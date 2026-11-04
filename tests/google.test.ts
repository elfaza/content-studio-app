import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { ideaFields, videoFields, snapshotFields } from "../src/lib/domain";
const mock = vi.hoisted(() => ({
  get: vi.fn(),
  valuesGet: vi.fn(),
  batchUpdate: vi.fn(),
}));
vi.mock("googleapis", () => ({
  google: {
    auth: { JWT: class {} },
    sheets: () => ({
      spreadsheets: {
        get: mock.get,
        values: { get: mock.valuesGet },
        batchUpdate: mock.batchUpdate,
      },
    }),
  },
}));
vi.mock("../src/lib/google-oauth", () => ({
  oauthMode: () => true,
  connectedGoogleClient: async () => ({}),
}));
import { readDataset, save } from "../src/lib/repository";
type Tab = { id: number; headers: string[]; rows: unknown[][] };
let tabs: Record<string, Tab>;
function contentRequests() {
  return (
    mock.batchUpdate.mock.calls
      .map((c) => c[0].requestBody.requests)
      .find((requests) =>
        requests.some(
          (r: { updateCells?: unknown; appendCells?: unknown }) =>
            r.updateCells || r.appendCells,
        ),
      ) ?? []
  );
}
function makeRow(
  mapping: Record<string, string>,
  data: Record<string, string>,
) {
  return Object.values(mapping).map((k) => data[k] ?? "");
}
beforeEach(() => {
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL", "test@example.com");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY", "fake-test-key");
  vi.stubEnv("GOOGLE_SHEETS_SPREADSHEET_ID", "fake-test-id");
  vi.stubEnv("GOOGLE_SHEETS_WRITES_ENABLED", "true");
  mock.get.mockReset();
  mock.valuesGet.mockReset();
  mock.batchUpdate.mockReset();
  tabs = {
    "Content Ideas": {
      id: 1,
      headers: [...Object.keys(ideaFields), "Custom column"],
      rows: [
        [
          ...makeRow(ideaFields, {
            date: "2026-10-01",
            title: "Existing story",
            category: "Running",
            status: "Idea",
          }),
          "keep this",
        ],
      ],
    },
    "Published Content": {
      id: 2,
      headers: Object.keys(videoFields),
      rows: [
        makeRow(videoFields, {
          id: "VID-001",
          title: "Published story",
          category: "Running",
          igUrl: "https://instagram.com/reel/test/",
          igViews: "477",
        }),
      ],
    },
    "Performance Tracker": {
      id: 3,
      headers: Object.keys(snapshotFields),
      rows: [],
    },
  };
  mock.get.mockImplementation(async () => ({
    data: {
      sheets: Object.entries(tabs).map(([title, t]) => ({
        properties: {
          title,
          sheetId: t.id,
          gridProperties: { rowCount: 100, columnCount: t.headers.length },
        },
      })),
    },
  }));
  mock.valuesGet.mockImplementation(
    async ({
      range,
      valueRenderOption,
    }: {
      range: string;
      valueRenderOption: string;
    }) => {
      const name = range.match(/^'(.+)'!/)![1],
        t = tabs[name];
      return {
        data: {
          values: [
            t.headers,
            ...t.rows.map((row) =>
              row.map((v) =>
                valueRenderOption === "UNFORMATTED_VALUE" && v === "=400+77"
                  ? 477
                  : v,
              ),
            ),
          ],
        },
      };
    },
  );
  mock.batchUpdate.mockResolvedValue({ data: {} });
});
afterEach(() => vi.unstubAllEnvs());
describe("Official Google adapter preservation", () => {
  it("retains registered idea IDs across row movement and external status changes", async () => {
    const anchor = createHash("sha256")
      .update(JSON.stringify(["2026-10-01", "Existing story"]))
      .digest("hex");
    tabs["CS_Metadata"] = {
      id: 4,
      headers: ["id", "entity", "fingerprint", "anchor", "extras"],
      rows: [["stable-idea", "ideas", "", anchor, "{}"]],
    };
    const first = (await readDataset()).ideas[0];
    expect(first.id).toBe("stable-idea");
    tabs["Content Ideas"].rows.unshift([
      ...makeRow(ideaFields, {
        date: "2026-10-02",
        title: "Another story",
        status: "Idea",
      }),
      "custom",
    ]);
    tabs["Content Ideas"].rows[1][17] = "Filming";
    const moved = (await readDataset()).ideas.find(
      (i) => i.title === "Existing story",
    )!;
    expect(moved.id).toBe(first.id);
    expect(moved.status).toBe("Filming");
    expect(moved.version).not.toBe(first.version);
  });
  it("detects concurrent changes stored only in sidecar metadata", async () => {
    const anchor = createHash("sha256")
      .update(JSON.stringify(["2026-10-01", "Existing story"]))
      .digest("hex");
    tabs["CS_Metadata"] = {
      id: 4,
      headers: ["id", "entity", "fingerprint", "anchor", "extras"],
      rows: [["stable-idea", "ideas", "", anchor, "{}"]],
    };
    const first = (await readDataset()).ideas[0];
    tabs["CS_Metadata"].rows[0][4] = '{"deadline":"2026-11-01"}';
    await expect(
      save("ideas", { ...first, deadline: "2026-11-02" }),
    ).rejects.toThrow("changed since");
    expect(contentRequests()).toEqual([]);
  });
  it("reads existing IDs and validates live headers without writing", async () => {
    const d = await readDataset();
    expect(d.mode).toBe("live");
    expect(d.videos[0].id).toBe("VID-001");
    expect(d.ideas[0].title).toBe("Existing story");
    expect(contentRequests()).toEqual([]);
  });
  it("updates only a changed cell and sidecar metadata, preserving unknown values and formatting", async () => {
    const d = await readDataset();
    await save("ideas", { ...d.ideas[0], title: "Renamed story" });
    const requests = contentRequests();
    const updates = requests.filter(
      (r: { updateCells?: { range: { sheetId: number } } }) =>
        r.updateCells?.range.sheetId === 1,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].updateCells.range.startColumnIndex).toBe(3);
    expect(updates[0].updateCells.fields).toBe("userEnteredValue");
    expect(
      requests.some(
        (r: { deleteSheet?: unknown; updateSpreadsheetProperties?: unknown }) =>
          r.updateSpreadsheetProperties,
      ),
    ).toBe(false);
  });
  it("does not clear latest view columns when editing a video", async () => {
    const d = await readDataset();
    await save("videos", { ...d.videos[0], title: "Updated publication" });
    const requests = contentRequests();
    const updates = requests.filter(
      (r: { updateCells?: { range: { sheetId: number } } }) =>
        r.updateCells?.range.sheetId === 2,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].updateCells.range.startColumnIndex).toBe(1);
  });
  it("reads computed metrics and leaves unchanged formulas alone", async () => {
    tabs["Published Content"].rows[0][13] = "=400+77";
    const d = await readDataset();
    expect(d.videos[0].igViews).toBe("477");
    await save("videos", { ...d.videos[0], notes: "Keep the formula" });
    const updates = contentRequests().filter(
      (r: { updateCells?: { range: { sheetId: number } } }) =>
        r.updateCells?.range.sheetId === 2,
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].updateCells.range.startColumnIndex).toBe(15);
  });
  it("blocks explicit replacement of a formula", async () => {
    tabs["Content Ideas"].rows[0][3] = "=400+77";
    const d = await readDataset();
    await expect(
      save("ideas", { ...d.ideas[0], title: "Overwrite" }),
    ).rejects.toThrow("formula");
    expect(contentRequests()).toEqual([]);
  });
  it("detects newer external edits before writing", async () => {
    const d = await readDataset();
    tabs["Published Content"].rows[0][15] = "External update";
    await expect(
      save("videos", { ...d.videos[0], notes: "App update" }),
    ).rejects.toThrow("changed since");
    expect(contentRequests()).toEqual([]);
  });
  it("never retries an uncertain write", async () => {
    const d = await readDataset();
    mock.batchUpdate
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValue(Object.assign(new Error("timeout"), { code: 503 }));
    await expect(
      save("videos", { ...d.videos[0], notes: "A note" }),
    ).rejects.toThrow("uncertain");
    expect(mock.batchUpdate).toHaveBeenCalledTimes(2);
  });
  it("recovers a transient read and still returns actual data", async () => {
    const normal = mock.get.getMockImplementation()!;
    mock.get
      .mockRejectedValueOnce(Object.assign(new Error("busy"), { code: 503 }))
      .mockImplementation(normal);
    const d = await readDataset();
    expect(d.videos[0].id).toBe("VID-001");
    expect(mock.get).toHaveBeenCalledTimes(2);
  });
  it("blocks writes on schema drift", async () => {
    tabs["Content Ideas"].headers[3] = "Renamed unexpected header";
    await expect(readDataset()).rejects.toThrow("Missing required columns");
    expect(contentRequests()).toEqual([]);
  });
});
