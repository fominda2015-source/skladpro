import fs from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import {
  assertObjectSectionInScope,
  getRequestDataScope
} from "../lib/dataScope.js";
import { contentDispositionAttachment } from "../lib/xlsxReport.js";
import { decodeUploadedOriginalName, repairStoredFileName } from "../lib/uploadFileName.js";
import { prisma } from "../lib/prisma.js";
import {
  buildProductivityDownloadBuffer,
  cellKey,
  extendDateColumnsThrough,
  parseCellValues,
  parseProductivityBuffer,
  removeProductivityFile,
  type ProductivityDateColumn
} from "../lib/productivitySheet.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const uploadDirAbs = path.resolve(process.cwd(), config.uploadsDir, "productivity");

async function assertProductivityScope(req: AuthedRequest, warehouseId: string, section: "SS" | "EOM") {
  const scope = await getRequestDataScope(req);
  try {
    assertObjectSectionInScope(scope, warehouseId, section);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) {
      const msg =
        err.message === "FORBIDDEN_SECTION" ? "Нет доступа к разделу" : "Нет доступа к объекту";
      const forbidden = new Error(msg) as Error & { status: number };
      forbidden.status = 403;
      throw forbidden;
    }
    throw e;
  }
}

const querySchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"])
});

const patchCellsSchema = z.object({
  cells: z
    .array(
      z.object({
        row: z.number().int().min(0),
        col: z.number().int().min(0),
        value: z.union([z.number(), z.string(), z.null()])
      })
    )
    .min(1)
    .max(5000)
});

async function ensureUploadDir() {
  await fs.mkdir(uploadDirAbs, { recursive: true });
}

function sheetToJson(sheet: {
  id: string;
  warehouseId: string;
  section: string;
  title: string;
  sourceFileName: string;
  headerRow: number;
  dataStartRow: number;
  fixedColCount: number;
  dateColumns: unknown;
  cellValues: unknown;
  updatedAt: Date;
}) {
  const dateColumns = extendDateColumnsThrough(
    (Array.isArray(sheet.dateColumns) ? sheet.dateColumns : []) as ProductivityDateColumn[]
  );
  return {
    id: sheet.id,
    warehouseId: sheet.warehouseId,
    section: sheet.section,
    title: sheet.title,
    sourceFileName: repairStoredFileName(sheet.sourceFileName),
    headerRow: sheet.headerRow,
    dataStartRow: sheet.dataStartRow,
    fixedColCount: sheet.fixedColCount,
    dateColumns,
    cellValues: parseCellValues(sheet.cellValues),
    updatedAt: sheet.updatedAt.toISOString()
  };
}

export const productivityRouter = Router();
productivityRouter.use(requireAuth);
productivityRouter.use(requirePermission("productivity.read"));

productivityRouter.get("/", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Нужны warehouseId и section (SS|EOM)" });
  }
  try {
    await assertProductivityScope(req as AuthedRequest, parsed.data.warehouseId, parsed.data.section);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }

  const sheet = await prisma.productivitySheet.findUnique({
    where: {
      warehouseId_section: {
        warehouseId: parsed.data.warehouseId,
        section: parsed.data.section
      }
    }
  });
  if (!sheet) {
    return res.json(null);
  }

  const extended = extendDateColumnsThrough(sheet.dateColumns as ProductivityDateColumn[]);
  if (extended.length !== (sheet.dateColumns as ProductivityDateColumn[]).length) {
    await prisma.productivitySheet.update({
      where: { id: sheet.id },
      data: { dateColumns: extended }
    });
  }

  const fileBuf = await fs.readFile(path.resolve(process.cwd(), sheet.storagePath));
  const parsedMeta = parseProductivityBuffer(fileBuf);

  return res.json({
    ...sheetToJson({ ...sheet, dateColumns: extended }),
    rows: parsedMeta.rows
  });
});

