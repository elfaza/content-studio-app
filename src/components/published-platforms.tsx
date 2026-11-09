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
type SyncMessage = { text: string; reconnect?: boolean };

export function PublishedPlatforms({
  video,
  snapshots,
  filter,
  writable = false,
  onSynced,
  onOpen,
}: {
  video: RecordData;
  snapshots: RecordData[];
  filter: string;
  writable?: boolean;
  onSynced?: () => Promise<unknown>;
  onOpen: () => void;
}) {
  const running = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [requiresReview, setRequiresReview] = useState(false);
  const [messages, setMessages] = useState<Record<string, SyncMessage>>({});
  const [refreshMessage, setRefreshMessage] = useState("");
  const targets = [
    { name: "Instagram", provider: "instagram", url: video.igUrl },
    { name: "TikTok", provider: "tiktok", url: video.tiktokUrl },
  ].filter((target) => !!target.url);

  async function sync() {
    if (running.current || !writable || !targets.length || requiresReview)
      return;
    running.current = true;
    setMessages({});
    setRefreshMessage("");
    let stopped = false;
    try {
      // Each platform can write the same tracker. Finish one before starting the next.
      for (const target of targets) {
        if (stopped) {
          setMessages((previous) => ({
            ...previous,
            [target.name]: {
              text: "Not started. Reload to review the previous sync before trying again.",
            },
          }));
          continue;
        }
        setBusy(target.name);
        try {
          const response = await fetch(`/api/${target.provider}/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoId: video.id }),
          });
          const body = await response.json();
          if (!response.ok) {
            setMessages((previous) => ({
              ...previous,
              [target.name]: {
                text:
                  body.error ||
                  "Sync could not be confirmed. Reload to check before trying again.",
                reconnect: body.reconnect || body.googleReconnect,
              },
            }));
            if (
              response.status >= 500 ||
              response.status === 409 ||
              body.googleReconnect
            ) {
              stopped = true;
              setRequiresReview(true);
            }
            continue;
          }
          const text = body.unmatched?.length
            ? "No available statistics. Check the post link and account access."
            : body.unchanged &&
                !body.added &&
                !body.updated &&
                !body.manualUpdated
              ? "Already up to date."
              : "Synced today's statistics.";
          setMessages((previous) => ({ ...previous, [target.name]: { text } }));
        } catch {
          stopped = true;
          setRequiresReview(true);
          setMessages((previous) => ({
            ...previous,
            [target.name]: {
              text: "Sync could not be confirmed. Reload to check before trying again. This request was not retried.",
            },
          }));
        }
      }
      // Refresh once, including partial success or an uncertain response. Never retry a write.
      try {
        await onSynced?.();
      } catch {
        setRefreshMessage(
          "The list could not refresh. Reload to review the latest statistics before syncing again.",
        );
        setRequiresReview(true);
      }
    } finally {
      running.current = false;
      setBusy(null);
    }
  }
  const names = targets.map((target) => target.name).join(" & ");
  const tooltip = busy
    ? `Syncing ${busy}…`
    : requiresReview
      ? "Reload to review the previous sync before trying again"
      : !targets.length
        ? "Add an Instagram or TikTok post link to sync"
        : !writable
          ? "Connect a writable tracker and go online to sync"
          : `Sync ${names}`;
  const observations = latest(snapshots.filter((s) => s.videoId === video.id));
  return (
    <>
      <div className="card-meta">
        <span className="category-label">
          {video.category || "Uncategorized"}
        </span>
        <div className="published-meta-actions">
          <span className="small muted">{video.id.slice(0, 16)}</span>
          <button
            type="button"
            className="icon-button published-sync-button"
            disabled={!writable || !!busy || !targets.length || requiresReview}
            aria-label={`Sync ${names || "Instagram & TikTok"} statistics for ${video.title}`}
            aria-busy={!!busy}
            title={tooltip}
            onClick={() => void sync()}
          >
            <RefreshCw
              size={18}
              className={busy ? "spin" : ""}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>
      <button className="plain-title" onClick={onOpen}>
        <h3>{video.title}</h3>
      </button>
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
              </section>
            );
          })}
        <div
          className="published-sync-status small muted"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {busy ? <p>Syncing {busy}…</p> : null}
          {Object.entries(messages).map(([platform, message]) => (
            <p key={platform}>
              <strong>{platform}:</strong> {message.text}{" "}
              {message.reconnect ? (
                <Link href="/settings">Reconnect in Settings</Link>
              ) : null}
            </p>
          ))}
          {refreshMessage ? <p>{refreshMessage}</p> : null}
        </div>
      </div>
    </>
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
