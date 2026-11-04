import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  openOAuthState,
  finishDirectGoogleAuthorization,
  credentialSuccessPage,
  oauthStateCookie,
} from "@/lib/google-oauth";
import { GoogleOAuthError } from "@/lib/google-errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The short-lived Lax state cookie authenticates this cross-site OAuth return.
// The app's Strict session cookie is intentionally not needed on this request.
export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const sealed = cookieStore.get(oauthStateCookie)?.value;
  const clear = (response: NextResponse) => {
    response.cookies.set(oauthStateCookie, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/google",
      maxAge: 0,
    });
    return response;
  };
  try {
    const state = await openOAuthState(
      sealed,
      req.nextUrl.searchParams.get("state"),
    );
    if (req.nextUrl.searchParams.has("error"))
      throw new GoogleOAuthError(
        "Google authorization was cancelled. Return to Settings to try again.",
        400,
      );
    await finishDirectGoogleAuthorization(
      req.nextUrl.searchParams.get("code") || "",
      state,
    );
    const page = credentialSuccessPage();
    return clear(
      new NextResponse(page.html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "private, no-store, max-age=0",
          Pragma: "no-cache",
          "Referrer-Policy": "no-referrer",
          "X-Frame-Options": "DENY",
          "Content-Security-Policy": `default-src 'none'; script-src 'none'; style-src 'nonce-${page.nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        },
      }),
    );
  } catch (e) {
    return clear(
      new NextResponse(
        e instanceof GoogleOAuthError
          ? e.message
          : "Google connection could not be completed. Return to Settings to try again.",
        {
          status: e instanceof GoogleOAuthError ? e.status : 503,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
          },
        },
      ),
    );
  }
}
