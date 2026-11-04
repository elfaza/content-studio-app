import {
  latest,
  number,
  platformPrefix,
  rate,
  sum,
  type Platform,
  type RecordData,
} from "./domain";

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
