import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  blobs: new Map<string, { text: string; etag: string }>(),
  serial: 0,
  get: vi.fn(),
  put: vi.fn(),
  fetch: vi.fn(),
  cookies: new Map<string, string>(),
  readFail: false,
  writeFail: "",
}));
vi.mock("@vercel/blob", () => ({ get: m.get, put: m.put }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) =>
      m.cookies.has(key) ? { value: m.cookies.get(key) } : undefined,
  }),
}));
import {
  beginTikTok,
  tiktokState,
  finishTikTok,
  sealTikTok,
  openTikTok,
  tiktokPath,
  readTikTokCredential,
  activeTikTokCredential,
} from "../src/lib/tiktok-connection";
import {
  collectTikTok,
  tiktokApi,
  tiktokVideoId,
  resolveTikTokVideoId,
} from "../src/lib/tiktok-api";
import { GET as status, POST as start } from "../src/app/api/tiktok/route";
import { GET as callback } from "../src/app/api/tiktok/callback/route";
import { POST as sync } from "../src/app/api/tiktok/sync/route";
import { token } from "../src/lib/auth";
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const tokenResult = (overrides = {}) => ({
  access_token: "private-access",
  refresh_token: "private-refresh",
  expires_in: 7200,
  refresh_expires_in: 15552000,
  open_id: "creator-id",
  scope: "user.info.basic,video.list",
  token_type: "Bearer",
  ...overrides,
});
beforeEach(() => {
  vi.clearAllMocks();
  m.blobs.clear();
  m.cookies.clear();
  m.serial = 0;
  m.readFail = false;
  m.writeFail = "";
  for (const [key, value] of Object.entries({
    TIKTOK_CLIENT_KEY: "client-key",
    TIKTOK_CLIENT_SECRET: "private-client-secret",
    SESSION_SECRET: "fake-session-secret-of-at-least-32-characters",
    APP_PASSWORD: "fake-password-at-least-16",
    APP_ORIGIN: "https://studio.example.com",
    BLOB_READ_WRITE_TOKEN: "fake-blob",
    VERCEL_BLOB_RETRIES: "0",
  }))
    vi.stubEnv(key, value);
  vi.stubGlobal("fetch", m.fetch);
  m.get.mockImplementation(async (path: string, options: unknown) => {
    expect(options).toMatchObject({ access: "private", useCache: false });
    if (m.readFail) throw Error("private-provider-token");
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
      options: { allowOverwrite: boolean; ifMatch?: string },
    ) => {
      expect(options).toMatchObject({
        access: "private",
        addRandomSuffix: false,
      });
      expect(process.env.VERCEL_BLOB_RETRIES).toBe("0");
      if (m.writeFail === "before") throw Error("private-secret");
      const b = m.blobs.get(path);
      if (
        (!options.allowOverwrite && b) ||
        (options.ifMatch && b?.etag !== options.ifMatch)
      )
        throw Error("precondition");
      const etag = '"' + ++m.serial + '"';
      m.blobs.set(path, { text, etag });
      if (m.writeFail === "after") throw Error("uncertain-private-token");
      return { etag };
    },
  );
  m.fetch.mockImplementation(
    async (url: URL | string, options: RequestInit) => {
      expect(String(url)).not.toMatch(/private-(access|refresh|client-secret)/);
      if (String(url).includes("/oauth/token/")) {
        expect(options.method).toBe("POST");
        expect(
          new URLSearchParams(String(options.body)).get("client_secret"),
        ).toBe("private-client-secret");
        return json(tokenResult());
      }
      expect(options.headers).toMatchObject({
        Authorization: "Bearer private-access",
      });
      return json({
        data: { user: { open_id: "creator-id", display_name: "Creator" } },
        error: { code: "ok" },
      });
    },
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function attempt() {
  const flow = await beginTikTok();
  const state = await tiktokState(
    flow.cookie,
    new URL(flow.url).searchParams.get("state"),
  );
  return { flow, state };
}
async function connected() {
  const { state } = await attempt();
  await finishTikTok("fake-code", state);
  m.fetch.mockClear();
  m.put.mockClear();
}
async function expireAccess() {
  const saved = (await readTikTokCredential())!;
  m.blobs.set(tiktokPath("credential.v1.json"), {
    text: sealTikTok({ ...saved.credential, expiresAt: Date.now() - 1 }),
    etag: saved.etag,
  });
}
it("encrypts with fresh IVs and rejects tampering and wrong purpose, origin or client", () => {
  const a = sealTikTok({ token: "private-token" }),
    b = sealTikTok({ token: "private-token" });
  expect(a).not.toBe(b);
  expect(a).not.toContain("private-token");
  expect(openTikTok(a)).toEqual({ token: "private-token" });
  const e = JSON.parse(a),
    bytes = Buffer.from(e.ciphertext, "base64url");
  bytes[0] ^= 1;
  e.ciphertext = bytes.toString("base64url");
  expect(() => openTikTok(JSON.stringify(e))).toThrow("verified");
  expect(() => openTikTok(a, "attempt")).toThrow("verified");
  vi.stubEnv("TIKTOK_CLIENT_KEY", "other");
  expect(() => openTikTok(a)).toThrow("verified");
  vi.stubEnv("TIKTOK_CLIENT_KEY", "client-key");
  vi.stubEnv("APP_ORIGIN", "https://other.example.com");
  expect(() => openTikTok(a)).toThrow("verified");
});
it("uses the documented Web scopes, browser-bound expiring state and no browser credentials", async () => {
  const { flow, state } = await attempt(),
    url = new URL(flow.url);
  expect(url.origin).toBe("https://www.tiktok.com");
  expect(url.searchParams.get("scope")).toBe("user.info.basic,video.list");
  expect(url.searchParams.get("redirect_uri")).toBe(
    "https://studio.example.com/api/tiktok/callback",
  );
  expect(flow.url).not.toContain("private-client-secret");
  await expect(tiktokState("a".repeat(43), state.state)).rejects.toThrow(
    "verified",
  );
  await expect(
    tiktokState(flow.cookie, state.state, state.createdAt + 600001),
  ).rejects.toThrow("expired");
});
it("claims callbacks across instances before exchanging the code and prevents replay", async () => {
  const { state } = await attempt();
  const results = await Promise.allSettled([
    finishTikTok("code", state),
    finishTikTok("code", state),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    m.fetch.mock.calls.filter((c) => String(c[0]).includes("/oauth/token/")),
  ).toHaveLength(1);
  expect(JSON.stringify([...m.blobs.values()])).not.toContain(
    "private-refresh",
  );
});
it("renders success without tokens and preserves the previous connection on stale callbacks", async () => {
  const { state, flow } = await attempt();
  m.cookies.set("cs-tiktok-state", flow.cookie);
  const r = await callback(
    new NextRequest(
      `https://studio.example.com/api/tiktok/callback?state=${state.state}&code=private-code`,
    ),
  );
  expect(r.status).toBe(200);
  expect(r.headers.get("cache-control")).toContain("no-store");
  const html = await r.text();
  expect(html).toContain("Continue to app");
  expect(html).not.toMatch(/private-(access|refresh|code)/);
  const a = await attempt(),
    b = await attempt();
  await finishTikTok("new", b.state);
  const latest = (await readTikTokCredential())!.credential;
  await expect(finishTikTok("old", a.state)).rejects.toThrow("not retried");
  expect((await readTikTokCredential())!.credential.revision).toBe(
    latest.revision,
  );
});
it("fails closed on storage and decryption failures and never retries uncertain claims", async () => {
  const { state } = await attempt();
  m.writeFail = "after";
  await expect(finishTikTok("code", state)).rejects.toThrow("not retried");
  expect(m.fetch).not.toHaveBeenCalled();
  m.writeFail = "";
  await expect(finishTikTok("code", state)).rejects.toThrow();
  expect(m.fetch).not.toHaveBeenCalled();
  m.readFail = true;
  await expect(readTikTokCredential()).rejects.toThrow("storage");
  m.readFail = false;
  m.blobs.set(tiktokPath("credential.v1.json"), {
    text: "bad-private-token",
    etag: "bad",
  });
  await expect(readTikTokCredential()).rejects.toThrow("verified");
});
it("protects status, initiation and sync and rejects cross-origin initiation", async () => {
  expect((await status()).status).toBe(401);
  expect(
    (
      await start(
        new NextRequest("https://studio.example.com/api/tiktok", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await sync(
        new NextRequest("https://studio.example.com/api/tiktok/sync", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(401);
  m.cookies.set("cs-session", token());
  const r = await start(
    new NextRequest("https://studio.example.com/api/tiktok", {
      method: "POST",
      headers: {
        host: "studio.example.com",
        origin: "https://evil.example.com",
      },
    }),
  );
  expect(r.status).toBe(403);
  expect(m.fetch).not.toHaveBeenCalled();
});
it("reads replacements without caching and never refreshes on status reads", async () => {
  await connected();
  m.cookies.set("cs-session", token());
  await expireAccess();
  expect(await (await status()).json()).toMatchObject({
    connected: true,
    displayName: "Creator",
  });
  expect(m.fetch).not.toHaveBeenCalled();
  const { state } = await attempt();
  await finishTikTok("new", state);
  expect((await activeTikTokCredential()).expiresAt).toBeGreaterThan(
    Date.now(),
  );
});
it("rotates refresh tokens once across concurrent instances and saves the replacement encrypted", async () => {
  await connected();
  await expireAccess();
  m.fetch.mockResolvedValue(
    json(
      tokenResult({
        access_token: "next-access",
        refresh_token: "next-refresh",
      }),
    ),
  );
  await Promise.allSettled([
    activeTikTokCredential(),
    activeTikTokCredential(),
  ]);
  expect(m.fetch).toHaveBeenCalledTimes(1);
  const body = new URLSearchParams(String(m.fetch.mock.calls[0][1].body));
  expect(body.get("grant_type")).toBe("refresh_token");
  expect(body.get("refresh_token")).toBe("private-refresh");
  expect((await readTikTokCredential())!.credential.refreshToken).toBe(
    "next-refresh",
  );
  expect(JSON.stringify([...m.blobs.values()])).not.toContain("next-refresh");
});
it("never repeats an uncertain refresh exchange", async () => {
  await connected();
  await expireAccess();
  m.fetch.mockRejectedValue(Error("private-provider-token"));
  await expect(activeTikTokCredential()).rejects.toThrow("not retried");
  await expect(activeTikTokCredential()).rejects.toThrow("previous refresh");
  expect(m.fetch).toHaveBeenCalledTimes(1);
});
it("does not retry an uncertain rotated-credential write or expose provider errors", async () => {
  await connected();
  await expireAccess();
  m.fetch.mockImplementation(async () => {
    m.writeFail = "after";
    return json(
      tokenResult({
        access_token: "next-access",
        refresh_token: "next-refresh",
      }),
    );
  });
  await expect(activeTikTokCredential()).rejects.toThrow("not retried");
  expect(m.fetch).toHaveBeenCalledTimes(1);
  m.writeFail = "";
  expect((await activeTikTokCredential()).accessToken).toBe("next-access");
  expect(m.fetch).toHaveBeenCalledTimes(1);
});
it("rejects a missing scope or changed account on refresh", async () => {
  await connected();
  await expireAccess();
  m.fetch.mockResolvedValue(json(tokenResult({ open_id: "other" })));
  await expect(activeTikTokCredential()).rejects.toThrow("different account");
  expect((await readTikTokCredential())!.credential.openId).toBe("creator-id");
});
it("rejects token grants without video access before persisting credentials", async () => {
  const { state } = await attempt();
  m.fetch.mockResolvedValue(json(tokenResult({ scope: "user.info.basic" })));
  await expect(finishTikTok("code", state)).rejects.toThrow("required access");
  expect(await readTikTokCredential()).toBeNull();
});
it("matches only full TikTok video links and fetches owned metrics while keeping measured zeros", async () => {
  await connected();
  const id = "1234567890123456789";
  expect(tiktokVideoId(`https://www.tiktok.com/@creator/video/${id}?x=1`)).toBe(
    id,
  );
  for (const u of [
    "https://vt.tiktok.com/abc/",
    `https://evil.com/@a/video/${id}`,
    `https://www.tiktok.com:8080/@a/video/${id}`,
  ])
    expect(tiktokVideoId(u)).toBeNull();
  m.fetch.mockImplementation(
    async (url: URL | string, options: RequestInit) => {
      expect(new URL(url).pathname).toBe("/v2/video/query/");
      expect(options.method).toBe("POST");
      expect(JSON.parse(String(options.body))).toEqual({
        filters: { video_ids: [id] },
      });
      expect(options.headers).toMatchObject({
        Authorization: "Bearer private-access",
      });
      return json({
        data: {
          videos: [{ id, view_count: 500, like_count: 0, share_count: null }],
        },
        error: { code: "ok" },
      });
    },
  );
  const result = await collectTikTok([
    {
      id: "VID-1",
      version: "v1",
      title: "Story",
      tiktokUrl: `https://www.tiktok.com/@creator/video/${id}`,
    },
  ]);
  expect(result.observations[0].metrics).toEqual({ views: "500", likes: "0" });
  expect(result.unmatched).toEqual([]);
});
it("queries only the selected TikTok video while retaining cross-tracker duplicate guards", async () => {
  await connected();
  const videos = ["1234567890123456789", "2234567890123456789"].map(
    (id, i) => ({
      id: `v${i}`,
      version: "1",
      title: `Story ${i}`,
      tiktokUrl: `https://www.tiktok.com/@creator/video/${id}`,
    }),
  );
  m.fetch.mockImplementation(async (_url: string, options: RequestInit) => {
    expect(JSON.parse(String(options.body)).filters.video_ids).toEqual([
      "2234567890123456789",
    ]);
    return json({
      data: { videos: [{ id: "2234567890123456789", view_count: 55 }] },
      error: { code: "ok" },
    });
  });
  const result = await collectTikTok(videos, "v1");
  expect(result.observations.map((s) => s.videoId)).toEqual(["v1"]);
  expect(result.unmatched).toEqual([]);
  await expect(
    collectTikTok([videos[0], { ...videos[0], id: "duplicate" }], "v0"),
  ).rejects.toThrow("same TikTok");
});
it("rejects duplicate links, foreign videos and sanitized provider errors", async () => {
  await connected();
  const video = {
    id: "VID-1",
    version: "v1",
    title: "Story",
    tiktokUrl: "https://www.tiktok.com/@creator/video/1234567890123456789",
  };
  await expect(
    collectTikTok([video, { ...video, id: "VID-2" }]),
  ).rejects.toThrow("same TikTok");
  expect(m.fetch).not.toHaveBeenCalled();
  m.fetch.mockResolvedValue(
    json({
      data: { videos: [{ id: "9999999999999999999", view_count: 10 }] },
      error: { code: "ok" },
    }),
  );
  await expect(collectTikTok([video])).rejects.toThrow("inconsistent");
  m.fetch.mockResolvedValue(
    json(
      {
        error: {
          code: "access_token_invalid",
          message: "private-provider-secret",
        },
      },
      401,
    ),
  );
  await expect(tiktokApi("user/info", "private-token")).rejects.toThrow(
    "Reconnect TikTok",
  );
  try {
    await tiktokApi("user/info", "private-token");
  } catch (e) {
    expect((e as Error).message).not.toContain("private-provider");
  }
});
it("resolves official short links without credentials and blocks external redirects before fetching them", async () => {
  const id = "1234567890123456789";
  m.fetch.mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: `https://www.tiktok.com/@creator/video/${id}` },
    }),
  );
  expect(await resolveTikTokVideoId("https://vt.tiktok.com/ABC123/")).toBe(id);
  expect(m.fetch).toHaveBeenCalledTimes(1);
  expect(m.fetch.mock.calls[0][1]).toMatchObject({
    method: "HEAD",
    redirect: "manual",
  });
  expect(m.fetch.mock.calls[0][1].headers).toBeUndefined();
  m.fetch.mockClear();
  m.fetch.mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "https://evil.example.com/steal" },
    }),
  );
  expect(
    await resolveTikTokVideoId("https://vm.tiktok.com/ABC123/"),
  ).toBeNull();
  expect(m.fetch).toHaveBeenCalledTimes(1);
  m.fetch.mockClear();
  expect(
    await resolveTikTokVideoId("https://vt.tiktok.com:8080/ABC123/"),
  ).toBeNull();
  expect(m.fetch).not.toHaveBeenCalled();
});
it("queries no more than 20 owned video ids in each request", async () => {
  await connected();
  const videos = Array.from({ length: 21 }, (_, i) => ({
    id: `VID-${i}`,
    version: "v1",
    title: `Story ${i}`,
    tiktokUrl: `https://www.tiktok.com/@creator/video/${String(1234567890123456700n + BigInt(i))}`,
  }));
  m.fetch.mockImplementation(
    async (_url: URL | string, options: RequestInit) => {
      const ids = JSON.parse(String(options.body)).filters.video_ids;
      expect(ids.length).toBeLessThanOrEqual(20);
      return json({
        data: { videos: ids.map((id: string) => ({ id, view_count: 1 })) },
        error: { code: "ok" },
      });
    },
  );
  expect((await collectTikTok(videos)).observations).toHaveLength(21);
  expect(m.fetch).toHaveBeenCalledTimes(2);
});
