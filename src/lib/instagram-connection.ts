import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { readPrivate, writePrivate } from "./google-credential-store";

export class InstagramError extends Error {
  constructor(
    message: string,
    public status = 503,
    public reconnect = false,
  ) {
    super(message);
  }
}
export const instagramConfigured = () =>
  systemInstagramConfigured() || instagramOAuthConfigured();
const instagramOAuthConfigured = () =>
  !!(
    process.env.META_APP_ID &&
    process.env.META_APP_SECRET &&
    process.env.META_INSTAGRAM_CONFIG_ID
  );
export const systemInstagramConfigured = () =>
  !!process.env.META_INSTAGRAM_SYSTEM_USER_TOKEN;

// Import only through an authenticated explicit connection action. Never use
// the environment token as a fallback when saved credentials fail.
export async function connectInstagramSystemUser() {
  const token = process.env.META_INSTAGRAM_SYSTEM_USER_TOKEN?.trim();
  const accountId = process.env.META_INSTAGRAM_ACCOUNT_ID || "";
  const systemUserId = process.env.META_INSTAGRAM_SYSTEM_USER_ID || "";
  if (
    !token ||
    token.length > 16000 ||
    !/^\d+$/.test(accountId) ||
    !/^\d+$/.test(systemUserId)
  )
    throw new InstagramError(
      "Instagram System User setup is incomplete on the server.",
    );
  const saved = await readInstagramPrivate(instagramPath("credential.v1.json"));
  const { instagramGraph } = await import("./instagram-graph");
  const identity = await instagramGraph("me", token, { fields: "id" });
  if (identity.id !== systemUserId)
    throw new InstagramError(
      "The server token belongs to a different System User. Check the Content Studio token in server settings.",
      428,
      true,
    );
  const profile = await instagramGraph(accountId, token, {
    fields: "id,username",
  });
  if (
    profile.id !== accountId ||
    typeof profile.username !== "string" ||
    !profile.username ||
    profile.username.length > 200
  )
    throw new InstagramError(
      "The configured Instagram account could not be verified. Check the account's assigned assets.",
      428,
      true,
    );
  // Read-only access check. Insights coverage is confirmed by the first sync.
  const media = await instagramGraph(`${accountId}/media`, token, {
    fields: "id",
    limit: "1",
  });
  if (!Array.isArray(media.data))
    throw new InstagramError(
      "Instagram media access could not be verified.",
      428,
      true,
    );
  const payload = credentialSchema.parse({
    accessToken: token,
    accountId,
    username: profile.username,
    // The token's issuance/expiry is unknown; never invent a new 60-day lifetime.
    expiresAt: null,
    savedAt: Date.now(),
    revision: randomUUID(),
  });
  await writeInstagramPrivate(
    instagramPath("credential.v1.json"),
    sealInstagram(payload),
    saved?.etag ?? null,
  );
  return { username: payload.username };
}
export function instagramOrigin() {
  try {
    const url = new URL(process.env.APP_ORIGIN || "");
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )
    )
      throw Error();
    return url.origin;
  } catch {
    throw new InstagramError("Instagram return address is not configured.");
  }
}
export const instagramCallback = () =>
  instagramOrigin() + "/api/instagram/callback";
export function graphVersion() {
  const value = process.env.META_GRAPH_VERSION || "v25.0";
  if (!/^v\d+\.0$/.test(value))
    throw new InstagramError("Instagram API version is not configured.");
  return value;
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
function security(purpose: "credential" | "attempt") {
  const secret = process.env.SESSION_SECRET,
    appId = process.env.META_APP_ID;
  if (!secret || secret.length < 32 || !appId)
    throw new InstagramError(
      "Instagram connection security is not configured.",
    );
  const scope = digest(
    JSON.stringify(["content-studio", "instagram", appId, instagramOrigin()]),
  );
  const aad = Buffer.from(`content-studio/instagram/${scope}/${purpose}/v1`);
  return {
    scope,
    aad,
    key: Buffer.from(
      hkdfSync("sha256", secret, Buffer.from(scope, "hex"), aad, 32),
    ),
  };
}
export function instagramPath(suffix: string) {
  return `content-studio/instagram/${security("credential").scope}/${suffix}`;
}
export function sealInstagram(
  value: unknown,
  purpose: "credential" | "attempt" = "credential",
) {
  const { key, aad } = security(purpose),
    iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  });
}
export function openInstagram(
  text: string,
  purpose: "credential" | "attempt" = "credential",
): unknown {
  try {
    const data = z
      .object({
        v: z.literal(1),
        iv: z.string().max(30),
        tag: z.string().max(30),
        ciphertext: z.string().max(50000),
      })
      .strict()
      .parse(JSON.parse(text));
    const { key, aad } = security(purpose),
      iv = Buffer.from(data.iv, "base64url"),
      tag = Buffer.from(data.tag, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(data.ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new InstagramError(
      "Saved Instagram connection could not be verified. Reconnect Instagram.",
      503,
      true,
    );
  }
}
export async function readInstagramPrivate(path: string) {
  try {
    return await readPrivate(path);
  } catch {
    throw new InstagramError(
      "Instagram connection storage is unavailable. Try again later.",
    );
  }
}
export async function writeInstagramPrivate(
  path: string,
  text: string,
  etag: string | null = null,
) {
  try {
    return await writePrivate(path, text, etag);
  } catch {
    throw new InstagramError(
      "The Instagram connection write could not be confirmed or another connection changed. Reconnect from Settings. This write was not retried.",
      503,
      true,
    );
  }
}
const credentialSchema = z
  .object({
    accessToken: z.string().min(1).max(16000),
    accountId: z.string().regex(/^\d+$/),
    username: z.string().max(200),
    expiresAt: z.number().nullable(),
    savedAt: z.number(),
    revision: z.string().uuid(),
  })
  .strict();
export async function readInstagramCredential() {
  const stored = await readInstagramPrivate(
    instagramPath("credential.v1.json"),
  );
  if (!stored) return null;
  let credential;
  try {
    credential = credentialSchema.parse(openInstagram(stored.text));
  } catch {
    throw new InstagramError(
      "Saved Instagram connection could not be verified. Reconnect Instagram.",
      503,
      true,
    );
  }
  if (
    credential.expiresAt !== null &&
    credential.expiresAt <= Date.now() + 60000
  )
    throw new InstagramError(
      "Instagram access expired. Reconnect Instagram in Settings.",
      428,
      true,
    );
  return credential;
}
const attemptSchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    browserDigest: z.string().length(64),
    createdAt: z.number(),
    etag: z.string().nullable(),
  })
  .strict();
