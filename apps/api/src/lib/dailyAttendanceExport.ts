import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ObjectSection } from "@prisma/client";
import {
  dailyAttendanceRowLimits,
  formatRuDateDot,
  safeFilePart,
  sectionLabel,
  type DailyAttendanceBlock
} from "./fieldDocs.js";

export type DailyAttendanceExportInput = {
  section: ObjectSection;
  workDate: string;
  objectTitle: string;
  warehouseName: string;
  blocks: DailyAttendanceBlock[];
};

type BlockLayout = {
  titleRow: number;
  headerRow: number;
  dataStartRow: number;
  dataRowCount: number;
  totalRow: number;
  percentRow: number;
};

function templatePath(section: ObjectSection): string {
  const file =
    section === "EOM" ? "daily-attendance-eom-template.xlsx" : "daily-attendance-ss-template.xlsx";
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, `../../assets/${file}`),
    path.resolve(process.cwd(), `assets/${file}`)
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("DAILY_ATTENDANCE_TEMPLATE_MISSING");
}

function blockLayouts(section: ObjectSection): BlockLayout[] {
  if (section === "EOM") {
    return [
      { titleRow: 2, headerRow: 2, dataStartRow: 3, dataRowCount: 3, totalRow: 6, percentRow: 7 },
      { titleRow: 8, headerRow: 8, dataStartRow: 9, dataRowCount: 9, totalRow: 18, percentRow: 19 }
    ];
  }
  return [
    { titleRow: 2, headerRow: 2, dataStartRow: 3, dataRowCount: 3, totalRow: 6, percentRow: 7 },
    { titleRow: 8, headerRow: 8, dataStartRow: 9, dataRowCount: 4, totalRow: 13, percentRow: 14 }
  ];
}

function setCell(ws: ExcelJS.Worksheet, addr: string, value: string | number | null | undefined) {
  if (value == null || value === "") return;
  ws.getCell(addr).value = value;
}

function clearBlockData(ws: ExcelJS.Worksheet, layout: BlockLayout) {
  for (let i = 0; i < layout.dataRowCount; i += 1) {
    const r = layout.dataStartRow + i;
    for (const col of ["B", "C", "D", "E", "F", "G"]) {
      if (col === "B" && i > 0) continue;
      ws.getCell(`${col}${r}`).value = null;
    }
  }
}

function fillBlock(ws: ExcelJS.Worksheet, layout: BlockLayout, block: DailyAttendanceBlock | undefined) {
  clearBlockData(ws, layout);
  if (!block) return;

  setCell(ws, `A${layout.titleRow}`, block.title);
  block.rows.slice(0, layout.dataRowCount).forEach((row, i) => {
    const r = layout.dataStartRow + i;
    if (i === 0) setCell(ws, `B${r}`, block.organization);
    setCell(ws, `C${r}`, i + 1);
    setCell(ws, `D${r}`, row.position);
    setCell(ws, `E${r}`, row.normQty);
    setCell(ws, `F${r}`, row.presentQty);
    setCell(ws, `G${r}`, row.nameReason);
  });
}

export async function buildDailyAttendanceWorkbook(input: DailyAttendanceExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath(input.section));
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("DAILY_ATTENDANCE_TEMPLATE_INVALID");

  setCell(ws, "A1", input.objectTitle);
  setCell(ws, "G1", `Дата: ${formatRuDateDot(input.workDate)}`);

  const layouts = blockLayouts(input.section);
  const limits = dailyAttendanceRowLimits(input.section);
  layouts.forEach((layout, idx) => {
    const block = input.blocks[idx];
    const limited =
      block && block.rows.length > (limits[idx] ?? 10)
        ? { ...block, rows: block.rows.slice(0, limits[idx]) }
        : block;
    fillBlock(ws, layout, limited);
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function buildDailyAttendanceFileName(input: DailyAttendanceExportInput): string {
  const sec = sectionLabel(input.section);
  const date = formatRuDateDot(input.workDate);
  const wh = safeFilePart(input.warehouseName);
  return `Табель учета ${sec} ${wh} ${date}.xlsx`;
}
