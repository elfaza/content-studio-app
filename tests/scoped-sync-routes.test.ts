import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({
  authorized: vi.fn(),
  origin: vi.fn(),
  dataset: vi.fn(),
  ig: vi.fn(),
  tt: vi.fn(),
  saveIg: vi.fn(),
  saveTt: vi.fn(),
}));
vi.mock("../src/lib/auth", () => ({
  authorized: m.authorized,
  sameOrigin: m.origin,
}));
vi.mock("../src/lib/repository", () => ({
  AppError: class extends Error {
    status = 409;
  },
  live: () => true,
  readDataset: m.dataset,
  saveInstagramObservations: m.saveIg,
  saveTikTokObservations: m.saveTt,
}));
vi.mock("../src/lib/instagram-graph", () => ({ collectInstagram: m.ig }));
vi.mock("../src/lib/tiktok-api", () => ({ collectTikTok: m.tt }));
vi.mock("../src/lib/instagram-connection", () => ({
  InstagramError: class extends Error {
    status = 409;
  },
  readInstagramCredential: async () => ({ revision: "r" }),
}));
vi.mock("../src/lib/tiktok-connection", () => ({
  TikTokError: class extends Error {
    status = 409;
  },
  readTikTokCredential: async () => ({ credential: { revision: "r" } }),
}));
import { POST as instagram } from "../src/app/api/instagram/sync/route";
import { POST as tiktok } from "../src/app/api/tiktok/sync/route";
const videos = [
  {
    id: "one",
    version: "v1",
    title: "First",
    igUrl: "https://instagram.com/p/first/",
    tiktokUrl: "https://www.tiktok.com/@me/video/123456789012",
  },
  {
    id: "two",
    version: "v2",
    title: "Other",
    igUrl: "https://instagram.com/p/other/",
    tiktokUrl: "https://www.tiktok.com/@me/video/223456789012",
  },
];
const request = (body?: string) =>
  new NextRequest("https://studio.example.com/api/provider/sync", {
    method: "POST",
    ...(body === undefined ? {} : { body }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.authorized.mockResolvedValue(true);
  m.origin.mockReturnValue(true);
  m.dataset.mockResolvedValue({
    writable: true,
    videos,
    snapshots: [
      {
        videoId: "one",
        platform: "Instagram",
        date: "2026-11-09",
        version: "ig-s1",
      },
      {
        videoId: "one",
        platform: "TikTok",
        date: "2026-11-09",
        version: "tt-s1",
      },
    ],
  });
  m.ig.mockResolvedValue({
    revision: "r",
    observations: [
      { videoId: "one", date: "2026-11-09", metrics: { views: "10" } },
    ],
    unmatched: [],
  });
  m.tt.mockResolvedValue({
    revision: "r",
    observations: [
      { videoId: "one", date: "2026-11-09", metrics: { views: "10" } },
    ],
    unmatched: [],
  });
  m.saveIg.mockResolvedValue({ updated: 1 });
  m.saveTt.mockResolvedValue({ updated: 1 });
});
it.each([
  ["Instagram", instagram, m.ig, m.saveIg, "ig-s1"],
  ["TikTok", tiktok, m.tt, m.saveTt, "tt-s1"],
] as const)(
  "%s scopes collection and keeps the original snapshot concurrency fence",
  async (_name, route, collect, save, version) => {
    expect((await route(request('{"videoId":"one"}'))).status).toBe(200);
    expect(collect).toHaveBeenCalledWith(videos, "one");
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toEqual([
      expect.objectContaining({ videoId: "one", snapshotVersion: version }),
    ]);
  },
);
it.each([instagram, tiktok])(
  "rejects invalid selections and protects scoped sync before collecting or saving",
  async (route) => {
    for (const body of ["{}", "bad", '{"videoId":"missing"}'])
      expect((await route(request(body))).status).toBeGreaterThanOrEqual(400);
    m.authorized.mockResolvedValue(false);
    expect((await route(request('{"videoId":"one"}'))).status).toBe(401);
    m.authorized.mockResolvedValue(true);
    m.origin.mockReturnValue(false);
    expect((await route(request('{"videoId":"one"}'))).status).toBe(403);
    expect(m.ig).not.toHaveBeenCalled();
    expect(m.tt).not.toHaveBeenCalled();
    expect(m.saveIg).not.toHaveBeenCalled();
    expect(m.saveTt).not.toHaveBeenCalled();
  },
);
it.each([
  [instagram, m.ig, m.saveIg],
  [tiktok, m.tt, m.saveTt],
] as const)(
  "keeps sync-all compatibility and never retries an uncertain write",
  async (route, collect, save) => {
    save.mockRejectedValue(new Error("private-provider-credential"));
    const response = await route(request());
    expect(collect).toHaveBeenCalledWith(videos, undefined);
    expect(save).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain(
      "private-provider-credential",
    );
  },
);
