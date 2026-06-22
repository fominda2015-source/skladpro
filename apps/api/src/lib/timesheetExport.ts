import ExcelJS from "exceljs";
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

const LEGEND: Array<[string, string]> = [
  ["ОТ", "ОТПУСК ЕЖЕГОДНЫЙ, ОПЛАЧИВАЕМЫЙ"],
  ["Б", "БОЛЬНИЧНЫЙ ОФОРМЛЕННЫЙ"],
  ["ДО", "ОТПУСК БЕЗ СОХРАНЕНИЯ ЗАРПЛАТЫ"],
  ["П", "ПРОСТОЙ"],
  ["Н", "ЧЕЛОВЕК НЕ ВЫШЕЛ, ПРОПАЛ ПО НЕЯСНЫМ ПРИЧИНАМ"]
];

const COL = {
  num: 1,
  name: 2,
  position: 3,
  hireDate: 4,
  dayStart: 5,
  halfFirst: 36,
  halfSecond: 37,
  monthTotal: 38,
  vacation: 39,
  sick: 40,
  unpaid: 41,
  idle: 42,
  absent: 43,
  sumTotal: 44,
  sumCard: 45,
  sumCash: 46,
  legend: 47,
  accepted: 24,
  fired: 28,
  compileDate: 7,
  periodFrom: 12,
  periodTo: 14,
  responsibleTitle: 24,
  responsibleName: 38,
  responsibleLabel: 31
} as const;

function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

function weekdayShort(iso: string): string {
  return WEEKDAYS_RU[ymdToDate(iso).getDay()] ?? "";
}

