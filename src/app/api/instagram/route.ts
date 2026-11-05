import { NextRequest, NextResponse } from "next/server";
import { authorized, sameOrigin } from "@/lib/auth";
import {
  InstagramError,
  beginInstagram,
  instagramConfigured,
  instagramCookie,
  readInstagramCredential,
} from "@/lib/instagram-connection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function instagramFailure(error: unknown) {
  return NextResponse.json(
    {
      error:
        error instanceof InstagramError
          ? error.message
          : "Instagram connection is unavailable. Try again later.",
      reconnect: error instanceof InstagramError && error.reconnect,
    },
    {
      status: error instanceof InstagramError ? error.status : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
export async function GET() {
  if (!(await authorized()))
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  try {
    const configured = instagramConfigured(),
      credential = configured ? await readInstagramCredential() : null;
    return NextResponse.json(
      {
        configured,
        connected: !!credential,
        username: credential?.username || "",
        expiresAt: credential?.expiresAt ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return instagramFailure(error);
  }
}
export async function POST(req: NextRequest) {
  if (!(await authorized()))
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  if (!sameOrigin(req))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  try {
    const flow = await beginInstagram();
    const response = NextResponse.json(
      { url: flow.url },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(instagramCookie, flow.cookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/instagram",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return instagramFailure(error);
  }
}
