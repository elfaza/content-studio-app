import "server-only";
import { withSheetWriteLock } from "./sheet-write-lock";
import { google, sheets_v4 } from "googleapis";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";
import {
  Dataset,
  Entity,
  RecordData,
  ideaFields,
  videoFields,
  snapshotFields,
  mapRow,
  validateHeaders,
  validate,
  stage,
} from "./domain";
import { demoData } from "./demo";
import { z } from "zod";
import { oauthMode, connectedGoogleClient } from "./google-oauth";
export const hostedDemo = () => process.env.DEMO_STORAGE === "browser";
const demoRecord = z
  .record(z.string(), z.string())
  .and(z.object({ id: z.string(), version: z.string() }));
const browserDataset = z.object({
  ideas: z.array(demoRecord).max(1000),
  videos: z.array(demoRecord).max(1000),
  snapshots: z.array(demoRecord).max(2000),
  schedule: z.array(demoRecord).max(1000),
  settings: z.array(demoRecord).max(10),
  mode: z.literal("demo"),
  persistence: z.literal("browser"),
  syncedAt: z.string(),
  writable: z.literal(true),
  warnings: z.array(z.string()),
});
const mappings = {
  ideas: ideaFields,
  videos: videoFields,
  snapshots: snapshotFields,
};
const names = {
  ideas: "Content Ideas",
  videos: "Published Content",
  snapshots: "Performance Tracker",
  schedule: "CS_Schedule",
  settings: "CS_Settings",
};
const extraHeaders = {
  schedule: [
    "id",
    "contentId",
    "title",
    "date",
    "time",
    "platform",
    "status",
    "notes",
  ],
  settings: ["id", "creator", "platform", "categories", "theme", "timezone"],
};
const metadataHeaders = ["id", "entity", "fingerprint", "anchor", "extras"];
const rowHash = (row: unknown[]) => {
  const v = row.map((x) => (x == null ? "" : String(x)));
  while (v.at(-1) === "") v.pop();
  return hash(v);
};
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
// Explicit live mode must fail closed when storage or authorization fails.
export const live = () => oauthMode();
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}
type Grid = {
  headers: string[];
  rows: unknown[][];
  formulas?: unknown[][];
  sheetId: number;
};
type Inspection = {
  api: sheets_v4.Sheets;
  spreadsheetId: string;
  grids: Partial<Record<Entity, Grid>>;
  meta: Grid | null;
  dataset: Dataset;
  indices: Map<string, number>;
  raw: Map<string, unknown[]>;
};
async function retry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (attempt >= 3 || ![429, 500, 502, 503, 504].includes(Number(code)))
        throw e;
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
    }
  }
}
async function client() {
  return google.sheets({ version: "v4", auth: await connectedGoogleClient() });
}

const anchor = (entity: Entity, row: Record<string, string>) =>
  entity === "ideas"
    ? hash([row.date, row.title])
    : entity === "snapshots"
      ? hash([row.videoId, row.platform, row.date])
      : row.id;
