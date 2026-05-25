import type { Prisma } from "@prisma/client";
import { ToolStatus } from "@prisma/client";
import { Router } from "express";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { z } from "zod";
import { recordAudit } from "../lib/audit.js";
import {
  assertProjectInScope,
  assertWarehouseInScope,
  getRequestDataScope,
  toolWhereFromScope,
  warehouseWhereFromScope
} from "../lib/dataScope.js";
import { handlePrismaError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createToolSchema = z.object({
  name: z.string().min(1),
  inventoryNumber: z.string().min(1),
  serialNumber: z.string().optional(),
  warehouseId: z.string().optional(),
  section: z.enum(["SS", "EOM"]).default("SS"),
  projectId: z.string().optional(),
  responsible: z.string().optional(),
  note: z.string().optional(),
  categoryId: z.string().nullable().optional()
});

const updateToolSchema = z.object({
  name: z.string().min(1).optional(),
  serialNumber: z.string().optional(),
  warehouseId: z.string().nullable().optional(),
  section: z.enum(["SS", "EOM"]).optional(),
  projectId: z.string().nullable().optional(),
  responsible: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  status: z.nativeEnum(ToolStatus).optional(),
  categoryId: z.string().nullable().optional()
});

const toolCategorySchema = z.object({
  name: z.string().min(1).max(120),
  icon: z.string().max(40).nullable().optional(),
  order: z.coerce.number().int().min(0).max(9999).optional()
});
const toolActionSchema = z.object({
  action: z.enum(["ISSUE", "RETURN", "SEND_TO_REPAIR", "MARK_DAMAGED", "MARK_LOST", "MARK_DISPUTED", "WRITE_OFF"]),
  comment: z.string().optional(),
  responsible: z.string().optional()
});

const nextStatusByAction: Record<z.infer<typeof toolActionSchema>["action"], ToolStatus> = {
  ISSUE: ToolStatus.ISSUED,
  RETURN: ToolStatus.IN_STOCK,
  SEND_TO_REPAIR: ToolStatus.IN_REPAIR,
  MARK_DAMAGED: ToolStatus.DAMAGED,
  MARK_LOST: ToolStatus.LOST,
  MARK_DISPUTED: ToolStatus.DISPUTED,
  WRITE_OFF: ToolStatus.WRITTEN_OFF
};

function buildQrCode(inventoryNumber: string) {
  return `TOOL:${inventoryNumber}`;
}

export const toolsRouter = Router();
toolsRouter.use(requireAuth);
toolsRouter.use(requirePermission("tools.read"));

// --- Категории инструмента (карточный вид) ---
toolsRouter.get("/categories", async (_req, res) => {
  const cats = await prisma.toolCategory.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] });
  return res.json(cats);
});

toolsRouter.post("/categories", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const parsed = toolCategorySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    const created = await prisma.toolCategory.create({
      data: {
        name: parsed.data.name.trim(),
        icon: parsed.data.icon || null,
        order: parsed.data.order ?? 0
      }
    });
    return res.status(201).json(created);
  } catch (error) {
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.patch("/categories/:id", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const parsed = toolCategorySchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    const updated = await prisma.toolCategory.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ...(parsed.data.icon !== undefined ? { icon: parsed.data.icon || null } : {}),
        ...(parsed.data.order !== undefined ? { order: parsed.data.order } : {})
      }
    });
    return res.json(updated);
  } catch (error) {
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.delete("/categories/:id", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  try {
    await prisma.tool.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
    await prisma.toolCategory.delete({ where: { id } });
    return res.status(204).send();
  } catch (error) {
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

// Группировка инструментов по категориям: если categoryId задан — берём категорию,
// иначе группируем по полю name. Возвращаем массив «карточек».
toolsRouter.get("/by-category", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const scopedToolFilter = toolWhereFromScope(scope);
  const warehouseIdParam = typeof req.query.warehouseId === "string" ? req.query.warehouseId.trim() : "";
  const sectionParam = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section: "SS" | "EOM" | undefined = sectionParam === "SS" || sectionParam === "EOM" ? sectionParam : undefined;
  try {
    if (warehouseIdParam) assertWarehouseInScope(scope, warehouseIdParam);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  const baseWhere: Prisma.ToolWhereInput = {
    AND: [
      scopedToolFilter,
      {
        ...(warehouseIdParam ? { warehouseId: warehouseIdParam } : {}),
        ...(section ? { section } : {})
      }
    ]
  };
  const [tools, categories] = await Promise.all([
    prisma.tool.findMany({
      where: baseWhere,
      select: { id: true, name: true, categoryId: true, status: true }
    }),
    prisma.toolCategory.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] })
  ]);
  type Card = {
    key: string;
    label: string;
    type: "CATEGORY" | "NAME";
    categoryId: string | null;
    icon: string | null;
    count: number;
    inStock: number;
    issued: number;
    inRepair: number;
  };
  const cardsByKey = new Map<string, Card>();
  const ensureCard = (key: string, label: string, type: Card["type"], categoryId: string | null, icon: string | null) => {
    let c = cardsByKey.get(key);
    if (!c) {
      c = { key, label, type, categoryId, icon, count: 0, inStock: 0, issued: 0, inRepair: 0 };
      cardsByKey.set(key, c);
    }
    return c;
  };
  const catById = new Map(categories.map((c) => [c.id, c]));
  for (const cat of categories) {
    ensureCard(`cat:${cat.id}`, cat.name, "CATEGORY", cat.id, cat.icon);
  }
  for (const t of tools) {
    let card: Card;
    if (t.categoryId && catById.has(t.categoryId)) {
      const cat = catById.get(t.categoryId)!;
      card = ensureCard(`cat:${cat.id}`, cat.name, "CATEGORY", cat.id, cat.icon);
    } else {
      const nameKey = (t.name || "Без названия").trim() || "Без названия";
      card = ensureCard(`name:${nameKey.toLowerCase()}`, nameKey, "NAME", null, null);
    }
    card.count += 1;
    if (t.status === ToolStatus.IN_STOCK) card.inStock += 1;
    else if (t.status === ToolStatus.ISSUED) card.issued += 1;
    else if (t.status === ToolStatus.IN_REPAIR) card.inRepair += 1;
  }
  const list = Array.from(cardsByKey.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === "CATEGORY" ? -1 : 1;
    return b.count - a.count || a.label.localeCompare(b.label, "ru");
  });
  return res.json(list);
});

toolsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const warehouseIdParam = typeof req.query.warehouseId === "string" ? req.query.warehouseId.trim() : "";
  try {
    if (warehouseIdParam) {
      assertWarehouseInScope(scope, warehouseIdParam);
    }
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  const pageRaw = Number(req.query.page);
  const pageSizeRaw = Number(req.query.pageSize);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(150, Math.max(1, Math.floor(pageSizeRaw))) : 20;
  const sort =
    typeof req.query.sort === "string" && ["created_desc", "inventory", "status"].includes(req.query.sort)
      ? req.query.sort
      : "created_desc";
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const sectionParam = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section: "SS" | "EOM" | undefined = sectionParam === "SS" || sectionParam === "EOM" ? sectionParam : undefined;
  const status =
    typeof req.query.status === "string" && Object.values(ToolStatus).includes(req.query.status as ToolStatus)
      ? (req.query.status as ToolStatus)
      : undefined;
  const categoryIdParam = typeof req.query.categoryId === "string" ? req.query.categoryId.trim() : "";
  const nameGroupParam = typeof req.query.nameGroup === "string" ? req.query.nameGroup.trim() : "";
  const where = {
    AND: [
      toolWhereFromScope(scope),
      {
        ...(warehouseIdParam ? { warehouseId: warehouseIdParam } : {}),
        ...(status ? { status } : {}),
        ...(section ? { section } : {}),
        ...(categoryIdParam ? { categoryId: categoryIdParam } : {}),
        ...(nameGroupParam
          ? { categoryId: null, name: { equals: nameGroupParam, mode: "insensitive" as const } }
          : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { inventoryNumber: { contains: q, mode: "insensitive" as const } },
                { serialNumber: { contains: q, mode: "insensitive" as const } },
                { qrCode: { contains: q, mode: "insensitive" as const } }
              ]
            }
          : {})
      }
    ]
  };
  const [total, rows] = await prisma.$transaction([
    prisma.tool.count({ where }),
    prisma.tool.findMany({
      where,
      include: {
        warehouse: true,
        project: true
      },
      orderBy:
        sort === "status"
          ? { status: "asc" }
          : sort === "inventory"
            ? { inventoryNumber: "asc" }
            : { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  return res.json({
    items: rows,
    total,
    page,
    pageSize
  });
});

/** Агрегат карточек инструмента по складу — для «среза по объектам». */
toolsRouter.get("/summary/by-warehouse", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const scopedToolFilter = toolWhereFromScope(scope);
  const toolScopeWhere: Prisma.ToolWhereInput =
    Object.keys(scopedToolFilter).length > 0 ? scopedToolFilter : {};
  const grouped = await prisma.tool.groupBy({
    by: ["warehouseId"],
    where: toolScopeWhere,
    _count: { _all: true }
  });
  const whWhere = warehouseWhereFromScope(scope);
  const warehouses = await prisma.warehouse.findMany({
    ...(Object.keys(whWhere).length ? { where: whWhere } : {}),
    select: { id: true, name: true }
  });
  const nameById = new Map(warehouses.map((w) => [w.id, w.name]));

  type Row = {
    warehouseId: string | null;
    warehouseName: string;
    count: number;
    inStock: number;
    issued: number;
  };
  const rows: Row[] = grouped.map((g) => {
    const wid = g.warehouseId;
    const warehouseName = wid ? (nameById.get(wid) ?? "Объект") : "Без объекта";
    return {
      warehouseId: wid,
      warehouseName,
      count: g._count._all,
      inStock: 0,
      issued: 0
    };
  });

  for (const r of rows) {
    const whFilter: Prisma.ToolWhereInput =
      r.warehouseId === null ? { warehouseId: null } : { warehouseId: r.warehouseId };
    const baseWhere: Prisma.ToolWhereInput =
      Object.keys(toolScopeWhere).length > 0 ? { AND: [toolScopeWhere, whFilter] } : whFilter;
    const [inStock, issued] = await Promise.all([
      prisma.tool.count({ where: { ...baseWhere, status: ToolStatus.IN_STOCK } }),
      prisma.tool.count({ where: { ...baseWhere, status: ToolStatus.ISSUED } })
    ]);
    r.inStock = inStock;
    r.issued = issued;
  }

  rows.sort((a, b) => b.count - a.count);
  return res.json(rows);
});

toolsRouter.post("/", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const parsed = createToolSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    const scope = await getRequestDataScope(req);
    if (parsed.data.warehouseId) {
      assertWarehouseInScope(scope, parsed.data.warehouseId);
    }
    assertProjectInScope(scope, parsed.data.projectId);
    const qrCode = buildQrCode(parsed.data.inventoryNumber);
    const created = await prisma.tool.create({
      data: {
        ...parsed.data,
        qrCode
      },
      include: { events: true }
    });
    await prisma.toolEvent.create({
      data: {
        toolId: created.id,
        action: "CREATE",
        status: created.status
      }
    });
    await recordAudit({
      userId: req.user!.userId,
      action: "TOOL_CREATE",
      entityType: "Tool",
      entityId: created.id,
      summary: `Создан инструмент: ${created.name}${created.inventoryNumber ? ` (инв. ${created.inventoryNumber})` : ""}`,
      after: { id: created.id, name: created.name, inventoryNumber: created.inventoryNumber, status: created.status }
    });
    return res.status(201).json(created);
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status === 403) {
      return res.status(403).json({ error: err.message });
    }
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.patch("/:id", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const parsed = updateToolSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    const scope = await getRequestDataScope(req);
    if (typeof parsed.data.warehouseId === "string") {
      assertWarehouseInScope(scope, parsed.data.warehouseId);
    }
    if (typeof parsed.data.projectId === "string") {
      assertProjectInScope(scope, parsed.data.projectId);
    }
    const existing = await prisma.tool.findFirst({
      where: { AND: [toolWhereFromScope(scope), { id: String(req.params.id) }] }
    });
    if (!existing) {
      return res.status(404).json({ error: "Tool not found" });
    }
    const updated = await prisma.tool.update({
      where: { id: String(req.params.id) },
      data: parsed.data
    });
    return res.json(updated);
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status === 403) {
      return res.status(403).json({ error: err.message });
    }
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.post("/:id/action", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const parsed = toolActionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  if (parsed.data.action === "ISSUE" && !parsed.data.responsible?.trim()) {
    return res.status(400).json({ error: "responsible is required for ISSUE" });
  }
  const id = String(req.params.id);
  const nextStatus = nextStatusByAction[parsed.data.action];
  const scope = await getRequestDataScope(req);
  const beforeTool = await prisma.tool.findFirst({
    where: { AND: [toolWhereFromScope(scope), { id }] }
  });
  if (!beforeTool) {
    return res.status(404).json({ error: "Tool not found" });
  }
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const tool = await tx.tool.update({
        where: { id },
        data: {
          status: nextStatus,
          ...(parsed.data.action === "ISSUE" ? { responsible: parsed.data.responsible?.trim() } : {}),
          ...(parsed.data.action === "RETURN" ? { responsible: null } : {})
        }
      });
      await tx.toolEvent.create({
        data: {
          toolId: id,
          action: parsed.data.action,
          status: nextStatus,
          actorId: req.user!.userId,
          comment:
            parsed.data.action === "ISSUE"
              ? `Responsible: ${parsed.data.responsible?.trim()}${parsed.data.comment ? `; ${parsed.data.comment}` : ""}`
              : parsed.data.comment
        }
      });
      return tool;
    });
    const actionRu: Record<string, string> = {
      ISSUE: "выдан",
      RETURN: "возвращён",
      SEND_TO_REPAIR: "отправлен в ремонт",
      MARK_DAMAGED: "помечен повреждённым",
      MARK_LOST: "помечен утерянным",
      MARK_DISPUTED: "помечен спорным",
      WRITE_OFF: "списан"
    };
    await recordAudit({
      userId: req.user!.userId,
      action: `TOOL_${parsed.data.action}`,
      entityType: "Tool",
      entityId: id,
      summary: `Инструмент ${beforeTool.name}${beforeTool.inventoryNumber ? ` (инв. ${beforeTool.inventoryNumber})` : ""} — ${actionRu[parsed.data.action] || parsed.data.action.toLowerCase()}`,
      before: { status: beforeTool.status, responsible: beforeTool.responsible },
      after: { status: updated.status, responsible: updated.responsible }
    });
    return res.json(updated);
  } catch (error) {
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.get("/:id", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const scope = await getRequestDataScope(req);
  const tool = await prisma.tool.findFirst({
    where: { AND: [toolWhereFromScope(scope), { id }] },
    include: { warehouse: true, project: true }
  });
  if (!tool) {
    return res.status(404).json({ error: "Tool not found" });
  }
  return res.json(tool);
});