function normMark(v: string | number | null | undefined): string {
  if (v == null || v === "") return "";
  return String(v).trim();
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

function parseMarkStats(days: string[], marks: Record<string, string | number | null>): MarkStats {
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

  for (const iso of days) {
    const raw = normMark(marks[iso]);
    if (!raw) continue;
    const upper = raw.toUpperCase();
    const dayNum = ymdToDate(iso).getDate();
    const isFirstHalf = dayNum <= 15;

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

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FF9CA3AF" } };
  return { top: side, left: side, bottom: side, right: side };
}

function setBorderRange(ws: ExcelJS.Worksheet, r1: number, c1: number, r2: number, c2: number) {
  for (let r = r1; r <= r2; r += 1) {
    for (let c = c1; c <= c2; c += 1) {
      ws.getCell(r, c).border = thinBorder();
    }
  }
}

function safeSheetName(name: string): string {
  return String(name).replace(/[\\/:?*[\]]/g, " ").slice(0, 31) || "Табель";
}

function normHoursForPeriod(periodFrom: string, periodTo: string): number {
  const days = listPeriodDays(periodFrom, periodTo).length;
  return Math.max(0, Math.round(days * (40 / 5)));
}

export async function buildTimesheetWorkbook(input: TimesheetExportInput): Promise<Buffer> {
  const days = listPeriodDays(input.periodFrom, input.periodTo);
  if (!days.length) throw new Error("EMPTY_PERIOD");

  const wb = new ExcelJS.Workbook();
  wb.creator = "СкладПро";
  wb.created = new Date();
  const ws = wb.addWorksheet(safeSheetName(input.sheetLabel || "Табель"));

  ws.getColumn(COL.num).width = 4;
  ws.getColumn(COL.name).width = 28;
  ws.getColumn(COL.position).width = 18;
  ws.getColumn(COL.hireDate).width = 12;
  for (let i = 0; i < 31; i += 1) {
    ws.getColumn(COL.dayStart + i).width = 4.2;
  }

  ws.mergeCells(5, 1, 5, 16);
  ws.getCell(5, 1).value = input.organization;
  ws.getCell(6, 1).value = "наименование организации";

  ws.mergeCells(7, 1, 7, 16);
  ws.getCell(7, 1).value = input.department;
  ws.getCell(8, 1).value = "структурное подразделение";

  ws.mergeCells(9, 1, 9, 16);
  ws.getCell(9, 1).value = input.objectName;
  ws.getCell(10, 1).value = "объект";

  ws.mergeCells(11, 2, 11, 5);
  ws.getCell(11, 2).value = "ТАБЕЛЬ УЧЕТА РАБОЧЕГО ВРЕМЕНИ";
  ws.getCell(11, 2).font = { bold: true, size: 12 };
  ws.getCell(11, COL.compileDate).value = "Дата составления";
  ws.getCell(11, COL.periodFrom).value = "Отчетный период";
  ws.getCell(12, COL.compileDate).value = ymdToDate(input.compileDate);
  ws.getCell(12, COL.compileDate).numFmt = "yyyy-mm-dd";
  ws.getCell(12, COL.periodFrom).value = "с";
  ws.getCell(12, COL.periodTo).value = "по";
  ws.getCell(13, COL.periodFrom).value = ymdToDate(input.periodFrom);
  ws.getCell(13, COL.periodFrom).numFmt = "yyyy-mm-dd";
  ws.getCell(13, COL.periodTo).value = ymdToDate(input.periodTo);
  ws.getCell(13, COL.periodTo).numFmt = "yyyy-mm-dd";

  ws.getCell(11, COL.accepted).value = "ПРИНЯТО";
  ws.getCell(11, COL.fired).value = "УВОЛЕНО";
  ws.getCell(11, COL.halfFirst).value = "ТЕКУЩЕСТЬ";
  ws.getCell(11, COL.monthTotal).value = "НОРМА ЧАСОВ";
  ws.getCell(11, COL.sick).value = "отработано";
  ws.getCell(11, COL.idle).value = "ССЧ";

  if (input.responsibleTitle || input.responsibleName) {
    ws.getCell(5, COL.responsibleTitle).value = input.responsibleTitle || "";
    ws.getCell(5, COL.responsibleName).value = input.responsibleName || "";
    ws.getCell(6, COL.responsibleLabel).value = "( Ответственный за табельный учет)";
  }

  const headerRow = 15;
  ws.getCell(headerRow, COL.num).value = "№";
  ws.getCell(headerRow, COL.name).value = "Фамилия И.О.";
  ws.getCell(headerRow, COL.position).value = "Должность";
  ws.getCell(headerRow, COL.hireDate).value = "Дата приема";
  ws.mergeCells(headerRow, COL.dayStart, headerRow, COL.dayStart + 30);
  ws.getCell(headerRow, COL.dayStart).value = "Отметки о явках и неявках на работу по часам";
  ws.getCell(headerRow, COL.halfFirst).value = "Отработано часов за";
  ws.getCell(headerRow, COL.vacation).value = "отпуск ежегод";
  ws.getCell(headerRow, COL.sick).value = "больничный";
  ws.getCell(headerRow, COL.unpaid).value = "БСЗП";
  ws.getCell(headerRow, COL.idle).value = "простой";
  ws.getCell(headerRow, COL.absent).value = "невыход";
  ws.getCell(headerRow, COL.sumTotal).value = "сумма общая";
  ws.getCell(headerRow, COL.sumCard).value = "сумма на карту";
  ws.getCell(headerRow, COL.sumCash).value = "сумма на руки";

  const dayNumRow = headerRow + 1;
  for (let i = 0; i < 31; i += 1) {
    ws.getCell(dayNumRow, COL.dayStart + i).value = i < days.length ? i + 1 : "";
  }
  ws.getCell(dayNumRow, COL.halfFirst).value = "половина месяца";
  ws.getCell(dayNumRow, COL.monthTotal).value = "месяц";

  const halfRow = headerRow + 2;
  ws.getCell(halfRow, COL.halfFirst).value = "I";
  ws.getCell(halfRow, COL.halfSecond).value = "II";

  const weekdayRow = headerRow + 4;
  for (let i = 0; i < days.length; i += 1) {
    ws.getCell(weekdayRow, COL.dayStart + i).value = weekdayShort(days[i]!);
  }

  let totalHours = 0;
  input.employees.forEach((emp, idx) => {
    const row = headerRow + 5 + idx;
    const stats = parseMarkStats(days, emp.marks);
    totalHours += stats.hours;

    ws.getCell(row, COL.num).value = idx + 1;
    ws.getCell(row, COL.name).value = emp.fullName;
    ws.getCell(row, COL.position).value = emp.position || "";
    if (emp.hireDate) {
      ws.getCell(row, COL.hireDate).value = ymdToDate(emp.hireDate);
      ws.getCell(row, COL.hireDate).numFmt = "yyyy-mm-dd";
    }

    days.forEach((iso, dayIdx) => {
      const mark = normMark(emp.marks[iso]);
      const cell = ws.getCell(row, COL.dayStart + dayIdx);
      if (mark === "") return;
      const n = Number(mark.replace(",", "."));
      cell.value = Number.isFinite(n) ? n : mark;
    });

    ws.getCell(row, COL.halfFirst).value = stats.halfFirst || "";
    ws.getCell(row, COL.halfSecond).value = stats.halfSecond || "";
    ws.getCell(row, COL.monthTotal).value = stats.hours || "";
    ws.getCell(row, COL.vacation).value = stats.vacation || "";
    ws.getCell(row, COL.sick).value = stats.sick || "";
    ws.getCell(row, COL.unpaid).value = stats.unpaid || "";
    ws.getCell(row, COL.idle).value = stats.idle || "";
    ws.getCell(row, COL.absent).value = stats.absent || "";
  });

  const statsRow = 12;
  ws.getCell(statsRow, COL.accepted).value = input.employees.length;
  ws.getCell(statsRow, COL.fired).value = 0;
  ws.getCell(statsRow, COL.halfFirst).value = 0;
  ws.getCell(statsRow, COL.monthTotal).value = normHoursForPeriod(input.periodFrom, input.periodTo);
  ws.getCell(statsRow, COL.sick).value =
    input.employees.length > 0 ? totalHours / input.employees.length : 0;
  ws.getCell(statsRow, COL.idle).value =
    input.employees.length > 0 ? Math.round(totalHours / input.employees.length) : 0;

  ws.getCell(5, COL.legend).value = "УСЛОВНЫЕ ОБОЗНАЧЕНИЯ";
  LEGEND.forEach(([code, label], i) => {
    ws.getCell(6 + i, COL.legend).value = code;
    ws.getCell(6 + i, COL.legend + 1).value = label;
  });

  const lastDataRow = headerRow + 4 + input.employees.length;
  setBorderRange(ws, headerRow, COL.num, lastDataRow, COL.absent);
  setBorderRange(ws, headerRow, COL.dayStart, weekdayRow, COL.dayStart + 30);

  for (let r = headerRow; r <= lastDataRow; r += 1) {
    ws.getRow(r).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  }
  ws.getColumn(COL.name).alignment = { horizontal: "left" };
  ws.getColumn(COL.position).alignment = { horizontal: "left" };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function buildTimesheetFileName(input: TimesheetExportInput): string {
  const month = input.periodTo.slice(0, 7);
  const section = input.sheetLabel ? ` ${input.sheetLabel}` : "";
  return `Табель${section} ${month}.xlsx`;
}
