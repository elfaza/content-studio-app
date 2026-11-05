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

export class TikTokError extends Error {
  constructor(
    message: string,
    public status = 503,
    public reconnect = false,
  ) {
    super(message);
  }
}
export const tiktokConfigured = () =>
  !!(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
export const tiktokCookie = "cs-tiktok-state";
export function tiktokOrigin() {
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
    throw new TikTokError("TikTok return address is not configured.");
  }
}
export const tiktokCallback = () => tiktokOrigin() + "/api/tiktok/callback";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
function security(purpose: "credential" | "attempt") {
  const secret = process.env.SESSION_SECRET,
    client = process.env.TIKTOK_CLIENT_KEY;
  if (!secret || secret.length < 32 || !client)
    throw new TikTokError("TikTok connection security is not configured.");
  const scope = digest(
    JSON.stringify(["content-studio", "tiktok", client, tiktokOrigin()]),
  );
  const aad = Buffer.from(`content-studio/tiktok/${scope}/${purpose}/v1`);
  return {
    scope,
    aad,
    key: Buffer.from(
      hkdfSync("sha256", secret, Buffer.from(scope, "hex"), aad, 32),
    ),
  };
}
export const tiktokPath = (suffix: string) =>
  `content-studio/tiktok/${security("credential").scope}/${suffix}`;
