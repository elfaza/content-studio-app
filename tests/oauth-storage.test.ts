import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
const m = vi.hoisted(() => ({
  blobs: new Map<string, { text: string; etag: string }>(),
  serial: 0,
  get: vi.fn(),
  put: vi.fn(),
  generate: vi.fn(),
  exchange: vi.fn(),
  access: vi.fn(),
  readFailure: false,
  writeFailure: "",
  cookies: new Map<string, string>(),
}));
vi.mock("@vercel/blob", () => ({ get: m.get, put: m.put }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) =>
      m.cookies.has(k) ? { value: m.cookies.get(k) } : undefined,
  }),
}));
vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        credentials: Record<string, string> = {};
        generateAuthUrl = m.generate;
        getToken = m.exchange;
        setCredentials(c: Record<string, string>) {
          this.credentials = c;
        }
        getAccessToken() {
          return m.access(this.credentials);
        }
      },
    },
  },
}));
import {
  beginDirectGoogleAuthorization,
  openOAuthState,
  finishDirectGoogleAuthorization,
  connectedGoogleClient,
  credentialSuccessPage,
  googleCallbackUrl,
  oauthStateCookie,
} from "../src/lib/google-oauth";
import {
  encryptCredential,
  decryptCredential,
  readGoogleCredential,
  saveGoogleCredential,
  credentialPath,
} from "../src/lib/google-credential-store";
import { NextRequest } from "next/server";
import { GET as callback } from "../src/app/api/google/callback/route";
import { POST as start, GET as status } from "../src/app/api/google/route";
import { token } from "../src/lib/auth";
beforeEach(() => {
  vi.clearAllMocks();
  m.blobs.clear();
  m.cookies.clear();
  m.serial = 0;
  m.readFailure = false;
  m.writeFailure = "";
  for (const [k, v] of Object.entries({
    SESSION_SECRET: "fake-session-secret-at-least-32-characters",
    APP_PASSWORD: "fake-password-at-least-16",
    GOOGLE_CLIENT_ID: "fake-client",
    GOOGLE_CLIENT_SECRET: "fake-secret",
    GOOGLE_AUTH_MODE: "oauth",
    GOOGLE_REFRESH_TOKEN: "",
    GOOGLE_SHEETS_WRITES_ENABLED: "true",
    APP_ORIGIN: "https://studio.example.com",
    BLOB_READ_WRITE_TOKEN: "fake-blob-token",
    VERCEL_BLOB_RETRIES: "0",
  }))
    vi.stubEnv(k, v);
  m.generate.mockReturnValue("https://accounts.google.com/o/oauth2/v2/auth");
  m.exchange.mockResolvedValue({
    tokens: { refresh_token: "fake-refresh", access_token: "fake-access" },
  });
  m.access.mockResolvedValue({ token: "fake-access" });
  m.get.mockImplementation(async (path: string, options: unknown) => {
    expect(options).toMatchObject({ access: "private", useCache: false });
    if (m.readFailure) throw Error("provider-secret");
    const b = m.blobs.get(path);
    return b
      ? {
          statusCode: 200,
          stream: new Blob([b.text]).stream(),
          blob: { etag: b.etag, size: Buffer.byteLength(b.text) },
        }
      : null;
  });
  m.put.mockImplementation(
    async (
      path: string,
      text: string,
      o: { allowOverwrite: boolean; ifMatch?: string },
    ) => {
      expect(process.env.VERCEL_BLOB_RETRIES).toBe("0");
      expect(o).toMatchObject({ access: "private", addRandomSuffix: false });
      if (m.writeFailure === "before") throw Error("provider-secret");
      const old = m.blobs.get(path);
      if ((!o.allowOverwrite && old) || (o.ifMatch && old?.etag !== o.ifMatch))
        throw Error("precondition");
      const etag = '"version-' + ++m.serial + '"';
      m.blobs.set(path, { text, etag });
      if (m.writeFailure === "after") throw Error("uncertain-provider-secret");
      return { etag };
    },
  );
});
afterEach(() => vi.unstubAllEnvs());
async function attempt() {
  const flow = await beginDirectGoogleAuthorization();
  const params = m.generate.mock.calls.at(-1)![0];
  return {
    flow,
    params,
    state: await openOAuthState(flow.cookie, params.state),
  };
}
it("uses random IVs and detects ciphertext, tag, key, scope, and purpose tampering", () => {
  const value = { refreshToken: "private-fake-refresh" },
    a = encryptCredential(value),
    b = encryptCredential(value);
  expect(a).not.toBe(b);
  expect(a).not.toContain(value.refreshToken);
  expect(decryptCredential(a)).toEqual(value);
  const e = JSON.parse(a),
    bytes = Buffer.from(e.ciphertext, "base64url");
  bytes[0] ^= 1;
  e.ciphertext = bytes.toString("base64url");
  expect(() => decryptCredential(JSON.stringify(e))).toThrow("verified");
  const tag = JSON.parse(a);
  tag.tag = Buffer.alloc(16).toString("base64url");
  expect(() => decryptCredential(JSON.stringify(tag))).toThrow();
  expect(() => decryptCredential(a, "oauth-attempt")).toThrow();
  vi.stubEnv("GOOGLE_CLIENT_ID", "other-client");
  expect(() => decryptCredential(a)).toThrow();
  vi.stubEnv("GOOGLE_CLIENT_ID", "fake-client");
  vi.stubEnv("APP_ORIGIN", "https://other.example.com");
  expect(() => decryptCredential(a)).toThrow();
  vi.stubEnv("APP_ORIGIN", "https://studio.example.com");
  vi.stubEnv("SESSION_SECRET", "another-secret-at-least-32-characters");
  expect(() => decryptCredential(a)).toThrow();
});
it("uses offline consent and S256 while keeping the verifier server-side", async () => {
  const { flow, params, state } = await attempt();
  expect(params).toMatchObject({
    access_type: "offline",
    prompt: "consent",
    code_challenge_method: "S256",
    scope: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  expect(params.code_challenge).toBe(
    createHash("sha256").update(state.verifier).digest("base64url"),
  );
  expect(flow.cookie).not.toContain(state.verifier);
  expect(flow.cookie).not.toBe(params.state);
  for (const b of m.blobs.values())
    expect(b.text).not.toContain(state.verifier);
  expect(googleCallbackUrl()).toBe(
    "https://studio.example.com/api/google/callback",
  );
});
it("rejects wrong browser, absent, expired, and tampered state", async () => {
  const { flow, params, state } = await attempt();
  await expect(openOAuthState("x".repeat(43), params.state)).rejects.toThrow(
    "verified",
  );
  await expect(openOAuthState(undefined, params.state)).rejects.toThrow();
  await expect(openOAuthState(flow.cookie, "z".repeat(43))).rejects.toThrow();
  await expect(
    openOAuthState(flow.cookie, params.state, state.createdAt + 600001),
  ).rejects.toThrow("expired");
  const path = [...m.blobs.keys()].find((k) => k.includes("attempts/"))!;
  m.blobs.get(path)!.text = "tampered";
  await expect(openOAuthState(flow.cookie, params.state)).rejects.toThrow();
});
it("claims before exchanging, stores encrypted credentials, and returns no token", async () => {
  const { state } = await attempt();
  m.exchange.mockImplementationOnce(async () => {
    expect([...m.blobs.keys()].some((k) => k.includes("claims/"))).toBe(true);
    return {
      tokens: {
        refresh_token: "private-refresh",
        access_token: "private-access",
      },
    };
  });
  await expect(finishDirectGoogleAuthorization("code", state)).resolves.toEqual(
    { connected: true },
  );
  expect(m.exchange).toHaveBeenCalledWith({
    code: "code",
    codeVerifier: state.verifier,
    redirect_uri: googleCallbackUrl(),
  });
  expect(m.blobs.get(credentialPath())!.text).not.toContain("private-refresh");
  expect((await readGoogleCredential())?.refreshToken).toBe("private-refresh");
});
it("prevents concurrent callback replay across independent server instances", async () => {
  const { state } = await attempt();
  vi.resetModules();
  const other = await import("../src/lib/google-oauth");
  const results = await Promise.allSettled([
    finishDirectGoogleAuthorization("first", state),
    other.finishDirectGoogleAuthorization("second", state),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(m.exchange).toHaveBeenCalledTimes(1);
});
it("keeps claims consumed after a failed code exchange", async () => {
  const { state } = await attempt();
  m.exchange.mockRejectedValue(Error("fake-secret"));
  await expect(finishDirectGoogleAuthorization("code", state)).rejects.toThrow(
    "Google could not complete",
  );
  await expect(finishDirectGoogleAuthorization("code", state)).rejects.toThrow(
    "not retried",
  );
  expect(m.exchange).toHaveBeenCalledTimes(1);
});
it("never retries an uncertain state claim even if it committed", async () => {
  const { state } = await attempt();
  m.writeFailure = "after";
  const count = m.put.mock.calls.length;
  await expect(finishDirectGoogleAuthorization("code", state)).rejects.toThrow(
    "not retried",
  );
  expect(m.put.mock.calls.length).toBe(count + 1);
  expect(m.exchange).not.toHaveBeenCalled();
  m.writeFailure = "";
  await expect(
    finishDirectGoogleAuthorization("code", state),
  ).rejects.toThrow();
  expect(m.exchange).not.toHaveBeenCalled();
});
it("never retries uncertain credential writes or switches to legacy after a committed write", async () => {
  vi.stubEnv("GOOGLE_REFRESH_TOKEN", "old-legacy");
  m.writeFailure = "after";
  await expect(saveGoogleCredential("new-refresh", null)).rejects.toThrow(
    "not retried",
  );
  expect(m.put).toHaveBeenCalledTimes(1);
  m.writeFailure = "";
  expect((await readGoogleCredential())?.refreshToken).toBe("new-refresh");
});
it("uses legacy only for confirmed absence and fails closed on read/decrypt failures", async () => {
  vi.stubEnv("GOOGLE_REFRESH_TOKEN", "fake-legacy");
  expect((await readGoogleCredential())?.source).toBe("legacy");
  await saveGoogleCredential("saved-refresh", null);
  expect((await readGoogleCredential())?.refreshToken).toBe("saved-refresh");
  m.readFailure = true;
  await expect(readGoogleCredential()).rejects.toThrow("could not be read");
  m.readFailure = false;
  m.blobs.get(credentialPath())!.text = "corrupt";
  await expect(readGoogleCredential()).rejects.toThrow("verified");
});
it("fails closed if Blob or retry configuration is missing", async () => {
  vi.stubEnv("GOOGLE_REFRESH_TOKEN", "legacy");
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  await expect(readGoogleCredential()).rejects.toThrow(
    "storage is unavailable",
  );
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "test");
  vi.stubEnv("VERCEL_BLOB_RETRIES", "10");
  await expect(saveGoogleCredential("fake", null)).rejects.toThrow("retries");
  expect(m.put).not.toHaveBeenCalled();
});
it("does not let older attempts overwrite a newer completed reconnect", async () => {
  const a = await attempt(),
    b = await attempt();
  await finishDirectGoogleAuthorization("new", b.state);
  await expect(finishDirectGoogleAuthorization("old", a.state)).rejects.toThrow(
    "another connection changed",
  );
});
it("every instance uses a replaced credential on its next request with a fresh access-token cache", async () => {
  await saveGoogleCredential("old-refresh", null);
  const first = await connectedGoogleClient();
  vi.resetModules();
  const other = await import("../src/lib/google-oauth");
  await other.connectedGoogleClient();
  await saveGoogleCredential(
    "new-refresh",
    m.blobs.get(credentialPath())!.etag,
  );
  const a = await connectedGoogleClient(),
    b = await other.connectedGoogleClient();
  expect(a).not.toBe(first);
  expect(b).not.toBe(a);
  expect(m.access.mock.calls.map((c) => c[0].refresh_token)).toEqual([
    "old-refresh",
    "old-refresh",
    "new-refresh",
    "new-refresh",
  ]);
  expect(m.access.mock.calls.every((c) => !c[0].access_token)).toBe(true);
});
it("automatically refreshes access tokens and sanitizes revoked grants", async () => {
  await saveGoogleCredential("fake-refresh", null);
  await connectedGoogleClient();
  expect(m.access).toHaveBeenCalledTimes(1);
  m.access.mockRejectedValue({
    response: { data: { error: "invalid_grant", secret: "private" } },
  });
  await expect(connectedGoogleClient()).rejects.toMatchObject({
    status: 428,
    reconnect: true,
    message: expect.stringContaining("Reconnect Google"),
  });
});
it("rejects unauthorized and cross-origin initiation before writing state", async () => {
  const req = (origin: string) =>
    new NextRequest("https://studio.example.com/api/google", {
      method: "POST",
      headers: { host: "studio.example.com", origin },
    });
  expect((await start(req("https://studio.example.com"))).status).toBe(401);
  m.cookies.set("cs-session", token());
  expect((await start(req("https://evil.example.com"))).status).toBe(403);
  expect(m.put).not.toHaveBeenCalled();
  const response = await start(req("https://studio.example.com"));
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(JSON.stringify(await response.json())).not.toContain("fake-secret");
});
it("callback stores credentials once and renders a token-free no-store success page", async () => {
  const { flow, params } = await attempt();
  m.cookies.set(oauthStateCookie, flow.cookie);
  const req = () =>
    new NextRequest(
      "https://studio.example.com/api/google/callback?code=private-code&state=" +
        params.state,
    );
  const response = await callback(req()),
    html = await response.text();
  expect(response.status).toBe(200);
  expect(html).toContain("Continue to app");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  for (const s of [
    "fake-refresh",
    "fake-access",
    "private-code",
    "fake-secret",
  ])
    expect(html).not.toContain(s);
  expect((await callback(req())).status).toBe(503);
  expect(m.exchange).toHaveBeenCalledTimes(1);
});
it("connection status sanitizes storage errors", async () => {
  m.cookies.set("cs-session", token());
  m.readFailure = true;
  const response = await status();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("provider-secret");
});
it("success page explains Testing expiration without copy-token instructions", () => {
  const { html } = credentialSuccessPage();
  expect(html).toContain("seven days");
  expect(html).not.toContain("<input");
  expect(html).not.toContain("refresh_token");
  expect(html).not.toContain("localStorage");
  expect(html).not.toContain("redeploy");
});
