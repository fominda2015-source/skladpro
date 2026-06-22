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

type SheetLayout =
  | {
      kind: "EOM";
      indexCol: number;
      workCodeCol: number;
      nameCol: number;
      isrNoteCol: number;
      contractorCol: number;
      unitCol: number;
      totalQtyCol: number;
      fixedEndCol: number;
    }
  | {
      kind: "SS";
      sectionCol: number;
      indexCol: number;
      nameCol: number;
      noteCol: number;
      unitCol: number;
      totalQtyCol: number;
      fixedEndCol: number;
    };

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

const UNIT_RE =
  /^(шт\.?|комплект|комплекс|м\.?|м2|м³|м3|кг|т|л|уп|ед\.?|1000\s*м3|1000\s*м²|п\.?м\.?|тонн|руб\.?|чел\.?-ч|чел\/ч|ч\.?|сут\.?)$/i;

function cellVal(ws: xlsx.WorkSheet, r: number, c: number): unknown {
  return ws[xlsx.utils.encode_cell({ r, c })]?.v;
}

function cellText(ws: xlsx.WorkSheet, r: number, c: number): string {
  return norm(cellVal(ws, r, c));
}

function parseExcelDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return formatYmd(v);
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

function parseQty(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function isUnitValue(v: string): boolean {
  const s = norm(v);
  if (!s || s.length > 24) return false;
  if (/^(эом|сс)\d/i.test(s)) return false;
  if (/^[A-ZА-Я]{2,3}\d+(\.\d+)?$/i.test(s)) return false;
  if (UNIT_RE.test(s)) return true;
  if (/^\d+([.,]\d+)?$/.test(s)) return false;
  if (s.length <= 10 && !/[;:]/.test(s)) return true;
  return false;
}

function looksLikeWorkCode(v: string): boolean {
  return /^\d+(?:\.\d+){2,}/.test(v);
}

function looksLikeIndex(v: string): boolean {
  return /^\d+(?:\.\d+)*\.?$/.test(v);
}

function parseIndexName(raw: string): { indexLabel?: string; name?: string } {
  const s = norm(raw);
  if (!s) return {};
  const combined = s.match(/^(\d+(?:\.\d+)*\.?)\s+(.+)$/);
  if (combined) {
    return { indexLabel: combined[1], name: combined[2] };
  }
  if (looksLikeIndex(s)) return { indexLabel: s };
  return { name: s };
}

function groupLevelFromIndex(indexLabel?: string): number {
  if (!indexLabel?.trim()) return 0;
  const cleaned = indexLabel.trim().replace(/\.$/, "");
  const parts = cleaned.split(".").filter(Boolean);
  return Math.max(0, parts.length - 1);
}

function isSubHeaderRow(ws: xlsx.WorkSheet, r: number, layout: SheetLayout): boolean {
  const texts: string[] = [];
  for (let c = 0; c <= layout.fixedEndCol + 4; c += 1) {
    const t = cellText(ws, r, c);
    if (t) texts.push(t.toLowerCase());
  }
  const joined = texts.join(" ");
  if (!joined) return true;
  if (joined.includes("материалы/ оборудование") || joined.includes("смр, пнр")) return true;
  if (joined.includes("цена, руб") && !joined.includes("наименование")) return true;
  if (joined.includes("предельная стоимость")) return true;
  return false;
}

function detectLayout(ws: xlsx.WorkSheet, range: xlsx.Range): SheetLayout {
  for (let r = range.s.r; r <= Math.min(range.e.r, 15); r += 1) {
    let indexCol = -1;
    let workCodeCol = -1;
    let nameCol = -1;
    for (let c = range.s.c; c <= Math.min(range.e.c, 14); c += 1) {
      const t = cellText(ws, r, c).toLowerCase();
      if (/номер\s*п\/?п/.test(t)) indexCol = c;
      if (t.includes("код узла иср")) workCodeCol = c;
      if (t.includes("наименование затрат")) nameCol = c;
    }
    if (workCodeCol >= 0 && nameCol >= 0) {
      const base = workCodeCol;
      return {
        kind: "EOM",
        indexCol: indexCol >= 0 ? indexCol : base - 1,
        workCodeCol: base,
        nameCol,
        isrNoteCol: nameCol + 1,
        contractorCol: nameCol + 2,
        unitCol: nameCol + 3,
        totalQtyCol: nameCol + 6,
        fixedEndCol: nameCol + 7
      };
    }
    for (let c = range.s.c; c <= Math.min(range.e.c, 12); c += 1) {
      const t = cellText(ws, r, c).toLowerCase();
      if (/номер\s*п\/?п/.test(t) && cellText(ws, r, c + 1).toLowerCase().includes("наименование")) {
        return {
          kind: "SS",
          sectionCol: Math.max(0, c - 1),
          indexCol: c,
          nameCol: c + 1,
          noteCol: c + 2,
          unitCol: c + 3,
          totalQtyCol: c + 5,
          fixedEndCol: c + 6
        };
      }
    }
  }
  return {
    kind: "EOM",
    indexCol: 0,
    workCodeCol: 1,
    nameCol: 2,
    isrNoteCol: 3,
    contractorCol: 4,
    unitCol: 5,
    totalQtyCol: 8,
    fixedEndCol: 9
  };
}

function findHeaderRow(ws: xlsx.WorkSheet, range: xlsx.Range): number {
  for (let r = range.s.r; r <= Math.min(range.e.r, 15); r += 1) {
    for (let c = range.s.c; c <= Math.min(range.e.c, 12); c += 1) {
      const t = cellText(ws, r, c).toLowerCase();
      if (/номер\s*п\/?п/.test(t)) return r;
    }
  }
  return 1;
}

function collectDateColumns(
  ws: xlsx.WorkSheet,
  range: xlsx.Range,
  headerRow: number,
  fixedEndCol: number
): ProductivityDateColumn[] {
  const seen = new Map<number, ProductivityDateColumn>();
  for (let r = headerRow; r <= Math.min(range.e.r, headerRow + 1); r += 1) {
    for (let c = Math.max(range.s.c, fixedEndCol); c <= range.e.c; c += 1) {
      const iso = parseExcelDate(cellVal(ws, r, c));
      if (!iso) continue;
      if (!seen.has(c)) seen.set(c, { col: c, date: iso });
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.col - b.col);
}

function syntheticDateColumns(fixedColCount: number, through: Date = new Date()): ProductivityDateColumn[] {
  const start = new Date(through.getFullYear(), through.getMonth(), 1);
  return [{ col: fixedColCount, date: formatYmd(start) }];
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
  const base = columns.length ? columns : syntheticDateColumns(0, through);
  const out = [...base];
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

function isSkippableRow(name?: string, indexLabel?: string): boolean {
  const text = norm(name || indexLabel).toLowerCase();
  if (!text) return false;
  if (/итого/.test(text)) return true;
  if (text.includes("общая стоимость")) return true;
  return false;
}

function isQualificationFooter(name?: string, indexLabel?: string): boolean {
  const text = norm(name || indexLabel).toLowerCase();
  return text.includes("квалификационная и контактная");
}

function readSectionMarker(ws: xlsx.WorkSheet, r: number, layout: SheetLayout): number | null {
  if (layout.kind !== "SS") return null;
  const v = cellVal(ws, r, layout.sectionCol);
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  const n = Number(norm(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function findDataStartRow(
  ws: xlsx.WorkSheet,
  range: xlsx.Range,
  headerRow: number,
  layout: SheetLayout
): number {
  for (let r = headerRow + 1; r <= Math.min(headerRow + 12, range.e.r); r += 1) {
    if (isSubHeaderRow(ws, r, layout)) continue;
    const indexRaw = cellText(ws, r, layout.indexCol);
    const nameRaw = cellText(ws, r, layout.nameCol);
    const unitRaw = cellText(ws, r, layout.unitCol);
    const parsed = parseIndexName(indexRaw);
    const name = nameRaw || parsed.name || "";
    if (name || parsed.indexLabel || unitRaw) return r;
  }
  return headerRow + 1;
}

function readRowFields(ws: xlsx.WorkSheet, r: number, layout: SheetLayout) {
  const indexRaw = cellText(ws, r, layout.indexCol);
  const parsedIndex = parseIndexName(indexRaw);
  const nameCol = cellText(ws, r, layout.nameCol);
  const unitRaw = cellText(ws, r, layout.unitCol);
  const unit = isUnitValue(unitRaw) ? unitRaw : undefined;
  const totalQty = parseQty(cellVal(ws, r, layout.totalQtyCol));

  if (layout.kind === "EOM") {
    const workCodeRaw = cellText(ws, r, layout.workCodeCol);
    const workCode = looksLikeWorkCode(workCodeRaw) ? workCodeRaw : undefined;
    const indexLabel = parsedIndex.indexLabel || (looksLikeIndex(indexRaw) ? indexRaw : undefined);
    const contractorNote = cellText(ws, r, layout.contractorCol);
    let name = nameCol || parsedIndex.name || "";
    if (!name && contractorNote && contractorNote.length < 120) {
      name = contractorNote;
    }
    return { indexLabel, workCode, name, unit, totalQty };
  }

  const noteCol = cellText(ws, r, layout.noteCol);
  const indexLabel = parsedIndex.indexLabel || (looksLikeIndex(indexRaw) ? indexRaw : undefined);
  const name = nameCol || parsedIndex.name || (noteCol.length < 120 ? noteCol : "");
  return { indexLabel, workCode: undefined as string | undefined, name, unit, totalQty };
}

function ssGroupLevel(
  name: string,
  sectionMarker: number | null,
  lastSectionMarker: number | null,
  lastWasMaterial: boolean,
  materialContainerLevel: number,
  prevGroupLevel: number
): number {
  const n = name.toLowerCase().trim();
  if (
    sectionMarker != null &&
    lastSectionMarker != null &&
    sectionMarker !== lastSectionMarker &&
    !/^секция\s+\d/.test(n) &&
    !/^шкаф\b/.test(n) &&
    !/^комплект\b/.test(n)
  ) {
    return 1;
  }
  if (/^секция\s+\d/.test(n)) return 2;
  if (/^шкаф\b/.test(n) || /^комплект\s+ша/i.test(n)) return 3;
  if (/^(основное оборудование|шкафы)\b/.test(n)) return 2;
  if (/^(изделия|материалы|пуско-наладочные|кабели и провода)\b/.test(n)) {
    return Math.max(3, materialContainerLevel);
  }
  if (lastWasMaterial) return materialContainerLevel;
  if (prevGroupLevel < 0) return 0;
  if (prevGroupLevel === 0) return 1;
  if (prevGroupLevel === 1 && /автоматизированн/.test(n)) return 1;
  return Math.min(prevGroupLevel + 1, 4);
}

function isRowEmpty(fields: ReturnType<typeof readRowFields>): boolean {
  return !fields.name && !fields.indexLabel && !fields.workCode && !fields.unit;
}

export function parseProductivityBuffer(buffer: Buffer): ProductivitySheetMeta {
  const wb = xlsx.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("EMPTY_SHEET");
  const ws = wb.Sheets[sheetName];
  if (!ws || !ws["!ref"]) throw new Error("EMPTY_SHEET");

  const range = xlsx.utils.decode_range(ws["!ref"]);
  const layout = detectLayout(ws, range);
  const headerRow = findHeaderRow(ws, range);
  let dateColumns = collectDateColumns(ws, range, headerRow, layout.fixedEndCol);
  const fixedColCount = dateColumns.length
    ? dateColumns[0]!.col
    : layout.fixedEndCol;
  if (!dateColumns.length) {
    dateColumns = syntheticDateColumns(fixedColCount);
  }

  const dataStartRow = findDataStartRow(ws, range, headerRow, layout);
  const rows: ProductivityRowPreview[] = [];
  let prevGroupLevel = -1;
  let materialContainerLevel = 0;
  let lastWasMaterial = false;
  let lastSectionMarker: number | null = null;

  for (let r = dataStartRow; r <= range.e.r; r += 1) {
    if (isSubHeaderRow(ws, r, layout)) continue;

    const fields = readRowFields(ws, r, layout);
    if (isQualificationFooter(fields.name, fields.indexLabel)) break;
    if (isSkippableRow(fields.name, fields.indexLabel)) {
      lastWasMaterial = false;
      continue;
    }
    if (isRowEmpty(fields)) {
      lastWasMaterial = false;
      continue;
    }

    const sectionMarker = readSectionMarker(ws, r, layout);

    if (!fields.unit) {
      if (!fields.name && !fields.indexLabel && !fields.workCode) continue;

      let level: number;
      if (layout.kind === "EOM") {
        level = fields.indexLabel
          ? groupLevelFromIndex(fields.indexLabel)
          : lastWasMaterial
            ? materialContainerLevel
            : prevGroupLevel < 0
              ? 0
              : prevGroupLevel + 1;
      } else {
        level = ssGroupLevel(
          fields.name,
          sectionMarker,
          lastSectionMarker,
          lastWasMaterial,
          materialContainerLevel,
          prevGroupLevel
        );
      }

      const groupName =
        fields.name || fields.indexLabel || fields.workCode || `Раздел ${r + 1}`;
      const prevRow = rows[rows.length - 1];
      if (
        prevRow?.nodeType === "GROUP" &&
        prevRow.level === level &&
        prevRow.name === groupName
      ) {
        continue;
      }

      rows.push({
        rowIndex: r,
        indexLabel: fields.indexLabel,
        workCode: fields.workCode,
        name: groupName,
        unit: undefined,
        totalQty: fields.totalQty,
        editable: false,
        nodeType: "GROUP",
        level
      });
      prevGroupLevel = level;
      lastWasMaterial = false;
      if (sectionMarker != null) lastSectionMarker = sectionMarker;
      continue;
    }

    if (!fields.name && !fields.indexLabel) continue;

    if (!lastWasMaterial) {
      materialContainerLevel = Math.max(0, prevGroupLevel);
    }

    const materialLevel =
      layout.kind === "EOM"
        ? fields.indexLabel
          ? groupLevelFromIndex(fields.indexLabel)
          : materialContainerLevel + 1
        : materialContainerLevel + 1;

    rows.push({
      rowIndex: r,
      indexLabel: fields.indexLabel,
      workCode: fields.workCode,
      name: fields.name || fields.indexLabel || `Строка ${r + 1}`,
      unit: fields.unit,
      totalQty: fields.totalQty,
      editable: true,
      nodeType: "MATERIAL",
      level: materialLevel
    });
    lastWasMaterial = true;
    if (sectionMarker != null) lastSectionMarker = sectionMarker;
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