export function sealTikTok(
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
export function openTikTok(
  text: string,
  purpose: "credential" | "attempt" = "credential",
): unknown {
  try {
    const e = z
      .object({
        v: z.literal(1),
        iv: z.string().max(30),
        tag: z.string().max(30),
        ciphertext: z.string().max(60000),
      })
      .strict()
      .parse(JSON.parse(text));
    const { key, aad } = security(purpose),
      iv = Buffer.from(e.iv, "base64url"),
      tag = Buffer.from(e.tag, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw Error();
    const cipher = createDecipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    cipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([
        cipher.update(Buffer.from(e.ciphertext, "base64url")),
        cipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new TikTokError(
      "Saved TikTok connection could not be verified. Reconnect TikTok.",
      503,
      true,
    );
  }
}
async function read(path: string) {
  try {
    return await readPrivate(path);
  } catch {
    throw new TikTokError(
      "TikTok connection storage is unavailable. Try again later.",
    );
  }
}
async function write(path: string, text: string, etag: string | null = null) {
  try {
    return await writePrivate(path, text, etag);
  } catch {
    throw new TikTokError(
      "TikTok connection write could not be confirmed or another connection changed. Reconnect TikTok. This write was not retried.",
      503,
      true,
    );
  }
}
const credentialSchema = z
  .object({
    accessToken: z.string().min(1).max(16000),
    refreshToken: z.string().min(1).max(16000),
    openId: z.string().min(1).max(300),
    displayName: z.string().max(200),
    expiresAt: z.number().finite(),
    refreshExpiresAt: z.number().finite(),
    revision: z.string().uuid(),
    savedAt: z.number().finite(),
  })
  .strict();
export async function readTikTokCredential() {
  const stored = await read(tiktokPath("credential.v1.json"));
  if (!stored) return null;
  try {
    return {
      credential: credentialSchema.parse(openTikTok(stored.text)),
      etag: stored.etag,
    };
  } catch {
    throw new TikTokError(
      "Saved TikTok connection could not be verified. Reconnect TikTok.",
      503,
      true,
    );
  }
}
const tokenSchema = z.object({
  access_token: z.string().min(1).max(16000),
  refresh_token: z.string().min(1).max(16000),
  expires_in: z.number().int().positive(),
  refresh_expires_in: z.number().int().positive(),
  open_id: z.string().min(1).max(300),
  scope: z.string().max(2000),
  token_type: z.literal("Bearer"),
});
async function exchange(params: Record<string, string>) {
  try {
    const response = await fetch(
      "https://open.tiktokapis.com/v2/oauth/token/",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: process.env.TIKTOK_CLIENT_KEY!,
          client_secret: process.env.TIKTOK_CLIENT_SECRET!,
          ...params,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw Error();
    const text = await response.text();
    if (text.length > 100000) throw Error();
    const result = tokenSchema.parse(JSON.parse(text));
    const scopes = new Set(result.scope.split(","));
    if (!["user.info.basic", "video.list"].every((s) => scopes.has(s)))
      throw Error();
    return result;
  } catch {
    throw new TikTokError(
      "TikTok token exchange could not be confirmed or required access was not granted. Reconnect TikTok. The request was not retried.",
      428,
      true,
    );
  }
}
function tokenFields(result: z.infer<typeof tokenSchema>) {
  const now = Date.now();
  return {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    openId: result.open_id,
    expiresAt: now + result.expires_in * 1000,
    refreshExpiresAt: now + result.refresh_expires_in * 1000,
    savedAt: now,
    revision: randomUUID(),
  };
}
const attemptSchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    browserDigest: z.string().length(64),
    createdAt: z.number(),
    etag: z.string().nullable(),
  })
  .strict();
const stateError = () =>
  new TikTokError(
    "This TikTok connection attempt expired or could not be verified. Return to Settings and reconnect.",
    400,
    true,
  );
export async function beginTikTok() {
  if (!tiktokConfigured())
    throw new TikTokError(
      "TikTok is not configured yet. Add the TikTok client credentials on the server.",
    );
  const state = randomBytes(32).toString("base64url"),
    browser = randomBytes(32).toString("base64url");
  const saved = await read(tiktokPath("credential.v1.json"));
  await write(
    tiktokPath(`attempts/${digest(state)}.json`),
    sealTikTok(
      {
        state,
        browserDigest: digest(browser),
        createdAt: Date.now(),
        etag: saved?.etag ?? null,
      },
      "attempt",
    ),
  );
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.search = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY!,
    scope: "user.info.basic,video.list",
    redirect_uri: tiktokCallback(),
    response_type: "code",
    state,
    disable_auto_auth: "1",
  }).toString();
  return { url: url.href, cookie: browser };
}
export async function tiktokState(
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
    throw stateError();
  const saved = await read(tiktokPath(`attempts/${digest(state)}.json`));
  if (!saved) throw stateError();
  try {
    const attempt = attemptSchema.parse(openTikTok(saved.text, "attempt"));
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
    throw stateError();
  }
}
export async function finishTikTok(
  code: string,
  attempt: z.infer<typeof attemptSchema>,
) {
  if (!code || code.length > 4096 || !tiktokConfigured()) throw stateError();
  await write(
    tiktokPath(`claims/${digest(attempt.state)}.json`),
    JSON.stringify({ claimedAt: Date.now() }),
  );
  const result = await exchange({
    code,
    grant_type: "authorization_code",
    redirect_uri: tiktokCallback(),
  });
  const { tiktokApi } = await import("./tiktok-api");
  const data = await tiktokApi("user/info", result.access_token);
  const user = z
    .object({ open_id: z.string(), display_name: z.string().max(200) })
    .parse(data.user);
  if (user.open_id !== result.open_id)
    throw new TikTokError(
      "TikTok returned an inconsistent account identity. Reconnect TikTok.",
      428,
      true,
    );
  await write(
    tiktokPath("credential.v1.json"),
    sealTikTok(
      credentialSchema.parse({
        ...tokenFields(result),
        displayName: user.display_name,
      }),
    ),
    attempt.etag,
  );
}
export async function activeTikTokCredential() {
  const saved = await readTikTokCredential();
  if (!saved)
    throw new TikTokError("Connect TikTok in Settings first.", 428, true);
  const current = saved.credential;
  if (current.refreshExpiresAt <= Date.now() + 60000)
    throw new TikTokError(
      "TikTok access expired. Reconnect TikTok in Settings.",
      428,
      true,
    );
  if (current.expiresAt > Date.now() + 120000) return current;
  // A rotating refresh token must be consumed at most once across instances.
  try {
    await write(
      tiktokPath(`refresh-claims/${current.revision}.json`),
      JSON.stringify({ claimedAt: Date.now() }),
    );
  } catch {
    const latest = await readTikTokCredential();
    if (
      latest &&
      latest.credential.revision !== current.revision &&
      latest.credential.expiresAt > Date.now() + 120000
    )
      return latest.credential;
    throw new TikTokError(
      "TikTok refresh is in progress or a previous refresh could not be confirmed. Try Sync again shortly; reconnect if it persists. No request was retried.",
      409,
      true,
    );
  }
  const check = await readTikTokCredential();
  if (!check || check.credential.revision !== current.revision)
    throw new TikTokError("TikTok connection changed. Sync again.", 409);
  const result = await exchange({
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
  });
  if (result.open_id !== current.openId)
    throw new TikTokError(
      "TikTok refresh returned a different account. Reconnect TikTok.",
      428,
      true,
    );
  const next = credentialSchema.parse({
    ...tokenFields(result),
    displayName: current.displayName,
  });
  await write(tiktokPath("credential.v1.json"), sealTikTok(next), saved.etag);
  return next;
}
