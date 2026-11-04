import { describe, it, expect } from "vitest";
import type { sheets_v4 } from "googleapis";
import { withSheetWriteLock } from "../src/lib/sheet-write-lock";

// Models Sheets' unique titles and all-or-nothing batch validation. Separate
// callers share only this API, as separate serverless instances would.
function sheet() {
  let owner: number | undefined;
  let writes = 0;
  let failCommit = false;
  const api = {
    spreadsheets: {
      batchUpdate: async (
        {
          requestBody: { requests },
        }: { requestBody: { requests: sheets_v4.Schema$Request[] } },
        options: { retry: boolean },
      ) => {
        expect(options.retry).toBe(false);
        if (requests[0].addSheet) {
          if (owner !== undefined) throw new Error("Duplicate title");
          owner = requests[0].addSheet.properties!.sheetId!;
        } else {
          const deletion = requests.find((r) => r.deleteSheet)?.deleteSheet;
          if (deletion?.sheetId !== owner) throw new Error("Missing lock");
          if (requests.some((r) => r.updateCells)) {
            if (failCommit) throw new Error("Unknown result");
            writes++;
          }
          owner = undefined;
        }
        return { data: {} };
      },
    },
  } as unknown as sheets_v4.Sheets;
  return {
    api,
    locked: () => owner !== undefined,
    writes: () => writes,
    fail: () => {
      failCommit = true;
    },
  };
}
const mutation: sheets_v4.Schema$Request[] = [
  { updateCells: { fields: "userEnteredValue" } },
];
describe("Shared sheet write coordination", () => {
  it("rejects another instance before it reads or writes, then permits the next save", async () => {
    const s = sheet();
    await withSheetWriteLock(s.api, "sheet", async (commit) => {
      await expect(
        withSheetWriteLock(s.api, "sheet", async () => {
          throw new Error("Must not enter");
        }),
      ).rejects.toThrow("Another save");
      await commit(mutation);
    });
    expect(s.locked()).toBe(false);
    await withSheetWriteLock(s.api, "sheet", (commit) => commit(mutation));
    expect(s.writes()).toBe(2);
  });
  it("releases after a stale editor or validation failure without changing content", async () => {
    const s = sheet();
    await expect(
      withSheetWriteLock(s.api, "sheet", async () => {
        throw new Error("stale editor");
      }),
    ).rejects.toThrow("stale editor");
    expect(s.locked()).toBe(false);
    expect(s.writes()).toBe(0);
  });
  it("retains the lock after an uncertain commit and blocks subsequent writers", async () => {
    const s = sheet();
    s.fail();
    await expect(
      withSheetWriteLock(s.api, "sheet", (commit) => commit(mutation)),
    ).rejects.toThrow("uncertain");
    expect(s.locked()).toBe(true);
    await expect(
      withSheetWriteLock(s.api, "sheet", async () => undefined),
    ).rejects.toThrow("Another save");
    expect(s.writes()).toBe(0);
  });
});
