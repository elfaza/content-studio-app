import { NextRequest, NextResponse } from "next/server";
import { authorized, sameOrigin } from "@/lib/auth";
import { collectTikTok } from "@/lib/tiktok-api";
import { TikTokError, readTikTokCredential } from "@/lib/tiktok-connection";
import {
  AppError,
  live,
  readDataset,
  saveTikTokObservations,
} from "@/lib/repository";
import { SheetWriteError } from "@/lib/sheet-write-lock";
import { GoogleOAuthError } from "@/lib/google-errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(req: NextRequest) {
  if (!(await authorized()))
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  if (!sameOrigin(req))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  try {
    if (!live())
      throw new TikTokError(
        "TikTok sync requires your real Google tracker. Demo content is not synced.",
        409,
      );
    const dataset = await readDataset();
    if (!dataset.writable)
      throw new TikTokError(
        "Resolve the Google tracker warning before syncing TikTok.",
        409,
      );
    const result = await collectTikTok(dataset.videos);
    const after = await readTikTokCredential();
    if (!after || after.credential.revision !== result.revision)
      throw new TikTokError(
        "TikTok connection changed during sync. Sync again using the new connection.",
        409,
      );
    const counts = result.observations.length
      ? await saveTikTokObservations(
          result.observations.map((item) => ({
            ...item,
            snapshotVersion:
              dataset.snapshots.find(
                (s) =>
                  s.videoId === item.videoId &&
                  s.platform === "TikTok" &&
                  s.date === item.date,
              )?.version ?? null,
          })),
        )
      : { added: 0, updated: 0, unchanged: 0, manualUpdated: 0 };
    return NextResponse.json(
      { ...counts, unmatched: result.unmatched },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const known =
      error instanceof TikTokError ||
      error instanceof AppError ||
      error instanceof SheetWriteError ||
      error instanceof GoogleOAuthError;
    return NextResponse.json(
      {
        error: known
          ? error.message
          : "TikTok sync could not be completed. Refresh to check the tracker before trying again. No write was automatically retried.",
        reconnect: error instanceof TikTokError && error.reconnect,
        googleReconnect: error instanceof GoogleOAuthError && error.reconnect,
      },
      {
        status: known ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
