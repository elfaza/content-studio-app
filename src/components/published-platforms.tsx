"use client";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  latest,
  number,
  platformPrefix,
  platforms,
  type RecordData,
} from "@/lib/domain";
import { averageWatchedPercent, publishedDuration } from "@/lib/performance";

const format = (value: number | null) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(value);
const dateLabel = (date: string) =>
  new Date(date + "T12:00:00+07:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Jakarta",
  });

export function PublishedPlatforms({
  video,
  snapshots,
  filter,
}: {
  video: RecordData;
  snapshots: RecordData[];
  filter: string;
}) {
  const observations = latest(snapshots.filter((s) => s.videoId === video.id));
  return (
    <div className="published-platforms" aria-label="Performance by platform">
      {platforms
        .filter(
          (p) =>
            (filter === "All platforms" || filter === p) &&
            (video[platformPrefix(p) + "Url"] ||
              observations.some((s) => s.platform === p)),
        )
        .map((p) => {
          const snapshot = observations.find((s) => s.platform === p);
          const link = video[platformPrefix(p) + "Url"];
          const duration = publishedDuration(video, p);
          const metrics: [string, string][] = [
            ["Duration", duration === null ? "—" : format(duration) + " sec"],
            ["Views", format(number(snapshot?.views))],
            ["Likes", format(number(snapshot?.likes))],
            [
              "Avg. watched",
              snapshot
                ? averageWatchedPercent(snapshot, video) === null
                  ? "—"
                  : format(averageWatchedPercent(snapshot, video)) + "%"
                : "—",
            ],
          ];
          return (
            <section
              className="published-platform"
              key={p}
              aria-label={p + " performance"}
            >
              <div className="platform-row-heading">
                <h4>
                  {link ? (
                    <a href={link} target="_blank" rel="noreferrer">
                      {p} <ExternalLink size={12} />
                    </a>
                  ) : (
                    p
                  )}
                </h4>
                <span className="small muted">
                  {snapshot
                    ? "Updated " + dateLabel(snapshot.date)
                    : "No snapshots yet"}
                </span>
              </div>
              <dl className="platform-metrics">
                {metrics.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}
    </div>
  );
}

export function ObservationHistory({
  videoId,
  snapshots,
  writable,
  onEdit,
}: {
  videoId: string;
  snapshots: RecordData[];
  writable?: boolean;
  onEdit?: (row: RecordData) => void;
}) {
  const [platform, setPlatform] = useState("All platforms");
  const rows = snapshots
    .filter(
      (s) =>
        s.videoId === videoId &&
        (platform === "All platforms" || s.platform === platform),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  return (
    <details className="observation-history">
      <summary>
        Observation history (
        {snapshots.filter((s) => s.videoId === videoId).length})
      </summary>
      <label className="history-filter">
        Platform
        <select
          aria-label="Observation history platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          <option>All platforms</option>
          {platforms.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      {rows.map((s) => (
        <div className="snapshot-line" key={s.id}>
          <span>
            {dateLabel(s.date)} · {s.platform}
          </span>
          <strong>{format(number(s.views))} views</strong>
          {onEdit && (
            <button
              className="text-link"
              disabled={!writable}
              onClick={() => onEdit(s)}
              aria-label={"Edit " + s.platform + " observation " + s.date}
            >
              Edit
            </button>
          )}
        </div>
      ))}
      {!rows.length && (
        <p className="muted small">No observations for this platform.</p>
      )}
    </details>
  );
}
