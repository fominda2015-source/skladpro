import { Router } from "express";
import { z } from "zod";
import { assertWarehouseInScope, getRequestDataScope } from "../lib/dataScope.js";
import { buildTimesheetContext, listPeriodDays, listTimesheetStaff } from "../lib/timesheetContext.js";
import {
  buildTimesheetFileName,
  buildTimesheetWorkbook,
  type TimesheetExportInput,
  type TimesheetEmployeeInput
} from "../lib/timesheetExport.js";
import { contentDispositionAttachment } from "../lib/xlsxReport.js";
import { prisma } from "../lib/prisma.js";
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
    .optional()
});

const draftSaveSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  fullName: z.string().min(1),
  position: z.string().optional(),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  marks: z.record(z.string(), markValueSchema).default({})
});

const closeMonthSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  organization: z.string().optional(),
  department: z.string().optional(),
  objectName: z.string().optional()
});

async function assertTimesheetWarehouse(req: AuthedRequest, warehouseId: string) {
  const scope = await getRequestDataScope(req);
  assertWarehouseInScope(scope, warehouseId);
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function isWeekend(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(y, (m || 1) - 1, d || 1).getDay();
  return day === 0 || day === 6;
}

function defaultMarks(days: string[]): Record<string, string> {
  return Object.fromEntries(days.map((iso) => [iso, isWeekend(iso) ? "н" : "8"]));
}

async function getMonthArchive(warehouseId: string, section: "SS" | "EOM", month: string) {
  return prisma.timesheetMonthArchive.findUnique({
    where: { warehouseId_section_month: { warehouseId, section, month } }
  });
}

async function buildExportPayload(
  warehouseId: string,
  section: "SS" | "EOM",
  month: string,
  userId: string,
  overrides?: Partial<TimesheetExportInput>
): Promise<TimesheetExportInput> {
  const defaults = await buildTimesheetContext({ warehouseId, section, month, userId });
  const drafts = await prisma.timesheetEmployeeDraft.findMany({
    where: { warehouseId, section, month }
  });
  const draftByStaff = new Map(drafts.map((d) => [d.staffUserId, d]));
  const staff = await listTimesheetStaff(warehouseId);
  const days = listPeriodDays(defaults.periodFrom, defaults.periodTo);

  const employees: TimesheetEmployeeInput[] = staff
    .map((s) => {
      const draft = draftByStaff.get(s.id);
      if (draft) {
        return {
          fullName: draft.fullName,
          position: draft.position || undefined,
          hireDate: draft.hireDate || undefined,
          marks: (draft.marks as Record<string, string | number | null>) || {}
        };
      }
      return {
        fullName: s.fullName,
        position: s.position || undefined,
        hireDate: s.hireDate || undefined,
        marks: defaultMarks(days)
      };
    })
    .filter((e) => e.fullName.trim());

  return {
    organization: overrides?.organization || defaults.organization,
    department: overrides?.department || defaults.department,
    objectName: overrides?.objectName || defaults.objectName,
    sheetLabel: defaults.sheetLabel,
    periodFrom: overrides?.periodFrom || defaults.periodFrom,
    periodTo: overrides?.periodTo || defaults.periodTo,
    compileDate: overrides?.compileDate || defaults.compileDate,
    responsibleTitle: overrides?.responsibleTitle || defaults.responsibleTitle,
    responsibleName: overrides?.responsibleName || defaults.responsibleName,
    employees: overrides?.employees?.length ? overrides.employees : employees
  };
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
    const month = parsed.data.month || currentMonth();
    const archive = await getMonthArchive(parsed.data.warehouseId, parsed.data.section, month);
    return res.json({ ...context, isClosed: Boolean(archive), archiveId: archive?.id ?? null });
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

timesheetRouter.get("/employees", async (req: AuthedRequest, res) => {
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
  const month = parsed.data.month || currentMonth();
  const [staff, drafts, archive] = await Promise.all([
    listTimesheetStaff(parsed.data.warehouseId),
    prisma.timesheetEmployeeDraft.findMany({
      where: {
        warehouseId: parsed.data.warehouseId,
        section: parsed.data.section,
        month
      },
      select: { staffUserId: true, updatedAt: true, fullName: true }
    }),
    getMonthArchive(parsed.data.warehouseId, parsed.data.section, month)
  ]);
  const draftMap = new Map(drafts.map((d) => [d.staffUserId, d]));
  return res.json({
    month,
    isClosed: Boolean(archive),
    employees: staff.map((s) => {
      const d = draftMap.get(s.id);
      return {
        id: s.id,
        fullName: d?.fullName || s.fullName,
        position: s.position,
        hireDate: s.hireDate,
        hasDraft: Boolean(d),
        draftUpdatedAt: d?.updatedAt.toISOString() ?? null
      };
    })
  });
});

timesheetRouter.get("/draft/:staffUserId", async (req: AuthedRequest, res) => {
  const parsed = warehouseQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }
  const staffUserId = String(req.params.staffUserId);
  try {
    await assertTimesheetWarehouse(req, parsed.data.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 403).json({ error: err.message || "Forbidden" });
  }
  const month = parsed.data.month || currentMonth();
  const archive = await getMonthArchive(parsed.data.warehouseId, parsed.data.section, month);
  if (archive) {
    const payload = archive.payload as {
      employees?: Array<{
        staffUserId?: string;
        fullName: string;
        position?: string;
        hireDate?: string;
        marks?: Record<string, string>;
      }>;
    };
    const emp = payload.employees?.find((e) => e.staffUserId === staffUserId);
    if (!emp) return res.status(404).json({ error: "Сотрудник не найден в архиве" });
    return res.json({ readOnly: true, ...emp, staffUserId, month });
  }
  const context = await buildTimesheetContext({
    warehouseId: parsed.data.warehouseId,
    section: parsed.data.section,
    month,
    userId: req.user!.userId
  });
  const staff = context.staff.find((s) => s.id === staffUserId);
  if (!staff) return res.status(404).json({ error: "Сотрудник не найден" });
  const draft = await prisma.timesheetEmployeeDraft.findUnique({
    where: {
      warehouseId_section_month_staffUserId: {
        warehouseId: parsed.data.warehouseId,
        section: parsed.data.section,
        month,
        staffUserId
      }
    }
  });
  if (draft) {
    return res.json({
      readOnly: false,
      staffUserId,
      month,
      fullName: draft.fullName,
      position: draft.position,
      hireDate: draft.hireDate,
      marks: draft.marks,
      updatedAt: draft.updatedAt.toISOString()
    });
  }
  return res.json({
    readOnly: false,
    staffUserId,
    month,
    fullName: staff.fullName,
    position: staff.position,
    hireDate: staff.hireDate,
    marks: defaultMarks(context.days),
    updatedAt: null
  });
});

timesheetRouter.put("/draft/:staffUserId", requirePermission("timesheet.write"), async (req: AuthedRequest, res) => {
  const staffUserId = String(req.params.staffUserId);
  const parsed = draftSaveSchema.safeParse({ ...req.body, staffUserId });
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    await assertTimesheetWarehouse(req, parsed.data.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 403).json({ error: err.message || "Forbidden" });
  }
  const archive = await getMonthArchive(parsed.data.warehouseId, parsed.data.section, parsed.data.month);
  if (archive) return res.status(409).json({ error: "Месяц уже закрыт" });
  const draft = await prisma.timesheetEmployeeDraft.upsert({
    where: {
      warehouseId_section_month_staffUserId: {
        warehouseId: parsed.data.warehouseId,
        section: parsed.data.section,
        month: parsed.data.month,
        staffUserId
      }
    },
    create: {
      warehouseId: parsed.data.warehouseId,
      section: parsed.data.section,
      month: parsed.data.month,
      staffUserId,
      fullName: parsed.data.fullName.trim(),
      position: parsed.data.position?.trim() || "",
      hireDate: parsed.data.hireDate || null,
      marks: parsed.data.marks,
      savedById: req.user!.userId
    },
    update: {
      fullName: parsed.data.fullName.trim(),
      position: parsed.data.position?.trim() || "",
      hireDate: parsed.data.hireDate || null,
      marks: parsed.data.marks,
      savedById: req.user!.userId
    }
  });
  return res.json({
    staffUserId,
    fullName: draft.fullName,
    position: draft.position,
    hireDate: draft.hireDate,
    marks: draft.marks,
    updatedAt: draft.updatedAt.toISOString()
  });
});

