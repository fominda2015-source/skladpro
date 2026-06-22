import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listPeriodDays } from "./timesheetContext.js";

export type TimesheetEmployeeInput = {
  fullName: string;
  position?: string;
  hireDate?: string;
  marks: Record<string, string | number | null>;
};

export type TimesheetExportInput = {
  organization: string;
  department: string;
  objectName: string;
  sheetLabel?: string;
  periodFrom: string;
  periodTo: string;
  compileDate: string;
  responsibleTitle?: string;
  responsibleName?: string;
  employees: TimesheetEmployeeInput[];
};

const WEEKDAYS_RU = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;
const TEMPLATE_DATA_ROWS = 3;
const FIRST_DATA_ROW = 20;
const DAY_COL_START = 5;
const DAY_COL_COUNT = 31;

const YELLOW_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFC000" }
};

const NO_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "none"
};

function templatePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../assets/timesheet-template.xlsx"),
    path.resolve(process.cwd(), "assets/timesheet-template.xlsx")
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("TIMESHEET_TEMPLATE_MISSING");
}

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

function monthDayIso(monthYm: string, dayNum: number): string | null {
  const [y, m] = monthYm.split("-").map(Number);
  if (!y || !m || dayNum < 1 || dayNum > 31) return null;
  const d = new Date(y, m - 1, dayNum, 12, 0, 0, 0);
  if (d.getMonth() !== m - 1) return null;
  const mm = String(m).padStart(2, "0");
  const dd = String(dayNum).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function weekdayShort(iso: string): string {
  return WEEKDAYS_RU[ymdToDate(iso).getDay()] ?? "";
}

function normMark(v: string | number | null | undefined): string {
  if (v == null || v === "") return "";
  return String(v).trim();
}

function inPeriod(iso: string, from: string, to: string): boolean {
  return iso >= from && iso <= to;
}

type MarkStats = {
  hours: number;
  halfFirst: number;
  halfSecond: number;
  vacation: number;
  sick: number;
  unpaid: number;
  idle: number;
  absent: number;
};

function parseMarkStats(
  monthYm: string,
  periodFrom: string,
  periodTo: string,
  marks: Record<string, string | number | null>
): MarkStats {
  const stats: MarkStats = {
    hours: 0,
    halfFirst: 0,
    halfSecond: 0,
    vacation: 0,
    sick: 0,
    unpaid: 0,
    idle: 0,
    absent: 0
  };

  for (let day = 1; day <= DAY_COL_COUNT; day += 1) {
    const iso = monthDayIso(monthYm, day);
    if (!iso || !inPeriod(iso, periodFrom, periodTo)) continue;
    const raw = normMark(marks[iso]);
    if (!raw) continue;
    const upper = raw.toUpperCase();
    const isFirstHalf = day <= 15;

    if (upper === "ОТ") {
      stats.vacation += 1;
      continue;
    }
    if (upper === "Б") {
      stats.sick += 1;
      continue;
    }
    if (upper === "ДО") {
      stats.unpaid += 1;
      continue;
    }
    if (upper === "П") {
      stats.idle += 1;
      continue;
    }
    if (upper === "Н" || upper === "НЕВЫХОД" || raw.toLowerCase() === "н") {
      stats.absent += 1;
      continue;
    }

    const n = Number(raw.replace(",", "."));
    if (!Number.isFinite(n)) continue;
    stats.hours += n;
    if (isFirstHalf) stats.halfFirst += n;
    else stats.halfSecond += n;
  }

  return stats;
}

function normHoursForPeriod(periodFrom: string, periodTo: string): number {
  const days = listPeriodDays(periodFrom, periodTo).length;
  return Math.max(0, Math.round(days * (40 / 5)));
}

function safeSheetName(name: string): string {
  return String(name).replace(/[\\/:?*[\]]/g, " ").slice(0, 31) || "Табель";
}

function setCell(ws: ExcelJS.Worksheet, row: number, col: number, value: ExcelJS.CellValue) {
  ws.getCell(row, col).value = value;
}

function fillHeader(ws: ExcelJS.Worksheet, input: TimesheetExportInput) {
  setCell(ws, 5, 1, input.organization);
  setCell(ws, 7, 1, input.department);
  setCell(ws, 9, 1, input.objectName);
  setCell(ws, 5, 24, input.responsibleTitle || "");
  setCell(ws, 5, 38, input.responsibleName || "");

  const compileDate = ymdToDate(input.compileDate);
  const periodFrom = ymdToDate(input.periodFrom);
  const periodTo = ymdToDate(input.periodTo);

  setCell(ws, 12, 7, compileDate);
  ws.getCell(12, 7).numFmt = "yyyy-mm-dd";
  setCell(ws, 13, 7, compileDate);
  ws.getCell(13, 7).numFmt = "yyyy-mm-dd";

  setCell(ws, 12, 12, "с");
  setCell(ws, 12, 15, "по");
  setCell(ws, 13, 12, periodFrom);
  ws.getCell(13, 12).numFmt = "yyyy-mm-dd";
  setCell(ws, 13, 15, periodTo);
  ws.getCell(13, 15).numFmt = "yyyy-mm-dd";
}

function fillSummaryRow(
  ws: ExcelJS.Worksheet,
  input: TimesheetExportInput,
  totalHours: number
) {
  const count = input.employees.length;
  setCell(ws, 12, 24, count);
  setCell(ws, 13, 24, count);
  setCell(ws, 12, 28, 0);
  setCell(ws, 13, 28, 0);
  setCell(ws, 12, 36, 0);
  setCell(ws, 13, 36, 0);
  const norm = normHoursForPeriod(input.periodFrom, input.periodTo);
  setCell(ws, 12, 38, norm);
  setCell(ws, 13, 38, norm);
  const avg = count > 0 ? totalHours / count : 0;
  setCell(ws, 12, 40, avg);
  setCell(ws, 13, 40, avg);
  setCell(ws, 12, 42, count > 0 ? Math.round(avg) : 0);
  setCell(ws, 13, 42, count > 0 ? Math.round(avg) : 0);
}

function updateDayHeaderRows(ws: ExcelJS.Worksheet, monthYm: string) {
  for (let day = 1; day <= DAY_COL_COUNT; day += 1) {
    const col = DAY_COL_START + day - 1;
    const iso = monthDayIso(monthYm, day);
    const isWeekend = iso ? [0, 6].includes(ymdToDate(iso).getDay()) : false;
    const fill = isWeekend ? YELLOW_FILL : NO_FILL;

    for (const row of [16, 17, 18]) {
      const cell = ws.getCell(row, col);
      cell.value = iso ? day : "";
      cell.fill = fill;
    }

    const wdCell = ws.getCell(19, col);
    wdCell.value = iso ? weekdayShort(iso) : "";
    wdCell.fill = fill;
  }
}

function ensureEmployeeRows(ws: ExcelJS.Worksheet, count: number) {
  if (count <= TEMPLATE_DATA_ROWS) return;
  const extra = count - TEMPLATE_DATA_ROWS;
  const anchorRow = FIRST_DATA_ROW + TEMPLATE_DATA_ROWS - 1;
  ws.duplicateRow(anchorRow, extra, true);
}

function fillEmployeeRow(
  ws: ExcelJS.Worksheet,
  row: number,
  index: number,
  emp: TimesheetEmployeeInput,
  monthYm: string,
  periodFrom: string,
  periodTo: string
) {
  const stats = parseMarkStats(monthYm, periodFrom, periodTo, emp.marks);

  setCell(ws, row, 1, index);
  setCell(ws, row, 2, emp.fullName);
  setCell(ws, row, 3, emp.position || "");
  if (emp.hireDate) {
    setCell(ws, row, 4, ymdToDate(emp.hireDate));
    ws.getCell(row, 4).numFmt = "yyyy-mm-dd";
  }

  for (let day = 1; day <= DAY_COL_COUNT; day += 1) {
    const col = DAY_COL_START + day - 1;
    const iso = monthDayIso(monthYm, day);
    const cell = ws.getCell(row, col);
    if (!iso || !inPeriod(iso, periodFrom, periodTo)) {
      cell.value = null;
      continue;
    }
    const mark = normMark(emp.marks[iso]);
    if (!mark) {
      cell.value = null;
      continue;
    }
    const n = Number(mark.replace(",", "."));
    cell.value = Number.isFinite(n) ? n : mark;
  }

  setCell(ws, row, 36, stats.halfFirst || 0);
  setCell(ws, row, 37, stats.halfSecond || 0);
  setCell(ws, row, 38, stats.hours || 0);
  setCell(ws, row, 39, stats.vacation || 0);
  setCell(ws, row, 40, stats.sick || 0);
  setCell(ws, row, 41, stats.unpaid || 0);
  setCell(ws, row, 42, stats.idle || 0);
  setCell(ws, row, 43, stats.absent || 0);
}

function updatePrintArea(ws: ExcelJS.Worksheet, lastRow: number) {
  const lastCol = "AT";
  ws.pageSetup.printArea = `A1:${lastCol}${lastRow}`;
}

export async function buildTimesheetWorkbook(input: TimesheetExportInput): Promise<Buffer> {
  if (!input.employees.length) throw new Error("EMPTY_EMPLOYEES");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("TIMESHEET_TEMPLATE_INVALID");

  ws.name = safeSheetName(input.sheetLabel || "Табель");
  const monthYm = input.periodTo.slice(0, 7);

  fillHeader(ws, input);
  updateDayHeaderRows(ws, monthYm);
  ensureEmployeeRows(ws, input.employees.length);

  let totalHours = 0;
  input.employees.forEach((emp, idx) => {
    const row = FIRST_DATA_ROW + idx;
    fillEmployeeRow(ws, row, idx + 1, emp, monthYm, input.periodFrom, input.periodTo);
    totalHours += parseMarkStats(monthYm, input.periodFrom, input.periodTo, emp.marks).hours;
  });

  for (let r = FIRST_DATA_ROW + input.employees.length; r < FIRST_DATA_ROW + TEMPLATE_DATA_ROWS; r += 1) {
    for (let c = 1; c <= 46; c += 1) ws.getCell(r, c).value = null;
  }

  fillSummaryRow(ws, input, totalHours);
  updatePrintArea(ws, FIRST_DATA_ROW + input.employees.length - 1);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function buildTimesheetFileName(input: TimesheetExportInput): string {
  const month = input.periodTo.slice(0, 7);
  const section = input.sheetLabel ? ` ${input.sheetLabel}` : "";
  return `Табель${section} ${month}.xlsx`;
}
