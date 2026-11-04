import { NextRequest, NextResponse } from "next/server";
import { authorized, sameOrigin } from "@/lib/auth";
import { AppError, readDataset, save } from "@/lib/repository";
import { Entity } from "@/lib/domain";
import { SheetWriteError } from "@/lib/sheet-write-lock";
import { ZodError } from "zod";
import { GoogleOAuthError } from "@/lib/google-errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function failure(e: unknown) {
  if (e instanceof GoogleOAuthError)
    return NextResponse.json(
      { error: e.message, reconnect: e.reconnect },
      { status: e.status },
    );
  if (e instanceof ZodError)
    return NextResponse.json(
      {
        error: e.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  if (e instanceof AppError || e instanceof SheetWriteError)
    return NextResponse.json({ error: e.message }, { status: e.status });
  return NextResponse.json(
    {
      error:
        "Unable to synchronize. Check server credentials and spreadsheet access, then retry. No write was automatically retried.",
    },
    { status: 503 },
  );
}
export async function GET() {
  if (!(await authorized()))
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  try {
    return NextResponse.json(await readDataset(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest) {
  if (!(await authorized()))
    return NextResponse.json({ error: "Sign in to continue" }, { status: 401 });
  if (!sameOrigin(req))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  if (Number(req.headers.get("content-length")) > 2000000)
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  try {
    const { entity, data, demoState } = await req.json();
    if (
      !["ideas", "videos", "snapshots", "schedule", "settings"].includes(entity)
    )
      throw new AppError("Unknown record type");
    return NextResponse.json(await save(entity as Entity, data, demoState), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return failure(e);
  }
}