export const instagramCookie = "cs-instagram-state";
const invalidState = () =>
  new InstagramError(
    "This Instagram connection attempt expired or could not be verified. Return to Settings and reconnect.",
    400,
    true,
  );
export async function beginInstagram() {
  if (!instagramOAuthConfigured())
    throw new InstagramError(
      "Instagram is not configured yet. Add the Meta app credentials in server settings.",
    );
  const state = randomBytes(32).toString("base64url"),
    browser = randomBytes(32).toString("base64url");
  const saved = await readInstagramPrivate(instagramPath("credential.v1.json"));
  await writeInstagramPrivate(
    instagramPath(`attempts/${digest(state)}.json`),
    sealInstagram(
      {
        state,
        browserDigest: digest(browser),
        createdAt: Date.now(),
        etag: saved?.etag ?? null,
      },
      "attempt",
    ),
  );
  const url = new URL(
    `https://www.facebook.com/${graphVersion()}/dialog/oauth`,
  );
  url.search = new URLSearchParams({
    client_id: process.env.META_APP_ID!,
    config_id: process.env.META_INSTAGRAM_CONFIG_ID!,
    redirect_uri: instagramCallback(),
    response_type: "code",
    state,
    override_default_response_type: "true",
  }).toString();
  return { url: url.href, cookie: browser };
}
export async function instagramState(
  browser: string | undefined,
  state: string | null,
  now = Date.now(),
) {
  if (
    !browser ||
    !/^[A-Za-z0-9_-]{43}$/.test(browser) ||
    !state ||
    !/^[A-Za-z0-9_-]{43}$/.test(state)
  )
    throw invalidState();
  const saved = await readInstagramPrivate(
    instagramPath(`attempts/${digest(state)}.json`),
  );
  if (!saved) throw invalidState();
  try {
    const attempt = attemptSchema.parse(openInstagram(saved.text, "attempt"));
    if (
      attempt.state !== state ||
      now - attempt.createdAt > 600000 ||
      attempt.createdAt > now + 60000 ||
      !timingSafeEqual(
        Buffer.from(attempt.browserDigest),
        Buffer.from(digest(browser)),
      )
    )
      throw Error();
    return attempt;
  } catch {
    throw invalidState();
  }
}
export async function finishInstagram(
  code: string,
  attempt: z.infer<typeof attemptSchema>,
) {
  if (!code || code.length > 4096 || !instagramOAuthConfigured())
    throw invalidState();
  await writeInstagramPrivate(
    instagramPath(`claims/${digest(attempt.state)}.json`),
    JSON.stringify({ claimedAt: Date.now() }),
  );
  let result;
  try {
    const response = await fetch(
      `https://graph.facebook.com/${graphVersion()}/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.META_APP_ID!,
          client_secret: process.env.META_APP_SECRET!,
          redirect_uri: instagramCallback(),
          code,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw Error();
    result = z
      .object({
        access_token: z.string().min(1).max(16000),
        expires_in: z.number().nonnegative().optional(),
      })
      .parse(await response.json());
  } catch {
    throw new InstagramError(
      "Instagram authorization could not be completed. Return to Settings and reconnect.",
      428,
      true,
    );
  }
  const { instagramGraph } = await import("./instagram-graph");
  const accounts = await instagramGraph(
    "me/assigned_instagram_accounts",
    result.access_token,
    { fields: "id,username", limit: "2" },
  );
  const rows = z
    .array(
      z.object({
        id: z.string().regex(/^\d+$/),
        username: z.string().max(200),
      }),
    )
    .parse(accounts.data);
  if (rows.length === 0)
    throw new InstagramError(
      "Meta approved authorization, but its API returned no assigned Instagram accounts. Your account selection may be correct. Check Instagram asset access in the selected business portfolio and the app's testing roles before reconnecting. No new connection was saved. Reference: IG_NO_ASSIGNED_ACCOUNT.",
      428,
      true,
    );
  if (rows.length > 1 || accounts.paging?.next)
    throw new InstagramError(
      "Meta returned more than one assigned Instagram account. Select exactly one Instagram account when connecting, then try again. No new connection was saved. Reference: IG_MULTIPLE_ASSIGNED_ACCOUNTS.",
      428,
      true,
    );
  const payload = credentialSchema.parse({
    accessToken: result.access_token,
    accountId: rows[0].id,
    username: rows[0].username,
    expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : null,
    savedAt: Date.now(),
    revision: randomUUID(),
  });
  await writeInstagramPrivate(
    instagramPath("credential.v1.json"),
    sealInstagram(payload),
    attempt.etag,
  );
}
