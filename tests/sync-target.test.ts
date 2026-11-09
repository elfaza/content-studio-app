import { expect, it } from "vitest";
import { syncTarget } from "../src/lib/sync-target";
import type { RecordData } from "../src/lib/domain";
const videos: RecordData[] = [
  {
    id: "one",
    version: "v1",
    title: "First",
    igUrl: "https://instagram.com/p/one/",
  },
  {
    id: "two",
    version: "v2",
    title: "Second",
    tiktokUrl: "https://www.tiktok.com/@a/video/123456789012",
  },
];
it("retains sync-all only for an empty body and validates an exact stored video", () => {
  expect(syncTarget("", videos, "igUrl")).toBeUndefined();
  expect(syncTarget('{"videoId":"one"}', videos, "igUrl")).toBe("one");
  expect(syncTarget('{"videoId":"two"}', videos, "tiktokUrl")).toBe("two");
});
it("rejects invalid selection rather than falling back to sync-all", () => {
  for (const body of [
    "{}",
    "null",
    "oops",
    '{"videoId":[]}',
    '{"videoId":""}',
    '{"videoId":"one","url":"external"}',
  ])
    expect(() => syncTarget(body, videos, "igUrl")).toThrow();
  expect(() => syncTarget('{"videoId":"missing"}', videos, "igUrl")).toThrow(
    "no longer exists",
  );
  expect(() => syncTarget('{"videoId":"two"}', videos, "igUrl")).toThrow(
    "post link",
  );
});
