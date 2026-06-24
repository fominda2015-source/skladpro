import ExcelJS from "exceljs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ObjectSection } from "@prisma/client";
import {
  formatRuDateDot,
  parseIsoDate,
  safeFilePart,
  sectionLabel,
  type WorkOrderRow
} from "./fieldDocs.js";

export type WorkOrderExportInput = {
  section: ObjectSection;
  workDate: string;
  objectTitle: string;
  warehouseName: string;
  foremanName: string;
  responsibleItrName: string;
  composedByItrName: string;
  rows: WorkOrderRow[];
  completedWorksNote: string;
};

const DATA_START_ROW = 9;
const DATA_ROW_COUNT = 6;

function templatePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "../../assets/work-order-template.xlsx"),
    path.resolve(process.cwd(), "assets/work-order-template.xlsx")
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("WORK_ORDER_TEMPLATE_MISSING");
}

function setCell(ws: ExcelJS.Worksheet, addr: string, value: string | number | Date | null | undefined) {
  if (value == null || value === "") return;
  ws.getCell(addr).value = value;
}

function clearDataRows(ws: ExcelJS.Worksheet) {
  for (let r = DATA_START_ROW; r < DATA_START_ROW + DATA_ROW_COUNT; r += 1) {
    for (const col of ["A", "B", "D", "E", "F", "G", "H", "I", "J", "K"]) {
      ws.getCell(`${col}${r}`).value = null;
    }
  }
}

export async function buildWorkOrderWorkbook(input: WorkOrderExportInput): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(templatePath());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("WORK_ORDER_TEMPLATE_INVALID");

  clearDataRows(ws);

  setCell(ws, "A1", input.objectTitle);
  setCell(ws, "C2", parseIsoDate(input.workDate));
  setCell(ws, "C3", input.foremanName);
  setCell(ws, "C4", input.responsibleItrName);
  setCell(ws, "C5", input.composedByItrName);
  setCell(ws, "D17", input.completedWorksNote);

  let peoplePlanSum = 0;
  input.rows.slice(0, DATA_ROW_COUNT).forEach((row, i) => {
    const r = DATA_START_ROW + i;
    setCell(ws, `A${r}`, i + 1);
    setCell(ws, `B${r}`, row.place);
    setCell(ws, `D${r}`, row.workAssigned);
    if (row.peoplePlan != null && row.peoplePlan !== "") {
      const n = Number(row.peoplePlan);
      if (Number.isFinite(n)) {
        setCell(ws, `E${r}`, n);
        peoplePlanSum += n;
      }
    }
    if (row.peopleFact != null && row.peopleFact !== "") {
      const n = Number(row.peopleFact);
      if (Number.isFinite(n)) setCell(ws, `F${r}`, n);
    }
    setCell(ws, `G${r}`, row.workDone);
    setCell(ws, `H${r}`, row.status);
    setCell(ws, `I${r}`, row.volumePlan);
    setCell(ws, `J${r}`, row.volumeFact);
    setCell(ws, `K${r}`, row.note);
  });

  if (peoplePlanSum > 0) setCell(ws, "E15", peoplePlanSum);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function buildWorkOrderFileName(input: WorkOrderExportInput): string {
  const sec = sectionLabel(input.section);
  const date = formatRuDateDot(input.workDate);
  const wh = safeFilePart(input.warehouseName);
  return `Наряд задание ${sec} ${date} ${wh}.xlsx`;
}
