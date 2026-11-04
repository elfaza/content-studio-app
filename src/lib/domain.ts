import { z } from "zod";
export const stages = [
  "Idea",
  "Scripting",
  "Filming",
  "Editing",
  "Ready",
  "Scheduled",
  "Published",
  "Cancelled",
] as const;
export const platforms = ["Instagram", "TikTok", "YouTube"] as const;
export type Platform = (typeof platforms)[number];
export function platformPrefix(platform: string) {
  return platform === "Instagram"
    ? "ig"
    : platform === "TikTok"
      ? "tiktok"
      : "youtube";
}
export const ideaFields = {
  "Date Found": "date",
  Priority: "priority",
  Category: "category",
  "Content Idea": "title",
  "Why It Fits Me": "relevance",
  "Reference / Source": "reference",
  "Video / Footage Reference": "footageReference",
  "Visual Notes / What to Copy": "visualNotes",
  "Trend / Inspiration": "trend",
  "Target Duration (sec)": "duration",
  "Hook (0–3 sec)": "hook",
  "Full Script / Story": "script",
  "Shot List / Footage Needed": "shots",
  "Text Overlay": "overlay",
  "CTA / Ending": "cta",
  Difficulty: "difficulty",
  "Need New Footage?": "needFootage",
  Status: "status",
  Platform: "platform",
  "Posted Date": "postedDate",
  "TikTok Views": "tiktokViews",
  "IG Reels Views": "igViews",
  "YouTube Shorts Views": "youtubeViews",
  "Performance Notes": "notes",
} as const;
export const videoFields = {
  "Video ID": "id",
  "Content Title": "title",
  Category: "category",
  "Related Idea": "ideaId",
  "IG Posted Date": "igDate",
  "IG Posted Time (WIB)": "igTime",
  "Instagram URL": "igUrl",
  "TikTok Posted Date": "tiktokDate",
  "TikTok Posted Time (WIB)": "tiktokTime",
  "TikTok URL": "tiktokUrl",
  "YouTube URL": "youtubeUrl",
  "Duration (sec)": "duration",
  Status: "status",
  "Latest IG Views": "igViews",
  "Latest TikTok Views": "tiktokViews",
  Notes: "notes",
} as const;
export const snapshotFields = {
  "Snapshot Date": "date",
  "Video ID": "videoId",
  "Content Title": "title",
  Platform: "platform",
  Views: "views",
  Likes: "likes",
  Comments: "comments",
  Shares: "shares",
  Reposts: "reposts",
  Saves: "saves",
  "Unique Viewers": "uniqueViewers",
  "Avg Watch (sec)": "avgWatch",
  "Watched Full (%)": "watchedFull",
  "New Follows": "follows",
  "Profile Visits": "profileVisits",
  "Bio Link Taps": "linkTaps",
  Interactions: "interactions",
  "Non-follower Views (%)": "nonFollower",
  "Audience / Traffic Notes": "audience",
  "Source / Context": "source",
  Notes: "notes",
} as const;
export type RecordData = Record<string, string> & {
  id: string;
  version: string;
};
export type Dataset = {
  ideas: RecordData[];
  videos: RecordData[];
  snapshots: RecordData[];
  schedule: RecordData[];
  settings: RecordData[];
  mode: "demo" | "live";
  persistence?: "browser";
  syncedAt: string;
  writable: boolean;
  warnings: string[];
};
export type Entity = "ideas" | "videos" | "snapshots" | "schedule" | "settings";
const text = z.string().max(20000).default("");
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + "T00:00:00Z");
    return !isNaN(+d) && d.toISOString().slice(0, 10) === v;
  }, "Invalid date");
const optionalDate = z.union([date, z.literal("")]).default("");
const optionalTime = z
  .union([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.literal("")])
  .default("");
