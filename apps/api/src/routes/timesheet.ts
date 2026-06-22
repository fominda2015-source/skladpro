import { Router } from "express";
import { z } from "zod";
import { assertWarehouseInScope, getRequestDataScope } from "../lib/dataScope.js";
import { buildTimesheetContext } from "../lib/timesheetContext.js";
import {
  buildTimesheetFileName,
  buildTimesheetWorkbook,
  type TimesheetExportInput
} from "../lib/timesheetExport.js";
import { contentDispositionAttachment } from "../lib/xlsxReport.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

export const timesheetRouter = Router();
timesheetRouter.use(requireAuth);
timesheetRouter.use(requirePermission("timesheet.read"));

const warehouseQuerySchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]).default("SS"),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional()
});

const markValueSchema = z.union([z.string(), z.number(), z.null()]);

const exportSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]).default("SS"),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  organization: z.string().min(1).optional(),
  department: z.string().min(1).optional(),
  objectName: z.string().min(1).optional(),
  compileDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  responsibleTitle: z.string().optional(),
  responsibleName: z.string().optional(),
  employees: z
    .array(
      z.object({
        fullName: z.string().min(1),
        position: z.string().optional(),
        hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        marks: z.record(z.string(), markValueSchema).default({})
      })
    )
    .min(1)
});

async function assertTimesheetWarehouse(req: AuthedRequest, warehouseId: string) {
  const scope = await getRequestDataScope(req);
  assertWarehouseInScope(scope, warehouseId);
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

timesheetRouter.get("/context", async (req: AuthedRequest, res) => {
  const parsed = warehouseQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  try {
    await assertTimesheetWarehouse(req, parsed.data.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 403).json({ error: err.message || "Forbidden" });
  }

  try {
    const context = await buildTimesheetContext({
      warehouseId: parsed.data.warehouseId,
      section: parsed.data.section,
      month: parsed.data.month || currentMonth(),
      userId: req.user!.userId
    });
    return res.json(context);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "WAREHOUSE_NOT_FOUND") {
      return res.status(404).json({ error: "Объект не найден" });
    }
    throw e;
  }
});

timesheetRouter.get("/staff", async (req: AuthedRequest, res) => {
  const parsed = warehouseQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }

  try {
    await assertTimesheetWarehouse(req, parsed.data.warehouseId);
    const context = await buildTimesheetContext({
      warehouseId: parsed.data.warehouseId,
      section: parsed.data.section,
      month: parsed.data.month || currentMonth(),
      userId: req.user!.userId
    });
    return res.json(context.staff);
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 403).json({ error: err.message || "Forbidden" });
  }
});

timesheetRouter.post("/export", async (req: AuthedRequest, res) => {
  const parsed = exportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  try {
    await assertTimesheetWarehouse(req, parsed.data.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 403).json({ error: err.message || "Forbidden" });
  }

  const defaults = await buildTimesheetContext({
    warehouseId: parsed.data.warehouseId,
    section: parsed.data.section,
    month: parsed.data.month,
    userId: req.user!.userId
  });

  const payload: TimesheetExportInput = {
    organization: parsed.data.organization || defaults.organization,
    department: parsed.data.department || defaults.department,
    objectName: parsed.data.objectName || defaults.objectName,
    sheetLabel: defaults.sheetLabel,
    periodFrom: parsed.data.periodFrom || defaults.periodFrom,
    periodTo: parsed.data.periodTo || defaults.periodTo,
    compileDate: parsed.data.compileDate || defaults.compileDate,
    responsibleTitle: parsed.data.responsibleTitle || defaults.responsibleTitle,
    responsibleName: parsed.data.responsibleName || defaults.responsibleName,
    employees: parsed.data.employees
  };

  if (payload.periodFrom > payload.periodTo) {
    return res.status(400).json({ error: "periodFrom must be <= periodTo" });
  }

  try {
    const buf = await buildTimesheetWorkbook(payload);
    const fileName = buildTimesheetFileName(payload);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", contentDispositionAttachment(fileName));
    return res.send(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "EMPTY_PERIOD") {
      return res.status(400).json({ error: "Укажите корректный отчётный период" });
    }
    throw e;
  }
});
