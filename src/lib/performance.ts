import {
  latest,
  number,
  platformPrefix,
  rate,
  sum,
  type Platform,
  type RecordData,
} from "./domain";

export function publishedDate(video: RecordData, platform: string) {
  const dates = (
    platform === "All platforms"
      ? ["Instagram", "TikTok", "YouTube"]
      : [platform]
  )
    .map((p) => video[platformPrefix(p) + "Date"] ?? "")
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  return dates.sort().at(-1) ?? "";
}

// A missing per-platform duration stays unknown; legacy duration is not evidence
// that all uploaded versions have the same length.
export function publishedDuration(
  video: Partial<RecordData> | undefined,
  platform: string,
) {
  return number(video?.[platformPrefix(platform) + "Duration"]);
}

export function averageWatchedPercent(
  snapshot: RecordData,
  video?: Partial<RecordData>,
) {
  return rate(
    number(snapshot.avgWatch),
    publishedDuration(video, snapshot.platform),
  );
}

// Display-only fallback. Never copy an older metric into a new observation.
export function watchObservation(
  snapshot: RecordData | undefined,
  snapshots: RecordData[],
) {
  if (!snapshot) return undefined;
  if (number(snapshot.avgWatch) !== null) return snapshot;
  return snapshots
    .filter(
      (s) =>
        s.videoId === snapshot.videoId &&
        s.platform === snapshot.platform &&
        s.date <= snapshot.date &&
        number(s.avgWatch) !== null,
    )
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

export function platformPerformance(
  snapshots: RecordData[],
  platform: Platform,
  start: string,
  end: string,
) {
  const rows = snapshots.filter(
    (s) =>
      s.platform === platform && (!start || s.date >= start) && s.date <= end,
  );
  const dates = [...new Set(rows.map((s) => s.date))].sort();
  return {
    observed: latest(rows),
    points: dates.map((date) => ({
      date,
      views: sum(
        latest(rows.filter((s) => s.date === date)).map((s) => number(s.views)),
      ),
    })),
  };
}
