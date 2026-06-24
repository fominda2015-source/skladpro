import { Router } from "express";
import { z } from "zod";
import { assertObjectSectionInScope, getRequestDataScope } from "../lib/dataScope.js";
import {
  buildDailyAttendanceObjectTitle,
  defaultDailyAttendanceBlocks,
  loadFieldDocWarehouse,
  parseDailyAttendanceBlocks,
  parseIsoDate,
  type DailyAttendanceBlock
} from "../lib/fieldDocs.js";
import { buildDailyAttendanceFileName, buildDailyAttendanceWorkbook } from "../lib/dailyAttendanceExport.js";
import { contentDispositionAttachment } from "../lib/xlsxReport.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

export const dailyAttendanceRouter = Router();
dailyAttendanceRouter.use(requireAuth);
dailyAttendanceRouter.use(requirePermission("productivity.read"));

const scopeQuerySchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"])
});

const listQuerySchema = scopeQuerySchema.extend({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional().default(50)
});

const dateParamSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const attendanceRowSchema = z.object({
  position: z.string().default(""),
  normQty: z.coerce.number().nonnegative().default(0),
  presentQty: z.coerce.number().nonnegative().default(0),
  nameReason: z.string().default("")
});

const blockSchema = z.object({
  title: z.string().min(1),
  organization: z.string().default(""),
  rows: z.array(attendanceRowSchema).default([])
});

const saveBodySchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  objectTitle: z.string().min(1).max(4000),
  blocks: z.array(blockSchema).min(1).max(4)
});

async function assertScope(req: AuthedRequest, warehouseId: string, section: "SS" | "EOM") {
  const scope = await getRequestDataScope(req);
  try {
    assertObjectSectionInScope(scope, warehouseId, section);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) {
      throw Object.assign(new Error(err.message === "FORBIDDEN_SECTION" ? "Нет доступа к разделу" : "Нет доступа к объекту"), {
        status: 403
      });
    }
    throw e;
  }
}

function mapRow(row: {
  id: string;
  workDate: Date;
  objectTitle: string;
  updatedAt: Date;
  createdBy: { fullName: string } | null;
}) {
  return {
    id: row.id,
    workDate: row.workDate.toISOString().slice(0, 10),
    objectTitle: row.objectTitle,
    updatedAt: row.updatedAt.toISOString(),
    createdByName: row.createdBy?.fullName ?? null
  };
}

dailyAttendanceRouter.get("/context", async (req: AuthedRequest, res) => {
  const parsed = scopeQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  try {
    await assertScope(req, parsed.data.warehouseId, parsed.data.section);
    const warehouse = await loadFieldDocWarehouse(parsed.data.warehouseId);
    const today = new Date().toISOString().slice(0, 10);
    return res.json({
      workDate: today,
      objectTitle: buildDailyAttendanceObjectTitle(warehouse, parsed.data.section),
      warehouseName: warehouse.name,
      blocks: defaultDailyAttendanceBlocks(parsed.data.section)
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 500).json({ error: err.message });
  }
});

dailyAttendanceRouter.get("/", async (req: AuthedRequest, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  try {
    await assertScope(req, parsed.data.warehouseId, parsed.data.section);
    const rows = await prisma.dailyAttendanceSheet.findMany({
      where: {
        warehouseId: parsed.data.warehouseId,
        section: parsed.data.section,
        ...(parsed.data.dateFrom || parsed.data.dateTo
          ? {
              workDate: {
                ...(parsed.data.dateFrom ? { gte: parseIsoDate(parsed.data.dateFrom) } : {}),
                ...(parsed.data.dateTo ? { lte: parseIsoDate(parsed.data.dateTo) } : {})
              }
            }
          : {})
      },
      orderBy: { workDate: "desc" },
      take: parsed.data.limit,
      include: { createdBy: { select: { fullName: true } } }
    });
    return res.json(rows.map(mapRow));
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 500).json({ error: err.message });
  }
});

