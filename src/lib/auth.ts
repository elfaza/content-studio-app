import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
export function sameOrigin(request: Request) {
  try {
    const origin = new URL(request.headers.get("origin") || "");
    return (
      ["http:", "https:"].includes(origin.protocol) &&
      origin.host === request.headers.get("host")
    );
  } catch {
    return false;
  }
}
export function configured() {
  return !!(
    process.env.APP_PASSWORD &&
    process.env.APP_PASSWORD.length >= 16 &&
    process.env.SESSION_SECRET &&
    process.env.SESSION_SECRET.length >= 32
  );
}
export function passwordMatches(value: string) {
  const expected = process.env.APP_PASSWORD ?? "";
  const a = Buffer.from(value),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function token() {
  const expiry = String(Date.now() + 7 * 86400000);
  return (
    expiry +
    "." +
    createHmac("sha256", process.env.SESSION_SECRET!)
      .update(expiry)
      .digest("hex")
  );
}
export async function authorized() {
  if (!configured()) return false;
  const value = (await cookies()).get("cs-session")?.value ?? "";
  const [expiry, sig] = value.split(".");
  if (!expiry || Number(expiry) < Date.now() || !sig) return false;
  const expected = createHmac("sha256", process.env.SESSION_SECRET!)
    .update(expiry)
    .digest("hex");
  return (
    sig.length === expected.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  );
}
