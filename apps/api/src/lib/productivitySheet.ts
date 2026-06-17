import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import path from "node:path";
import xlsx from "xlsx";

export type ProductivityDateColumn = { col: number; date: string };

export type ProductivityRowPreview = {
  rowIndex: number;
  indexLabel?: string;
  workCode?: string;
  name: string;
  unit?: string;
  totalQty?: number | null;
  editable: boolean;
  nodeType: "GROUP" | "MATERIAL";
  level: number;
};

export type ProductivitySheetMeta = {
  headerRow: number;
  dataStartRow: number;
  fixedColCount: number;
  dateColumns: ProductivityDateColumn[];
  rows: ProductivityRowPreview[];
};

export type CellValuesMap = Record<string, string | number | null>;

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

function parseExcelDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = xlsx.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
  }
  const s = norm(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m2) return `${m2[3]}-${m2[2].padStart(2, "0")}-${m2[1].padStart(2, "0")}`;
  return null;
}

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function parseCellValues(raw: unknown): CellValuesMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CellValuesMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v == null || v === "") continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
      continue;
    }
    const s = norm(v);
    if (!s) continue;
    const n = Number(s.replace(",", "."));
    out[k] = Number.isFinite(n) ? n : s;
  }
  return out;
}

/** Продлевает календарные колонки до конца месяца `through` (минимум). */
export function extendDateColumnsThrough(
  columns: ProductivityDateColumn[],
  through: Date = new Date()
): ProductivityDateColumn[] {
  if (!columns.length) return columns;
  const out = [...columns];
  let last = out[out.length - 1]!;
  let lastDate = ymdToDate(last.date);
  const target = endOfMonth(through);
  while (lastDate < target) {
    lastDate = addDays(lastDate, 1);
    last = { col: last.col + 1, date: formatYmd(lastDate) };
    out.push(last);
  }
  return out;
}

function findHeaderRow(ws: xlsx.WorkSheet): number {
  const range = xlsx.utils.decode_range(ws["!ref"] || "A1");
  for (let r = range.s.r; r <= Math.min(range.e.r, 12); r += 1) {
    let dateHits = 0;
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cell = ws[xlsx.utils.encode_cell({ r, c })];
      if (parseExcelDate(cell?.v)) dateHits += 1;
    }
    if (dateHits >= 3) return r;
  }
  return 1;
}

function groupLevelFromIndex(indexLabel?: string): number {
  if (!indexLabel?.trim()) return 0;
  const parts = indexLabel.trim().split(".").filter(Boolean);
  return Math.max(0, parts.length - 1);
}

export function parseProductivityBuffer(buffer: Buffer): ProductivitySheetMeta {
  const wb = xlsx.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("EMPTY_SHEET");
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws["!ref"]) throw new Error("EMPTY_SHEET");

  const range = xlsx.utils.decode_range(ws["!ref"]);
  const headerRow = findHeaderRow(ws);
  const dateColumns: ProductivityDateColumn[] = [];

  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const cell = ws[xlsx.utils.encode_cell({ r: headerRow, c })];
    const iso = parseExcelDate(cell?.v);
    if (iso) dateColumns.push({ col: c, date: iso });
  }
  if (!dateColumns.length) throw new Error("NO_DATE_COLUMNS");

  const fixedColCount = dateColumns[0]!.col;
  let dataStartRow = headerRow + 1;
  for (let r = headerRow + 1; r <= Math.min(headerRow + 8, range.e.r); r += 1) {
    const a = norm(ws[xlsx.utils.encode_cell({ r, c: 0 })]?.v);
    const b = norm(ws[xlsx.utils.encode_cell({ r, c: 1 })]?.v);
    const c3 = norm(ws[xlsx.utils.encode_cell({ r, c: 2 })]?.v);
    if (a && /^\d/.test(a) && (b || c3)) {
      dataStartRow = r;
      break;
    }
  }

  const rows: ProductivityRowPreview[] = [];
  for (let r = dataStartRow; r <= range.e.r; r += 1) {
    const indexLabel = norm(ws[xlsx.utils.encode_cell({ r, c: 0 })]?.v) || undefined;
    const workCode = norm(ws[xlsx.utils.encode_cell({ r, c: 1 })]?.v) || undefined;
    const nameCol = norm(ws[xlsx.utils.encode_cell({ r, c: 2 })]?.v);
    const descCol = norm(ws[xlsx.utils.encode_cell({ r, c: 4 })]?.v);
    const unit = norm(ws[xlsx.utils.encode_cell({ r, c: 5 })]?.v) || undefined;
    const totalRaw = ws[xlsx.utils.encode_cell({ r, c: 6 })]?.v;
    const totalQty =
      totalRaw == null || totalRaw === ""
        ? null
        : Number(String(totalRaw).replace(",", ".")) || null;

    const name = nameCol || descCol;
    if (!name && !unit && !indexLabel && !workCode) continue;

    if (!unit) {
      if (!name && !indexLabel && !workCode) continue;
      rows.push({
        rowIndex: r,
        indexLabel,
        workCode,
        name: name || indexLabel || workCode || `Раздел ${r + 1}`,
        unit,
        totalQty,
        editable: false,
        nodeType: "GROUP",
        level: groupLevelFromIndex(indexLabel)
      });
      continue;
    }

    if (!name) continue;

    rows.push({
      rowIndex: r,
      indexLabel,
      workCode,
      name: name || descCol || indexLabel || `Строка ${r + 1}`,
      unit,
      totalQty,
      editable: true,
      nodeType: "MATERIAL",
      level: 0
    });
  }

  return {
    headerRow,
    dataStartRow,
    fixedColCount,
    dateColumns,
    rows
  };
}

export async function buildProductivityDownloadBuffer(opts: {
  storagePath: string;
  headerRow: number;
  dateColumns: ProductivityDateColumn[];
  cellValues: CellValuesMap;
}): Promise<Buffer> {
  const abs = path.resolve(process.cwd(), opts.storagePath);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(abs);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("EMPTY_SHEET");

  const headerExcelRow = opts.headerRow + 1;
  for (const dc of opts.dateColumns) {
    const cell = ws.getCell(headerExcelRow, dc.col + 1);
    cell.value = ymdToDate(dc.date);
    if (!cell.numFmt) cell.numFmt = "yyyy-mm-dd";
  }

  for (const [key, raw] of Object.entries(opts.cellValues)) {
    const [rs, cs] = key.split(":");
    const row = Number(rs);
    const col = Number(cs);
    if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
    const cell = ws.getCell(row + 1, col + 1);
    if (typeof raw === "number") {
      cell.value = raw;
    } else if (raw != null && raw !== "") {
      const n = Number(String(raw).replace(",", "."));
      cell.value = Number.isFinite(n) ? n : String(raw);
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function removeProductivityFile(storagePath: string): Promise<void> {
  try {
    await fs.unlink(path.resolve(process.cwd(), storagePath));
  } catch {
    // ignore missing file
  }
}
