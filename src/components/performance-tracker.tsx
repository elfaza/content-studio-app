"use client";
import { useState } from "react";
import { number, platforms, type RecordData } from "@/lib/domain";

const format = (value: string) =>
  number(value) === null
    ? "—"
    : new Intl.NumberFormat("en").format(number(value)!);
function corrections(
  row: RecordData,
): { at: string; before: Record<string, string> }[] {
  try {
    const history: unknown = JSON.parse(row.correctionHistory || "[]");
    return Array.isArray(history)
      ? history.filter(
          (entry) =>
            entry &&
            typeof entry.at === "string" &&
            entry.before &&
            typeof entry.before === "object",
        )
      : [];
  } catch {
    return [];
  }
}
export function PerformanceTracker({
  snapshots,
  videos,
  writable,
  onEdit,
  onAdd,
}: {
  snapshots: RecordData[];
  videos: RecordData[];
  writable: boolean;
  onEdit: (row: RecordData) => void;
  onAdd: () => void;
}) {
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("All platforms");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const title = (row: RecordData) =>
    videos.find((v) => v.id === row.videoId)?.title || row.title || row.videoId;
  const rows = snapshots
    .filter(
      (row) =>
        (platform === "All platforms" || row.platform === platform) &&
        (!from || row.date >= from) &&
        (!to || row.date <= to) &&
        (title(row) + " " + row.videoId)
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(rows.length / 25) - 1),
  );
  return (
    <section
      className="performance-tracker"
      aria-label="Performance tracker list"
    >
      <div className="section-top">
        <p className="muted small">{rows.length} observations · newest first</p>
        <button className="button" disabled={!writable} onClick={onAdd}>
          Add observation
        </button>
      </div>
      <div className="panel tracker-filters">
        <label className="field">
          <span>Find content</span>
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="Search title or video ID"
          />
        </label>
        <label className="field">
          <span>Tracker platform</span>
          <select
            value={platform}
            onChange={(e) => {
              setPlatform(e.target.value);
              setPage(0);
            }}
          >
            <option>All platforms</option>
            {platforms.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Observed from</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(0);
            }}
          />
        </label>
        <label className="field">
          <span>Observed until</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(0);
            }}
          />
        </label>
      </div>
      {!writable && (
        <p className="form-note">
          Editing is unavailable while offline or while a connection or
          spreadsheet warning is unresolved. Your observations remain visible.
        </p>
      )}
      {!rows.length && (
        <p className="panel muted">No observations match these filters.</p>
      )}
      {rows.slice(currentPage * 25, (currentPage + 1) * 25).map((row) => {
        const history = corrections(row);
        return (
          <article className="panel tracker-row" key={row.id}>
            <div className="tracker-row-top">
              <div>
                <h3>{title(row)}</h3>
                <p className="small muted">
                  {row.platform} · Observed{" "}
                  <time dateTime={row.date}>{row.date}</time> · {row.videoId}
                </p>
              </div>
              <button
                className="button outline"
                disabled={!writable}
                onClick={() => onEdit(row)}
                aria-label={
                  "Edit observation: " +
                  title(row) +
                  ", " +
                  row.platform +
                  ", " +
                  row.date
                }
              >
                Edit observation
              </button>
            </div>
            <dl className="platform-metrics">
              <div>
                <dt>Views</dt>
                <dd>{format(row.views)}</dd>
              </div>
              <div>
                <dt>Likes</dt>
                <dd>{format(row.likes)}</dd>
              </div>
              <div>
                <dt>Comments</dt>
                <dd>{format(row.comments)}</dd>
              </div>
              <div>
                <dt>Shares</dt>
                <dd>{format(row.shares)}</dd>
              </div>
            </dl>
            {!!history.length && (
              <details className="correction-history">
                <summary>Correction history ({history.length})</summary>
                {[...history].reverse().map((entry, i) => (
                  <div className="snapshot-line" key={entry.at + i}>
                    <span>
                      Before correction{" "}
                      {new Date(entry.at).toLocaleString("en-GB", {
                        timeZone: "Asia/Jakarta",
                      })}{" "}
                      WIB
                      <br />
                      {entry.before.title || entry.before.videoId} ·{" "}
                      {entry.before.platform} · {entry.before.date}
                    </span>
                    <span>
                      {format(entry.before.views)} views ·{" "}
                      {format(entry.before.likes)} likes
                    </span>
                  </div>
                ))}
              </details>
            )}
          </article>
        );
      })}
      {rows.length > 25 && (
        <div className="button-group tracker-pagination">
          <button
            className="button outline"
            disabled={!currentPage}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous
          </button>
          <span>
            Page {currentPage + 1} of {Math.ceil(rows.length / 25)}
          </span>
          <button
            className="button outline"
            disabled={(currentPage + 1) * 25 >= rows.length}
            onClick={() => setPage(currentPage + 1)}
          >
            Next
          </button>
        </div>
      )}
    </section>
  );
}