timesheetRouter.get("/archives", async (req: AuthedRequest, res) => {
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
  const rows = await prisma.timesheetMonthArchive.findMany({
    where: { warehouseId: parsed.data.warehouseId, section: parsed.data.section },
    orderBy: { month: "desc" },
    include: { closedBy: { select: { fullName: true } } }
  });
  return res.json(
    rows.map((r) => ({
      id: r.id,
      month: r.month,
      closedAt: r.closedAt.toISOString(),
      closedByName: r.closedBy?.fullName ?? null
    }))
  );
});

timesheetRouter.post("/close-month", requirePermission("timesheet.write"), async (req: AuthedRequest, res) => {
  const parsed = closeMonthSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    await assertTimesheetWarehouse(req, parsed.data.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 403).json({ error: err.message || "Forbidden" });
  }
  const existing = await getMonthArchive(parsed.data.warehouseId, parsed.data.section, parsed.data.month);
  if (existing) return res.status(409).json({ error: "Месяц уже закрыт" });
  const staff = await listTimesheetStaff(parsed.data.warehouseId);
  const drafts = await prisma.timesheetEmployeeDraft.findMany({
    where: {
      warehouseId: parsed.data.warehouseId,
      section: parsed.data.section,
      month: parsed.data.month
    }
  });
  const draftIds = new Set(drafts.map((d) => d.staffUserId));
  const unsaved = staff.filter((s) => !draftIds.has(s.id)).map((s) => s.fullName);
  const context = await buildTimesheetContext({
    warehouseId: parsed.data.warehouseId,
    section: parsed.data.section,
    month: parsed.data.month,
    userId: req.user!.userId
  });
  const days = listPeriodDays(context.periodFrom, context.periodTo);
  const draftByStaff = new Map(drafts.map((d) => [d.staffUserId, d]));
  const archivePayload = {
    organization: parsed.data.organization || context.organization,
    department: parsed.data.department || context.department,
    objectName: parsed.data.objectName || context.objectName,
    sheetLabel: context.sheetLabel,
    periodFrom: context.periodFrom,
    periodTo: context.periodTo,
    compileDate: context.compileDate,
    responsibleTitle: context.responsibleTitle,
    responsibleName: context.responsibleName,
    employees: staff.map((s) => {
      const draft = draftByStaff.get(s.id);
      return {
        staffUserId: s.id,
        fullName: draft?.fullName || s.fullName,
        position: draft?.position || s.position || undefined,
        hireDate: draft?.hireDate || s.hireDate || undefined,
        marks: (draft?.marks as Record<string, string | number | null>) || defaultMarks(days)
      };
    })
  };
  const archive = await prisma.timesheetMonthArchive.create({
    data: {
      warehouseId: parsed.data.warehouseId,
      section: parsed.data.section,
      month: parsed.data.month,
      payload: archivePayload,
      closedById: req.user!.userId
    }
  });
  return res.json({ id: archive.id, month: archive.month, unsavedEmployeeNames: unsaved });
});

