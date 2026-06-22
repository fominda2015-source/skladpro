import { Router } from "express";
import { z } from "zod";
import { MaterialKind, StockCondition, StockMovementDirection } from "@prisma/client";
import { warehouseReceiptCategoryToMaterialFields, WAREHOUSE_RECEIPT_CATEGORIES } from "../lib/warehouseStock.js";
import { recordAudit } from "../lib/audit.js";
import {
  assertObjectSectionInScope,
  assertWarehouseInScope,
  getRequestDataScope,
  resolveReadScope,
  stockWhereForQuery
} from "../lib/dataScope.js";
import { isScopeForbiddenError, respondScopeForbidden } from "../lib/accessScope.js";
import { prisma } from "../lib/prisma.js";
import { materialQtyCoerceSchema, qtyFromDb } from "../lib/quantity.js";
import { loadMaterialPriceBasisMap, materialAmountsForQty } from "../lib/materialPricing.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

export const stocksRouter = Router();
stocksRouter.use(requireAuth);
stocksRouter.use(requirePermission("stocks.read"));

const manualStockLineSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  materialName: z.string().trim().min(1).max(800),
  quantity: materialQtyCoerceSchema,
  unit: z.string().trim().min(1).max(64).optional().default("шт"),
  warehouseCategory: z.enum(WAREHOUSE_RECEIPT_CATEGORIES).optional().default("EQUIPMENT"),
  unitPrice: z.coerce.number().nonnegative().optional().nullable()
});

stocksRouter.post("/manual-line", requirePermission("operations.write"), async (req: AuthedRequest, res) => {
  const parsed = manualStockLineSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    const scope = await getRequestDataScope(req);
    assertObjectSectionInScope(scope, parsed.data.warehouseId, parsed.data.section);

    const name = parsed.data.materialName.trim();
    const qty = parsed.data.quantity;
    const unit = parsed.data.unit.trim() || "шт";

    const { kind, category } = warehouseReceiptCategoryToMaterialFields(parsed.data.warehouseCategory);

    const { materialId } = await prisma.$transaction(async (tx) => {
      const material = await tx.material.create({
        data: {
          name,
          unit,
          kind,
          category: category ?? undefined,
          unitPrice: parsed.data.unitPrice ?? undefined,
          ...(parsed.data.unitPrice != null && qty > 0 ? { priceBasisQty: qty } : {})
        },
        select: { id: true }
      });

      const stockKey = {
        warehouseId_materialId_section_condition: {
          warehouseId: parsed.data.warehouseId,
          materialId: material.id,
          section: parsed.data.section,
          condition: StockCondition.NEW
        }
      };
      const existing = await tx.stock.findUnique({ where: stockKey });

      if (existing) {
        await tx.stock.update({
          where: stockKey,
          data: { quantity: { increment: qty } }
        });
      } else {
        await tx.stock.create({
          data: {
            warehouseId: parsed.data.warehouseId,
            materialId: material.id,
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
          materialId: material.id,
          quantity: qty,
          direction: StockMovementDirection.IN,
          sourceDocumentType: "MANUAL_WAREHOUSE",
          note: "Ручная строка со вкладки «Склад»",
          createdById: req.user!.userId
        }
      });

      return { materialId: material.id };
    });

    await recordAudit({
      userId: req.user!.userId,
      action: "STOCK_MANUAL_LINE",
      entityType: "Stock",
      entityId: `${parsed.data.warehouseId}:${materialId}:${parsed.data.section}`,
      summary: `Ручное добавление: ${name}, +${qty} ${unit}`,
      after: {
        warehouseId: parsed.data.warehouseId,
        section: parsed.data.section,
        materialId,
        quantity: qty,
        unit,
        materialName: name
      }
    });

    return res.status(201).json({ ok: true, materialId });
  } catch (error) {
    const err = error as Error & { status?: number };
    if (isScopeForbiddenError(err)) {
      return respondScopeForbidden(res, err);
    }
    return res.status(500).json({ error: "Failed to create manual stock line" });
  }
});

