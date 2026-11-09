import { z } from "zod";
import type { RecordData } from "./domain";

export class SyncTargetError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// Empty requests retain Settings' existing sync-all behavior.
export function syncTarget(
  body: string,
  videos: RecordData[],
  linkKey: string,
) {
  if (body.length > 1000) throw new SyncTargetError("Invalid sync request.");
  if (!body.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new SyncTargetError("Invalid sync request.");
  }
  const result = z
    .object({ videoId: z.string().trim().min(1).max(200) })
    .strict()
    .safeParse(parsed);
  if (!result.success)
    throw new SyncTargetError("Choose one published video to sync.");
  const video = videos.find((v) => v.id === result.data.videoId);
  if (!video)
    throw new SyncTargetError(
      "This published video no longer exists. Refresh the list.",
      404,
    );
  if (!video[linkKey])
    throw new SyncTargetError(
      "Add this platform's published post link before syncing.",
    );
  return video.id;
}
