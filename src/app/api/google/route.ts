import { NextRequest, NextResponse } from "next/server";
import { authorized, sameOrigin } from "@/lib/auth";
import { GoogleOAuthError } from "@/lib/google-errors";
import {
  oauthMode,
  oauthConfigured,
  oauthReady,
  beginDirectGoogleAuthorization,
  oauthStateCookie,
} from "@/lib/google-oauth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof GoogleOAuthError
          ? error.message
          : "Google connection is unavailable.",
      reconnect: error instanceof GoogleOAuthError && error.reconnect,
    },
    {
      status: error instanceof GoogleOAuthError ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export async function GET() {
  if (!(await authorized()))
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  try {
    return NextResponse.json(
      {
        configured: oauthMode() && oauthConfigured(),
        mode: "oauth",
        connected: oauthMode() ? await oauthReady() : false,
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
    if (!oauthMode())
      throw new GoogleOAuthError(
        "Direct Google OAuth is not configured for this app.",
      );
    const flow = await beginDirectGoogleAuthorization();
    const response = NextResponse.json(
      { url: flow.url },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(oauthStateCookie, flow.cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/google",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return failure(error);
  }
}
