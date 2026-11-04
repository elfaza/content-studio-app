import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { google } from "googleapis";
import { CodeChallengeMethod } from "google-auth-library";
import { z } from "zod";
import { GoogleOAuthError } from "./google-errors";
import {
  credentialPath,
  readPrivate,
  writePrivate,
  googleStoragePath,
  encryptCredential,
  decryptCredential,
  readGoogleCredential,
  saveGoogleCredential,
} from "./google-credential-store";

export const oauthStateCookie = "cs-google-state";
export const oauthMode = () => process.env.GOOGLE_AUTH_MODE === "oauth";
export const oauthConfigured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export async function oauthReady() {
  return oauthConfigured() && !!(await readGoogleCredential());
}
export function googleCallbackUrl() {
  try {
    const origin = new URL(process.env.APP_ORIGIN || "");
    if (
      origin.protocol !== "https:" &&
      !(
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(origin.hostname)
      )
    )
      throw new Error();
    return new URL("/api/google/callback", origin).href;
  } catch {
    throw new GoogleOAuthError("The Google return address must use HTTPS.");
  }
}
export function directGoogleClient() {
  if (!oauthConfigured())
    throw new GoogleOAuthError("Google OAuth is not configured for this app.");
  return new google.auth.OAuth2({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: googleCallbackUrl(),
    transporterOptions: { retry: false },
  });
}
const attemptSchema = z
  .object({
    state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
    browserDigest: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.number(),
    credentialEtag: z.string().max(200).nullable(),
  })
  .strict();
type OAuthState = z.infer<typeof attemptSchema>;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const attemptPath = (state: string) =>
  googleStoragePath("attempts/" + digest(state) + ".json");
const claimPath = (state: string) =>
  googleStoragePath("claims/" + digest(state) + ".json");
export async function beginDirectGoogleAuthorization() {
  const state = randomBytes(32).toString("base64url"),
    browser = randomBytes(32).toString("base64url"),
    verifier = randomBytes(48).toString("base64url");
  const client = directGoogleClient();
  const saved = await readPrivate(credentialPath());
  const payload: OAuthState = {
    state,
    verifier,
    browserDigest: digest(browser),
    createdAt: Date.now(),
    credentialEtag: saved?.etag ?? null,
  };
  await writePrivate(
    attemptPath(state),
    encryptCredential(payload, "oauth-attempt"),
  );
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      process.env.GOOGLE_SHEETS_WRITES_ENABLED === "true"
        ? "https://www.googleapis.com/auth/spreadsheets"
        : "https://www.googleapis.com/auth/spreadsheets.readonly",
    ],
    state,
    code_challenge: digestBase64(verifier),
    code_challenge_method: CodeChallengeMethod.S256,
  });
  // Only a random browser binding is in the cookie. PKCE stays encrypted on the server.
  return { url, cookie: browser };
}
const digestBase64 = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
export async function openOAuthState(
  browser: string | undefined,
  state: string | null,
  now = Date.now(),
): Promise<OAuthState> {
  if (
    !browser ||
    !/^[A-Za-z0-9_-]{43}$/.test(browser) ||
    !state ||
    !/^[A-Za-z0-9_-]{43}$/.test(state)
  )
    throw invalidAttempt();
  const saved = await readPrivate(attemptPath(state));
  if (!saved) throw invalidAttempt();
  try {
    const payload = attemptSchema.parse(
      decryptCredential(saved.text, "oauth-attempt"),
    );
    if (
      !timingSafeEqual(
        Buffer.from(payload.browserDigest),
        Buffer.from(digest(browser)),
      ) ||
      payload.state !== state ||
      now - payload.createdAt > 600000 ||
      payload.createdAt > now + 60000
    )
      throw new Error();
    return payload;
  } catch {
    throw invalidAttempt();
  }
}
function invalidAttempt() {
  return new GoogleOAuthError(
    "This Google connection attempt expired or could not be verified. Return to Settings and reconnect Google.",
    400,
    true,
  );
}
export async function finishDirectGoogleAuthorization(
  code: string,
  state: OAuthState,
) {
  if (!code || code.length > 4096) throw invalidAttempt();
  // Never delete or release this claim, even after provider/storage failure.
  // Atomic create-only writes make callbacks single-use across all instances.
  await writePrivate(
    claimPath(state.state),
    JSON.stringify({ claimedAt: Date.now() }),
  );
  let refreshToken: string | undefined | null;
  try {
    const { tokens } = await directGoogleClient().getToken({
      code,
      codeVerifier: state.verifier,
      redirect_uri: googleCallbackUrl(),
    });
    refreshToken = tokens.refresh_token;
  } catch {
    throw new GoogleOAuthError(
      "Google could not complete authorization. Return to Settings and reconnect Google.",
      428,
      true,
    );
  }
  if (!refreshToken)
    throw new GoogleOAuthError(
      "Google did not grant offline access. Return to Settings and reconnect Google.",
      428,
      true,
    );
  await saveGoogleCredential(refreshToken, state.credentialEtag);
  return { connected: true };
}
export async function connectedGoogleClient() {
  const saved = await readGoogleCredential();
  if (!saved)
    throw new GoogleOAuthError(
      "Connect Google in Settings to access your tracker.",
      428,
      true,
    );
  // No module/global client cache: every request reads the current credential
  // from origin storage and starts without a previous credential's access token.
  const auth = directGoogleClient();
  auth.setCredentials({ refresh_token: saved.refreshToken });
  try {
    await auth.getAccessToken();
  } catch (error) {
    const e = error as { response?: { data?: { error?: string } } };
    if (
      e.response?.data?.error === "invalid_grant" ||
      e.response?.data?.error === "invalid_client"
    )
      throw new GoogleOAuthError(
        "Google authorization expired or was revoked. Reconnect Google in Settings.",
        428,
        true,
      );
    throw new GoogleOAuthError(
      "Google authorization is temporarily unavailable. Please try again later.",
    );
  }
  return auth;
}
export function credentialSuccessPage() {
  const nonce = randomBytes(24).toString("base64");
  return {
    nonce,
    html:
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google connected · Content Studio</title></head><body><main><p>CONTENT STUDIO</p><h1>Google is connected.</h1><p>Your connection was saved securely. You can return to your workspace now.</p><a href="/settings">Continue to app</a><p class="note">If your Google OAuth app is in Testing, Google requires reauthorization after seven days. Just reconnect, choose your account, and approve access.</p></main><style nonce="' +
      nonce +
      '">body{margin:0;background:#f5f6f8;color:#202b3d;font:16px/1.7 system-ui}main{max-width:600px;margin:10vh auto;padding:28px}h1{font-size:32px;line-height:1.25}a{display:inline-block;background:#275bc5;color:white;text-decoration:none;padding:12px 20px;border-radius:9px;margin:16px 0}.note{color:#56657b;font-size:14px}</style></body></html>',
  };
}
