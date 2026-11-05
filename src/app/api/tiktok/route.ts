import { NextRequest, NextResponse } from "next/server";
import { authorized, sameOrigin } from "@/lib/auth";
import {
  TikTokError,
  beginTikTok,
  tiktokConfigured,
  tiktokCookie,
  readTikTokCredential,
} from "@/lib/tiktok-connection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof TikTokError
          ? error.message
          : "TikTok connection could not be completed. Try again later.",
      reconnect: error instanceof TikTokError && error.reconnect,
    },
    {
      status: error instanceof TikTokError ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export async function GET() {
  if (!(await authorized()))
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  try {
    const configured = tiktokConfigured(),
      saved = configured ? await readTikTokCredential() : null;
    const connected =
      !!saved && saved.credential.refreshExpiresAt > Date.now() + 60000;
    return NextResponse.json(
      {
        configured,
        connected,
        displayName: saved?.credential.displayName || "",
        expiresAt: saved?.credential.refreshExpiresAt ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: NextRequest) {
  if (!(await authorized()))
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  if (!sameOrigin(req))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  try {
    const flow = await beginTikTok();
    const response = NextResponse.json(
      { url: flow.url },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(tiktokCookie, flow.cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/tiktok",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return failure(error);
  }
}
