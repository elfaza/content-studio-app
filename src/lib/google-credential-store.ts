import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { get, put } from "@vercel/blob";
import { z } from "zod";
import { GoogleOAuthError } from "./google-errors";

function context() {
  const secret = process.env.SESSION_SECRET;
  const client = process.env.GOOGLE_CLIENT_ID;
  const value = process.env.APP_ORIGIN;
  if (!secret || secret.length < 32 || !client || !value)
    throw new GoogleOAuthError("Google connection security is not configured.");
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new GoogleOAuthError("Google return address is not configured.");
  }
  if (
    origin.protocol !== "https:" &&
    !(
      origin.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(origin.hostname)
    )
  )
    throw new GoogleOAuthError("Google return address must use HTTPS.");
  const scope = createHash("sha256")
    .update(JSON.stringify(["content-studio", client, origin.origin]))
    .digest();
  return { secret, scope };
}
type Purpose = "refresh-credential" | "oauth-attempt";
function encryption(purpose: Purpose) {
  const { secret, scope } = context();
  const aad = Buffer.from(
    `content-studio/google/${purpose}/v1/${scope.toString("hex")}`,
  );
  return { aad, key: Buffer.from(hkdfSync("sha256", secret, scope, aad, 32)) };
}
const envelope = z
  .object({
    v: z.literal(1),
    iv: z.string().max(30),
    tag: z.string().max(30),
    ciphertext: z.string().max(50000),
  })
  .strict();
export function encryptCredential(
  value: unknown,
  purpose: Purpose = "refresh-credential",
) {
  const { key, aad } = encryption(purpose),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    v: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  });
}
export function decryptCredential(
  value: string,
  purpose: Purpose = "refresh-credential",
): unknown {
  try {
    const e = envelope.parse(JSON.parse(value));
    const { key, aad } = encryption(purpose);
    const iv = Buffer.from(e.iv, "base64url"),
      tag = Buffer.from(e.tag, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(aad);
    cipher.setAuthTag(tag);
    return JSON.parse(
      Buffer.concat([
        cipher.update(Buffer.from(e.ciphertext, "base64url")),
        cipher.final(),
      ]).toString("utf8"),
    );
  } catch {
    throw new GoogleOAuthError(
      "Saved Google connection could not be verified. Reconnect Google.",
      503,
      true,
    );
  }
}
export function googleStoragePath(suffix: string) {
  return `content-studio/google/${context().scope.toString("hex")}/${suffix}`;
}
export const credentialPath = () => googleStoragePath("credential.v1.json");
function storage() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token)
    throw new GoogleOAuthError(
      "Google connection storage is unavailable. Please try again later.",
    );
  // A misconfigured deployment must never silently enable the SDK's retries.
  if (process.env.VERCEL_BLOB_RETRIES !== "0")
    throw new GoogleOAuthError(
      "Google connection storage requires retries to be disabled.",
    );
  return token;
}
export async function readPrivate(
  path: string,
): Promise<{ text: string; etag: string } | null> {
  const token = storage();
  try {
    const result = await get(path, {
      access: "private",
      token,
      useCache: false,
    });
    if (result === null) return null;
    if (result.statusCode !== 200 || result.blob.size > 50000)
      throw new Error();
    const text = await new Response(result.stream).text();
    if (text.length > 50000) throw new Error();
    return { text, etag: result.blob.etag };
  } catch {
    throw new GoogleOAuthError(
      "Google connection storage could not be read. Please try again later.",
    );
  }
}
export async function writePrivate(
  path: string,
  text: string,
  expectedEtag: string | null = null,
) {
  const token = storage();
  try {
    return await put(path, text, {
      access: "private",
      token,
      addRandomSuffix: false,
      allowOverwrite: expectedEtag !== null,
      ...(expectedEtag !== null ? { ifMatch: expectedEtag } : {}),
      contentType: "application/json",
      cacheControlMaxAge: 0,
    });
  } catch {
    // Includes conflicts and timeouts whose outcome is unknown. No retry or
    // deletion: a callback/state claim may already have committed.
    throw new GoogleOAuthError(
      "The connection write could not be confirmed or another connection changed. Return to Settings and reconnect. This write was not retried.",
      503,
      true,
    );
  }
}
const credential = z
  .object({
    refreshToken: z.string().min(1).max(16000),
    revision: z.string().uuid(),
    savedAt: z.number(),
  })
  .strict();
export async function readGoogleCredential() {
  const saved = await readPrivate(credentialPath());
  if (saved !== null) {
    try {
      return {
        ...credential.parse(decryptCredential(saved.text)),
        source: "stored" as const,
      };
    } catch {
      throw new GoogleOAuthError(
        "Saved Google connection could not be verified. Reconnect Google.",
        503,
        true,
      );
    }
  }
  const legacy = process.env.GOOGLE_REFRESH_TOKEN;
  return legacy
    ? {
        refreshToken: legacy,
        revision: createHash("sha256").update(legacy).digest("hex"),
        source: "legacy" as const,
      }
    : null;
}
export async function saveGoogleCredential(
  refreshToken: string,
  expectedEtag: string | null,
) {
  const payload = credential.parse({
    refreshToken,
    revision: randomUUID(),
    savedAt: Date.now(),
  });
  await writePrivate(
    credentialPath(),
    encryptCredential(payload),
    expectedEtag,
  );
}
