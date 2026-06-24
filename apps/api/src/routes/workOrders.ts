import { Router } from "express";
import { z } from "zod";
import { assertObjectSectionInScope, getRequestDataScope } from "../lib/dataScope.js";
import {
  buildWorkOrderObjectTitle,
  loadFieldDocWarehouse,
  loadUserShortName,
  parseIsoDate,
  parseWorkOrderRows,
  type WorkOrderRow
} from "../lib/fieldDocs.js";
import { buildWorkOrderFileName, buildWorkOrderWorkbook } from "../lib/workOrderExport.js";
import { contentDispositionAttachment } from "../lib/xlsxReport.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

export const workOrdersRouter = Router();
workOrdersRouter.use(requireAuth);
workOrdersRouter.use(requirePermission("productivity.read"));

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

const workOrderRowSchema = z.object({
  place: z.string().default(""),
  workAssigned: z.string().default(""),
  peoplePlan: z.union([z.number(), z.string(), z.null()]).optional(),
  peopleFact: z.union([z.number(), z.string(), z.null()]).optional(),
  workDone: z.string().optional(),
  status: z.string().optional(),
  volumePlan: z.string().optional(),
  volumeFact: z.string().optional(),
  note: z.string().optional()
});

const saveBodySchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  objectTitle: z.string().min(1).max(4000),
  foremanName: z.string().max(500).default(""),
  rows: z.array(workOrderRowSchema).max(6).default([]),
  completedWorksNote: z.string().max(8000).default("")
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
  foremanName: string;
  updatedAt: Date;
  createdBy: { fullName: string } | null;
  updatedBy: { fullName: string } | null;
}) {
  return {
    id: row.id,
    workDate: row.workDate.toISOString().slice(0, 10),
    objectTitle: row.objectTitle,
    foremanName: row.foremanName,
    updatedAt: row.updatedAt.toISOString(),
    createdByName: row.createdBy?.fullName ?? null,
    updatedByName: row.updatedBy?.fullName ?? null
  };
}

workOrdersRouter.get("/context", async (req: AuthedRequest, res) => {
  const parsed = scopeQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  try {
    await assertScope(req, parsed.data.warehouseId, parsed.data.section);
    const warehouse = await loadFieldDocWarehouse(parsed.data.warehouseId);
    const userName = await loadUserShortName(req.user!.userId);
    const today = new Date().toISOString().slice(0, 10);
    return res.json({
      workDate: today,
      userShortName: userName,
      objectTitle: buildWorkOrderObjectTitle(warehouse, parsed.data.section),
      warehouseName: warehouse.name
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 500).json({ error: err.message });
  }
});

workOrdersRouter.get("/", async (req: AuthedRequest, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  try {
    await assertScope(req, parsed.data.warehouseId, parsed.data.section);
    const rows = await prisma.workOrderSheet.findMany({
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
      include: {
        createdBy: { select: { fullName: true } },
        updatedBy: { select: { fullName: true } }
      }
    });
    return res.json(rows.map(mapRow));
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 500).json({ error: err.message });
  }
});

workOrdersRouter.get("/:date/export", async (req: AuthedRequest, res) => {
  const dateParsed = dateParamSchema.safeParse(req.params.date);
  if (!dateParsed.success) return res.status(400).json({ error: "Invalid date" });
  const q = scopeQuerySchema.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "Invalid query", details: q.error.flatten() });
  try {
    await assertScope(req, q.data.warehouseId, q.data.section);
    const row = await prisma.workOrderSheet.findUnique({
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
      foremanName: row.foremanName,
      responsibleItrName: row.responsibleItrName,
      composedByItrName: row.composedByItrName,
      rows: parseWorkOrderRows(row.rows) as WorkOrderRow[],
      completedWorksNote: row.completedWorksNote
    };
    const buf = await buildWorkOrderWorkbook(input);
    const fileName = buildWorkOrderFileName(input);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", contentDispositionAttachment(fileName));
    return res.send(buf);
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 500).json({ error: err.message });
  }
});

workOrdersRouter.get("/:date", async (req: AuthedRequest, res) => {
  const dateParsed = dateParamSchema.safeParse(req.params.date);
  if (!dateParsed.success) return res.status(400).json({ error: "Invalid date" });
  const q = scopeQuerySchema.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "Invalid query", details: q.error.flatten() });
  try {
    await assertScope(req, q.data.warehouseId, q.data.section);
    const row = await prisma.workOrderSheet.findUnique({
      where: {
        warehouseId_section_workDate: {
          warehouseId: q.data.warehouseId,
          section: q.data.section,
          workDate: parseIsoDate(dateParsed.data)
        }
      },
      include: {
        createdBy: { select: { fullName: true } },
        updatedBy: { select: { fullName: true } }
      }
    });
    if (!row) {
      const warehouse = await loadFieldDocWarehouse(q.data.warehouseId);
      const userName = await loadUserShortName(req.user!.userId);
      return res.json({
        exists: false,
        workDate: dateParsed.data,
        objectTitle: buildWorkOrderObjectTitle(warehouse, q.data.section),
        foremanName: "",
        responsibleItrName: userName,
        composedByItrName: userName,
        rows: [] as WorkOrderRow[],
        completedWorksNote: ""
      });
    }
    return res.json({
      exists: true,
      id: row.id,
      workDate: dateParsed.data,
      objectTitle: row.objectTitle,
      foremanName: row.foremanName,
      responsibleItrName: row.responsibleItrName,
      composedByItrName: row.composedByItrName,
      rows: parseWorkOrderRows(row.rows),
      completedWorksNote: row.completedWorksNote,
      updatedAt: row.updatedAt.toISOString(),
      createdByName: row.createdBy?.fullName ?? null,
      updatedByName: row.updatedBy?.fullName ?? null
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 500).json({ error: err.message });
  }
});

workOrdersRouter.put("/:date", requirePermission("productivity.write"), async (req: AuthedRequest, res) => {
  const dateParsed = dateParamSchema.safeParse(req.params.date);
  if (!dateParsed.success) return res.status(400).json({ error: "Invalid date" });
  const parsed = saveBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  try {
    await assertScope(req, parsed.data.warehouseId, parsed.data.section);
    const userName = await loadUserShortName(req.user!.userId);
    const workDate = parseIsoDate(dateParsed.data);
    const existing = await prisma.workOrderSheet.findUnique({
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
      foremanName: parsed.data.foremanName.trim(),
      responsibleItrName: userName,
      composedByItrName: userName,
      rows: parsed.data.rows,
      completedWorksNote: parsed.data.completedWorksNote.trim(),
      updatedById: req.user!.userId
    };
    const row = existing
      ? await prisma.workOrderSheet.update({
          where: { id: existing.id },
          data,
          include: {
            createdBy: { select: { fullName: true } },
            updatedBy: { select: { fullName: true } }
          }
        })
      : await prisma.workOrderSheet.create({
          data: {
            warehouseId: parsed.data.warehouseId,
            section: parsed.data.section,
            workDate,
            ...data,
            createdById: req.user!.userId
          },
          include: {
            createdBy: { select: { fullName: true } },
            updatedBy: { select: { fullName: true } }
          }
        });
    return res.json({
      ...mapRow(row),
      rows: parseWorkOrderRows(row.rows),
      responsibleItrName: row.responsibleItrName,
      composedByItrName: row.composedByItrName,
      completedWorksNote: row.completedWorksNote
    });
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 500).json({ error: err.message });
  }
});
