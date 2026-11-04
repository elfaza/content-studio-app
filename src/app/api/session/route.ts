import { NextRequest, NextResponse } from "next/server";
import {
  authorized,
  configured,
  passwordMatches,
  token,
  sameOrigin,
} from "@/lib/auth";
export const runtime = "nodejs";
const attempts = new Map<string, { count: number; reset: number }>();
export async function GET() {
  return NextResponse.json(
    { authorized: await authorized(), configured: configured() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (!configured())
    return NextResponse.json(
      {
        error:
          "Set APP_PASSWORD (16+ characters) and SESSION_SECRET (32+ characters) in .env.local, then restart the server.",
      },
      { status: 503 },
    );
  const key = "single-user";
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry || entry.reset < now) {
    entry = { count: 0, reset: now + 60000 };
    attempts.set(key, entry);
  }
  if (++entry.count > 10)
    return NextResponse.json(
      { error: "Too many attempts. Try again in one minute." },
      { status: 429 },
    );
  let password: unknown;
  try {
    ({ password } = await req.json());
  } catch {
    return NextResponse.json(
      { error: "Invalid sign-in request" },
      { status: 400 },
    );
  }
  if (typeof password !== "string" || !passwordMatches(password))
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("cs-session", token(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 86400,
  });
  return response;
}
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("cs-session");
  res.cookies.set("cs-google-state", "", { path: "/api/google", maxAge: 0 });
  return res;
}