stocksRouter.get("/peer-summaries", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const excludeWarehouseId =
    typeof req.query.excludeWarehouseId === "string" ? req.query.excludeWarehouseId : undefined;
  const sectionParam = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionParam === "SS" || sectionParam === "EOM" ? sectionParam : undefined;

  let warehouseIdList: string[];
  if (scope.unrestricted && !scope.warehouseIds?.length) {
    const whs = await prisma.warehouse.findMany({
      where: { isActive: true },
      select: { id: true },
      orderBy: { name: "asc" }
    });
    warehouseIdList = whs.map((w) => w.id);
  } else if (scope.warehouseIds?.length) {
    warehouseIdList = scope.warehouseIds;
  } else {
    return res.json([]);
  }

  const filtered = warehouseIdList.filter((id) => id !== excludeWarehouseId);
  if (!filtered.length) {
    return res.json([]);
  }

  const grouped = await prisma.stock.groupBy({
    by: ["warehouseId"],
    where: {
      warehouseId: { in: filtered },
      ...stockWhereForQuery(scope, { section })
    },
    _sum: { quantity: true },
    _count: { _all: true }
  });

  const names = await prisma.warehouse.findMany({
    where: { id: { in: grouped.map((g) => g.warehouseId) } },
    select: { id: true, name: true }
  });
  const nameById = Object.fromEntries(names.map((w) => [w.id, w.name]));

  return res.json(
    grouped.map((g) => ({
      warehouseId: g.warehouseId,
      warehouseName: nameById[g.warehouseId] ?? g.warehouseId,
      stockLines: g._count._all,
      totalQty: Number(g._sum.quantity ?? 0)
    }))
  );
});

stocksRouter.get("/", async (req: AuthedRequest, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const materialId = typeof req.query.materialId === "string" ? req.query.materialId : undefined;
  const sectionParam = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionParam === "SS" || sectionParam === "EOM" ? sectionParam : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const onlyLow =
    typeof req.query.onlyLow === "string" ? ["1", "true", "yes"].includes(req.query.onlyLow) : false;

  const scope = await resolveReadScope(req, { warehouseId });
  if (warehouseId && section) {
    try {
      assertObjectSectionInScope(scope, warehouseId, section);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (isScopeForbiddenError(err)) return respondScopeForbidden(res, err);
      throw e;
    }
  } else if (warehouseId) {
    try {
      assertWarehouseInScope(scope, warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (isScopeForbiddenError(err)) return respondScopeForbidden(res, err);
      throw e;
    }
  }

  const kindParam = typeof req.query.kind === "string" ? req.query.kind.toUpperCase() : "";
  const kindFilter =
    kindParam === "MATERIAL" || kindParam === "CONSUMABLE" || kindParam === "WORKWEAR"
      ? { material: { kind: kindParam as MaterialKind } }
      : {};

  const rows = await prisma.stock.findMany({
    where: {
      AND: [
        stockWhereForQuery(scope, { warehouseId, section }),
        {
          ...(materialId ? { materialId } : {}),
          ...kindFilter,
      ...(q
        ? {
            material: {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { sku: { contains: q, mode: "insensitive" } },
                { synonyms: { some: { value: { contains: q, mode: "insensitive" } } } }
              ]
            }
          }
        : {})
        }
      ]
    },
    include: {
      warehouse: true,
      material: {
        include: { synonyms: true }
      }
    },
    orderBy: [{ warehouse: { name: "asc" } }, { material: { name: "asc" } }],
    take: 500
  });

  const materialIds = [...new Set(rows.map((row) => row.materialId))];
  const priceBasisMap = await loadMaterialPriceBasisMap(materialIds);

  const mapped = rows.map((row) => {
    const qty = qtyFromDb(row.quantity);
    const reserved = qtyFromDb(row.reserved);
    const available = qty - reserved;
    const lineTotal = row.material.unitPrice != null ? Number(row.material.unitPrice) : null;
    const priceBasisQty =
      row.material.priceBasisQty != null ? Number(row.material.priceBasisQty) : null;
    const amounts = materialAmountsForQty(priceBasisMap.get(row.materialId), qty);
    return {
      id: row.id,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      section: row.section,
      materialId: row.materialId,
      materialName: row.material.name,
      materialSku: row.material.sku,
      materialUnit: row.material.unit,
      materialKind: row.material.kind,
      materialCategory: row.material.category,
      materialToolCatalogSection: row.material.toolCatalogSection,
      unitPrice: lineTotal,
      lineTotal,
      priceBasisQty: amounts.priceBasisQty ?? priceBasisQty,
      unitCost: amounts.unitCost,
      stockAmount: amounts.totalAmount,
      quantity: qty,
      reserved,
      storageRoom: row.storageRoom,
      storageCell: row.storageCell,
      available,
      isLow: available <= 0,
      updatedAt: row.updatedAt
    };
  });

  return res.json(onlyLow ? mapped.filter((x) => x.isLow) : mapped);
});

