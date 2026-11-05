import "server-only";
import { z } from "zod";
import { TikTokError, activeTikTokCredential } from "./tiktok-connection";
import { today, type RecordData } from "./domain";

export async function tiktokApi(
  endpoint: "user/info" | "video/query",
  token: string,
  ids: string[] = [],
): Promise<Record<string, unknown>> {
  const url = new URL(`https://open.tiktokapis.com/v2/${endpoint}/`);
  url.searchParams.set(
    "fields",
    endpoint === "user/info"
      ? "open_id,display_name"
      : "id,view_count,like_count,comment_count,share_count",
  );
  let response: Response,
    result: { data?: Record<string, unknown>; error?: { code?: string } };
  try {
    response = await fetch(url, {
      method: endpoint === "video/query" ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(endpoint === "video/query"
        ? { body: JSON.stringify({ filters: { video_ids: ids } }) }
        : {}),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    if (text.length > 2000000) throw Error();
    result = JSON.parse(text);
    if (!result || typeof result !== "object") throw Error();
  } catch {
    throw new TikTokError(
      "TikTok could not be reached. No statistics were saved. Try again later.",
    );
  }
  if (
    response.ok &&
    result.error?.code === "ok" &&
    result.data &&
    typeof result.data === "object"
  )
    return result.data;
  if (
    response.status === 401 ||
    [
      "access_token_invalid",
      "scope_not_authorized",
      "scope_permission_missed",
    ].includes(result.error?.code || "")
  )
    throw new TikTokError(
      "TikTok access expired, was revoked, or lacks permission. Reconnect TikTok in Settings.",
      428,
      true,
    );
  if (response.status === 429)
    throw new TikTokError(
      "TikTok is limiting requests. Wait before syncing again. No statistics were saved.",
      429,
    );
  throw new TikTokError(
    `TikTok could not complete the ${endpoint === "user/info" ? "account" : "video"} check. Check app access and try again. No statistics were saved.`,
  );
}
export function tiktokVideoId(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !["www.tiktok.com", "tiktok.com", "m.tiktok.com"].includes(
        url.hostname,
      ) ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    return url.pathname.match(/^\/@[^/]+\/video\/(\d{10,30})\/?$/)?.[1] || null;
  } catch {
    return null;
  }
}
export async function resolveTikTokVideoId(
  value: string,
  deadline = Date.now() + 15000,
) {
  const direct = tiktokVideoId(value);
  if (direct) return direct;
  let url: URL;
  try {
    url = new URL(value);
    if (
      !["vt.tiktok.com", "vm.tiktok.com"].includes(url.hostname) ||
      !/^\/[A-Za-z0-9_-]{1,100}\/?$/.test(url.pathname)
    )
      return null;
    for (let hop = 0; hop < 4; hop++) {
      if (Date.now() >= deadline) return null;
      if (
        url.protocol !== "https:" ||
        url.port ||
        url.username ||
        url.password ||
        ![
          "vt.tiktok.com",
          "vm.tiktok.com",
          "www.tiktok.com",
          "tiktok.com",
          "m.tiktok.com",
        ].includes(url.hostname)
      )
        return null;
      const id = tiktokVideoId(url.href);
      if (id) return id;
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(5000, deadline - Date.now())),
        ),
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return null;
      const location = response.headers.get("location");
      if (!location) return null;
      url = new URL(location, url);
    }
  } catch {
    return null;
  }
  return tiktokVideoId(url.href);
}
export type TikTokObservation = {
  videoId: string;
  videoVersion: string;
  tiktokUrl: string;
  date: string;
  fetchedAt: number;
  snapshotVersion?: string | null;
  metrics: Record<string, string>;
};
const count = z.number().safe().nonnegative();
const videoSchema = z.object({
  id: z.string().regex(/^\d{10,30}$/),
  view_count: count.nullish(),
  like_count: count.nullish(),
  comment_count: count.nullish(),
  share_count: count.nullish(),
});
export async function collectTikTok(videos: RecordData[]) {
  const credential = await activeTikTokCredential();
  const tracked = videos.filter((v) => !!v.tiktokUrl);
  if (tracked.length > 100)
    throw new TikTokError(
      "Sync currently supports up to 100 linked TikTok videos.",
      409,
    );
  const requested = new Map<string, RecordData>(),
    unmatched: string[] = [];
  const resolved: (string | null)[] = [];
  const linkDeadline = Date.now() + 60000;
  for (let i = 0; i < tracked.length; i += 4) {
    resolved.push(
      ...(await Promise.all(
        tracked
          .slice(i, i + 4)
          .map((video) => resolveTikTokVideoId(video.tiktokUrl, linkDeadline)),
      )),
    );
  }
  for (const [index, video] of tracked.entries()) {
    const id = resolved[index];
    if (!id) {
      unmatched.push(video.title);
      continue;
    }
    if (requested.has(id))
      throw new TikTokError(
        "Two content items use the same TikTok video link. Resolve the duplicate before syncing.",
        409,
      );
    requested.set(id, video);
  }
  const ids = [...requested.keys()],
    found = new Map<string, z.infer<typeof videoSchema>>();
  for (let offset = 0; offset < ids.length; offset += 20) {
    const batch = ids.slice(offset, offset + 20);
    const data = await tiktokApi("video/query", credential.accessToken, batch);
    const rows = z.array(videoSchema).max(20).parse(data.videos);
    for (const row of rows) {
      if (!batch.includes(row.id) || found.has(row.id))
        throw new TikTokError(
          "TikTok returned an inconsistent video match. No statistics were saved.",
          409,
        );
      found.set(row.id, row);
    }
  }
  const observations: TikTokObservation[] = [];
  for (const [id, video] of requested) {
    const row = found.get(id),
      metrics: Record<string, string> = {};
    if (row)
      for (const [field, key] of [
        ["view_count", "views"],
        ["like_count", "likes"],
        ["comment_count", "comments"],
        ["share_count", "shares"],
      ] as const) {
        if (row[field] != null) metrics[key] = String(row[field]);
      }
    if (!Object.keys(metrics).length) {
      unmatched.push(video.title);
      continue;
    }
    const fetchedAt = Date.now();
    observations.push({
      videoId: video.id,
      videoVersion: video.version,
      tiktokUrl: video.tiktokUrl,
      date: today(new Date(fetchedAt)),
      fetchedAt,
      metrics,
    });
  }
  return {
    observations,
    unmatched,
    displayName: credential.displayName,
    revision: credential.revision,
  };
}