dailyAttendanceRouter.get("/:date/export", async (req: AuthedRequest, res) => {
  const dateParsed = dateParamSchema.safeParse(req.params.date);
  if (!dateParsed.success) return res.status(400).json({ error: "Invalid date" });
  const q = scopeQuerySchema.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "Invalid query", details: q.error.flatten() });
  try {
    await assertScope(req, q.data.warehouseId, q.data.section);
    const row = await prisma.dailyAttendanceSheet.findUnique({
      where: {
        warehouseId_section_workDate: {
          warehouseId: q.data.warehouseId,
          section: q.data.section,
          workDate: parseIsoDate(dateParsed.data)
        }
      }
    });
    if (!row) return res.status(404).json({ error: "Запись не найдена" });
    const warehouse = await loadFieldDocWarehouse(q.data.warehouseId);
    const input = {
      section: q.data.section,
      workDate: dateParsed.data,
      objectTitle: row.objectTitle,
      warehouseName: warehouse.name,
      blocks: parseDailyAttendanceBlocks(row.blocks) as DailyAttendanceBlock[]
    };
    const buf = await buildDailyAttendanceWorkbook(input);
    const fileName = buildDailyAttendanceFileName(input);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", contentDispositionAttachment(fileName));
    return res.send(buf);
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 500).json({ error: err.message });
  }
});

dailyAttendanceRouter.get("/:date", async (req: AuthedRequest, res) => {
  const dateParsed = dateParamSchema.safeParse(req.params.date);
  if (!dateParsed.success) return res.status(400).json({ error: "Invalid date" });
  const q = scopeQuerySchema.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "Invalid query", details: q.error.flatten() });
  try {
    await assertScope(req, q.data.warehouseId, q.data.section);
    const row = await prisma.dailyAttendanceSheet.findUnique({
      where: {
        warehouseId_section_workDate: {
          warehouseId: q.data.warehouseId,
          section: q.data.section,
          workDate: parseIsoDate(dateParsed.data)
        }
      },
      include: { createdBy: { select: { fullName: true } } }
    });
    if (!row) {
      const warehouse = await loadFieldDocWarehouse(q.data.warehouseId);
      return res.json({
        exists: false,
        workDate: dateParsed.data,
        objectTitle: buildDailyAttendanceObjectTitle(warehouse, q.data.section),
        blocks: defaultDailyAttendanceBlocks(q.data.section)
      });
    }
    return res.json({
      exists: true,
      id: row.id,
      workDate: dateParsed.data,
      objectTitle: row.objectTitle,
      blocks: parseDailyAttendanceBlocks(row.blocks),
      updatedAt: row.updatedAt.toISOString(),
      createdByName: row.createdBy?.fullName ?? null
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 500).json({ error: err.message });
  }
});

dailyAttendanceRouter.put("/:date", requirePermission("productivity.write"), async (req: AuthedRequest, res) => {
  const dateParsed = dateParamSchema.safeParse(req.params.date);
  if (!dateParsed.success) return res.status(400).json({ error: "Invalid date" });
  const parsed = saveBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  try {
    await assertScope(req, parsed.data.warehouseId, parsed.data.section);
    const workDate = parseIsoDate(dateParsed.data);
    const existing = await prisma.dailyAttendanceSheet.findUnique({
      where: {
        warehouseId_section_workDate: {
          warehouseId: parsed.data.warehouseId,
          section: parsed.data.section,
          workDate
        }
      }
    });
    const data = {
      objectTitle: parsed.data.objectTitle.trim(),
      blocks: parsed.data.blocks
    };
    const row = existing
      ? await prisma.dailyAttendanceSheet.update({
          where: { id: existing.id },
          data,
          include: { createdBy: { select: { fullName: true } } }
        })
      : await prisma.dailyAttendanceSheet.create({
          data: {
            warehouseId: parsed.data.warehouseId,
            section: parsed.data.section,
            workDate,
            ...data,
            createdById: req.user!.userId
          },
          include: { createdBy: { select: { fullName: true } } }
        });
    return res.json({
      ...mapRow(row),
      blocks: parseDailyAttendanceBlocks(row.blocks)
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 500).json({ error: err.message });
  }
});
