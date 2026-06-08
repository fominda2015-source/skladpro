import ExcelJS from "exceljs";

export type ReportColumn = {
  header: string;
  key: string;
  width?: number;
  numFmt?: string;
  /** Цвет текста ячейки (ARGB, напр. FF16A34A) */
  textColor?: (value: unknown, row: Record<string, unknown>) => string | undefined;
  /** Заливка ячейки (ARGB) */
  fillColor?: (value: unknown, row: Record<string, unknown>) => string | undefined;
};

export type ReportMetaRow = { label: string; value: string };

export type ReportSheetDef = {
  name: string;
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF2563EB" }
};

const META_LABEL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFEFF6FF" }
};

const THIN_GRAY = { argb: "FFD1D5DB" };

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: "thin", color: THIN_GRAY };
  return { top: side, left: side, bottom: side, right: side };
}

function safeSheetName(name: string): string {
  return String(name).replace(/[\\/:?*\[\]]/g, " ").slice(0, 31) || "Sheet";
}

function cellValue(v: unknown): string | number | boolean | Date | null {
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

export async function buildStyledWorkbook(
  meta: { title: string; rows: ReportMetaRow[] },
  sheets: ReportSheetDef[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "СкладПро";
  wb.created = new Date();

  const metaWs = wb.addWorksheet("Параметры");
  metaWs.getColumn(1).width = 22;
  metaWs.getColumn(2).width = 48;
  metaWs.mergeCells(1, 1, 1, 2);
  const titleCell = metaWs.getCell(1, 1);
  titleCell.value = meta.title;
  titleCell.font = { bold: true, size: 14, color: { argb: "FF1E3A8A" } };
  titleCell.alignment = { vertical: "middle" };
  metaWs.getRow(1).height = 28;

  meta.rows.forEach((row, idx) => {
    const r = metaWs.getRow(idx + 3);
    r.getCell(1).value = row.label;
    r.getCell(2).value = row.value;
    r.getCell(1).font = { bold: true };
    r.getCell(1).fill = META_LABEL_FILL;
    r.getCell(1).border = thinBorder();
    r.getCell(2).border = thinBorder();
  });

  for (const sheet of sheets) {
    const ws = wb.addWorksheet(safeSheetName(sheet.name));
    sheet.columns.forEach((col, i) => {
      ws.getColumn(i + 1).width = col.width ?? Math.min(36, Math.max(12, col.header.length + 4));
    });

    const headerRow = ws.getRow(1);
    sheet.columns.forEach((col, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = col.header;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.fill = HEADER_FILL;
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = thinBorder();
    });
    headerRow.height = 22;
    ws.views = [{ state: "frozen", ySplit: 1 }];

    sheet.rows.forEach((rowData, rowIdx) => {
      const row = ws.getRow(rowIdx + 2);
      sheet.columns.forEach((col, colIdx) => {
        const cell = row.getCell(colIdx + 1);
        cell.value = cellValue(rowData[col.key]);
        cell.border = thinBorder();
        cell.alignment = { vertical: "top", wrapText: true };
        if (col.numFmt && typeof cell.value === "number") {
          cell.numFmt = col.numFmt;
        }
        const rawVal = rowData[col.key];
        const textArgb = col.textColor?.(rawVal, rowData);
        const fillArgb = col.fillColor?.(rawVal, rowData);
        if (textArgb || fillArgb) {
          cell.font = { ...(cell.font || {}), ...(textArgb ? { color: { argb: textArgb } } : {}) };
        }
        if (fillArgb) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
        } else if (rowIdx % 2 === 1) {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF8FAFC" }
          };
        }
      });
    });

    if (!sheet.rows.length) {
      const row = ws.getRow(2);
      row.getCell(1).value = "Нет данных за выбранный период / фильтры";
      ws.mergeCells(2, 1, 2, Math.max(1, sheet.columns.length));
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export function sendStyledXlsx(res: import("express").Response, buffer: Buffer, fileName: string) {
  const safe = fileName.replace(/[^\w\u0400-\u04FF.\-]+/gi, "_").slice(0, 120) || "export.xlsx";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  res.setHeader("Content-Length", String(buffer.length));
  res.send(buffer);
}
