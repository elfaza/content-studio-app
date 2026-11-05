import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  InstagramError,
  finishInstagram,
  instagramCookie,
  instagramState,
} from "@/lib/instagram-connection";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const browser = (await cookies()).get(instagramCookie)?.value;
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy":
      "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    "X-Frame-Options": "DENY",
  };
  const clear = (response: NextResponse) => {
    response.cookies.set(instagramCookie, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/instagram",
      maxAge: 0,
    });
    return response;
  };
  try {
    const attempt = await instagramState(
      browser,
      req.nextUrl.searchParams.get("state"),
    );
    if (req.nextUrl.searchParams.has("error"))
      throw new InstagramError(
        "Instagram authorization was cancelled. Return to Settings to try again.",
        400,
      );
    await finishInstagram(req.nextUrl.searchParams.get("code") || "", attempt);
    return clear(
      new NextResponse(
        '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instagram connected</title></head><body><main><h1>Instagram is connected.</h1><p>Your connection was saved securely. Statistics are fetched only when you choose Sync Instagram.</p><a href="/settings">Continue to app</a></main></body></html>',
        { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } },
      ),
    );
  } catch (error) {
    const message = (
      error instanceof InstagramError
        ? error.message
        : "Instagram connection could not be completed. Return to Settings and reconnect."
    ).replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character]!,
    );
    return clear(
      new NextResponse(
        `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Instagram connection incomplete</title></head><body><main><h1>Instagram connection is incomplete.</h1><p>${message}</p><p>Authorization does not change your spreadsheet or performance history.</p><a href="/settings">Return to Settings</a></main></body></html>`,
        {
          status: error instanceof InstagramError ? error.status : 503,
          headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
        },
      ),
    );
  }
}
