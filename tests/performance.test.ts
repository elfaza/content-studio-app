import { describe, expect, it } from "vitest";
import { validate, type RecordData } from "../src/lib/domain";
import {
  averageWatchedPercent,
  platformPerformance,
  publishedDuration,
  publishedDate,
  watchObservation,
} from "../src/lib/performance";

const row = (data: Record<string, string>): RecordData => ({
  id: "s",
  version: "v",
  videoId: "v",
  title: "Story",
  ...data,
});
describe("platform-specific performance", () => {
  it("sorts by actual publish date for the selected platform, leaving undated items last", () => {
    const videos = [
      row({ id: "undated" }),
      row({ id: "cross-post", igDate: "2026-10-20", tiktokDate: "2026-11-09" }),
      row({ id: "new-ig", igDate: "2026-11-08" }),
      row({ id: "youtube", youtubeDate: "2026-11-07" }),
    ];
    const ordered = (platform: string) =>
      [...videos]
        .sort((a, b) =>
          publishedDate(b, platform).localeCompare(publishedDate(a, platform)),
        )
        .map((v) => v.id);
    expect(ordered("All platforms")).toEqual([
      "cross-post",
      "new-ig",
      "youtube",
      "undated",
    ]);
    expect(ordered("Instagram")).toEqual([
      "new-ig",
      "cross-post",
      "undated",
      "youtube",
    ]);
    expect(publishedDate(videos[0], "All platforms")).toBe("");
    expect(videos.map((v) => v.id)).toEqual([
      "undated",
      "cross-post",
      "new-ig",
      "youtube",
    ]);
  });
  it("uses the most recent known watch value only for the same video and platform without mutating history", () => {
    const current = row({
      id: "new",
      platform: "TikTok",
      date: "2026-11-06",
      views: "500",
      avgWatch: "",
    });
    const older = row({
      id: "old",
      platform: "TikTok",
      date: "2026-11-05",
      views: "100",
      avgWatch: "12",
    });
    const history = [
      row({ platform: "TikTok", date: "2026-11-07", avgWatch: "25" }),
      row({ platform: "Instagram", date: "2026-11-06", avgWatch: "20" }),
      row({
        videoId: "other",
        platform: "TikTok",
        date: "2026-11-06",
        avgWatch: "22",
      }),
      row({ platform: "TikTok", date: "2026-11-04", avgWatch: "10" }),
      older,
      current,
    ];
    const before = JSON.stringify(history);
    const source = watchObservation(current, history);
    expect(source).toBe(older);
    expect(averageWatchedPercent(source!, row({ tiktokDuration: "30" }))).toBe(
      40,
    );
    expect(current.views).toBe("500");
    expect(current.avgWatch).toBe("");
    expect(JSON.stringify(history)).toBe(before);
    expect(
      watchObservation({ ...current, avgWatch: "0" }, history)?.avgWatch,
    ).toBe("0");
    expect(watchObservation({ ...current, avgWatch: "18" }, history)?.id).toBe(
      "new",
    );
    expect(watchObservation(current, history.slice(0, 3))).toBeUndefined();
    expect(watchObservation(undefined, history)).toBeUndefined();
  });
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
