"use client";
import { useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import Link from "next/link";
import {
  latest,
  number,
  platformPrefix,
  platforms,
  type RecordData,
} from "@/lib/domain";
import {
  averageWatchedPercent,
  publishedDuration,
  watchObservation,
} from "@/lib/performance";

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
  writable = false,
  onSynced,
}: {
  video: RecordData;
  snapshots: RecordData[];
  filter: string;
  writable?: boolean;
  onSynced?: () => Promise<unknown>;
}) {
  const running = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<
    Record<string, { text: string; reconnect?: boolean }>
  >({});
  async function sync(platform: string) {
    if (running.current || !writable) return;
    running.current = true;
    setBusy(platform);
    setMessages((previous) => ({ ...previous, [platform]: { text: "" } }));
    try {
      const provider = platform === "Instagram" ? "instagram" : "tiktok";
      const response = await fetch(`/api/${provider}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: video.id }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessages((previous) => ({
          ...previous,
          [platform]: {
            text:
              body.error ||
              "Sync could not be confirmed. Reload to check before trying again.",
            reconnect: body.reconnect || body.googleReconnect,
          },
        }));
        return;
      }
      let text = body.unmatched?.length
        ? "No available statistics for this post. Check its link and account access."
        : body.unchanged
          ? "Already up to date."
          : "Synced today's statistics. Previous values stay in correction history.";
      try {
        await onSynced?.();
      } catch {
        text +=
          " Sync completed, but the list could not refresh. Reload the app to review it.";
      }
      setMessages((previous) => ({ ...previous, [platform]: { text } }));
    } catch {
      setMessages((previous) => ({
        ...previous,
        [platform]: {
          text: "Sync could not be confirmed. Reload to check before trying again. This request was not retried.",
        },
      }));
    } finally {
      running.current = false;
      setBusy(null);
    }
  }
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
          const watch = watchObservation(snapshot, snapshots);
          const watchPercent = watch
            ? averageWatchedPercent(watch, video)
            : null;
          const metrics: [string, string][] = [
            ["Duration", duration === null ? "—" : format(duration) + " sec"],
            ["Views", format(number(snapshot?.views))],
            ["Likes", format(number(snapshot?.likes))],
            [
              "Avg. watched",
              watchPercent === null ? "—" : format(watchPercent) + "%",
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
                    <dd>
                      {value}
                      {label === "Avg. watched" &&
                        watchPercent !== null &&
                        watch &&
                        watch !== snapshot && (
                          <div
                            className="small muted"
                            title={"Previous observation: " + watch.date}
                          >
                            Last available · {dateLabel(watch.date)}
                          </div>
                        )}
                    </dd>
                  </div>
                ))}
              </dl>
              {link && (p === "Instagram" || p === "TikTok") && (
                <button
                  className="button outline"
                  disabled={!writable || !!busy}
                  aria-label={`Refresh ${p} statistics for ${video.title}`}
                  title={
                    writable
                      ? `Sync only this ${p} post`
                      : "Connect a writable tracker and go online to sync"
                  }
                  onClick={() => void sync(p)}
                >
                  <RefreshCw size={15} className={busy === p ? "spin" : ""} />
                  {busy === p ? "Syncing…" : `Refresh ${p}`}
                </button>
              )}
              {messages[p]?.text && (
                <p className="small form-note" role="status">
                  {messages[p].text}{" "}
                  {messages[p].reconnect && (
                    <Link href="/settings">Reconnect in Settings</Link>
                  )}
                </p>
              )}
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