productivityRouter.post(
  "/upload",
  requirePermission("productivity.write"),
  upload.single("file"),
  async (req, res) => {
    const body = z
      .object({
        warehouseId: z.string().min(1),
        section: z.enum(["SS", "EOM"]),
        title: z.string().min(2).max(200).optional()
      })
      .safeParse(req.body);

    if (!body.success) {
      return res.status(400).json({ error: "Нужны warehouseId и section (SS|EOM)" });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ error: "Файл не передан" });
    if (!/\.(xlsx|xls)$/i.test(file.originalname)) {
      return res.status(400).json({ error: "Нужен файл Excel (.xlsx)" });
    }

    const scope = await getRequestDataScope(req as AuthedRequest);
    try {
      assertObjectSectionInScope(scope, body.data.warehouseId, body.data.section);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) {
        return res.status(403).json({
          error: err.message === "FORBIDDEN_SECTION" ? "Нет доступа к разделу" : "Нет доступа к объекту"
        });
      }
      throw e;
    }

    let meta;
    try {
      meta = parseProductivityBuffer(file.buffer);
    } catch {
      return res.status(400).json({
        error: "INVALID_EXCEL",
        message: "Не удалось разобрать Excel. Проверьте формат шаблона выработки."
      });
    }

    const extendedDates = extendDateColumnsThrough(meta.dateColumns);
    await ensureUploadDir();

    const existing = await prisma.productivitySheet.findUnique({
      where: {
        warehouseId_section: {
          warehouseId: body.data.warehouseId,
          section: body.data.section
        }
      }
    });
    if (existing) {
      await removeProductivityFile(existing.storagePath);
    }

    const stored = `productivity-${body.data.warehouseId}-${body.data.section}-${Date.now()}.xlsx`;
    const relPath = `${config.uploadsDir}/productivity/${stored}`.replace(/\\/g, "/");
    await fs.writeFile(path.join(uploadDirAbs, stored), file.buffer);

    const sourceFileName = decodeUploadedOriginalName(file.originalname);
    const title =
      body.data.title?.trim() ||
      sourceFileName.replace(/\.(xlsx|xls)$/i, "").trim() ||
      "Выработка";

    const sheet = await prisma.productivitySheet.upsert({
      where: {
        warehouseId_section: {
          warehouseId: body.data.warehouseId,
          section: body.data.section
        }
      },
      create: {
        warehouseId: body.data.warehouseId,
        section: body.data.section,
        title,
        sourceFileName,
        storagePath: relPath,
        headerRow: meta.headerRow,
        dataStartRow: meta.dataStartRow,
        fixedColCount: meta.fixedColCount,
        dateColumns: extendedDates,
        cellValues: {},
        createdById: (req as AuthedRequest).user?.userId ?? null
      },
      update: {
        title,
        sourceFileName,
        storagePath: relPath,
        headerRow: meta.headerRow,
        dataStartRow: meta.dataStartRow,
        fixedColCount: meta.fixedColCount,
        dateColumns: extendedDates,
        cellValues: {},
        createdById: (req as AuthedRequest).user?.userId ?? null
      }
    });

    return res.status(existing ? 200 : 201).json({
      ...sheetToJson(sheet),
      rows: meta.rows
    });
  }
);

productivityRouter.patch("/cells", requirePermission("productivity.write"), async (req, res) => {
  const query = querySchema.safeParse(req.query);
  if (!query.success) {
    return res.status(400).json({ error: "Нужны warehouseId и section в query" });
  }
  const body = patchCellsSchema.safeParse(req.body);
  if (!body.success) {
    return res.status(400).json({ error: "Некорректные ячейки" });
  }

  try {
    await assertProductivityScope(req as AuthedRequest, query.data.warehouseId, query.data.section);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }

  const sheet = await prisma.productivitySheet.findUnique({
    where: {
      warehouseId_section: {
        warehouseId: query.data.warehouseId,
        section: query.data.section
      }
    }
  });
  if (!sheet) return res.status(404).json({ error: "Сначала загрузите шаблон выработки" });

  const values = parseCellValues(sheet.cellValues);
  for (const cell of body.data.cells) {
    const key = cellKey(cell.row, cell.col);
    if (cell.value == null || cell.value === "") {
      delete values[key];
    } else {
      const n = typeof cell.value === "number" ? cell.value : Number(String(cell.value).replace(",", "."));
      values[key] = Number.isFinite(n) ? n : String(cell.value);
    }
  }

  const updated = await prisma.productivitySheet.update({
    where: { id: sheet.id },
    data: { cellValues: values }
  });

  return res.json(sheetToJson(updated));
});

productivityRouter.get("/download", async (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Нужны warehouseId и section" });
  }
  try {
    await assertProductivityScope(req as AuthedRequest, parsed.data.warehouseId, parsed.data.section);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }

  const sheet = await prisma.productivitySheet.findUnique({
    where: {
      warehouseId_section: {
        warehouseId: parsed.data.warehouseId,
        section: parsed.data.section
      }
    }
  });
  if (!sheet) return res.status(404).json({ error: "Нет загруженной выработки" });

  const dateColumns = extendDateColumnsThrough(sheet.dateColumns as ProductivityDateColumn[]);
  if (dateColumns.length !== (sheet.dateColumns as ProductivityDateColumn[]).length) {
    await prisma.productivitySheet.update({
      where: { id: sheet.id },
      data: { dateColumns }
    });
  }

  const buffer = await buildProductivityDownloadBuffer({
    storagePath: sheet.storagePath,
    headerRow: sheet.headerRow,
    dateColumns,
    cellValues: parseCellValues(sheet.cellValues)
  });

  const fileName = repairStoredFileName(
    sheet.sourceFileName.endsWith(".xlsx") ? sheet.sourceFileName : `${sheet.sourceFileName}.xlsx`
  );
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", contentDispositionAttachment(fileName));
  return res.send(buffer);
});
