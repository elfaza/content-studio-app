"use client";
import { useState } from "react";
import useSWR from "swr";
import { Instagram, RefreshCw } from "lucide-react";
const statusFetcher = async (url: string) => {
  const r = await fetch(url, { cache: "no-store" });
  const body = await r.json();
  if (!r.ok)
    throw new Error(body.error || "Instagram connection is unavailable.");
  return body as {
    configured: boolean;
    connected: boolean;
    username: string;
    expiresAt: number | null;
    connectionMethod?: "system_user" | "oauth";
  };
};
export function InstagramSettings({
  online,
  writable,
  onSynced,
}: {
  online: boolean;
  writable: boolean;
  onSynced: () => Promise<unknown>;
}) {
  const { data, error, mutate } = useSWR(
    online ? "/api/instagram" : null,
    statusFetcher,
    { shouldRetryOnError: false },
  );
  const [busy, setBusy] = useState<"connect" | "sync" | null>(null);
  const [message, setMessage] = useState("");
  async function act(action: "connect" | "sync") {
    setBusy(action);
    setMessage("");
    try {
      const response = await fetch(
        action === "connect" ? "/api/instagram" : "/api/instagram/sync",
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error || "Instagram action could not be completed.",
        );
      if (action === "connect") {
        if (body.connected) {
          setMessage(
            `Connected to @${body.username}. Choose Sync Instagram to read performance statistics.`,
          );
          await mutate();
        } else {
          window.location.assign(body.url);
        }
        return;
      }
      setMessage(
        `Instagram synced: ${body.added} added, ${body.updated} updated, ${body.unchanged} unchanged. ${body.manualUpdated ?? 0} manual observations refreshed; previous values kept in correction history. ${body.unmatched.length} post links could not be matched or had no available metrics.`,
      );
      try {
        await onSynced();
      } catch {
        setMessage(
          (previous) =>
            previous +
            " Statistics were saved, but the workspace could not refresh. Reload the app to review them.",
        );
      }
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Instagram action could not be completed.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="panel instagram-settings">
      <div className="panel-heading">
        <h2>
          <Instagram size={18} /> Instagram insights
        </h2>
        <span className="tiny-pill">
          {data?.connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <p>
        {data?.connected
          ? `Connected to @${data.username}.`
          : "Connect your Instagram Creator or Business account to read its post statistics."}
      </p>
      <p className="muted small">
        Sync runs only when you press Sync Instagram. It uses the Instagram
        links saved in Published content. There is no automatic schedule.
      </p>
      {!data?.configured && !error && (
        <p className="form-note">
          Instagram setup is not complete yet. The Meta app credentials must be
          configured on the server.
        </p>
      )}
      {data?.expiresAt && (
        <p className="muted small">
          Access expires{" "}
          {new Date(data.expiresAt).toLocaleDateString("en-GB", {
            timeZone: "Asia/Jakarta",
          })}
          . Reconnect here when needed.
        </p>
      )}
      {data?.connectionMethod === "system_user" && (
        <p className="muted small">
          Uses the server connection for your Instagram account. If Meta expires
          or revokes access, replace the server token and validate again.
        </p>
      )}
      <div className="button-group">
        <button
          className="button outline"
          disabled={!online || !!busy}
          onClick={() => void act("connect")}
        >
          {busy === "connect"
            ? data?.connectionMethod === "system_user"
              ? "Validating Instagram…"
              : "Opening Instagram…"
            : data?.connectionMethod === "system_user"
              ? "Validate Instagram connection"
              : data?.connected
                ? "Reconnect Instagram"
                : "Connect Instagram"}
        </button>
        <button
          className="button"
          disabled={!online || !writable || !data?.connected || !!busy}
          onClick={() => void act("sync")}
        >
          <RefreshCw size={15} className={busy === "sync" ? "spin" : ""} />
          {busy === "sync" ? "Reading Instagram…" : "Sync Instagram"}
        </button>
      </div>
      <p className="muted small">
        Sync refreshes available Instagram metrics on today&apos;s snapshot,
        including manual observations. Previous values are kept in correction
        history. Reels average watch time is refreshed when Meta provides it;
        otherwise your existing value is kept. Duration, completion rate, older
        dates, TikTok and YouTube are unchanged.
      </p>
      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}
      {message && (
        <p className="form-note" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
