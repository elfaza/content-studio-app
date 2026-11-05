import { beforeEach, afterEach, it, expect, vi } from "vitest";
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
    get: (k: string) =>
      m.cookies.has(k) ? { value: m.cookies.get(k) } : undefined,
  }),
}));
import {
  beginInstagram,
  instagramState,
  finishInstagram,
  sealInstagram,
  openInstagram,
  instagramPath,
  readInstagramCredential,
  InstagramError,
  connectInstagramSystemUser,
} from "../src/lib/instagram-connection";
import {
  collectInstagram,
  instagramGraph,
  instagramShortcode,
} from "../src/lib/instagram-graph";
import { GET as status, POST as start } from "../src/app/api/instagram/route";
import { GET as callback } from "../src/app/api/instagram/callback/route";
import { token } from "../src/lib/auth";
import { POST as sync } from "../src/app/api/instagram/sync/route";
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.blobs.clear();
  m.cookies.clear();
  m.serial = 0;
  m.readFail = false;
  m.writeFail = "";
  for (const [k, v] of Object.entries({
    META_APP_ID: "123",
    META_APP_SECRET: "private-test-secret",
    META_INSTAGRAM_CONFIG_ID: "456",
    META_GRAPH_VERSION: "v25.0",
    SESSION_SECRET: "fake-session-secret-of-at-least-32-characters",
    APP_PASSWORD: "fake-password-at-least-16",
    APP_ORIGIN: "https://studio.example.com",
    BLOB_READ_WRITE_TOKEN: "fake-blob",
    VERCEL_BLOB_RETRIES: "0",
    META_INSTAGRAM_SYSTEM_USER_TOKEN: "",
    META_INSTAGRAM_SYSTEM_USER_ID: "",
    META_INSTAGRAM_ACCOUNT_ID: "",
  }))
    vi.stubEnv(k, v);
  vi.stubGlobal("fetch", m.fetch);
  m.get.mockImplementation(async (path: string, o: unknown) => {
    expect(o).toMatchObject({ access: "private", useCache: false });
    if (m.readFail) throw Error("provider-private-secret");
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
      expect(o).toMatchObject({ access: "private", addRandomSuffix: false });
      expect(process.env.VERCEL_BLOB_RETRIES).toBe("0");
      if (m.writeFail === "before") throw Error("private-secret");
      const b = m.blobs.get(path);
      if ((!o.allowOverwrite && b) || (o.ifMatch && b?.etag !== o.ifMatch))
        throw Error("precondition");
      const etag = '"' + ++m.serial + '"';
      m.blobs.set(path, { text, etag });
      if (m.writeFail === "after") throw Error("uncertain-private-secret");
      return { etag };
    },
  );
  m.fetch.mockImplementation(async (url: URL | string) =>
    String(url).includes("oauth/access_token")
      ? json({ access_token: "private-access-token", expires_in: 5184000 })
      : json({ data: [{ id: "987", username: "creator" }] }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function attempt() {
  const flow = await beginInstagram();
  const state = await instagramState(
    flow.cookie,
    new URL(flow.url).searchParams.get("state"),
  );
  return { flow, state };
}
async function connected() {
  const { state } = await attempt();
  await finishInstagram("fake-code", state);
  m.fetch.mockClear();
}
function systemUserProvider() {
  vi.stubEnv("META_INSTAGRAM_SYSTEM_USER_TOKEN", "private-system-token");
  vi.stubEnv("META_INSTAGRAM_SYSTEM_USER_ID", "55");
  vi.stubEnv("META_INSTAGRAM_ACCOUNT_ID", "987");
  m.fetch.mockImplementation(
    async (url: URL | string, options: RequestInit) => {
      expect(options.method ?? "GET").toBe("GET");
      expect(options.headers).toMatchObject({
        Authorization: "Bearer private-system-token",
      });
      expect(String(url)).not.toContain("private-system-token");
      const path = new URL(url).pathname;
      if (path.endsWith("/me")) return json({ id: "55" });
      if (path.endsWith("/55")) return json({ id: "55" });
      if (path.endsWith("/987"))
        return json({ id: "987", username: "creator" });
      if (path.endsWith("/987/media")) return json({ data: [] });
      throw Error("unexpected provider request");
    },
  );
}
it("imports a server System User token only through an authenticated same-origin action and encrypts it", async () => {
  systemUserProvider();
  const request = () =>
    new NextRequest("https://studio.example.com/api/instagram", {
      method: "POST",
      headers: {
        host: "studio.example.com",
        origin: "https://studio.example.com",
      },
    });
  expect((await start(request())).status).toBe(401);
  expect(m.fetch).not.toHaveBeenCalled();
  m.cookies.set("cs-session", token());
  const response = await start(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    connected: true,
    username: "creator",
  });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.cookies.get("cs-instagram-state")).toBeUndefined();
  expect(await readInstagramCredential()).toMatchObject({
    accessToken: "private-system-token",
    accountId: "987",
    expiresAt: null,
  });
  expect(JSON.stringify([...m.blobs.values()])).not.toContain(
    "private-system-token",
  );
  expect(await (await status()).text()).not.toContain("private-system-token");
});
it("rejects mismatched System Users, mismatched profiles and denied media access without replacing credentials", async () => {
  await connected();
  const previous = await readInstagramCredential();
  systemUserProvider();
  m.fetch.mockResolvedValueOnce(json({ id: "wrong" }));
  await expect(connectInstagramSystemUser()).rejects.toThrow(
    "IG_SYSTEM_USER_MISMATCH",
  );
  expect(await readInstagramCredential()).toEqual(previous);
  systemUserProvider();
  m.fetch
    .mockResolvedValueOnce(json({ id: "55" }))
    .mockResolvedValueOnce(json({ id: "999", username: "other" }));
  await expect(connectInstagramSystemUser()).rejects.toThrow(
    "could not be verified",
  );
  expect(await readInstagramCredential()).toEqual(previous);
  systemUserProvider();
  m.fetch
    .mockResolvedValueOnce(json({ id: "55" }))
    .mockResolvedValueOnce(json({ id: "987", username: "creator" }))
    .mockResolvedValueOnce(
      json({ error: { code: 200, message: "private-system-token" } }, 400),
    );
  await expect(connectInstagramSystemUser()).rejects.toThrow("IG_MEDIA_200");
  expect(await readInstagramCredential()).toEqual(previous);
});
it("accepts an app-scoped identity only when the configured System User resolves to that same id", async () => {
  systemUserProvider();
  m.fetch
    .mockResolvedValueOnce(json({ id: "999999" }))
    .mockResolvedValueOnce(json({ id: "999999" }));
  await expect(connectInstagramSystemUser()).resolves.toEqual({
    username: "creator",
  });
  expect(new URL(m.fetch.mock.calls[0][0]).searchParams.get("fields")).toBe(
    "id",
  );
  expect(new URL(m.fetch.mock.calls[1][0]).pathname).toBe("/v25.0/55");
});
it.each(["66", 66, null, {}, 9007199254740992])(
  "rejects a different or invalid resolved System User ID (%s)",
  async (mappedId) => {
    systemUserProvider();
    m.fetch
      .mockResolvedValueOnce(json({ id: "999999" }))
      .mockResolvedValueOnce(json({ id: mappedId }));
    await expect(connectInstagramSystemUser()).rejects.toThrow(
      "IG_SYSTEM_USER_MISMATCH",
    );
    expect(m.put).not.toHaveBeenCalled();
    expect(m.fetch).toHaveBeenCalledTimes(2);
  },
);
it.each([
  ["me", "IG_IDENTITY_100_33"],
  ["987", "IG_PROFILE_100_33"],
  ["987/media", "IG_MEDIA_100_33"],
  ["987/insights", "IG_INSIGHTS_100_33"],
] as const)(
  "reports only safe stage/code diagnostics for %s",
  async (path, reference) => {
    m.fetch.mockResolvedValue(
      json(
        {
          error: {
            code: 100,
            error_subcode: 33,
            message: "provider-private-token secret",
          },
        },
        400,
      ),
    );
    await expect(instagramGraph(path, "private-token")).rejects.toThrow(
      reference,
    );
    try {
      await instagramGraph(path, "private-token");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret");
      expect((error as Error).message).not.toContain("private-token");
    }
  },
);
it("fails closed when the System User mapping is inaccessible and reports that exact check", async () => {
  systemUserProvider();
  m.fetch
    .mockResolvedValueOnce(json({ id: "999999" }))
    .mockResolvedValueOnce(
      json({ error: { code: 100, message: "private-token" } }, 400),
    );
  await expect(connectInstagramSystemUser()).rejects.toThrow(
    "IG_IDENTITY_MAPPING_100",
  );
  expect(m.put).not.toHaveBeenCalled();
});
it("does not import on status reads, fail over on corrupt storage, or retry uncertain System User writes", async () => {
  systemUserProvider();
  m.cookies.set("cs-session", token());
  expect(await (await status()).json()).toMatchObject({
    connected: false,
    connectionMethod: "system_user",
  });
  expect(m.fetch).not.toHaveBeenCalled();
  m.readFail = true;
  await expect(connectInstagramSystemUser()).rejects.toThrow("storage");
  expect(m.fetch).not.toHaveBeenCalled();
  m.readFail = false;
  m.writeFail = "after";
  await expect(connectInstagramSystemUser()).rejects.toThrow("not retried");
  expect(m.put).toHaveBeenCalledTimes(1);
  expect((await readInstagramCredential())?.accessToken).toBe(
    "private-system-token",
  );
  m.blobs.set(instagramPath("credential.v1.json"), {
    text: "corrupt",
    etag: "bad",
  });
  await expect(readInstagramCredential()).rejects.toThrow("verified");
});
it("requires numeric server asset configuration before calling Meta", async () => {
  systemUserProvider();
  vi.stubEnv("META_INSTAGRAM_ACCOUNT_ID", "https://evil.example.com");
  await expect(connectInstagramSystemUser()).rejects.toThrow("incomplete");
  expect(m.fetch).not.toHaveBeenCalled();
});
it("allows only one concurrent System User credential replacement", async () => {
  await connected();
  systemUserProvider();
  const results = await Promise.allSettled([
    connectInstagramSystemUser(),
    connectInstagramSystemUser(),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(
    1,
  );
  expect((await readInstagramCredential())?.accessToken).toBe(
    "private-system-token",
  );
});
it("encrypts with random IVs and rejects tampering and wrong purpose/app/origin", () => {
  const a = sealInstagram({ accessToken: "private-token" }),
    b = sealInstagram({ accessToken: "private-token" });
  expect(a).not.toBe(b);
  expect(a).not.toContain("private-token");
  expect(openInstagram(a)).toEqual({ accessToken: "private-token" });
  const e = JSON.parse(a);
  const bytes = Buffer.from(e.ciphertext, "base64url");
  bytes[0] ^= 1;
  e.ciphertext = bytes.toString("base64url");
  expect(() => openInstagram(JSON.stringify(e))).toThrow("verified");
  expect(() => openInstagram(a, "attempt")).toThrow("verified");
  vi.stubEnv("META_APP_ID", "different");
  expect(() => openInstagram(a)).toThrow("verified");
  vi.stubEnv("META_APP_ID", "123");
  vi.stubEnv("APP_ORIGIN", "https://other.example.com");
  expect(() => openInstagram(a)).toThrow("verified");
});
it("uses config_id, server-only credentials, and browser-bound expiring state", async () => {
  const { flow, state } = await attempt();
  const url = new URL(flow.url);
  expect(url.origin).toBe("https://www.facebook.com");
  expect(url.searchParams.get("config_id")).toBe("456");
  expect(url.searchParams.get("scope")).toBeNull();
  expect(flow.url).not.toContain("private-test-secret");
  expect(JSON.stringify([...m.blobs.values()])).not.toContain(
    "private-access-token",
  );
  await expect(instagramState("a".repeat(43), state.state)).rejects.toThrow(
    "verified",
  );
  await expect(
    instagramState(flow.cookie, state.state, state.createdAt + 600001),
  ).rejects.toThrow("expired");
});
it("claims callbacks atomically before code exchange and prevents replay across instances", async () => {
  const { state } = await attempt();
  const results = await Promise.allSettled([
    finishInstagram("code", state),
    finishInstagram("code", state),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(
    m.fetch.mock.calls.filter((c) =>
      String(c[0]).includes("oauth/access_token"),
    ),
  ).toHaveLength(1);
  const saved = await readInstagramCredential();
  expect(saved?.accountId).toBe("987");
  expect(JSON.stringify([...m.blobs.values()])).not.toContain(
    "private-access-token",
  );
});
it("does not retry uncertain claim writes or contact Meta afterward", async () => {
  const { state } = await attempt();
  m.writeFail = "after";
  await expect(finishInstagram("code", state)).rejects.toThrow("not retried");
  expect(m.fetch).not.toHaveBeenCalled();
  m.writeFail = "";
  await expect(finishInstagram("code", state)).rejects.toThrow();
  expect(m.fetch).not.toHaveBeenCalled();
});
it("fails closed on storage failures and corrupt or expired credentials", async () => {
  await connected();
  m.readFail = true;
  await expect(readInstagramCredential()).rejects.toThrow("storage");
  m.readFail = false;
  const p = instagramPath("credential.v1.json");
  m.blobs.set(p, { text: "bad-private-token", etag: '"bad"' });
  await expect(readInstagramCredential()).rejects.toThrow("verified");
  m.blobs.set(p, {
    text: sealInstagram({
      accessToken: "fake",
      accountId: "987",
      username: "creator",
      expiresAt: Date.now() - 1,
      savedAt: Date.now(),
      revision: "11111111-1111-4111-8111-111111111111",
    }),
    etag: '"expired"',
  });
  await expect(readInstagramCredential()).rejects.toThrow("expired");
});
it("uses ETag replacement so an older callback cannot overwrite a newer connection", async () => {
  await connected();
  const first = await attempt(),
    second = await attempt();
  await finishInstagram("new-code", second.state);
  await expect(finishInstagram("old-code", first.state)).rejects.toThrow(
    "another connection changed",
  );
  expect((await readInstagramCredential())?.username).toBe("creator");
});
it("refuses multiple assigned Instagram accounts", async () => {
  const { state } = await attempt();
  m.fetch.mockImplementation(async (url: URL | string) =>
    String(url).includes("oauth/access_token")
      ? json({ access_token: "private-access-token" })
      : json({
          data: [
            { id: "1", username: "one" },
            { id: "2", username: "two" },
          ],
        }),
  );
  await expect(finishInstagram("code", state)).rejects.toThrow("exactly one");
  expect(await readInstagramCredential()).toBeNull();
});
it("distinguishes an empty API assignment from multiple selections and preserves a previous connection", async () => {
  await connected();
  const previous = await readInstagramCredential();
  const { state, flow } = await attempt();
  m.cookies.set("cs-instagram-state", flow.cookie);
  m.fetch.mockImplementation(async (url: URL | string) =>
    String(url).includes("oauth/access_token")
      ? json({ access_token: "new-private-access-token" })
      : json({ data: [] }),
  );
  const response = await callback(
    new NextRequest(
      `https://studio.example.com/api/instagram/callback?code=private-code&state=${state.state}`,
    ),
  );
  expect(response.status).toBe(428);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const html = await response.text();
  expect(html).toContain("IG_NO_ASSIGNED_ACCOUNT");
  expect(html).toContain('href="/settings"');
  expect(html).not.toContain("Select exactly one");
  expect(html).not.toContain("new-private-access-token");
  expect(html).not.toContain("private-code");
  expect(await readInstagramCredential()).toEqual(previous);
  expect(m.cookies.get("cs-instagram-state")).toBe(flow.cookie);
  await expect(finishInstagram("code", state)).rejects.toThrow();
});
it("protects connection/status routes and requires a same-origin POST", async () => {
  expect((await status()).status).toBe(401);
  expect(
    (
      await sync(
        new NextRequest("https://studio.example.com/api/instagram/sync", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await start(
        new NextRequest("https://studio.example.com/api/instagram", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(401);
  m.cookies.set("cs-session", token());
  expect(
    (
      await sync(
        new NextRequest("https://studio.example.com/api/instagram/sync", {
          method: "POST",
          headers: {
            host: "studio.example.com",
            origin: "https://evil.example.com",
          },
        }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await start(
        new NextRequest("https://studio.example.com/api/instagram", {
          method: "POST",
          headers: {
            host: "studio.example.com",
            origin: "https://evil.example.com",
          },
        }),
      )
    ).status,
  ).toBe(403);
});
it("returns only non-secret metadata and never renders tokens in callback HTML", async () => {
  const { flow, state } = await attempt();
  m.cookies.set("cs-instagram-state", flow.cookie);
  const r = await callback(
    new NextRequest(
      `https://studio.example.com/api/instagram/callback?state=${state.state}&code=private-code`,
    ),
  );
  expect(r.status).toBe(200);
  const html = await r.text();
  expect(html).toContain("Continue to app");
  expect(html).not.toMatch(
    /private-access-token|private-test-secret|private-code/,
  );
  expect(r.headers.get("cache-control")).toContain("no-store");
  m.cookies.set("cs-session", token());
  const body = await (await status()).json();
  expect(body).toMatchObject({ connected: true, username: "creator" });
  expect(JSON.stringify(body)).not.toContain("private-access-token");
});
it("rejects invalid callbacks and sanitizes revoked-access errors", async () => {
  expect(
    (
      await callback(
        new NextRequest(
          "https://studio.example.com/api/instagram/callback?code=private-code",
        ),
      )
    ).status,
  ).toBe(400);
  m.fetch.mockResolvedValue(
    json({ error: { code: 190, message: "private-provider-credential" } }, 400),
  );
  await expect(instagramGraph("123/insights", "private-token")).rejects.toThrow(
    "Reconnect Instagram",
  );
  try {
    await instagramGraph("123/insights", "private-token");
  } catch (e) {
    expect((e as InstagramError).message).not.toContain("private-provider");
  }
});
it("matches only Instagram post links without fetching arbitrary URLs", () => {
  expect(
    instagramShortcode("https://www.instagram.com/reel/AbCd_1/?utm_source=x"),
  ).toBe("AbCd_1");
  expect(instagramShortcode("https://instagram.com/p/AbCd_1/")).toBe("AbCd_1");
  for (const s of [
    "https://evil.com/reel/abc/",
    "https://instagram.com.evil.com/p/abc/",
    "http://instagram.com/p/abc/",
    "https://instagram.com:8443/p/abc/",
  ])
    expect(instagramShortcode(s)).toBeNull();
});
it("fetches owned posts, follows only provider cursors, preserves measured zeros and leaves unavailable metrics missing", async () => {
  await connected();
  m.fetch.mockImplementation(
    async (url: URL | string, options: RequestInit) => {
      const u = new URL(url);
      expect(options.headers).toMatchObject({
        Authorization: "Bearer private-access-token",
      });
      expect(String(url)).not.toContain("private-access-token");
      if (u.pathname.endsWith("/media")) {
        if (!u.searchParams.has("after"))
          return json({
            data: [],
            paging: {
              next: "https://evil.example.com/steal",
              cursors: { after: "cursor" },
            },
          });
        return json({
          data: [
            {
              id: "88",
              permalink: "https://instagram.com/p/AbCd/",
              like_count: 0,
              comments_count: 2,
            },
          ],
        });
      }
      const metric = u.searchParams.get("metric");
      return metric === "views"
        ? json({ data: [{ name: "views", values: [{ value: 500 }] }] })
        : json({ error: { code: 100, message: "invalid metric" } }, 400);
    },
  );
  const r = await collectInstagram([
    {
      id: "v",
      version: "v1",
      title: "Story",
      igUrl: "https://www.instagram.com/reel/AbCd/",
    },
  ]);
  expect(r.observations[0].metrics).toEqual({
    likes: "0",
    comments: "2",
    views: "500",
  });
  expect(r.unmatched).toEqual([]);
  expect(
    m.fetch.mock.calls.every(
      (c) => new URL(c[0]).hostname === "graph.facebook.com",
    ),
  ).toBe(true);
});
