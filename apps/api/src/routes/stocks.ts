import { Router } from "express";
import { z } from "zod";
import { StockMovementDirection } from "@prisma/client";
import { recordAudit } from "../lib/audit.js";
import {
  assertObjectSectionInScope,
  getRequestDataScope,
  stockWhereFromScope
} from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

export const stocksRouter = Router();
stocksRouter.use(requireAuth);
stocksRouter.use(requirePermission("stocks.read"));

const manualStockLineSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  materialName: z.string().trim().min(1).max(800),
  quantity: z.coerce.number().positive().max(1_000_000_000),
  unit: z.string().trim().min(1).max(64).optional().default("шт")
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

    const { materialId } = await prisma.$transaction(async (tx) => {
      const material = await tx.material.create({
        data: {
          name,
          unit
        },
        select: { id: true }
      });

      const existing = await tx.stock.findUnique({
        where: {
          warehouseId_materialId_section: {
            warehouseId: parsed.data.warehouseId,
            materialId: material.id,
            section: parsed.data.section
          }
        }
      });

      if (existing) {
        await tx.stock.update({
          where: {
            warehouseId_materialId_section: {
              warehouseId: parsed.data.warehouseId,
              materialId: material.id,
              section: parsed.data.section
            }
          },
          data: { quantity: { increment: qty } }
        });
      } else {
        await tx.stock.create({
          data: {
            warehouseId: parsed.data.warehouseId,
            materialId: material.id,
            section: parsed.data.section,
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
    if (err.status === 403) {
      return res.status(403).json({ error: err.message });
    }
    return res.status(500).json({ error: "Failed to create manual stock line" });
  }
});

stocksRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const materialId = typeof req.query.materialId === "string" ? req.query.materialId : undefined;
  const sectionParam = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionParam === "SS" || sectionParam === "EOM" ? sectionParam : undefined;
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const onlyLow =
    typeof req.query.onlyLow === "string" ? ["1", "true", "yes"].includes(req.query.onlyLow) : false;

  if (warehouseId && !scope.unrestricted && scope.warehouseIds?.length && !scope.warehouseIds.includes(warehouseId)) {
    return res.status(403).json({ error: "FORBIDDEN_WAREHOUSE" });
  }

  const rows = await prisma.stock.findMany({
    where: {
      AND: [
        stockWhereFromScope(scope),
        {
          ...(warehouseId ? { warehouseId } : {}),
          ...(materialId ? { materialId } : {}),
          ...(section ? { section } : {}),
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

  const mapped = rows.map((row) => {
    const qty = Number(row.quantity);
    const reserved = Number(row.reserved);
    const available = qty - reserved;
    return {
      id: row.id,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouse.name,
      section: row.section,
      materialId: row.materialId,
      materialName: row.material.name,
      materialSku: row.material.sku,
      materialUnit: row.material.unit,
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
