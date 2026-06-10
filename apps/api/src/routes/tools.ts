import { StockCondition, StockMovementDirection, NotificationLevel, ToolStatus, type Prisma, type ToolCatalogSection } from "@prisma/client";
import path from "node:path";
import { Router } from "express";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { z } from "zod";
import { recordAudit } from "../lib/audit.js";
import { dispatchCriticalNotification, dispatchNotification } from "../lib/notifications.js";
import {
  assertObjectSectionInScope,
  assertProjectInScope,
  assertWarehouseInScope,
  getRequestDataScope,
  resolveReadScope,
  toolWhereFromScope,
  warehouseWhereFromScope
} from "../lib/dataScope.js";
import { handlePrismaError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { materialQtyCoerceSchema, materialQtySchema } from "../lib/quantity.js";
import { buildMaterialCreateFromReceiptItem } from "../lib/receiptMaterialApply.js";
import {
  CATALOG_MATERIAL_TOOL_SECTIONS,
  ensureDefaultToolCategories,
  isElectricToolCategoryId,
  isElectricToolCategorySlug,
  isKitTrackableCategoryId,
  isManualToolCategoryName,
  normalizeToolKitFields,
  toolCatalogSectionToReceiptCategory,
  MANUAL_TOOL_CATEGORY,
  ELECTRIC_TOOL_CATEGORY,
  TOOL_CATEGORY_SLUGS
} from "../lib/toolCatalog.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

export { MANUAL_TOOL_CATEGORY, ELECTRIC_TOOL_CATEGORY, isManualToolCategoryName };

const createToolSchema = z.object({
  name: z.string().min(1),
  inventoryNumber: z.string().min(1),
  serialNumber: z.string().nullable().optional(),
  warehouseId: z.string().optional(),
  section: z.enum(["SS", "EOM"]).default("SS"),
  projectId: z.string().optional(),
  responsible: z.string().optional(),
  note: z.string().optional(),
  brand: z.string().optional(),
  toolType: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  kitComplete: z.boolean().optional(),
  kitMissingNote: z.string().max(2000).nullable().optional()
});

const kitPatchSchema = z.object({
  kitComplete: z.boolean(),
  kitMissingNote: z.string().max(2000).nullable().optional()
});

function formatKitStateLabel(kitComplete: boolean, kitMissingNote: string | null | undefined): string {
  if (kitComplete !== false) return "комплект";
  const note = String(kitMissingNote || "").trim();
  return note ? `некомплект: ${note}` : "некомплект";
}

const updateToolSchema = z.object({
  name: z.string().min(1).optional(),
  serialNumber: z.string().nullable().optional(),
  warehouseId: z.string().nullable().optional(),
  section: z.enum(["SS", "EOM"]).optional(),
  projectId: z.string().nullable().optional(),
  responsible: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  toolType: z.string().nullable().optional(),
  status: z.nativeEnum(ToolStatus).optional(),
  categoryId: z.string().nullable().optional(),
  kitComplete: z.boolean().optional(),
  kitMissingNote: z.string().max(2000).nullable().optional()
});

function toolPatchValidationMessage(error: z.ZodError): string {
  const flat = error.flatten().fieldErrors as Record<string, string[] | undefined>;
  const parts: string[] = [];
  for (const [field, msgs] of Object.entries(flat)) {
    if (!msgs?.length) continue;
    for (const m of msgs) {
      parts.push(`${field}: ${m}`);
    }
  }
  return parts.length ? parts.join("; ") : "Некорректные данные карточки";
}

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

const PDF_LABEL_FONT = path.resolve(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf");

function drawToolLabelCell(
  doc: PDFKit.PDFDocument,
  tool: { inventoryNumber: string; name: string; qrCode: string },
  x: number,
  y: number,
  cellWidth: number,
  cellHeight: number,
  qrPng: Buffer
) {
  const pad = 4;
  const innerX = x + pad;
  const innerY = y + pad;
  const innerW = cellWidth - pad * 2;
  const innerH = cellHeight - pad * 2;

  doc.rect(x, y, cellWidth, cellHeight).lineWidth(0.5).strokeColor("#999").stroke();

  doc.save();
  doc.rect(innerX, innerY, innerW, innerH).clip();

  const qrSize = Math.min(innerW * 0.36, innerH * 0.48, 50);
  const textX = innerX + qrSize + 5;
  const textW = Math.max(18, innerW - qrSize - 5);
  const footerY = innerY + qrSize + 3;

  doc.image(qrPng, innerX, innerY, { width: qrSize, height: qrSize });

  doc.font(PDF_LABEL_FONT).fillColor("#111");
  doc.fontSize(8).text(tool.inventoryNumber, textX, innerY, { width: textW, lineBreak: false, ellipsis: true });
  doc.fontSize(7).text(tool.name, textX, innerY + 11, {
    width: textW,
    height: Math.max(12, footerY - innerY - 12),
    ellipsis: true
  });

  doc.fontSize(6).fillColor("#555").text(tool.qrCode, innerX, footerY, {
    width: innerW,
    lineBreak: false,
    ellipsis: true
  });

  doc.restore();
}

export const toolsRouter = Router();
toolsRouter.use(requireAuth);
toolsRouter.use(requirePermission("tools.read"));

// --- Категории инструмента (карточный вид) ---
toolsRouter.get("/categories", async (_req, res) => {
  await ensureDefaultToolCategories();
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
  const warehouseIdParam = typeof req.query.warehouseId === "string" ? req.query.warehouseId.trim() : "";
  const scope = await resolveReadScope(req, { warehouseId: warehouseIdParam || undefined });
  const scopedToolFilter = toolWhereFromScope(scope);
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
  const categorySlugParam = typeof req.query.categorySlug === "string" ? req.query.categorySlug.trim() : "";
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
  let categorySlugIds: string[] | undefined;
  if (categorySlugParam) {
    await ensureDefaultToolCategories();
    const slugs =
      categorySlugParam === TOOL_CATEGORY_SLUGS.ELECTRIC
        ? [TOOL_CATEGORY_SLUGS.ELECTRIC, TOOL_CATEGORY_SLUGS.ELECTRIC_CORDLESS, TOOL_CATEGORY_SLUGS.ELECTRIC_CORDED]
        : [categorySlugParam];
    const cats = await prisma.toolCategory.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
    categorySlugIds = cats.map((c) => c.id);
  }
  const filteredTools =
    categorySlugIds !== undefined
      ? tools.filter((t) => t.categoryId && categorySlugIds!.includes(t.categoryId))
      : tools;
  const groupMiscByName =
    categorySlugParam === TOOL_CATEGORY_SLUGS.OTHER ||
    categorySlugParam === TOOL_CATEGORY_SLUGS.TOWERS_LADDERS ||
    categorySlugParam === TOOL_CATEGORY_SLUGS.KIP ||
    categorySlugParam === TOOL_CATEGORY_SLUGS.TOOL_CONSUMABLE;
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
  if (!categorySlugParam) {
    for (const cat of categories) {
      ensureCard(`cat:${cat.id}`, cat.name, "CATEGORY", cat.id, cat.icon);
    }
  }
  for (const t of filteredTools) {
    let card: Card;
    if (groupMiscByName && t.categoryId && catById.has(t.categoryId)) {
      const cat = catById.get(t.categoryId)!;
      const nameKey = (t.name || "Без названия").trim() || "Без названия";
      card = ensureCard(`name:${cat.id}:${nameKey.toLowerCase()}`, nameKey, "NAME", cat.id, cat.icon);
    } else if (t.categoryId && catById.has(t.categoryId)) {
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
  const list = Array.from(cardsByKey.values())
    .filter((c) => c.count > 0)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "CATEGORY" ? -1 : 1;
      return b.count - a.count || a.label.localeCompare(b.label, "ru");
    });
  return res.json(list);
});

toolsRouter.get("/", async (req: AuthedRequest, res) => {
  const warehouseIdParam = typeof req.query.warehouseId === "string" ? req.query.warehouseId.trim() : "";
  const scope = await resolveReadScope(req, { warehouseId: warehouseIdParam || undefined });
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
  const categorySlugParam = typeof req.query.categorySlug === "string" ? req.query.categorySlug.trim() : "";
  const nameGroupParam = typeof req.query.nameGroup === "string" ? req.query.nameGroup.trim() : "";
  let categorySlugIds: string[] | undefined;
  if (categorySlugParam) {
    await ensureDefaultToolCategories();
    const slugs =
      categorySlugParam === TOOL_CATEGORY_SLUGS.ELECTRIC
        ? [TOOL_CATEGORY_SLUGS.ELECTRIC, TOOL_CATEGORY_SLUGS.ELECTRIC_CORDLESS, TOOL_CATEGORY_SLUGS.ELECTRIC_CORDED]
        : [categorySlugParam];
    const cats = await prisma.toolCategory.findMany({ where: { slug: { in: slugs } }, select: { id: true } });
    categorySlugIds = cats.map((c) => c.id);
  }
  const where = {
    AND: [
      toolWhereFromScope(scope),
      {
        ...(warehouseIdParam ? { warehouseId: warehouseIdParam } : {}),
        ...(status ? { status } : {}),
        ...(section ? { section } : {}),
        ...(categoryIdParam ? { categoryId: categoryIdParam } : {}),
        ...(categorySlugIds !== undefined
          ? categorySlugIds.length > 0
            ? { categoryId: { in: categorySlugIds } }
            : { categoryId: { in: [] } }
          : {}),
        ...(nameGroupParam
          ? {
              categoryId: categoryIdParam || undefined,
              name: { equals: nameGroupParam, mode: "insensitive" as const }
            }
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
        project: true,
        category: true
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
    const isKitTrackable = await isKitTrackableCategoryId(parsed.data.categoryId);
    const kit = normalizeToolKitFields(isKitTrackable, parsed.data.kitComplete, parsed.data.kitMissingNote);
    if ("error" in kit) {
      return res.status(400).json({ error: kit.error });
    }
    const { kitComplete, kitMissingNote, ...toolBody } = parsed.data;
    void kitComplete;
    void kitMissingNote;
    const qrCode = buildQrCode(parsed.data.inventoryNumber);
    const created = await prisma.tool.create({
      data: {
        ...toolBody,
        kitComplete: kit.kitComplete,
        kitMissingNote: kit.kitMissingNote,
        qrCode
      },
      include: { events: true, category: true }
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

toolsRouter.patch("/:id/kit", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const parsed = kitPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    const scope = await getRequestDataScope(req);
    const existing = await prisma.tool.findFirst({
      where: { AND: [toolWhereFromScope(scope), { id: String(req.params.id) }] },
      include: { category: true, warehouse: true }
    });
    if (!existing) {
      return res.status(404).json({ error: "Tool not found" });
    }
    const kitTrackable = await isKitTrackableCategoryId(existing.categoryId);
    if (!kitTrackable) {
      return res.status(400).json({
        error: "Комплектность можно менять только у электроинструмента и КИП"
      });
    }
    const kit = normalizeToolKitFields(kitTrackable, parsed.data.kitComplete, parsed.data.kitMissingNote);
    if ("error" in kit) {
      return res.status(400).json({ error: kit.error });
    }
    const unchanged =
      existing.kitComplete === kit.kitComplete &&
      String(existing.kitMissingNote || "").trim() === String(kit.kitMissingNote || "").trim();
    if (unchanged) {
      return res.json(existing);
    }

    const prevLabel = formatKitStateLabel(existing.kitComplete, existing.kitMissingNote);
    const nextLabel = formatKitStateLabel(kit.kitComplete, kit.kitMissingNote);
    const eventComment = `${prevLabel} → ${nextLabel}`;

    const updated = await prisma.$transaction(async (tx) => {
      const tool = await tx.tool.update({
        where: { id: existing.id },
        data: {
          kitComplete: kit.kitComplete,
          kitMissingNote: kit.kitMissingNote
        },
        include: { warehouse: true, project: true, category: true }
      });
      await tx.toolEvent.create({
        data: {
          toolId: existing.id,
          action: "KIT_UPDATE",
          status: tool.status,
          comment: eventComment,
          actorId: req.user!.userId
        }
      });
      return tool;
    });

    await recordAudit({
      userId: req.user!.userId,
      action: "TOOL_KIT_UPDATE",
      entityType: "Tool",
      entityId: updated.id,
      summary: `Комплектность «${updated.name}» (инв. ${updated.inventoryNumber}): ${eventComment}`,
      before: { kitComplete: existing.kitComplete, kitMissingNote: existing.kitMissingNote },
      after: { kitComplete: updated.kitComplete, kitMissingNote: updated.kitMissingNote }
    });

    void dispatchNotification({
      eventCode: "TOOL_KIT_CHANGED",
      title: "Изменена комплектность инструмента",
      message: `«${updated.name}» (инв. ${updated.inventoryNumber}): ${eventComment}`,
      entityType: "Tool",
      entityId: updated.id,
      level: kit.kitComplete ? NotificationLevel.INFO : NotificationLevel.WARNING,
      excludeUserIds: [req.user!.userId]
    }).catch(() => undefined);

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

toolsRouter.patch("/:id", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const parsed = updateToolSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: toolPatchValidationMessage(parsed.error),
      details: parsed.error.flatten()
    });
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
    const categoryId =
      parsed.data.categoryId !== undefined ? parsed.data.categoryId : existing.categoryId;
    const isKitTrackable = await isKitTrackableCategoryId(categoryId);
    const kitInput =
      parsed.data.kitComplete !== undefined || parsed.data.kitMissingNote !== undefined
        ? {
            kitComplete: parsed.data.kitComplete ?? existing.kitComplete,
            kitMissingNote: parsed.data.kitMissingNote ?? existing.kitMissingNote
          }
        : { kitComplete: existing.kitComplete, kitMissingNote: existing.kitMissingNote };
    const kit = normalizeToolKitFields(isKitTrackable, kitInput.kitComplete, kitInput.kitMissingNote);
    if ("error" in kit) {
      return res.status(400).json({ error: kit.error });
    }
    const { kitComplete, kitMissingNote, ...patchBody } = parsed.data;
    void kitComplete;
    void kitMissingNote;
    const updated = await prisma.tool.update({
      where: { id: String(req.params.id) },
      data: {
        ...patchBody,
        kitComplete: kit.kitComplete,
        kitMissingNote: kit.kitMissingNote
      },
      include: { warehouse: true, project: true, category: true }
    });
    await recordAudit({
      userId: req.user!.userId,
      action: "TOOL_UPDATE",
      entityType: "Tool",
      entityId: updated.id,
      summary: `Обновлена карточка инструмента: ${updated.name} (инв. ${updated.inventoryNumber})`,
      after: {
        id: updated.id,
        name: updated.name,
        categoryId: updated.categoryId
      }
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

toolsRouter.delete("/:id", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  try {
    const scope = await getRequestDataScope(req);
    const tool = await prisma.tool.findFirst({
      where: { AND: [toolWhereFromScope(scope), { id }] },
      select: { id: true, name: true, inventoryNumber: true, status: true }
    });
    if (!tool) {
      return res.status(404).json({ error: "Tool not found" });
    }
    if (tool.status !== ToolStatus.IN_STOCK) {
      return res.status(400).json({
        error: "Удалить можно только инструмент со статусом «На складе». Сначала верните на склад или спишите."
      });
    }
    const [issueLinks, openConsumables] = await Promise.all([
      prisma.issueRequestToolItem.count({ where: { toolId: id } }),
      prisma.toolConsumableIssue.count({ where: { toolId: id, status: "OPEN" } })
    ]);
    if (issueLinks > 0) {
      return res.status(409).json({ error: "Инструмент указан в заявках на выдачу — удаление невозможно" });
    }
    if (openConsumables > 0) {
      return res.status(409).json({
        error: "По инструменту есть открытые выдачи расходников — сначала закройте их"
      });
    }
    await prisma.tool.delete({ where: { id } });
    await recordAudit({
      userId: req.user!.userId,
      action: "TOOL_DELETE",
      entityType: "Tool",
      entityId: id,
      summary: `Удалена карточка инструмента: ${tool.name} (инв. ${tool.inventoryNumber})`
    });
    return res.status(204).send();
  } catch (error) {
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
    where: { AND: [toolWhereFromScope(scope), { id }] },
    include: { category: true }
  });
  if (!beforeTool) {
    return res.status(404).json({ error: "Tool not found" });
  }
  if (parsed.data.action === "WRITE_OFF" && isManualToolCategoryName(beforeTool.category?.name)) {
    return res.status(400).json({
      error:
        "Ручной инструмент списывается только по акту на имя ответственного. Используйте акт «Списание» в разделе «Акты»."
    });
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
    if (parsed.data.action === "WRITE_OFF") {
      if (beforeTool.warehouseId) {
        void dispatchCriticalNotification({
          warehouseId: beforeTool.warehouseId,
          eventCode: "TOOL_WRITE_OFF",
          title: "Списание инструмента",
          message: `«${beforeTool.name}»${beforeTool.inventoryNumber ? ` (инв. ${beforeTool.inventoryNumber})` : ""} списан.${parsed.data.comment?.trim() ? ` Комментарий: ${parsed.data.comment.trim()}` : ""}`,
          entityType: "Tool",
          entityId: id,
          excludeUserIds: [req.user!.userId]
        }).catch(() => undefined);
      }
    }
    return res.json(updated);
  } catch (error) {
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

const catalogSectionSchema = z.enum([
  "TOOL_MANUAL",
  "TOOL_ELECTRIC_CORDLESS",
  "TOOL_ELECTRIC_CORDED",
  "PPE",
  "TOOL_CONSUMABLE",
  "KIP",
  "TOWERS_LADDERS",
  "OTHER"
]);

toolsRouter.get("/catalog/summary", async (req: AuthedRequest, res) => {
  await ensureDefaultToolCategories();
  const warehouseIdParam = typeof req.query.warehouseId === "string" ? req.query.warehouseId.trim() : "";
  const scope = await resolveReadScope(req, { warehouseId: warehouseIdParam || undefined });
  try {
    if (warehouseIdParam) assertWarehouseInScope(scope, warehouseIdParam);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  const sectionParam = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section: "SS" | "EOM" | undefined = sectionParam === "SS" || sectionParam === "EOM" ? sectionParam : undefined;
  const baseToolWhere: Prisma.ToolWhereInput = {
    AND: [
      toolWhereFromScope(scope),
      ...(warehouseIdParam ? [{ warehouseId: warehouseIdParam }] : []),
      ...(section ? [{ section }] : [])
    ]
  };
  const categories = await prisma.toolCategory.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] });
  const tools = await prisma.tool.findMany({
    where: baseToolWhere,
    select: { categoryId: true, status: true, category: { select: { slug: true } } }
  });
  const countBySlug = (slugs: string[]) => {
    const ids = new Set(categories.filter((c) => c.slug && slugs.includes(c.slug)).map((c) => c.id));
    const subset = tools.filter((t) => t.categoryId && ids.has(t.categoryId));
    return {
      count: subset.length,
      inStock: subset.filter((t) => t.status === ToolStatus.IN_STOCK).length,
      issued: subset.filter((t) => t.status === ToolStatus.ISSUED).length,
      inRepair: subset.filter((t) => t.status === ToolStatus.IN_REPAIR).length
    };
  };
  const materialSections: ToolCatalogSection[] = ["TOOL_CONSUMABLE", "KIP", "TOWERS_LADDERS", "OTHER"];
  const stocks = await prisma.stock.findMany({
    where: {
      ...(warehouseIdParam ? { warehouseId: warehouseIdParam } : {}),
      ...(section ? { section } : {}),
      condition: StockCondition.NEW,
      material: { toolCatalogSection: { in: materialSections } }
    },
    include: { material: { select: { toolCatalogSection: true } } }
  });
  const matCounts = Object.fromEntries(
    materialSections.map((s) => [s, { count: 0, qty: 0 }])
  ) as Record<string, { count: number; qty: number }>;
  for (const st of stocks) {
    const sec = st.material.toolCatalogSection;
    if (!sec) continue;
    matCounts[sec].count += 1;
    matCounts[sec].qty += Number(st.quantity);
  }
  return res.json({
    toolManual: countBySlug([TOOL_CATEGORY_SLUGS.MANUAL]),
    toolElectric: countBySlug([
      TOOL_CATEGORY_SLUGS.ELECTRIC,
      TOOL_CATEGORY_SLUGS.ELECTRIC_CORDLESS,
      TOOL_CATEGORY_SLUGS.ELECTRIC_CORDED
    ]),
    toolElectricCordless: countBySlug([TOOL_CATEGORY_SLUGS.ELECTRIC_CORDLESS]),
    toolElectricCorded: countBySlug([TOOL_CATEGORY_SLUGS.ELECTRIC_CORDED]),
    ppe: countBySlug([TOOL_CATEGORY_SLUGS.PPE]),
    toolConsumable: (() => {
      const t = countBySlug([TOOL_CATEGORY_SLUGS.TOOL_CONSUMABLE]);
      return {
        count: matCounts.TOOL_CONSUMABLE.count + t.count,
        qty: matCounts.TOOL_CONSUMABLE.qty,
        inStock: t.inStock,
        issued: t.issued,
        inRepair: t.inRepair
      };
    })(),
    kip: (() => {
      const t = countBySlug([TOOL_CATEGORY_SLUGS.KIP]);
      return {
        count: matCounts.KIP.count + t.count,
        qty: matCounts.KIP.qty,
        inStock: t.inStock,
        issued: t.issued,
        inRepair: t.inRepair
      };
    })(),
    towersLadders: (() => {
      const t = countBySlug([TOOL_CATEGORY_SLUGS.TOWERS_LADDERS]);
      return {
        count: matCounts.TOWERS_LADDERS.count + t.count,
        qty: matCounts.TOWERS_LADDERS.qty,
        inStock: t.inStock,
        issued: t.issued,
        inRepair: t.inRepair
      };
    })(),
    other: (() => {
      const t = countBySlug([TOOL_CATEGORY_SLUGS.OTHER]);
      return {
        count: matCounts.OTHER.count + t.count,
        qty: matCounts.OTHER.qty,
        inStock: t.inStock,
        issued: t.issued,
        inRepair: t.inRepair
      };
    })()
  });
});

const manualCatalogMaterialSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  materialName: z.string().trim().min(1).max(800),
  quantity: materialQtyCoerceSchema,
  unit: z.string().trim().min(1).max(64).optional().default("шт"),
  toolCatalogSection: z.enum(CATALOG_MATERIAL_TOOL_SECTIONS),
  unitPrice: z.coerce.number().nonnegative().optional().nullable()
});

toolsRouter.post("/catalog/manual-line", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const parsed = manualCatalogMaterialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    const scope = await getRequestDataScope(req);
    assertObjectSectionInScope(scope, parsed.data.warehouseId, parsed.data.section);

    const name = parsed.data.materialName.trim();
    const qty = parsed.data.quantity;
    const unit = parsed.data.unit.trim() || "шт";
    const receiptCategory = toolCatalogSectionToReceiptCategory(parsed.data.toolCatalogSection);
    const catalogFields = buildMaterialCreateFromReceiptItem(
      receiptCategory,
      parsed.data.toolCatalogSection,
      parsed.data.unitPrice ?? null
    );

    const { materialId } = await prisma.$transaction(async (tx) => {
      const existing = await tx.material.findFirst({ where: { name, unit } });
      let materialId: string;
      if (existing) {
        await tx.material.update({
          where: { id: existing.id },
          data: catalogFields
        });
        materialId = existing.id;
      } else {
        const material = await tx.material.create({
          data: { name, unit, ...catalogFields },
          select: { id: true }
        });
        materialId = material.id;
      }

      const stockKey = {
        warehouseId_materialId_section_condition: {
          warehouseId: parsed.data.warehouseId,
          materialId,
          section: parsed.data.section,
          condition: StockCondition.NEW
        }
      };
      const existingStock = await tx.stock.findUnique({ where: stockKey });
      if (existingStock) {
        await tx.stock.update({
          where: stockKey,
          data: { quantity: { increment: qty } }
        });
      } else {
        await tx.stock.create({
          data: {
            warehouseId: parsed.data.warehouseId,
            materialId,
            section: parsed.data.section,
            condition: StockCondition.NEW,
            quantity: qty,
            reserved: 0
          }
        });
      }

      await tx.stockMovement.create({
        data: {
          warehouseId: parsed.data.warehouseId,
          materialId,
          quantity: qty,
          direction: StockMovementDirection.IN,
          sourceDocumentType: "MANUAL_TOOL_CATALOG",
          note: "Ручная строка в каталоге инструментов/СИЗ",
          createdById: req.user!.userId
        }
      });

      return { materialId };
    });

    await recordAudit({
      userId: req.user!.userId,
      action: "TOOL_CATALOG_MANUAL_LINE",
      entityType: "Stock",
      entityId: `${parsed.data.warehouseId}:${materialId}:${parsed.data.section}`,
      summary: `Ручное добавление в каталог: ${name}, +${qty} ${unit}`,
      after: {
        warehouseId: parsed.data.warehouseId,
        section: parsed.data.section,
        materialId,
        toolCatalogSection: parsed.data.toolCatalogSection,
        quantity: qty,
        unit,
        materialName: name
      }
    });

    return res.status(201).json({ ok: true, materialId });
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status === 403) {
      return res.status(403).json({ error: err.message });
    }
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.get("/catalog/materials", async (req: AuthedRequest, res) => {
  const parsed = catalogSectionSchema.safeParse(req.query.section);
  if (!parsed.success) return res.status(400).json({ error: "Invalid section" });
  const warehouseIdParam = typeof req.query.warehouseId === "string" ? req.query.warehouseId.trim() : "";
  const scope = await resolveReadScope(req, { warehouseId: warehouseIdParam || undefined });
  try {
    if (warehouseIdParam) assertWarehouseInScope(scope, warehouseIdParam);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  const sectionParam = typeof req.query.sectionFilter === "string" ? req.query.sectionFilter.toUpperCase() : "";
  const objectSection: "SS" | "EOM" | undefined =
    sectionParam === "SS" || sectionParam === "EOM" ? sectionParam : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const splitByCondition =
    req.query.splitByCondition === "1" || String(req.query.splitByCondition).toLowerCase() === "true";

  if (splitByCondition) {
    const stocks = await prisma.stock.findMany({
      where: {
        material: { toolCatalogSection: parsed.data },
        quantity: { gt: 0 },
        ...(warehouseIdParam ? { warehouseId: warehouseIdParam } : {}),
        ...(objectSection ? { section: objectSection } : {}),
        ...(q ? { material: { name: { contains: q, mode: "insensitive" } } } : {})
      },
      include: {
        material: { select: { id: true, name: true, unit: true } },
        warehouse: { select: { id: true, name: true } }
      },
      orderBy: [{ condition: "desc" }, { material: { name: "asc" } }, { warehouse: { name: "asc" } }]
    });
    return res.json(
      stocks.map((st) => ({
        key: `${st.warehouseId}:${st.materialId}:${st.section}:${st.condition}`,
        stockId: st.id,
        materialId: st.material.id,
        name: st.material.name,
        unit: st.material.unit,
        warehouseId: st.warehouseId,
        warehouseName: st.warehouse?.name ?? "—",
        section: st.section,
        condition: st.condition,
        quantity: Number(st.quantity),
        disputed: st.catalogDisputed,
        note: st.catalogNote,
        cardStatus: st.catalogDisputed ? "DISPUTED" : "IN_STOCK"
      }))
    );
  }

  const rows = await prisma.stock.findMany({
    where: {
      material: { toolCatalogSection: parsed.data },
      condition: StockCondition.NEW,
      ...(warehouseIdParam ? { warehouseId: warehouseIdParam } : {}),
      ...(objectSection ? { section: objectSection } : {}),
      ...(q ? { material: { name: { contains: q, mode: "insensitive" } } } : {})
    },
    include: {
      material: { select: { id: true, name: true, unit: true, kind: true, toolCatalogSection: true } },
      warehouse: { select: { id: true, name: true } }
    },
    orderBy: [{ material: { name: "asc" } }]
  });
  const usedRows = await prisma.stock.findMany({
    where: {
      material: { toolCatalogSection: parsed.data },
      condition: StockCondition.USED,
      ...(warehouseIdParam ? { warehouseId: warehouseIdParam } : {}),
      ...(objectSection ? { section: objectSection } : {})
    },
    include: {
      material: { select: { id: true, name: true, unit: true } },
      warehouse: { select: { id: true, name: true } }
    }
  });
  const byKey = new Map<
    string,
    {
      materialId: string;
      name: string;
      unit: string;
      warehouseId: string;
      warehouseName: string;
      section: string;
      qtyNew: number;
      qtyUsed: number;
    }
  >();
  for (const st of rows) {
    const key = `${st.warehouseId}:${st.materialId}:${st.section}`;
    const row = byKey.get(key) ?? {
      materialId: st.material.id,
      name: st.material.name,
      unit: st.material.unit,
      warehouseId: st.warehouseId,
      warehouseName: st.warehouse?.name ?? "—",
      section: st.section,
      qtyNew: 0,
      qtyUsed: 0
    };
    row.qtyNew += Number(st.quantity);
    byKey.set(key, row);
  }
  for (const st of usedRows) {
    const key = `${st.warehouseId}:${st.materialId}:${st.section}`;
    const row = byKey.get(key);
    if (row) row.qtyUsed += Number(st.quantity);
    else {
      byKey.set(key, {
        materialId: st.material.id,
        name: st.material.name,
        unit: st.material.unit,
        warehouseId: st.warehouseId,
        warehouseName: st.warehouse?.name ?? "—",
        section: st.section,
        qtyNew: 0,
        qtyUsed: Number(st.quantity)
      });
    }
  }
  return res.json(Array.from(byKey.values()));
});

const catalogMaterialSectionPatchSchema = z.object({
  toolCatalogSection: z.enum(["TOOL_CONSUMABLE", "KIP", "TOWERS_LADDERS", "OTHER"]).nullable()
});

toolsRouter.patch(
  "/catalog/materials/:materialId/section",
  requirePermission("tools.write"),
  async (req: AuthedRequest, res) => {
    const parsed = catalogMaterialSectionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const materialId = String(req.params.materialId);
    const existing = await prisma.material.findUnique({
      where: { id: materialId },
      select: { id: true, name: true, toolCatalogSection: true }
    });
    if (!existing) {
      return res.status(404).json({ error: "Материал не найден" });
    }
    const updated = await prisma.material.update({
      where: { id: materialId },
      data: { toolCatalogSection: parsed.data.toolCatalogSection },
      select: { id: true, name: true, toolCatalogSection: true }
    });
    const sectionRu: Record<string, string> = {
      PPE: "СИЗ",
      TOOL_CONSUMABLE: "Расходники для инструмента",
      KIP: "КИП",
      TOWERS_LADDERS: "Туры и стремянки",
      OTHER: "Прочее"
    };
    const from = existing.toolCatalogSection
      ? sectionRu[existing.toolCatalogSection] || existing.toolCatalogSection
      : "склад";
    const to = updated.toolCatalogSection
      ? sectionRu[updated.toolCatalogSection] || updated.toolCatalogSection
      : "склад";
    await recordAudit({
      userId: req.user!.userId,
      action: "MATERIAL_CATALOG_SECTION",
      entityType: "Material",
      entityId: materialId,
      summary: `Раздел каталога «${existing.name}»: ${from} → ${to}`,
      before: { toolCatalogSection: existing.toolCatalogSection },
      after: { toolCatalogSection: updated.toolCatalogSection }
    });
    return res.json(updated);
  }
);

const consumableIssueSchema = z.object({
  toolId: z.string().min(1),
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]).default("SS"),
  holderName: z.string().min(1),
  issueRequestId: z.string().optional(),
  items: z
    .array(
      z.object({
        materialId: z.string().min(1),
        quantity: materialQtySchema,
        condition: z.enum(["NEW", "USED"]).optional()
      })
    )
    .min(1)
});

toolsRouter.post("/consumables/issue", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const parsed = consumableIssueSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  const scope = await getRequestDataScope(req);
  try {
    assertWarehouseInScope(scope, parsed.data.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  const tool = await prisma.tool.findFirst({
    where: { AND: [toolWhereFromScope(scope), { id: parsed.data.toolId }] },
    include: { category: true }
  });
  if (!tool) return res.status(404).json({ error: "Tool not found" });
  try {
    const created = await prisma.$transaction(async (tx) => {
      const lines = [];
      for (const it of parsed.data.items) {
        const condition =
          it.condition === "USED" ? StockCondition.USED : StockCondition.NEW;
        const stock = await tx.stock.findUnique({
          where: {
            warehouseId_materialId_section_condition: {
              warehouseId: parsed.data.warehouseId,
              materialId: it.materialId,
              section: parsed.data.section,
              condition
            }
          }
        });
        if (!stock || Number(stock.quantity) < it.quantity) {
          const label = condition === StockCondition.USED ? "б/у" : "новых";
          throw Object.assign(new Error(`Недостаточно расходника (${label}) на складе`), { status: 409 });
        }
        await tx.stock.update({
          where: { id: stock.id },
          data: { quantity: { decrement: it.quantity } }
        });
        const line = await tx.toolConsumableIssue.create({
          data: {
            toolId: parsed.data.toolId,
            materialId: it.materialId,
            warehouseId: parsed.data.warehouseId,
            section: parsed.data.section,
            issueRequestId: parsed.data.issueRequestId,
            qtyIssued: it.quantity,
            holderName: parsed.data.holderName,
            status: "OPEN"
          }
        });
        lines.push(line);
      }
      return lines;
    });
    return res.status(201).json(created);
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status) return res.status(err.status).json({ error: err.message });
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

const consumableReturnSchema = z.object({
  toolId: z.string().min(1),
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]).default("SS"),
  lines: z
    .array(
      z.object({
        issueId: z.string().min(1),
        qtyNew: z.number().nonnegative(),
        qtyUsed: z.number().nonnegative(),
        writeoffQty: z.number().nonnegative().optional(),
        writeoffReason: z.string().max(500).optional()
      })
    )
    .min(1)
});

const consumableDirectIssueSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]).default("SS"),
  materialId: z.string().min(1),
  condition: z.enum(["NEW", "USED"]).default("NEW"),
  quantity: materialQtySchema,
  holderName: z.string().min(1),
  comment: z.string().max(500).optional()
});

toolsRouter.post("/catalog/consumables/issue-direct", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const parsed = consumableDirectIssueSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  const scope = await getRequestDataScope(req);
  try {
    assertWarehouseInScope(scope, parsed.data.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  const condition = parsed.data.condition === "USED" ? StockCondition.USED : StockCondition.NEW;
  try {
    await prisma.$transaction(async (tx) => {
      const material = await tx.material.findFirst({
        where: { id: parsed.data.materialId, toolCatalogSection: "TOOL_CONSUMABLE" }
      });
      if (!material) throw Object.assign(new Error("Расходник не найден в каталоге"), { status: 404 });
      const stock = await tx.stock.findUnique({
        where: {
          warehouseId_materialId_section_condition: {
            warehouseId: parsed.data.warehouseId,
            materialId: parsed.data.materialId,
            section: parsed.data.section,
            condition
          }
        }
      });
      if (!stock || Number(stock.quantity) < parsed.data.quantity) {
        const label = condition === StockCondition.USED ? "б/у" : "новых";
        throw Object.assign(new Error(`Недостаточно расходника (${label}) на складе`), { status: 409 });
      }
      await tx.stock.update({
        where: { id: stock.id },
        data: { quantity: { decrement: parsed.data.quantity } }
      });
      await tx.stockMovement.create({
        data: {
          warehouseId: parsed.data.warehouseId,
          materialId: parsed.data.materialId,
          quantity: parsed.data.quantity,
          direction: StockMovementDirection.OUT,
          sourceDocumentType: "TOOL_CONSUMABLE_ISSUE",
          note: [
            `Выдача расходника: ${parsed.data.holderName}`,
            condition === StockCondition.USED ? "б/у" : "новые",
            parsed.data.comment?.trim()
          ]
            .filter(Boolean)
            .join(" · "),
          createdById: req.user!.userId
        }
      });
    });
    return res.status(201).json({ ok: true });
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status) return res.status(err.status).json({ error: err.message });
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

async function recordConsumableCatalogEvent(
  tx: Prisma.TransactionClient,
  data: {
    stockId: string;
    materialId: string;
    warehouseId: string;
    section: "SS" | "EOM";
    condition: StockCondition;
    action: string;
    comment?: string | null;
    actorId?: string | null;
  }
) {
  await tx.toolCatalogConsumableEvent.create({
    data: {
      stockId: data.stockId,
      materialId: data.materialId,
      warehouseId: data.warehouseId,
      section: data.section,
      condition: data.condition,
      action: data.action,
      comment: data.comment?.trim() || null,
      actorId: data.actorId ?? null
    }
  });
}

const consumableCardPatchSchema = z.object({
  name: z.string().min(2).optional(),
  unit: z.string().min(1).optional(),
  note: z.string().max(2000).nullable().optional()
});

const consumableCardActionSchema = z.object({
  action: z.enum(["WRITE_OFF", "DISPUTE", "CLEAR_DISPUTE"]),
  comment: z.string().max(500).optional(),
  quantity: materialQtySchema.optional()
});

toolsRouter.get("/catalog/consumables/card/:stockId", async (req: AuthedRequest, res) => {
  const stockId = String(req.params.stockId);
  const scope = await resolveReadScope(req);
  const stock = await prisma.stock.findUnique({
    where: { id: stockId },
    include: {
      material: { select: { id: true, name: true, unit: true, toolCatalogSection: true } },
      warehouse: { select: { id: true, name: true } }
    }
  });
  if (!stock || stock.material.toolCatalogSection !== "TOOL_CONSUMABLE") {
    return res.status(404).json({ error: "Карточка расходника не найдена" });
  }
  try {
    assertWarehouseInScope(scope, stock.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  const events = await prisma.toolCatalogConsumableEvent.findMany({
    where: {
      materialId: stock.materialId,
      warehouseId: stock.warehouseId,
      section: stock.section,
      condition: stock.condition
    },
    orderBy: { createdAt: "desc" },
    take: 80
  });
  return res.json({
    key: `${stock.warehouseId}:${stock.materialId}:${stock.section}:${stock.condition}`,
    stockId: stock.id,
    materialId: stock.materialId,
    name: stock.material.name,
    unit: stock.material.unit,
    warehouseId: stock.warehouseId,
    warehouseName: stock.warehouse?.name ?? "—",
    section: stock.section,
    condition: stock.condition,
    quantity: Number(stock.quantity),
    reserved: Number(stock.reserved),
    disputed: stock.catalogDisputed,
    note: stock.catalogNote,
    cardStatus: stock.catalogDisputed ? "DISPUTED" : Number(stock.quantity) > 0 ? "IN_STOCK" : "WRITTEN_OFF",
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      comment: e.comment,
      createdAt: e.createdAt.toISOString()
    }))
  });
});

toolsRouter.patch("/catalog/consumables/card/:stockId", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const stockId = String(req.params.stockId);
  const parsed = consumableCardPatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  const scope = await getRequestDataScope(req);
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const stock = await tx.stock.findUnique({
        where: { id: stockId },
        include: { material: true }
      });
      if (!stock || stock.material.toolCatalogSection !== "TOOL_CONSUMABLE") {
        throw Object.assign(new Error("Карточка расходника не найдена"), { status: 404 });
      }
      assertWarehouseInScope(scope, stock.warehouseId);
      if (parsed.data.name != null || parsed.data.unit != null) {
        await tx.material.update({
          where: { id: stock.materialId },
          data: {
            ...(parsed.data.name != null ? { name: parsed.data.name.trim() } : {}),
            ...(parsed.data.unit != null ? { unit: parsed.data.unit.trim() } : {})
          }
        });
      }
      if (parsed.data.note !== undefined) {
        await tx.stock.update({
          where: { id: stockId },
          data: { catalogNote: parsed.data.note }
        });
      }
      await recordConsumableCatalogEvent(tx, {
        stockId,
        materialId: stock.materialId,
        warehouseId: stock.warehouseId,
        section: stock.section,
        condition: stock.condition,
        action: "EDIT",
        comment: "Изменены данные карточки",
        actorId: req.user!.userId
      });
      return tx.stock.findUnique({
        where: { id: stockId },
        include: {
          material: { select: { id: true, name: true, unit: true } },
          warehouse: { select: { id: true, name: true } }
        }
      });
    });
    await recordAudit({
      userId: req.user!.userId,
      action: "TOOL_CONSUMABLE_EDIT",
      entityType: "Stock",
      entityId: stockId,
      summary: `Изменена карточка расходника: ${updated?.material.name ?? stockId}`
    });
    return res.json(updated);
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status) return res.status(err.status).json({ error: err.message });
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.post("/catalog/consumables/card/:stockId/action", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const stockId = String(req.params.stockId);
  const parsed = consumableCardActionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  const scope = await getRequestDataScope(req);
  try {
    await prisma.$transaction(async (tx) => {
      const stock = await tx.stock.findUnique({
        where: { id: stockId },
        include: { material: true }
      });
      if (!stock || stock.material.toolCatalogSection !== "TOOL_CONSUMABLE") {
        throw Object.assign(new Error("Карточка расходника не найдена"), { status: 404 });
      }
      assertWarehouseInScope(scope, stock.warehouseId);
      const qty = Number(stock.quantity);
      const reserved = Number(stock.reserved);
      if (parsed.data.action === "WRITE_OFF") {
        const writeQty = parsed.data.quantity ?? qty;
        if (writeQty <= 0 || writeQty > qty) {
          throw Object.assign(new Error("Некорректное количество для списания"), { status: 400 });
        }
        if (reserved > 0 && writeQty > qty - reserved) {
          throw Object.assign(new Error("Часть остатка зарезервирована"), { status: 409 });
        }
        await tx.stock.update({
          where: { id: stockId },
          data: { quantity: { decrement: writeQty } }
        });
        await tx.stockMovement.create({
          data: {
            warehouseId: stock.warehouseId,
            materialId: stock.materialId,
            quantity: writeQty,
            direction: StockMovementDirection.OUT,
            sourceDocumentType: "TOOL_CONSUMABLE_WRITEOFF",
            note: parsed.data.comment?.trim() || "Списание расходника из каталога",
            createdById: req.user!.userId
          }
        });
        await recordConsumableCatalogEvent(tx, {
          stockId,
          materialId: stock.materialId,
          warehouseId: stock.warehouseId,
          section: stock.section,
          condition: stock.condition,
          action: "WRITE_OFF",
          comment: parsed.data.comment?.trim() || `Списано ${writeQty} ${stock.material.unit}`,
          actorId: req.user!.userId
        });
      } else if (parsed.data.action === "DISPUTE") {
        await tx.stock.update({
          where: { id: stockId },
          data: { catalogDisputed: true }
        });
        await recordConsumableCatalogEvent(tx, {
          stockId,
          materialId: stock.materialId,
          warehouseId: stock.warehouseId,
          section: stock.section,
          condition: stock.condition,
          action: "DISPUTE",
          comment: parsed.data.comment?.trim() || "Помечено спорным",
          actorId: req.user!.userId
        });
      } else if (parsed.data.action === "CLEAR_DISPUTE") {
        await tx.stock.update({
          where: { id: stockId },
          data: { catalogDisputed: false }
        });
        await recordConsumableCatalogEvent(tx, {
          stockId,
          materialId: stock.materialId,
          warehouseId: stock.warehouseId,
          section: stock.section,
          condition: stock.condition,
          action: "CLEAR_DISPUTE",
          comment: parsed.data.comment?.trim() || "Спор снят",
          actorId: req.user!.userId
        });
      }
    });
    await recordAudit({
      userId: req.user!.userId,
      action: "TOOL_CONSUMABLE_ACTION",
      entityType: "Stock",
      entityId: stockId,
      summary: `Действие по расходнику: ${parsed.data.action}`
    });
    return res.json({ ok: true });
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status) return res.status(err.status).json({ error: err.message });
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.delete("/catalog/consumables/card/:stockId", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const stockId = String(req.params.stockId);
  const scope = await getRequestDataScope(req);
  try {
    await prisma.$transaction(async (tx) => {
      const stock = await tx.stock.findUnique({
        where: { id: stockId },
        include: { material: true }
      });
      if (!stock || stock.material.toolCatalogSection !== "TOOL_CONSUMABLE") {
        throw Object.assign(new Error("Карточка расходника не найдена"), { status: 404 });
      }
      assertWarehouseInScope(scope, stock.warehouseId);
      if (Number(stock.quantity) > 0) {
        throw Object.assign(new Error("Удалить можно только при нулевом остатке — сначала спишите"), { status: 400 });
      }
      if (Number(stock.reserved) > 0) {
        throw Object.assign(new Error("Остаток зарезервирован"), { status: 409 });
      }
      const openIssues = await tx.toolConsumableIssue.count({
        where: { materialId: stock.materialId, warehouseId: stock.warehouseId, status: "OPEN" }
      });
      if (openIssues > 0) {
        throw Object.assign(new Error("Есть открытые выдачи расходника — сначала закройте их"), { status: 409 });
      }
      await recordConsumableCatalogEvent(tx, {
        stockId,
        materialId: stock.materialId,
        warehouseId: stock.warehouseId,
        section: stock.section,
        condition: stock.condition,
        action: "DELETE",
        comment: "Карточка удалена",
        actorId: req.user!.userId
      });
      await tx.stock.delete({ where: { id: stockId } });
      const otherStock = await tx.stock.count({
        where: {
          materialId: stock.materialId,
          OR: [{ quantity: { gt: 0 } }, { reserved: { gt: 0 } }]
        }
      });
      if (otherStock === 0) {
        await tx.material.update({
          where: { id: stock.materialId },
          data: { toolCatalogSection: null }
        });
      }
    });
    await recordAudit({
      userId: req.user!.userId,
      action: "TOOL_CONSUMABLE_DELETE",
      entityType: "Stock",
      entityId: stockId,
      summary: "Удалена карточка расходника"
    });
    return res.status(204).send();
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status) return res.status(err.status).json({ error: err.message });
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.post("/consumables/return", requirePermission("tools.write"), async (req: AuthedRequest, res) => {
  const parsed = consumableReturnSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  const scope = await getRequestDataScope(req);
  try {
    assertWarehouseInScope(scope, parsed.data.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  try {
    await prisma.$transaction(async (tx) => {
      for (const line of parsed.data.lines) {
        const issue = await tx.toolConsumableIssue.findFirst({
          where: { id: line.issueId, toolId: parsed.data.toolId, status: "OPEN" }
        });
        if (!issue) throw Object.assign(new Error("Строка расходника не найдена"), { status: 404 });
        const pending =
          Number(issue.qtyIssued) -
          Number(issue.qtyReturnedNew) -
          Number(issue.qtyReturnedUsed) -
          Number(issue.qtyWrittenOff);
        const totalReturn = line.qtyNew + line.qtyUsed + (line.writeoffQty ?? 0);
        if (totalReturn > pending + 0.0001) {
          throw Object.assign(new Error("Возвращаемое количество больше выданного"), { status: 409 });
        }
        if (line.qtyNew > 0) {
          await tx.stock.upsert({
            where: {
              warehouseId_materialId_section_condition: {
                warehouseId: parsed.data.warehouseId,
                materialId: issue.materialId,
                section: parsed.data.section,
                condition: StockCondition.NEW
              }
            },
            create: {
              warehouseId: parsed.data.warehouseId,
              materialId: issue.materialId,
              section: parsed.data.section,
              condition: StockCondition.NEW,
              quantity: line.qtyNew
            },
            update: { quantity: { increment: line.qtyNew } }
          });
        }
        if (line.qtyUsed > 0) {
          await tx.stock.upsert({
            where: {
              warehouseId_materialId_section_condition: {
                warehouseId: parsed.data.warehouseId,
                materialId: issue.materialId,
                section: parsed.data.section,
                condition: StockCondition.USED
              }
            },
            create: {
              warehouseId: parsed.data.warehouseId,
              materialId: issue.materialId,
              section: parsed.data.section,
              condition: StockCondition.USED,
              quantity: line.qtyUsed
            },
            update: { quantity: { increment: line.qtyUsed } }
          });
        }
        const writeoffQty = line.writeoffQty ?? 0;
        await tx.toolConsumableIssue.update({
          where: { id: issue.id },
          data: {
            qtyReturnedNew: { increment: line.qtyNew },
            qtyReturnedUsed: { increment: line.qtyUsed },
            qtyWrittenOff: { increment: writeoffQty },
            ...(writeoffQty > 0 && line.writeoffReason ? { writeoffReason: line.writeoffReason } : {}),
            status:
              Number(issue.qtyReturnedNew) +
                line.qtyNew +
                Number(issue.qtyReturnedUsed) +
                line.qtyUsed +
                Number(issue.qtyWrittenOff) +
                writeoffQty >=
              Number(issue.qtyIssued)
                ? "CLOSED"
                : "OPEN"
          }
        });
      }
    });
    return res.json({ ok: true });
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status) return res.status(err.status).json({ error: err.message });
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.get("/:id/open-consumables", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const scope = await resolveReadScope(req);
  const tool = await prisma.tool.findFirst({
    where: { AND: [toolWhereFromScope(scope), { id }] },
    include: { category: true }
  });
  if (!tool) return res.status(404).json({ error: "Tool not found" });
  const lines = await prisma.toolConsumableIssue.findMany({
    where: { toolId: id, status: "OPEN" },
    include: { material: { select: { id: true, name: true, unit: true } } },
    orderBy: { createdAt: "asc" }
  });
  const mapped = lines.map((l) => ({
    id: l.id,
    materialId: l.materialId,
    name: l.material.name,
    unit: l.material.unit,
    qtyIssued: Number(l.qtyIssued),
    qtyReturnedNew: Number(l.qtyReturnedNew),
    qtyReturnedUsed: Number(l.qtyReturnedUsed),
    qtyWrittenOff: Number(l.qtyWrittenOff),
    pending:
      Number(l.qtyIssued) -
      Number(l.qtyReturnedNew) -
      Number(l.qtyReturnedUsed) -
      Number(l.qtyWrittenOff)
  }));
  return res.json({
    hasOpen: mapped.some((m) => m.pending > 0),
    lines: mapped,
    isElectric: isElectricToolCategorySlug(tool.category?.slug ?? null)
  });
});

toolsRouter.get("/:id", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const scope = await getRequestDataScope(req);
  const tool = await prisma.tool.findFirst({
    where: { AND: [toolWhereFromScope(scope), { id }] },
    include: { warehouse: true, project: true, category: true }
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

    const qrPng = await QRCode.toBuffer(tool.qrCode, { margin: 0, width: 280, errorCorrectionLevel: "M" });
    drawToolLabelCell(doc, tool, x, y, cellWidth, cellHeight, qrPng);
  }

  doc.end();
});