const numeric = z
  .string()
  .refine(
    (v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
    "Use a non-negative number",
  )
  .default("");
const url = z
  .union([
    z.url().refine((v) => /^https?:\/\//.test(v), "Use an HTTP(S) URL"),
    z.literal(""),
  ])
  .default("");
const identity = {
  id: z.string().max(100).optional(),
  version: z.string().max(100).optional(),
};
export const ideaSchema = z
  .object({
    ...identity,
    title: z.string().trim().min(1).max(250),
    date: optionalDate,
    category: text,
    priority: text,
    status: text,
    platform: text,
    difficulty: text,
    duration: numeric,
    needFootage: text,
    relevance: text,
    reference: text,
    footageReference: text,
    visualNotes: text,
    trend: text,
    hook: text,
    script: text,
    shots: text,
    overlay: text,
    cta: text,
    notes: text,
    archived: z.enum(["true", "false"]).default("false"),
    deadline: optionalDate,
    footageRecorded: text,
    cancellationReason: z.string().trim().max(2000).default(""),
  })
  .refine(
    (data) =>
      stage(data.status) !== "Cancelled" || data.cancellationReason.length > 0,
    { path: ["cancellationReason"], message: "Enter a cancellation reason." },
  );
export const videoSchema = z
  .object({
    ...identity,
    title: z.string().trim().min(1).max(250),
    category: text,
    ideaId: text,
    duration: numeric,
    igDuration: numeric,
    tiktokDuration: numeric,
    youtubeDuration: numeric,
    igDate: optionalDate,
    igTime: optionalTime,
    igUrl: url,
    tiktokDate: optionalDate,
    tiktokTime: optionalTime,
    tiktokUrl: url,
    youtubeDate: optionalDate,
    youtubeTime: optionalTime,
    youtubeUrl: url,
    notes: text,
    status: z.string().max(100).default("Posted"),
  })
  .refine(
    (v) => !!(v.igUrl || v.tiktokUrl || v.youtubeUrl),
    "At least one post URL is required",
  );
export const metricKeys = [
  "views",
  "likes",
  "comments",
  "shares",
  "reposts",
  "saves",
  "uniqueViewers",
  "avgWatch",
  "watchedFull",
  "follows",
  "profileVisits",
  "linkTaps",
  "interactions",
  "nonFollower",
] as const;
export const snapshotSchema = z
  .object({
    ...identity,
    videoId: z.string().min(1),
    title: text,
    date,
    platform: z.enum(platforms),
    ...Object.fromEntries(metricKeys.map((k) => [k, numeric])),
    audience: text,
    source: text,
    notes: text,
  })
  .superRefine((v, c) => {
    for (const k of ["watchedFull", "nonFollower"])
      if (Number((v as Record<string, unknown>)[k]) > 100)
        c.addIssue({
          code: "custom",
          path: [k],
          message: "Must be between 0 and 100",
        });
  });
export const scheduleSchema = z.object({
  ...identity,
  contentId: z.string().min(1),
  title: z.string().min(1).max(250),
  date,
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  platform: z.enum(platforms),
  status: z.enum(["Scheduled", "Published", "Cancelled"]).default("Scheduled"),
  notes: text,
});
export const settingsSchema = z.object({
  ...identity,
  creator: text,
  platform: text,
  categories: text,
  theme: z.enum(["dark", "light"]).default("dark"),
  timezone: z.literal("Asia/Jakarta").default("Asia/Jakarta"),
});
export function validate(
  entity: Entity,
  data: unknown,
): Record<string, string> {
  return {
    ideas: ideaSchema,
    videos: videoSchema,
    snapshots: snapshotSchema,
    schedule: scheduleSchema,
    settings: settingsSchema,
  }[entity].parse(data) as Record<string, string>;
}
export function stage(status: string) {
  const s = status.toLowerCase().trim();
  if (["posted", "published", "done"].includes(s)) return "Published";
  if (s === "canceled" || s === "cancelled") return "Cancelled";
  if (s === "ideas" || s === "new") return "Idea";
  return stages.find((x) => x.toLowerCase() === s) ?? "Idea";
}
export function number(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "")
    return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
export function today(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function dayAdd(day: string, amount: number) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
export function sum(values: (number | null)[]) {
  const known = values.filter((x): x is number => x !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
}
export function rate(n: number | null, d: number | null) {
  return n !== null && d !== null && d > 0 ? (n / d) * 100 : null;
}
export function engagement(s: RecordData) {
  const total =
    number(s.interactions) ??
    (["likes", "comments", "shares", "saves"].every(
      (k) => number(s[k]) !== null,
    )
      ? sum(["likes", "comments", "shares", "saves"].map((k) => number(s[k])))
      : null);
  return rate(total, number(s.views));
}
export function latest(snapshots: RecordData[]) {
  const map = new Map<string, RecordData>();
  for (const s of snapshots) {
    const key = s.videoId + "|" + s.platform;
    if (!map.has(key) || map.get(key)!.date < s.date) map.set(key, s);
  }
  return [...map.values()];
}
export function mapRow(
  headers: string[],
  row: unknown[],
  mapping: Record<string, string>,
) {
  return Object.fromEntries(
    headers.flatMap((h, i) =>
      mapping[h] ? [[mapping[h], row[i] == null ? "" : String(row[i])]] : [],
    ),
  );
}
export function validateHeaders(
  headers: string[],
  mapping: Record<string, string>,
) {
  const missing = Object.keys(mapping).filter((x) => !headers.includes(x));
  if (missing.length)
    throw new Error("Missing required columns: " + missing.join(", "));
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length)
    throw new Error("Duplicate column headers");
}

export function cancelIdeaSchedules(
  rows: RecordData[],
  ideaId: string,
  version: string,
) {
  return rows.map((row) =>
    row.contentId === ideaId && row.status === "Scheduled"
      ? {
          ...row,
          status: "Cancelled",
          version: "cancelled-" + version.slice(0, 64),
        }
      : row,
  );
}
