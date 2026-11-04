import { describe, expect, it } from "vitest";
import { validate, type RecordData } from "../src/lib/domain";
import {
  averageWatchedPercent,
  platformPerformance,
  publishedDuration,
} from "../src/lib/performance";

const row = (data: Record<string, string>): RecordData => ({
  id: "s",
  version: "v",
  videoId: "v",
  title: "Story",
  ...data,
});
describe("platform-specific performance", () => {
  const snapshots = [
    row({
      id: "ig-old",
      platform: "Instagram",
      date: "2026-10-26",
      views: "3742",
    }),
    row({
      id: "ig-new",
      platform: "Instagram",
      date: "2026-10-31",
      views: "3779",
      avgWatch: "30",
    }),
    row({
      id: "tt",
      platform: "TikTok",
      date: "2026-10-13",
      views: "245",
      avgWatch: "30",
    }),
  ];
  it("separates platforms and takes the latest snapshot without summing history", () => {
    const ig = platformPerformance(
      snapshots,
      "Instagram",
      "2026-10-01",
      "2026-10-31",
    );
    expect(ig.observed.map((s) => s.views)).toEqual(["3779"]);
    expect(ig.points).toEqual([
      { date: "2026-10-26", views: 3742 },
      { date: "2026-10-31", views: 3779 },
    ]);
    expect(
      platformPerformance(
        snapshots,
        "TikTok",
        "2026-10-01",
        "2026-10-31",
      ).observed.map((s) => s.views),
    ).toEqual(["245"]);
    expect(
      platformPerformance(snapshots, "YouTube", "2026-10-01", "2026-10-31")
        .observed,
    ).toEqual([]);
    expect(
      platformPerformance(snapshots, "Instagram", "2026-10-01", "2026-10-26")
        .observed[0].views,
    ).toBe("3742");
  });
  it("uses each version's actual duration, never the shared legacy duration", () => {
    const video = row({
      duration: "100",
      igDuration: "45",
      tiktokDuration: "70",
    });
    expect(averageWatchedPercent(snapshots[1], video)).toBeCloseTo(66.6667);
    expect(averageWatchedPercent(snapshots[2], video)).toBeCloseTo(42.8571);
    expect(publishedDuration(video, "YouTube")).toBeNull();
    expect(
      averageWatchedPercent(snapshots[1], row({ duration: "100" })),
    ).toBeNull();
    expect(
      averageWatchedPercent(snapshots[1], row({ igDuration: "0" })),
    ).toBeNull();
    expect(
      averageWatchedPercent({ ...snapshots[1], avgWatch: "0" }, video),
    ).toBe(0);
    expect(
      averageWatchedPercent({ ...snapshots[1], avgWatch: "60" }, video),
    ).toBeCloseTo(133.3333);
  });
  it("validates independent durations while preserving legacy duration", () => {
    const data = {
      title: "Story",
      igUrl: "https://instagram.com/reel/test/",
      duration: "60",
      igDuration: "45",
      tiktokDuration: "70.5",
    };
    expect(validate("videos", data)).toMatchObject({
      duration: "60",
      igDuration: "45",
      tiktokDuration: "70.5",
      youtubeDuration: "",
    });
    expect(() => validate("videos", { ...data, igDuration: "-1" })).toThrow();
    expect(() =>
      validate("videos", { ...data, tiktokDuration: "NaN" }),
    ).toThrow();
  });
});