toolsRouter.get("/:id/events", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const scope = await getRequestDataScope(req);
  const toolOk = await prisma.tool.findFirst({ where: { AND: [toolWhereFromScope(scope), { id }] } });
  if (!toolOk) {
    return res.status(404).json({ error: "Tool not found" });
  }
  const events = await prisma.toolEvent.findMany({
    where: { toolId: id },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return res.json(events);
});

toolsRouter.get("/:id/qr", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const tool = await prisma.tool.findFirst({
    where: { AND: [toolWhereFromScope(scope), { id: String(req.params.id) }] }
  });
  if (!tool) {
    return res.status(404).json({ error: "Tool not found" });
  }
  const dataUrl = await QRCode.toDataURL(tool.qrCode, { margin: 1, width: 512 });
  return res.json({ id: tool.id, qrCode: tool.qrCode, dataUrl });
});

toolsRouter.get("/labels/pdf", async (req: AuthedRequest, res) => {
  const idsRaw = typeof req.query.ids === "string" ? req.query.ids : "";
  const ids = idsRaw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!ids.length) {
    return res.status(400).json({ error: "ids query param is required" });
  }

  const scope = await getRequestDataScope(req);
  const tools = await prisma.tool.findMany({
    where: { AND: [toolWhereFromScope(scope), { id: { in: ids } }] },
    orderBy: { createdAt: "desc" }
  });
  if (!tools.length) {
    return res.status(404).json({ error: "Tools not found" });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=tool-labels.pdf");
  const doc = new PDFDocument({ size: "A4", margin: 24 });
  doc.pipe(res);

  const cols = 3;
  const rows = 8;
  const gap = 10;
  const pageWidth = 595.28 - 24 * 2;
  const pageHeight = 841.89 - 24 * 2;
  const cellWidth = (pageWidth - gap * (cols - 1)) / cols;
  const cellHeight = (pageHeight - gap * (rows - 1)) / rows;

  for (let i = 0; i < tools.length; i += 1) {
    const tool = tools[i];
    if (i > 0 && i % (cols * rows) === 0) {
      doc.addPage();
    }

    const cellIndex = i % (cols * rows);
    const col = cellIndex % cols;
    const row = Math.floor(cellIndex / cols);
    const x = 24 + col * (cellWidth + gap);
    const y = 24 + row * (cellHeight + gap);

    doc.rect(x, y, cellWidth, cellHeight).lineWidth(0.5).strokeColor("#999").stroke();

    const qrSize = Math.min(cellHeight - 22, cellWidth * 0.45);
    const png = await QRCode.toBuffer(tool.qrCode, { margin: 1, width: 220 });
    doc.image(png, x + 6, y + 6, { width: qrSize, height: qrSize });
    doc.fontSize(8).fillColor("#111").text(tool.inventoryNumber, x + qrSize + 10, y + 8, { width: cellWidth - qrSize - 14 });
    doc.fontSize(7).text(tool.name, x + qrSize + 10, y + 22, { width: cellWidth - qrSize - 14, height: 22 });
    doc.fontSize(7).text(tool.qrCode, x + 6, y + qrSize + 10, { width: cellWidth - 12 });
  }

  doc.end();
});
