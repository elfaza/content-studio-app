import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  ideaFields,
  videoFields,
  snapshotFields,
  today,
} from "../src/lib/domain";
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
import {
  readDataset,
  save,
  saveInstagramObservations,
  saveTikTokObservations,
} from "../src/lib/repository";
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
  it("refreshes only Instagram average watch time with correction history while preserving completion, duration and TikTok", async () => {
    tabs["Performance Tracker"].rows = [
      makeRow(snapshotFields, {
        videoId: "VID-001",
        title: "Manual",
        platform: "Instagram",
        date: today(),
        views: "500",
        likes: "0",
        comments: "2",
        avgWatch: "10",
        watchedFull: "40",
      }),
      makeRow(snapshotFields, {
        videoId: "VID-001",
        platform: "TikTok",
        date: today(),
        avgWatch: "11",
        views: "300",
      }),
    ];
    const input = await instagramInput();
    expect(
      await saveInstagramObservations([
        { ...input, metrics: { ...input.metrics, avgWatch: "12.345" } },
      ]),
    ).toMatchObject({ updated: 1, manualUpdated: 1 });
    const requests = contentRequests();
    const allowed = (["avgWatch", "source"] as const).map((k) =>
      Object.values(snapshotFields).indexOf(k),
    );
    const snapshotWrites = requests.filter(
      (r: { updateCells?: { range?: { sheetId: number } } }) =>
        r.updateCells?.range?.sheetId === 3,
    );
    expect(
      snapshotWrites.some(
        (r: {
          updateCells: {
            rows: { values: { userEnteredValue: { stringValue: string } }[] }[];
          };
        }) =>
          r.updateCells.rows[0].values[0].userEnteredValue.stringValue ===
          "12.345",
      ),
    ).toBe(true);
    for (const r of snapshotWrites) {
      expect(r.updateCells.range.startRowIndex).toBe(1);
      expect(allowed).toContain(r.updateCells.range.startColumnIndex);
    }
    expect(JSON.stringify(requests)).toContain("correctionHistory");
    expect(JSON.stringify(requests)).toContain("10");
  });
  it("does not overwrite an average watch time formula during Instagram sync", async () => {
    tabs["Performance Tracker"].rows = [
      makeRow(snapshotFields, {
        videoId: "VID-001",
        platform: "Instagram",
        date: today(),
        avgWatch: "=6+6",
      }),
    ];
    const input = await instagramInput();
    await expect(
      saveInstagramObservations([
        { ...input, metrics: { ...input.metrics, avgWatch: "9" } },
      ]),
    ).rejects.toThrow("formula");
    expect(contentRequests()).toEqual([]);
  });
  it("refreshes only today's TikTok metrics with history and preserves Instagram, watch values and unavailable saves", async () => {
    tabs["Published Content"].rows[0] = makeRow(videoFields, {
      id: "VID-001",
      title: "Published story",
      igUrl: "https://instagram.com/reel/test/",
      tiktokUrl: "https://www.tiktok.com/@creator/video/1234567890123456789",
      tiktokDuration: "30",
    });
    tabs["Performance Tracker"].rows = [
      makeRow(snapshotFields, {
        videoId: "VID-001",
        title: "Manual",
        platform: "TikTok",
        date: today(),
        views: "100",
        likes: "7",
        saves: "22",
        avgWatch: "11",
        watchedFull: "40",
      }),
      makeRow(snapshotFields, {
        videoId: "VID-001",
        platform: "Instagram",
        date: today(),
        views: "1936",
      }),
      makeRow(snapshotFields, {
        videoId: "VID-001",
        platform: "TikTok",
        date: "2025-01-01",
        views: "90",
      }),
    ];
    const dataset = await readDataset(),
      video = dataset.videos[0],
      snapshot = dataset.snapshots[0];
    const input = {
      videoId: video.id,
      videoVersion: video.version,
      tiktokUrl: video.tiktokUrl,
      date: today(),
      fetchedAt: Date.now(),
      snapshotVersion: snapshot.version,
      metrics: {
        views: "500",
        likes: "0",
        shares: "3",
        saves: "999",
        avgWatch: "999",
      },
    };
    expect(await saveTikTokObservations([input])).toMatchObject({
      updated: 1,
      manualUpdated: 1,
      added: 0,
    });
    const requests = contentRequests();
    const allowed = (["views", "likes", "shares", "source"] as const).map((k) =>
      Object.values(snapshotFields).indexOf(k),
    );
    for (const r of requests.filter(
      (r: { updateCells?: { range?: { sheetId: number } } }) =>
        r.updateCells?.range?.sheetId === 3,
    )) {
      expect(r.updateCells.range.startRowIndex).toBe(1);
      expect(allowed).toContain(r.updateCells.range.startColumnIndex);
    }
    const encoded = JSON.stringify(requests);
    expect(encoded).toContain("correctionHistory");
    expect(encoded).toContain("tiktokFetchedAt");
    expect(encoded).not.toContain("instagramFetchedAt");
    expect(encoded).not.toContain("999");
    mock.batchUpdate.mockClear();
    input.snapshotVersion = "stale";
    await expect(saveTikTokObservations([input])).rejects.toThrow(
      "observation changed",
    );
    expect(contentRequests()).toEqual([]);
  });
  async function instagramInput() {
    const dataset = await readDataset();
    const video = dataset.videos[0];
    return {
      videoId: video.id,
      videoVersion: video.version,
      igUrl: video.igUrl,
      date: today(),
      fetchedAt: Date.now(),
      snapshotVersion:
        dataset.snapshots.find(
          (snapshot) =>
            snapshot.videoId === video.id &&
            snapshot.platform === "Instagram" &&
            snapshot.date === today(),
        )?.version ?? null,
      metrics: { views: "500", likes: "0", comments: "2" },
    };
  }
  it("syncs Instagram statistics and metadata atomically without changing posts or other platforms", async () => {
    const before = JSON.stringify(tabs);
    expect(await saveInstagramObservations([await instagramInput()])).toEqual({
      added: 1,
      updated: 0,
      unchanged: 0,
      manualUpdated: 0,
    });
    const requests = contentRequests();
    expect(JSON.stringify(requests)).toContain("automaticProvider");
    expect(JSON.stringify(requests)).toContain("instagram");
    expect(JSON.stringify(requests)).toContain("500");
    expect(
      requests.filter((r: { updateCells?: { range?: { sheetId: number } } }) =>
        [1, 2].includes(r.updateCells?.range?.sheetId ?? -1),
      ),
    ).toEqual([]);
    expect(requests.some((r: { deleteSheet?: unknown }) => r.deleteSheet)).toBe(
      true,
    );
    expect(mock.batchUpdate).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(tabs)).toBe(before);
  });
  it("refreshes today's manual Instagram metrics with history while preserving watch metrics, other dates and platforms", async () => {
    tabs["Performance Tracker"].rows = [
      makeRow(snapshotFields, {
        videoId: "VID-001",
        title: "Manual",
        platform: "Instagram",
        date: today(),
        views: "100",
        likes: "7",
        shares: "8",
        avgWatch: "12",
        notes: "Keep manual notes",
      }),
      makeRow(snapshotFields, {
        videoId: "VID-001",
        platform: "TikTok",
        date: today(),
        views: "3526",
      }),
      makeRow(snapshotFields, {
        videoId: "VID-001",
        platform: "Instagram",
        date: "2025-01-01",
        views: "90",
      }),
    ];
    const input = await instagramInput();
    const existing = (await readDataset()).snapshots[0];
    expect(await saveInstagramObservations([input])).toMatchObject({
      updated: 1,
      manualUpdated: 1,
      added: 0,
    });
    const requests = contentRequests();
    const changed = requests.filter(
      (r: { updateCells?: { range?: { sheetId: number } } }) =>
        r.updateCells?.range?.sheetId === 3,
    );
    expect(changed.length).toBeGreaterThan(0);
    const allowed = (["views", "likes", "comments", "source"] as const).map(
      (k) => Object.values(snapshotFields).indexOf(k),
    );
    for (const r of changed) {
      expect(r.updateCells.range.startRowIndex).toBe(1);
      expect(allowed).toContain(r.updateCells.range.startColumnIndex);
      expect(r.updateCells.fields).toBe("userEnteredValue");
    }
    const encoded = JSON.stringify(requests);
    expect(encoded).toContain("correctionHistory");
    expect(encoded).toContain(existing.id);
    expect(encoded).toContain("Keep manual notes");
    expect(encoded).toContain("automaticProvider");
  });
  it("updates only its own observation with correction history and rejects stale provider results", async () => {
    const raw = makeRow(snapshotFields, {
      videoId: "VID-001",
      title: "Published story",
      platform: "Instagram",
      date: today(),
      views: "100",
      source: "Instagram API",
    });
    while (raw.at(-1) === "") raw.pop();
    tabs["Performance Tracker"].rows = [raw];
    const fingerprint = createHash("sha256")
        .update(JSON.stringify(raw))
        .digest("hex"),
      anchor = createHash("sha256")
        .update(JSON.stringify(["VID-001", "Instagram", today()]))
        .digest("hex");
    tabs["CS_Metadata"] = {
      id: 4,
      headers: ["id", "entity", "fingerprint", "anchor", "extras"],
      rows: [
        [
          "auto",
          "snapshots",
          fingerprint,
          anchor,
          JSON.stringify({
            automaticProvider: "instagram",
            instagramFetchedAt: String(Date.now() - 10000),
          }),
        ],
      ],
    };
    const input = await instagramInput();
    expect((await saveInstagramObservations([input])).updated).toBe(1);
    const requests = JSON.stringify(contentRequests());
    expect(requests).toContain("correctionHistory");
    expect(requests).toContain("100");
    mock.batchUpdate.mockClear();
    tabs["CS_Metadata"].rows[0][4] = JSON.stringify({
      automaticProvider: "instagram",
      instagramFetchedAt: String(input.fetchedAt + 10000),
    });
    input.snapshotVersion = (await readDataset()).snapshots[0].version;
    expect((await saveInstagramObservations([input])).unchanged).toBe(1);
    expect(contentRequests()).toEqual([]);
  });
  it("does not save provider metrics if a linked video changed during sync", async () => {
    const input = await instagramInput();
    input.videoVersion = "stale";
    await expect(saveInstagramObservations([input])).rejects.toThrow(
      "post changed",
    );
    expect(contentRequests()).toEqual([]);
  });
  it("does not overwrite a manual observation added while Instagram was loading", async () => {
    const input = await instagramInput();
    tabs["Performance Tracker"].rows = [
      makeRow(snapshotFields, {
        videoId: "VID-001",
        title: "Manual",
        platform: "Instagram",
        date: today(),
        views: "999",
      }),
    ];
    await expect(saveInstagramObservations([input])).rejects.toThrow(
      "observation changed",
    );
    expect(contentRequests()).toEqual([]);
  });
  it("never retries an uncertain Instagram snapshot commit", async () => {
    const input = await instagramInput();
    mock.batchUpdate
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValue(Object.assign(Error("timeout"), { code: 503 }));
    await expect(saveInstagramObservations([input])).rejects.toThrow(
      "uncertain",
    );
    expect(mock.batchUpdate).toHaveBeenCalledTimes(2);
  });
  it("protects snapshot formulas and records the provenance of human corrections", async () => {
    const raw = makeRow(snapshotFields, {
      videoId: "VID-001",
      title: "Published story",
      platform: "Instagram",
      date: today(),
      views: "=400+77",
      source: "Instagram API",
    });
    while (raw.at(-1) === "") raw.pop();
    tabs["Performance Tracker"].rows = [raw];
    const fingerprint = createHash("sha256")
        .update(JSON.stringify(raw))
        .digest("hex"),
      anchor = createHash("sha256")
        .update(JSON.stringify(["VID-001", "Instagram", today()]))
        .digest("hex");
    tabs["CS_Metadata"] = {
      id: 4,
      headers: ["id", "entity", "fingerprint", "anchor", "extras"],
      rows: [
        [
          "auto",
          "snapshots",
          fingerprint,
          anchor,
          JSON.stringify({
            automaticProvider: "instagram",
            instagramFetchedAt: "1",
          }),
        ],
      ],
    };
    await expect(
      saveInstagramObservations([await instagramInput()]),
    ).rejects.toThrow("formula");
    expect(contentRequests()).toEqual([]);
    const snapshot = (await readDataset()).snapshots[0];
    const corrected = await save("snapshots", { ...snapshot, likes: "10" });
    expect(corrected.automaticProvider).toBe("manual");
  });
  function registeredSnapshot() {
    const row = makeRow(snapshotFields, {
      videoId: "VID-001",
      title: "Published story",
      platform: "Instagram",
      date: "2026-11-01",
      views: "100",
      likes: "5",
    });
    while (row.at(-1) === "") row.pop();
    tabs["Performance Tracker"].rows = [row];
    tabs["CS_Metadata"] = {
      id: 4,
      headers: ["id", "entity", "fingerprint", "anchor", "extras"],
      rows: [
        [
          "stable-snapshot",
          "snapshots",
          createHash("sha256").update(JSON.stringify(row)).digest("hex"),
          createHash("sha256")
            .update(JSON.stringify(["VID-001", "Instagram", "2026-11-01"]))
            .digest("hex"),
          "{}",
        ],
      ],
    };
    return row;
  }
  it("recovers only an exact platform-only external correction without writing on reads", async () => {
    const raw = registeredSnapshot();
    const old = (await readDataset()).snapshots[0];
    raw[Object.values(snapshotFields).indexOf("platform")] = "TikTok";
    const corrected = await readDataset();
    expect(corrected.writable).toBe(true);
    expect(corrected.warnings).toEqual([]);
    expect(corrected.snapshots[0]).toMatchObject({
      id: old.id,
      platform: "TikTok",
      views: "100",
    });
    expect(corrected.snapshots[0].version).not.toBe(old.version);
    expect(mock.batchUpdate).not.toHaveBeenCalled();
    await expect(save("snapshots", { ...old, views: "101" })).rejects.toThrow(
      "changed since",
    );
  });
  it("blocks recovery when more than the platform cell changed", async () => {
    const raw = registeredSnapshot();
    raw[Object.values(snapshotFields).indexOf("platform")] = "TikTok";
    raw[Object.values(snapshotFields).indexOf("views")] = "101";
    const d = await readDataset();
    expect(d.writable).toBe(false);
    expect(d.warnings.join()).toContain("Unresolved sidecar");
    expect(mock.batchUpdate).not.toHaveBeenCalled();
  });
  it("atomically corrects date/platform/metrics and updates the existing metadata identity with an audit copy", async () => {
    registeredSnapshot();
    const row = (await readDataset()).snapshots[0];
    await save("snapshots", {
      ...row,
      platform: "TikTok",
      date: "2026-11-02",
      views: "245",
    });
    const requests = contentRequests();
    const changes = requests.filter(
      (r: { updateCells?: { range: { sheetId: number } } }) =>
        r.updateCells?.range.sheetId === 3,
    );
    expect(changes).toHaveLength(3);
    expect(JSON.stringify(requests)).toContain("correctionHistory");
    expect(JSON.stringify(requests)).toContain(
      createHash("sha256")
        .update(JSON.stringify(["VID-001", "TikTok", "2026-11-02"]))
        .digest("hex"),
    );
    expect(requests.some((r: { deleteSheet?: unknown }) => r.deleteSheet)).toBe(
      true,
    );
    expect(mock.batchUpdate).toHaveBeenCalledTimes(2);
  });
  it("does not overwrite a snapshot formula during correction", async () => {
    registeredSnapshot()[Object.values(snapshotFields).indexOf("views")] =
      "=400+77";
    // Keep metadata aligned with the formula-bearing row.
    const row = tabs["Performance Tracker"].rows[0];
    tabs["CS_Metadata"].rows[0][2] = createHash("sha256")
      .update(JSON.stringify(row))
      .digest("hex");
    const snapshot = (await readDataset()).snapshots[0];
    await expect(
      save("snapshots", { ...snapshot, views: "200" }),
    ).rejects.toThrow("formula");
    expect(contentRequests()).toEqual([]);
  });
  it("stores platform durations in metadata without rewriting the original duration, formulas, or snapshots", async () => {
    const column = Object.values(videoFields).indexOf("duration");
    tabs["Published Content"].rows[0][column] = "=400+77";
    const video = (await readDataset()).videos[0];
    expect(video.duration).toBe("477");
    await save("videos", { ...video, igDuration: "45", tiktokDuration: "70" });
    const requests = contentRequests();
    expect(
      requests.filter((r: { updateCells?: { range: { sheetId: number } } }) =>
        [2, 3].includes(r.updateCells?.range.sheetId ?? -1),
      ),
    ).toHaveLength(0);
    const serialized = JSON.stringify(requests);
    expect(serialized).toContain("igDuration");
    expect(serialized).toContain("tiktokDuration");
    expect(serialized).toContain("45");
    expect(tabs["Published Content"].rows[0][column]).toBe("=400+77");
    expect(mock.batchUpdate).toHaveBeenCalledTimes(2);
  });
  it("cancels the idea and linked schedules in one atomic batch with reason in sidecar metadata", async () => {
    const idea = (await readDataset()).ideas[0];
    tabs["CS_Schedule"] = {
      id: 4,
      headers: [
        "id",
        "contentId",
        "title",
        "date",
        "time",
        "platform",
        "status",
        "notes",
      ],
      rows: [
        [
          "plan",
          idea.id,
          idea.title,
          "2026-11-10",
          "19:00",
          "Instagram",
          "Scheduled",
          "Keep schedule notes",
        ],
      ],
    };
    await save("ideas", {
      ...idea,
      status: "Cancelled",
      cancellationReason: "Topic no longer relevant",
    });
    const requests = contentRequests();
    const originalUpdates = requests.filter(
      (r: { updateCells?: { range: { sheetId: number } } }) =>
        r.updateCells?.range.sheetId === 1,
    );
    expect(originalUpdates).toHaveLength(1);
    expect(originalUpdates[0].updateCells.range.startColumnIndex).toBe(17);
    const planUpdates = requests.filter(
      (r: { updateCells?: { range: { sheetId: number } } }) =>
        r.updateCells?.range.sheetId === 4,
    );
    expect(planUpdates).toHaveLength(1);
    expect(planUpdates[0].updateCells.range.startColumnIndex).toBe(6);
    expect(
      planUpdates[0].updateCells.rows[0].values[0].userEnteredValue.stringValue,
    ).toBe("Cancelled");
    expect(JSON.stringify(requests)).toContain("Topic no longer relevant");
    expect(requests.at(-1)).toHaveProperty("deleteSheet");
    expect(mock.batchUpdate).toHaveBeenCalledTimes(2);
  });
  it("does not commit cancellation if a linked schedule status is a formula", async () => {
    const idea = (await readDataset()).ideas[0];
    tabs["CS_Schedule"] = {
      id: 4,
      headers: [
        "id",
        "contentId",
        "title",
        "date",
        "time",
        "platform",
        "status",
        "notes",
      ],
      rows: [
        [
          "plan",
          idea.id,
          idea.title,
          "2026-11-10",
          "19:00",
          "Instagram",
          '="Scheduled"',
          "Keep notes",
        ],
      ],
    };
    const normal = mock.valuesGet.getMockImplementation()!;
    mock.valuesGet.mockImplementation(async (args) => {
      const result = await normal(args);
      if (args.valueRenderOption === "UNFORMATTED_VALUE")
        result.data.values = result.data.values.map((r: unknown[]) =>
          r.map((v) => (v === '="Scheduled"' ? "Scheduled" : v)),
        );
      return result;
    });
    await expect(
      save("ideas", {
        ...idea,
        status: "Cancelled",
        cancellationReason: "Stop",
      }),
    ).rejects.toThrow("formula");
    expect(contentRequests()).toEqual([]);
  });

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
