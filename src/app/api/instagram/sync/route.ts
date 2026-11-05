import { NextRequest, NextResponse } from "next/server";
import { authorized, sameOrigin } from "@/lib/auth";
import { collectInstagram } from "@/lib/instagram-graph";
import {
  InstagramError,
  readInstagramCredential,
} from "@/lib/instagram-connection";
import {
  AppError,
  live,
  readDataset,
  saveInstagramObservations,
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
      throw new InstagramError(
        "Instagram sync requires your real Google tracker. Demo content is not synced.",
        409,
      );
    const dataset = await readDataset();
    if (!dataset.writable)
      throw new InstagramError(
        "Resolve the Google tracker warning before syncing Instagram.",
        409,
      );
    const before = await readInstagramCredential();
    const result = await collectInstagram(dataset.videos);
    const after = await readInstagramCredential();
    if (!before || !after || before.revision !== after.revision)
      throw new InstagramError(
        "The Instagram connection changed during sync. Sync again using the new connection.",
        409,
      );
    const counts = result.observations.length
      ? await saveInstagramObservations(result.observations)
      : { added: 0, updated: 0, unchanged: 0, manualKept: 0 };
    return NextResponse.json(
      { ...counts, unmatched: result.unmatched, username: result.username },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const known =
      error instanceof InstagramError ||
      error instanceof AppError ||
      error instanceof SheetWriteError ||
      error instanceof GoogleOAuthError;
    return NextResponse.json(
      {
        error: known
          ? error.message
          : "Instagram sync could not be completed. Refresh to check the tracker before trying again. No write was automatically retried.",
        reconnect: error instanceof InstagramError && error.reconnect,
        googleReconnect: error instanceof GoogleOAuthError && error.reconnect,
      },
      {
        status: known ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
