import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  TikTokError,
  finishTikTok,
  tiktokCookie,
  tiktokState,
} from "@/lib/tiktok-connection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "X-Frame-Options": "DENY",
    "Content-Type": "text/html; charset=utf-8",
  };
  let message =
      "TikTok is connected. Your connection was saved securely. Choose Sync TikTok in Settings to read statistics.",
    status = 200;
  try {
    const attempt = await tiktokState(
      (await cookies()).get(tiktokCookie)?.value,
      req.nextUrl.searchParams.get("state"),
    );
    if (req.nextUrl.searchParams.has("error"))
      throw new TikTokError(
        "TikTok authorization was cancelled. Return to Settings to try again.",
        400,
      );
    await finishTikTok(req.nextUrl.searchParams.get("code") || "", attempt);
  } catch (error) {
    message =
      error instanceof TikTokError
        ? error.message
        : "TikTok connection could not be completed. Return to Settings and reconnect.";
    status = error instanceof TikTokError ? error.status : 503;
  }
  const safe = message.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
  const response = new NextResponse(
    `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>TikTok connection</title></head><body><main><h1>${status === 200 ? "TikTok connected" : "TikTok connection incomplete"}</h1><p>${safe}</p><a href="/settings">Continue to app</a></main></body></html>`,
    { status, headers },
  );
  response.cookies.set(tiktokCookie, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/tiktok",
    maxAge: 0,
  });
  return response;
}
