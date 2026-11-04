import { describe, it, expect } from "vitest";
import {
  number,
  sum,
  rate,
  engagement,
  latest,
  mapRow,
  ideaFields,
  validateHeaders,
  today,
  dayAdd,
  stage,
  validate,
  RecordData,
} from "../src/lib/domain";
const row = (v: Record<string, string>): RecordData => ({
  id: "x",
  version: "v1",
  ...v,
});
describe("Missing metrics and calculations", () => {
  it("distinguishes missing from measured zero", () => {
    expect(number("")).toBeNull();
    expect(number(null)).toBeNull();
    expect(number("0")).toBe(0);
    expect(sum([null, null])).toBeNull();
    expect(sum([null, 0])).toBe(0);
    expect(number("1,200")).toBe(1200);
  });
  it("never divides by zero or invents a denominator", () => {
    expect(rate(10, 0)).toBeNull();
    expect(rate(null, 100)).toBeNull();
    expect(rate(5, 200)).toBe(2.5);
  });
  it("requires complete engagement components unless interactions are supplied", () => {
    expect(engagement(row({ views: "100", likes: "10" }))).toBeNull();
    expect(engagement(row({ views: "100", interactions: "0" }))).toBe(0);
    expect(
      engagement(
        row({
          views: "100",
          likes: "10",
          comments: "1",
          shares: "2",
          saves: "0",
        }),
      ),
    ).toBe(13);
  });
  it("uses the latest actual observation per video and platform", () => {
    const rows = [
      row({
        id: "a",
        videoId: "v",
        platform: "Instagram",
        date: "2026-10-01",
        views: "10",
      }),
      row({
        id: "b",
        videoId: "v",
        platform: "Instagram",
        date: "2026-10-03",
        views: "20",
      }),
      row({
        id: "c",
        videoId: "v",
        platform: "TikTok",
        date: "2026-10-01",
        views: "5",
      }),
    ];
    expect(latest(rows).map((s) => s.id)).toEqual(["b", "c"]);
    expect(rows).toHaveLength(3);
  });
});
describe("Existing schema preservation", () => {
  it("maps by headers rather than positions", () =>
    expect(
      mapRow(
        ["Content Idea", "Unrecognized", "Priority"],
        ["Story", "keep", "High"],
        ideaFields,
      ),
    ).toEqual({ title: "Story", priority: "High" }));
  it("rejects missing and duplicate required headers", () => {
    expect(() => validateHeaders(["Content Idea"], ideaFields)).toThrow(
      "Missing required",
    );
    expect(() =>
      validateHeaders(["Title", "Title"], { Title: "title" }),
    ).toThrow("Duplicate");
  });
  it("normalizes legacy status without changing raw input", () => {
    expect(stage("Posted")).toBe("Published");
    expect(stage("Researching")).toBe("Idea");
    expect(stage("editing")).toBe("Editing");
  });
});
describe("Jakarta dates and validation", () => {
  it("uses WIB across UTC midnight boundaries", () => {
    expect(today(new Date("2026-10-25T18:00:00Z"))).toBe("2026-10-26");
    expect(dayAdd("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("rejects invalid dates and negative metrics", () => {
    expect(() =>
      validate("snapshots", {
        videoId: "v",
        date: "2026-02-30",
        platform: "Instagram",
      }),
    ).toThrow();
    expect(() =>
      validate("snapshots", {
        videoId: "v",
        date: "2026-10-26",
        platform: "Instagram",
        views: "-1",
      }),
    ).toThrow();
    expect(() =>
      validate("snapshots", {
        videoId: "v",
        date: "2026-10-26",
        platform: "Instagram",
        watchedFull: "101",
      }),
    ).toThrow();
  });
  it("keeps omitted performance metrics unknown", () => {
    const s = validate("snapshots", {
      videoId: "v",
      date: "2026-10-26",
      platform: "Instagram",
      views: "0",
    });
    expect(s.views).toBe("0");
    expect(s.likes).toBe("");
  });
  it("requires a real post identifier and safe links", () => {
    expect(() => validate("videos", { title: "Story" })).toThrow();
    expect(() =>
      validate("videos", { title: "Story", igUrl: "javascript:alert(1)" }),
    ).toThrow();
    expect(
      validate("videos", {
        title: "Story",
        igUrl: "https://instagram.com/reel/test/",
      }).title,
    ).toBe("Story");
  });
  it("validates schedule times without fabricating publication data", () => {
    expect(() =>
      validate("schedule", {
        contentId: "i",
        title: "Story",
        date: "2026-10-26",
        time: "25:00",
        platform: "Instagram",
      }),
    ).toThrow();
    expect(
      validate("schedule", {
        contentId: "i",
        title: "Story",
        date: "2026-10-26",
        time: "19:00",
        platform: "Instagram",
      }).status,
    ).toBe("Scheduled");
  });
});
