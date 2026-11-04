import "server-only";
import { randomInt } from "node:crypto";
import type { sheets_v4 } from "googleapis";

export const writeLockTitle = "CS_Write_Lock";
export class SheetWriteError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}

// A unique sheet title is the shared mutex. Never expire or steal it: a paused
// function could resume after an expiring lease and overwrite a newer save.
export async function withSheetWriteLock<T>(
  api: sheets_v4.Sheets,
  spreadsheetId: string,
  work: (
    commit: (requests: sheets_v4.Schema$Request[]) => Promise<void>,
  ) => Promise<T>,
): Promise<T> {
  const sheetId = randomInt(1, 2147483647);
  const batch = (requests: sheets_v4.Schema$Request[]) =>
    api.spreadsheets.batchUpdate(
      { spreadsheetId, requestBody: { requests } },
      { retry: false },
    );
  try {
    await batch([
      {
        addSheet: {
          properties: {
            sheetId,
            title: writeLockTitle,
            hidden: true,
            gridProperties: { rowCount: 1, columnCount: 1 },
          },
        },
      },
    ]);
  } catch (e) {
    if (Number((e as { code?: unknown }).code) === 403)
      throw new SheetWriteError(
        "Google editing access is missing. Reconnect Google in Settings and approve editing.",
        403,
      );
    throw new SheetWriteError(
      "Another save is running or needs review. Refresh before trying again. If CS_Write_Lock remains, ask for recovery; do not delete it while a save may still be running.",
    );
  }
  let submitted = false;
  try {
    return await work(async (requests) => {
      if (submitted)
        throw new SheetWriteError("A save may only be submitted once.");
      submitted = true;
      try {
        // Commit and unlock together. An uncertain response cannot release a
        // lock ahead of a delayed write. Deleting this exact ID also fences
        // old requests if an operator has recovered an abandoned lock.
        await batch([...requests, { deleteSheet: { sheetId } }]);
      } catch {
        throw new SheetWriteError(
          "The save result is uncertain. Refresh to check whether it saved. Further edits may be blocked until the save lock is reviewed.",
          503,
        );
      }
    });
  } finally {
    // Validation/read failures have not sent a content write, so may unlock.
    // Once a write is submitted, only its atomic batch may release the lock.
    if (!submitted) await batch([{ deleteSheet: { sheetId } }]);
  }
}