async function inspect(): Promise<Inspection> {
  const api = await client(),
    spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new AppError("Spreadsheet ID is missing", 503);
  const metadata = await retry(() =>
    api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties" }),
  );
  const properties = metadata.data.sheets?.map((s) => s.properties!) ?? [];
  for (const name of Object.values(names).slice(0, 3))
    if (!properties.some((s) => s.title === name))
      throw new AppError("Missing worksheet: " + name, 409);
  const selected = properties.filter((p) =>
    [...Object.values(names), "CS_Metadata"].includes(p.title!),
  );
  const grids: Inspection["grids"] = {},
    indices = new Map<string, number>(),
    raw = new Map<string, unknown[]>();
  let meta: Grid | null = null;
  for (const p of selected) {
    const columnCount = p.gridProperties?.columnCount ?? 26,
      rowCount = p.gridProperties?.rowCount ?? 1000;
    if (columnCount > 100 || rowCount > 10000)
      throw new AppError(
        "Worksheet exceeds the safe MVP read limit (10,000 rows / 100 columns).",
        409,
      );
    const end = columnName(columnCount - 1);
    const result = await retry(() =>
      api.spreadsheets.values.get({
        spreadsheetId,
        range: `'${p.title}'!A1:${end}${rowCount}`,
        valueRenderOption: "FORMULA",
      }),
    );
    const rows = result.data.values ?? [];
    const effective = await retry(() =>
      api.spreadsheets.values.get({
        spreadsheetId,
        range: `'${p.title}'!A1:${end}${rowCount}`,
        valueRenderOption: "UNFORMATTED_VALUE",
      }),
    );
    const grid = {
      headers: (rows[0] ?? []).map(String),
      rows: (effective.data.values ?? []).slice(1),
      formulas: rows.slice(1),
      sheetId: p.sheetId!,
    };
    if (p.title === "CS_Metadata") meta = grid;
    else {
      const entity = (Object.keys(names) as Entity[]).find(
        (k) => names[k] === p.title,
      )!;
      grids[entity] = grid;
    }
  }
  if (meta)
    validateHeaders(
      meta.headers,
      Object.fromEntries(metadataHeaders.map((k) => [k, k])),
    );
  const metadataRows =
    meta?.rows.map((r) =>
      mapRow(
        meta!.headers,
        r,
        Object.fromEntries(metadataHeaders.map((k) => [k, k])),
      ),
    ) ?? [];
  const dataset: Dataset = {
    ideas: [],
    videos: [],
    snapshots: [],
    schedule: [],
    settings: [],
    mode: "live",
    syncedAt: new Date().toISOString(),
    writable: process.env.GOOGLE_SHEETS_WRITES_ENABLED === "true",
    warnings: [],
  };
  for (const entity of Object.keys(names) as Entity[]) {
    const grid = grids[entity];
    if (!grid) continue;
    const mapping =
      entity in mappings
        ? mappings[entity as keyof typeof mappings]
        : Object.fromEntries(
            extraHeaders[entity as keyof typeof extraHeaders].map((k) => [
              k,
              k,
            ]),
          );
    validateHeaders(grid.headers, mapping);
    grid.rows.forEach((values, i) => {
      if (!values.some((x) => x !== "" && x !== null)) return;
      const mapped = mapRow(grid.headers, values, mapping);
      for (const k of [
        "date",
        "igDate",
        "tiktokDate",
        "youtubeDate",
        "postedDate",
      ]) {
        if (mapped[k] && /^\d+(\.\d+)?$/.test(mapped[k]))
          mapped[k] = new Date(
            Date.UTC(1899, 11, 30) + Number(mapped[k]) * 86400000,
          )
            .toISOString()
            .slice(0, 10);
      }
      for (const k of ["igTime", "tiktokTime", "youtubeTime"])
        if (mapped[k] && Number(mapped[k]) >= 0 && Number(mapped[k]) < 1) {
          const minutes = Math.round(Number(mapped[k]) * 1440);
          mapped[k] =
            String(Math.floor(minutes / 60)).padStart(2, "0") +
            ":" +
            String(minutes % 60).padStart(2, "0");
        }
      const formulaRow = grid.formulas?.[i] ?? values,
        fp = rowHash(formulaRow),
        a = anchor(entity, mapped);
      const candidates = metadataRows.filter(
        (m) => m.entity === entity && (m.fingerprint === fp || m.anchor === a),
      );
      if (candidates.length > 1)
        throw new AppError(
          "Ambiguous identifier mapping. Resolve duplicated records before writing.",
          409,
        );
      const entry = candidates[0];
      let extras: Record<string, string> = {};
      if (entry) {
        try {
          extras = JSON.parse(entry.extras || "{}");
        } catch {
          throw new AppError("Invalid sidecar metadata", 409);
        }
      }
      const id = mapped.id || entry?.id || `${entity}-${fp.slice(0, 20)}`;
      if (indices.has(entity + id))
        throw new AppError(
          "Duplicate records or IDs detected; writes are blocked.",
          409,
        );
      const record = {
        ...mapped,
        ...extras,
        id,
        version: hash([fp, entry?.extras ?? ""]),
      };
      dataset[entity].push(record);
      indices.set(entity + id, i + 1);
      raw.set(entity + id, formulaRow);
    });
  }
  // Rows can move freely. Externally changing both date and title cannot be reconciled safely.
  const orphaned = metadataRows.filter(
    (m) => !dataset[m.entity as Entity]?.some((r) => r.id === m.id),
  );
  if (orphaned.length) {
    dataset.writable = false;
    dataset.warnings.push(
      "Unresolved sidecar IDs after external edits. Reconcile CS_Metadata before enabling writes.",
    );
  }
  return { api, spreadsheetId, grids, meta, dataset, indices, raw };
}
export function columnName(i: number): string {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26))
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}
const demoPath = () => process.env.DEMO_DATA_PATH || ".demo-data.json";
async function readDemo(): Promise<Dataset> {
  if (hostedDemo()) return { ...demoData(), persistence: "browser" };
  try {
    const d = JSON.parse(
      await readFile(/* turbopackIgnore: true */ demoPath(), "utf8"),
    ) as Dataset;
    return { ...d, mode: "demo", syncedAt: new Date().toISOString() };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return demoData();
  }
}
export async function readDataset() {
  return live() ? (await inspect()).dataset : readDemo();
}
export async function save(
  entity: Entity,
  input: unknown,
  demoState?: unknown,
) {
  const perform = async (
    commit?: (requests: sheets_v4.Schema$Request[]) => Promise<void>,
  ) => {
    const data = validate(entity, input);
    let inspection: Inspection | undefined;
    const dataset = live()
      ? (inspection = await inspect()).dataset
      : hostedDemo()
        ? browserDataset.parse(demoState)
        : await readDemo();
    if (!dataset.writable)
      throw new AppError(
        "Real-sheet writes are disabled. Review the migration instructions and enable writes in server configuration.",
        403,
      );
    const existing = data.id
      ? dataset[entity].find((r) => r.id === data.id)
      : undefined;
    if (data.id && !existing)
      throw new AppError(
        "Record changed or was removed externally. Refresh before editing.",
        409,
      );
    if (existing && data.version !== existing.version)
      throw new AppError(
        "This record changed since you opened it. Refresh and review the latest version.",
        409,
      );
    if (entity === "snapshots" && existing)
      throw new AppError("Historical snapshots are append-only.", 409);
    if (
      entity === "snapshots" &&
      dataset.snapshots.some(
        (s) =>
          s.videoId === data.videoId &&
          s.platform === data.platform &&
          s.date === data.date,
      )
    )
      throw new AppError(
        "A snapshot already exists for this video, platform, and date. Historical observations are not overwritten.",
        409,
      );
    if (
      entity === "snapshots" &&
      !dataset.videos.some((v) => v.id === data.videoId)
    )
      throw new AppError("Choose an existing published video.");
    if (
      entity === "schedule" &&
      ![...dataset.ideas, ...dataset.videos].some(
        (v) => v.id === data.contentId,
      )
    )
      throw new AppError("Choose an existing content item.");
    if (
      entity === "schedule" &&
      dataset.schedule.some(
        (s) =>
          s.id !== data.id &&
          s.contentId === data.contentId &&
          s.platform === data.platform &&
          s.status === "Scheduled" &&
          data.status === "Scheduled",
      )
    )
      throw new AppError(
        "This content already has a schedule for that platform. Edit its existing event.",
      );
    if (
      entity === "videos" &&
      data.ideaId &&
      !dataset.ideas.some((i) => i.id === data.ideaId)
    )
      throw new AppError("Choose an existing idea.");
    if (
      entity === "ideas" &&
      stage(data.status) === "Published" &&
      !dataset.videos.some((v) => v.ideaId === data.id)
    )
      throw new AppError(
        "Add a published video linked to this idea before marking it Published.",
      );
    const id =
      existing?.id || `${entity === "videos" ? "VID" : entity}-${randomUUID()}`;
    const record = {
      ...existing,
      ...data,
      id,
      version: hash(data),
    } as RecordData;
    if (entity === "videos") {
      for (const key of ["igUrl", "tiktokUrl", "youtubeUrl"]) {
        if (!record[key]) continue;
        const normalized = (url: string) => url.replace(/\/$/, "");
        if (
          dataset.videos.some(
            (v) =>
              v.id !== id &&
              v[key] &&
              normalized(v[key]) === normalized(record[key]),
          )
        )
          throw new AppError(
            "This post URL already belongs to another video. Edit that video instead of duplicating it.",
            409,
          );
      }
    }
    if (
      entity === "ideas" &&
      dataset.ideas.some(
        (i) => i.id !== id && anchor("ideas", i) === anchor("ideas", record),
      )
    )
      throw new AppError(
        "An idea with this title and discovery date already exists. Change the title or date to keep identifiers unambiguous.",
        409,
      );
    if (!inspection) {
      if (hostedDemo()) return record;
      dataset[entity] = existing
        ? dataset[entity].map((r) => (r.id === id ? record : r))
        : [...dataset[entity], record];
      const tmp = demoPath() + ".tmp";
      await writeFile(tmp, JSON.stringify(dataset), "utf8");
      await rename(tmp, demoPath());
      return record;
    }
    const requests: sheets_v4.Schema$Request[] = [];
    const allIds = [
      ...Object.values(inspection.grids).map((g) => g!.sheetId),
      inspection.meta?.sheetId ?? 0,
    ];
    let newId = Math.max(...allIds) + 1;
    function addSheet(title: string, headers: string[]) {
      const sheetId = newId++;
      requests.push(
        {
          addSheet: {
            properties: {
              sheetId,
              title,
              gridProperties: {
                rowCount: 1000,
                columnCount: Math.max(headers.length, 26),
                frozenRowCount: 1,
              },
            },
          },
        },
        {
          appendCells: {
            sheetId,
            rows: [
              {
                values: headers.map((stringValue) => ({
                  userEnteredValue: { stringValue },
                })),
              },
            ],
            fields: "userEnteredValue",
          },
        },
      );
      return { sheetId, headers, rows: [] };
    }
    const grid =
      inspection.grids[entity] ??
      addSheet(
        names[entity],
        extraHeaders[entity as keyof typeof extraHeaders],
      );
    const meta = inspection.meta ?? addSheet("CS_Metadata", metadataHeaders);
    for (const idea of dataset.ideas) {
      if (idea.id === id && entity === "ideas") continue;
      if (
        meta.rows.some(
          (r) => String(r[0]) === idea.id && String(r[1]) === "ideas",
        )
      )
        continue;
      const a = anchor("ideas", idea);
      if (
        dataset.ideas
          .map((i) => (entity === "ideas" && i.id === id ? record : i))
          .filter((i) => anchor("ideas", i) === a).length > 1
      )
        throw new AppError(
          "Ideas share the same title and date. Resolve this ambiguity before enabling writes.",
          409,
        );
      requests.push({
        appendCells: {
          sheetId: meta.sheetId,
          rows: [
            {
              values: [
                idea.id,
                "ideas",
                rowHash(inspection.raw.get("ideas" + idea.id) ?? []),
                a,
                "{}",
              ].map((stringValue) => ({ userEnteredValue: { stringValue } })),
            },
          ],
          fields: "userEnteredValue",
        },
      });
    }
    const mapping =
      entity in mappings
        ? mappings[entity as keyof typeof mappings]
        : Object.fromEntries(grid.headers.map((k) => [k, k]));
    const rowIndex = inspection.indices.get(entity + id);
    const original = inspection.raw.get(entity + id) || [];
    const nextValues = [...original];
    const cells: sheets_v4.Schema$CellData[] = grid.headers.map((h, i) => {
      const key = (mapping as Record<string, string>)[h];
      const value =
        key && (!existing || record[key] !== existing[key])
          ? (record[key] ?? "")
          : String(original[i] ?? "");
      nextValues[i] = value;
      return { userEnteredValue: { stringValue: value } };
    });
    if (rowIndex !== undefined) {
      for (let c = 0; c < grid.headers.length; c++) {
        if (!(mapping as Record<string, string>)[grid.headers[c]]) continue;
        if (String(original[c] ?? "") === String(nextValues[c] ?? "")) continue;
        if (String(original[c] ?? "").startsWith("="))
          throw new AppError(
            "This cell contains a formula. Edit it in Google Sheets; the app will not replace it.",
            409,
          );
        requests.push({
          updateCells: {
            range: {
              sheetId: grid.sheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: c,
              endColumnIndex: c + 1,
            },
            rows: [{ values: [cells[c]] }],
            fields: "userEnteredValue",
          },
        });
      }
    } else
      requests.push({
        appendCells: {
          sheetId: grid.sheetId,
          rows: [{ values: cells }],
          fields: "userEnteredValue",
        },
      });
    const mappedKeys = Object.values(mapping);
    const extras = Object.fromEntries(
      Object.entries(record).filter(
        ([k]) => !mappedKeys.includes(k) && !["id", "version"].includes(k),
      ),
    );
    const metaValues = [
      id,
      entity,
      rowHash(nextValues),
      anchor(entity, record),
      JSON.stringify(extras),
    ];
    const metaIndex = meta.rows.findIndex(
      (r) => String(r[0]) === id && String(r[1]) === entity,
    );
    const metaRow = {
      values: metaValues.map((stringValue) => ({
        userEnteredValue: { stringValue },
      })),
    };
    if (metaIndex < 0)
      requests.push({
        appendCells: {
          sheetId: meta.sheetId,
          rows: [metaRow],
          fields: "userEnteredValue",
        },
      });
    else
      requests.push({
        updateCells: {
          range: {
            sheetId: meta.sheetId,
            startRowIndex: metaIndex + 1,
            endRowIndex: metaIndex + 2,
            startColumnIndex: 0,
            endColumnIndex: 5,
          },
          rows: [metaRow],
          fields: "userEnteredValue",
        },
      });
    // Deliberately do not retry writes: a timeout can mean the atomic batch committed.
    if (!commit) throw new AppError("Save coordination is unavailable", 503);
    await commit(requests);
    return record;
  };
  return serialized(async () => {
    if (!live()) return perform();
    validate(entity, input);
    if (process.env.GOOGLE_SHEETS_WRITES_ENABLED !== "true")
      throw new AppError(
        "Real-sheet editing is disabled in server configuration.",
        403,
      );
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    if (!spreadsheetId) throw new AppError("Spreadsheet ID is missing", 503);
    return withSheetWriteLock(await client(), spreadsheetId, perform);
  });
}
