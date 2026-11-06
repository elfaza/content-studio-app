import "server-only";
import { z } from "zod";
import {
  InstagramError,
  graphVersion,
  readInstagramCredential,
} from "./instagram-connection";
import { today, type RecordData } from "./domain";

type GraphResult = {
  id?: unknown;
  username?: unknown;
  data?: unknown;
  paging?: { next?: string; cursors?: { after?: string } };
  error?: { code?: number; error_subcode?: number; message?: string };
};
export async function instagramGraph(
  path: string,
  token: string,
  params: Record<string, string> = {},
  optionalMetric = false,
  stage?: "identity_mapping",
): Promise<GraphResult> {
  if (
    !/^(me|\d+|me\/assigned_instagram_accounts|\d+\/(media|insights))$/.test(
      path,
    )
  )
    throw new InstagramError("Invalid Instagram request.");
  const url = new URL(`https://graph.facebook.com/${graphVersion()}/${path}`);
  const requestStage =
    stage ||
    (path === "me"
      ? "identity"
      : path.endsWith("/assigned_instagram_accounts")
        ? "assigned_accounts"
        : path.endsWith("/media")
          ? "media"
          : path.endsWith("/insights")
            ? "insights"
            : "profile");
  url.search = new URLSearchParams(params).toString();
  let response: Response, result: GraphResult;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    if (text.length > 2000000) throw Error();
    result = JSON.parse(text);
    if (!result || typeof result !== "object") throw Error();
  } catch {
    throw new InstagramError(
      "Instagram could not be reached. No statistics were saved. Try again later.",
    );
  }
  if (response.ok && !result.error) return result;
  // Never surface provider messages, request URLs, headers, or response bodies.
  // Only fixed stage names and numeric error codes are safe diagnostic details.
  const safeCode = Number.isSafeInteger(result.error?.code)
    ? result.error!.code
    : response.status;
  const safeSubcode = Number.isSafeInteger(result.error?.error_subcode)
    ? `_${result.error!.error_subcode}`
    : "";
  const reference = ` Reference: IG_${requestStage.toUpperCase()}_${safeCode}${safeSubcode}.`;
  if (result.error?.code === 190)
    throw new InstagramError(
      "Instagram access expired or was revoked. Reconnect Instagram in Settings." +
        reference,
      428,
      true,
    );
  if ([10, 200].includes(result.error?.code ?? 0))
    throw new InstagramError(
      "Meta denied access at the Instagram " +
        requestStage.replaceAll("_", " ") +
        " check. Check the token permissions and assigned assets." +
        reference,
      428,
      true,
    );
  if (
    optionalMetric &&
    result.error?.code === 100 &&
    /metric|not supported|not available/i.test(result.error.message || "")
  )
    return { data: [] };
  throw new InstagramError(
    "Meta could not complete the Instagram " +
      requestStage.replaceAll("_", " ") +
      " check. No statistics were saved." +
      reference,
  );
}
export function instagramShortcode(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["instagram.com", "www.instagram.com", "m.instagram.com"].includes(
        url.hostname,
      ) ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    return (
      url.pathname.match(/^\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)\/?$/)?.[1] ||
      null
    );
  } catch {
    return null;
  }
}
const count = z.number().finite().nonnegative();
const mediaSchema = z.object({
  id: z.string().regex(/^\d+$/),
  permalink: z.string(),
  like_count: count.nullish(),
  comments_count: count.nullish(),
  media_product_type: z.string().nullish(),
});
export type InstagramObservation = {
  videoId: string;
  videoVersion: string;
  igUrl: string;
  date: string;
  fetchedAt: number;
  snapshotVersion?: string | null;
  metrics: Record<string, string>;
};
export async function collectInstagram(videos: RecordData[]) {
  const credential = await readInstagramCredential();
  if (!credential)
    throw new InstagramError("Connect Instagram in Settings first.", 428, true);
  const tracked = videos.filter((v) => !!v.igUrl);
  if (tracked.length > 100)
    throw new InstagramError(
      "Sync currently supports up to 100 linked Instagram posts.",
      409,
    );
  const requested = new Map<string, RecordData>();
  const unmatched: string[] = [];
  for (const video of tracked) {
    const code = instagramShortcode(video.igUrl);
    if (!code) {
      unmatched.push(video.title);
      continue;
    }
    if (requested.has(code))
      throw new InstagramError(
        "Two content items use the same Instagram post link. Resolve the duplicate link before syncing.",
        409,
      );
    requested.set(code, video);
  }
  const found = new Map<string, z.infer<typeof mediaSchema>>();
  let after = "";
  const seen = new Set<string>();
  for (let page = 0; requested.size && page < 20; page++) {
    const result = await instagramGraph(
      `${credential.accountId}/media`,
      credential.accessToken,
      {
        fields: "id,permalink,like_count,comments_count,media_product_type",
        limit: "100",
        ...(after ? { after } : {}),
      },
    );
    const rows = z.array(mediaSchema).parse(result.data);
    for (const media of rows) {
      const code = instagramShortcode(media.permalink);
      if (!code || !requested.has(code)) continue;
      if (found.has(code) && found.get(code)!.id !== media.id)
        throw new InstagramError(
          "Instagram returned an ambiguous post match. No statistics were saved.",
          409,
        );
      found.set(code, media);
    }
    if (found.size === requested.size || !result.paging?.next) break;
    after = result.paging.cursors?.after || "";
    if (!after || seen.has(after) || after.length > 4000)
      throw new InstagramError(
        "Instagram pagination could not be verified. No statistics were saved.",
      );
    seen.add(after);
  }
  const observations: InstagramObservation[] = [];
  // Fetch every provider result before beginning any spreadsheet write.
  for (const [code, video] of requested) {
    const media = found.get(code);
    if (!media) {
      unmatched.push(video.title);
      continue;
    }
    const metrics: Record<string, string> = {};
    if (media.like_count != null) metrics.likes = String(media.like_count);
    if (media.comments_count != null)
      metrics.comments = String(media.comments_count);
    for (const [metric, key] of [
      ["views", "views"],
      ["shares", "shares"],
      ["saved", "saves"],
      ...(media.media_product_type === "REELS"
        ? [["ig_reels_avg_watch_time", "avgWatch"]]
        : []),
    ]) {
      const result = await instagramGraph(
        `${media.id}/insights`,
        credential.accessToken,
        { metric },
        true,
      );
      const rows = z
        .array(
          z.object({
            name: z.string(),
            values: z.array(z.object({ value: count.nullish() })).optional(),
            total_value: z.object({ value: count.nullish() }).optional(),
          }),
        )
        .parse(result.data);
      const row = rows.find((r) => r.name === metric);
      const value = row?.total_value?.value ?? row?.values?.at(-1)?.value;
      // Meta's Reels average watch time is milliseconds; the tracker stores
      // seconds and derives Avg. watched from the platform-specific duration.
      if (value != null)
        metrics[key] = String(
          metric === "ig_reels_avg_watch_time" ? value / 1000 : value,
        );
    }
    if (!Object.keys(metrics).length) {
      unmatched.push(video.title);
      continue;
    }
    const fetchedAt = Date.now();
    observations.push({
      videoId: video.id,
      videoVersion: video.version,
      igUrl: video.igUrl,
      date: today(new Date(fetchedAt)),
      fetchedAt,
      metrics,
    });
  }
  return { observations, unmatched, username: credential.username };
}