const adjustStockQuantitySchema = z.object({
  quantity: materialQtyCoerceSchema,
  note: z.string().trim().max(500).optional()
});

stocksRouter.patch("/:id/quantity", requirePermission("operations.write"), async (req: AuthedRequest, res) => {
  const parsed = adjustStockQuantitySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const id = String(req.params.id);
  const row = await prisma.stock.findUnique({
    where: { id },
    include: { material: { select: { name: true, unit: true } }, warehouse: { select: { name: true } } }
  });
  if (!row) return res.status(404).json({ error: "Stock line not found" });

  try {
    const scope = await getRequestDataScope(req);
    assertObjectSectionInScope(scope, row.warehouseId, row.section);

    const prevQty = qtyFromDb(row.quantity);
    const reserved = qtyFromDb(row.reserved);
    const nextQty = parsed.data.quantity;
    if (nextQty < reserved) {
      return res.status(400).json({
        error: `Остаток не может быть меньше резерва (${reserved})`
      });
    }
    const delta = nextQty - prevQty;
    if (Math.abs(delta) < 1e-9) {
      return res.json({
        ok: true,
        id: row.id,
        quantity: nextQty,
        reserved,
        available: nextQty - reserved
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.stock.update({
        where: { id: row.id },
        data: { quantity: nextQty }
      });
      await tx.stockMovement.create({
        data: {
          warehouseId: row.warehouseId,
          materialId: row.materialId,
          quantity: Math.abs(delta),
          direction: delta > 0 ? StockMovementDirection.IN : StockMovementDirection.OUT,
          sourceDocumentType: "STOCK_ADJUSTMENT",
          sourceDocumentId: row.id,
          note:
            parsed.data.note?.trim() ||
            `Корректировка остатка: ${prevQty} → ${nextQty} ${row.material.unit}`,
          createdById: req.user!.userId
        }
      });
    });

    await recordAudit({
      userId: req.user!.userId,
      action: "STOCK_QUANTITY_ADJUST",
      entityType: "Stock",
      entityId: row.id,
      summary: `Остаток: ${row.material.name} (${row.warehouse.name}), ${prevQty} → ${nextQty} ${row.material.unit}`,
      before: { quantity: prevQty, reserved },
      after: { quantity: nextQty, reserved, note: parsed.data.note ?? null }
    });

    return res.json({
      ok: true,
      id: row.id,
      quantity: nextQty,
      reserved,
      available: nextQty - reserved
    });
  } catch (error) {
    const err = error as Error & { status?: number };
    if (isScopeForbiddenError(err)) {
      return respondScopeForbidden(res, err);
    }
    return res.status(500).json({ error: "Failed to adjust stock quantity" });
  }
});