timesheetRouter.get("/archives/:month/export", async (req: AuthedRequest, res) => {
  const month = String(req.params.month);
  if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: "Invalid month" });
  const parsed = warehouseQuerySchema.safeParse({ ...req.query, month });
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
  }
  try {
    await assertTimesheetWarehouse(req, parsed.data.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    return res.status(err.status || 403).json({ error: err.message || "Forbidden" });
  }
  const archive = await getMonthArchive(parsed.data.warehouseId, parsed.data.section, month);
  if (!archive) return res.status(404).json({ error: "Архив не найден" });
  const payload = archive.payload as TimesheetExportInput;
  const buf = await buildTimesheetWorkbook(payload);
  const fileName = buildTimesheetFileName(payload);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", contentDispositionAttachment(fileName));
  return res.send(buf);
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

  const payload: TimesheetExportInput = parsed.data.employees?.length
    ? {
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
      }
    : await buildExportPayload(parsed.data.warehouseId, parsed.data.section, parsed.data.month, req.user!.userId, {
        organization: parsed.data.organization,
        department: parsed.data.department,
        objectName: parsed.data.objectName,
        periodFrom: parsed.data.periodFrom,
        periodTo: parsed.data.periodTo,
        compileDate: parsed.data.compileDate,
        responsibleTitle: parsed.data.responsibleTitle,
        responsibleName: parsed.data.responsibleName
      });

  if (!payload.employees.length) {
    return res.status(400).json({ error: "Нет сотрудников для выгрузки" });
  }

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
