"use client";
import { useState } from "react";
import useSWR from "swr";
import { Music2, RefreshCw } from "lucide-react";
async function statusFetcher(url: string) {
  const response = await fetch(url, { cache: "no-store" }),
    body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "TikTok connection is unavailable.");
  return body as {
    configured: boolean;
    connected: boolean;
    displayName: string;
    expiresAt: number | null;
  };
}
export function TikTokSettings({
  online,
  writable,
  onSynced,
}: {
  online: boolean;
  writable: boolean;
  onSynced: () => Promise<unknown>;
}) {
  const { data, error } = useSWR(online ? "/api/tiktok" : null, statusFetcher, {
    shouldRetryOnError: false,
  });
  const [busy, setBusy] = useState<"connect" | "sync" | null>(null),
    [message, setMessage] = useState("");
  async function act(action: "connect" | "sync") {
    setBusy(action);
    setMessage("");
    try {
      const response = await fetch(
        action === "connect" ? "/api/tiktok" : "/api/tiktok/sync",
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || "TikTok action could not be completed.");
      if (action === "connect") {
        window.location.assign(body.url);
        return;
      }
      setMessage(
        `TikTok synced: ${body.added} added, ${body.updated} updated, ${body.unchanged} unchanged. ${body.manualUpdated ?? 0} manual observations refreshed; previous values kept in correction history. ${body.unmatched.length} links were unavailable or could not be matched. Use full TikTok video links for matching.`,
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
          : "TikTok action could not be completed.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <section className="panel tiktok-settings">
      <div className="panel-heading">
        <h2>
          <Music2 size={18} /> TikTok performance
        </h2>
        <span className="tiny-pill">
          {data?.connected ? "Connected" : "Not connected"}
        </span>
      </div>
      <p>
        {data?.connected
          ? `Connected to ${data.displayName}.`
          : "Connect your TikTok account to read statistics for its public videos."}
      </p>
      <p className="muted small">
        Sync runs only when you press Sync TikTok. It reads the TikTok video
        links saved in Published content. There is no automatic schedule.
      </p>
      {!data?.configured && !error && (
        <p className="form-note">
          TikTok setup is not complete yet. Configure the app credentials and
          Login Kit redirect URI on the server and in TikTok for Developers.
        </p>
      )}
      <div className="button-group">
        <button
          className="button outline"
          disabled={!online || !!busy}
          onClick={() => void act("connect")}
        >
          {busy === "connect"
            ? "Opening TikTok…"
            : data?.connected
              ? "Reconnect TikTok"
              : "Connect TikTok"}
        </button>
        <button
          className="button"
          disabled={!online || !writable || !data?.connected || !!busy}
          onClick={() => void act("sync")}
        >
          <RefreshCw size={15} className={busy === "sync" ? "spin" : ""} />
          {busy === "sync" ? "Reading TikTok…" : "Sync TikTok"}
        </button>
      </div>
      <p className="muted small">
        Views, likes, comments, and shares refresh on today&apos;s TikTok
        snapshot, including manual observations. Previous values stay in
        correction history. Duration, watch metrics, older dates, Instagram, and
        YouTube are unchanged. Tokens refresh securely on the server when
        needed.
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
