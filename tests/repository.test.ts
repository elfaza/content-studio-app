import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDataset, save } from "../src/lib/repository";
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "cs-test-"));
  vi.stubEnv("DEMO_DATA_PATH", join(dir, "data.json"));
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "");
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});
describe("Repository mutations and conflicts", () => {
  it("cancels ideas with a reason and pending schedules, then restores without restarting plans", async () => {
    const idea = await save("ideas", {
      title: "Cancellation test",
      status: "Filming",
      notes: "Keep notes",
    });
    const plan = await save("schedule", {
      contentId: idea.id,
      title: idea.title,
      date: "2026-11-10",
      time: "19:00",
      platform: "Instagram",
    });
    const d = await readDataset();
    const originalVideos = JSON.stringify(d.videos),
      originalSnapshots = JSON.stringify(d.snapshots);
    await expect(
      save("ideas", { ...idea, status: "Cancelled", cancellationReason: " " }),
    ).rejects.toThrow("cancellation reason");
    const cancelled = await save("ideas", {
      ...idea,
      status: "Cancelled",
      cancellationReason: "No longer fits my content",
    });
    expect(cancelled).toMatchObject({
      notes: "Keep notes",
      cancelledFrom: "Filming",
      cancellationReason: "No longer fits my content",
    });
    expect(cancelled.cancelledAt).toBeTruthy();
    expect(
      (await readDataset()).schedule.find((s) => s.id === plan.id)?.status,
    ).toBe("Cancelled");
    await expect(
      save("schedule", {
        contentId: idea.id,
        title: idea.title,
        date: "2026-11-11",
        time: "19:00",
        platform: "TikTok",
      }),
    ).rejects.toThrow("Restore this cancelled idea");
    const restored = await save("ideas", {
      ...cancelled,
      status: cancelled.cancelledFrom,
    });
    const after = await readDataset();
    expect(restored).toMatchObject({
      status: "Filming",
      cancellationReason: "No longer fits my content",
      notes: "Keep notes",
    });
    expect(after.schedule.find((s) => s.id === plan.id)?.status).toBe(
      "Cancelled",
    );
    expect(JSON.stringify(after.videos)).toBe(originalVideos);
    expect(JSON.stringify(after.snapshots)).toBe(originalSnapshots);
    await expect(
      save("ideas", {
        ...idea,
        status: "Cancelled",
        cancellationReason: "Stale cancel",
      }),
    ).rejects.toThrow("changed since");
  });
  it("fails closed in direct OAuth mode without credential configuration", async () => {
    vi.stubEnv("GOOGLE_AUTH_MODE", "oauth");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    try {
      await expect(readDataset()).rejects.toMatchObject({ status: 503 });
    } finally {
      vi.stubEnv("GOOGLE_AUTH_MODE", "");
    }
  });
  it("keeps unconfigured local mode in demo without using old service-account settings", async () => {
    vi.stubEnv("GOOGLE_AUTH_MODE", "connect");
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "unfinished@example.com");
    try {
      expect((await readDataset()).mode).toBe("demo");
    } finally {
      vi.stubEnv("GOOGLE_AUTH_MODE", "");
      vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "");
    }
  });
  it("supports hosted demo mutations without relying on a writable server filesystem", async () => {
    vi.stubEnv("DEMO_STORAGE", "browser");
    try {
      const initial = await readDataset();
      expect(initial.persistence).toBe("browser");
      const idea = await save("ideas", { title: "Hosted demo idea" }, initial);
      expect(idea.title).toBe("Hosted demo idea");
      expect((await readDataset()).ideas.some((i) => i.id === idea.id)).toBe(
        false,
      );
      const clientState = { ...initial, ideas: [...initial.ideas, idea] };
      await expect(
        save("ideas", { ...idea, hook: "A hook" }, clientState),
      ).resolves.toMatchObject({ hook: "A hook" });
      await expect(save("ideas", { title: "No state" })).rejects.toThrow();
    } finally {
      vi.stubEnv("DEMO_STORAGE", "");
    }
  });
  it("creates, edits, archives, and rejects a stale edit", async () => {
    const created = await save("ideas", {
      title: "Test idea",
      category: "Running",
    });
    expect(created.id).toBeTruthy();
    const edited = await save("ideas", {
      ...created,
      title: "New title",
      archived: "true",
    });
    expect(edited.title).toBe("New title");
    expect(
      (await readDataset()).ideas.find((i) => i.id === created.id)?.archived,
    ).toBe("true");
    await expect(
      save("ideas", { ...created, title: "Stale title" }),
    ).rejects.toThrow("changed since");
  });
  it("requires published linking before moving into Published", async () => {
    const item = await save("ideas", { title: "Link me" });
    await expect(
      save("ideas", { ...item, status: "Published" }),
    ).rejects.toThrow("linked");
    const video = await save("videos", {
      title: "Linked story",
      ideaId: item.id,
      igUrl: "https://instagram.com/reel/example/",
    });
    expect(video.ideaId).toBe(item.id);
    await expect(
      save("ideas", { ...item, status: "Published" }),
    ).resolves.toMatchObject({ status: "Published" });
  });
  it("creates snapshots once and never overwrites history", async () => {
    const d = await readDataset();
    const input = {
      videoId: d.videos[0].id,
      title: "Observation",
      platform: "Instagram",
      date: "2025-01-01",
      views: "0",
    };
    const first = await save("snapshots", input);
    await expect(save("snapshots", input)).rejects.toThrow("already exists");
    await expect(save("snapshots", { ...first, views: "5" })).rejects.toThrow(
      "append-only",
    );
    await save("snapshots", { ...input, date: "2025-01-02", views: "50" });
    expect(
      (await readDataset()).snapshots.find((s) => s.id === first.id)?.views,
    ).toBe("0");
  });
  it("rejects missing links and duplicate plans, and supports rescheduling", async () => {
    await expect(
      save("schedule", {
        contentId: "missing",
        title: "Nope",
        date: "2026-10-26",
        time: "19:00",
        platform: "Instagram",
      }),
    ).rejects.toThrow("existing content");
    const item = await save("ideas", { title: "Scheduled idea" });
    const s = await save("schedule", {
      contentId: item.id,
      title: item.title,
      date: "2026-10-26",
      time: "19:00",
      platform: "TikTok",
    });
    await expect(
      save("schedule", {
        contentId: item.id,
        title: item.title,
        date: "2026-10-27",
        time: "19:00",
        platform: "TikTok",
      }),
    ).rejects.toThrow("already has");
    await expect(
      save("schedule", { ...s, date: "2026-10-28" }),
    ).resolves.toMatchObject({ date: "2026-10-28", status: "Scheduled" });
  });
  it("serializes competing updates and rejects one stale write", async () => {
    const item = await save("ideas", { title: "Concurrency" });
    const results = await Promise.allSettled([
      save("ideas", { ...item, title: "First writer" }),
      save("ideas", { ...item, title: "Second writer" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});
