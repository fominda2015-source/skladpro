import type { Prisma } from "@prisma/client";
import { OperationType } from "@prisma/client";
import { Router } from "express";
import {
  assertObjectSectionInScope,
  getRequestDataScope,
  resolveReadScope,
  type DataScope
} from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

export const stockMovementsRouter = Router();
stockMovementsRouter.use(requireAuth);
stockMovementsRouter.use(requirePermission("stocks.read"));

function movementScopeWhere(scope: DataScope): Prisma.StockMovementWhereInput {
  if (scope.unrestricted) {
    return {};
  }
  if (scope.sectionScopes.length) {
    return {
      OR: scope.sectionScopes.map((s) => ({
        warehouseId: s.warehouseId,
        OR: [
          { issueRequest: { is: { section: s.section } } },
          { operation: { is: { section: s.section } } }
        ]
      }))
    };
  }
  if (scope.warehouseIds?.length) {
    return { warehouseId: { in: scope.warehouseIds } };
  }
  return {};
}

stockMovementsRouter.get("/issued-summary", async (req: AuthedRequest, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const scope = await resolveReadScope(req, { warehouseId });
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : undefined;

  if (warehouseId && section) {
    try {
      assertObjectSectionInScope(scope, warehouseId, section);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
  }

  const parts: Prisma.StockMovementWhereInput[] = [{ direction: "OUT" }];
  const scoped = movementScopeWhere(scope);
  if (Object.keys(scoped).length) parts.push(scoped);
  if (warehouseId) parts.push({ warehouseId });
  if (section) {
    parts.push({
      OR: [
        { issueRequest: { is: { section } } },
        { operation: { is: { section } } }
      ]
    });
  }

  const rows = await prisma.stockMovement.groupBy({
    by: ["materialId"],
    where: parts.length > 1 ? { AND: parts } : parts[0],
    _sum: { quantity: true }
  });

  return res.json(
    rows.map((row) => ({
      materialId: row.materialId,
      issuedQty: Number(row._sum.quantity || 0)
    }))
  );
});

/** Сводка для количественной диаграммы лимита: приход по секции, расход по выдаче, остаток, «в закупке». */
stockMovementsRouter.get("/supply-metrics", async (req: AuthedRequest, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const scope = await resolveReadScope(req, { warehouseId });
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : undefined;

  if (!warehouseId || !section) {
    return res.status(400).json({ error: "warehouseId и section обязательны (SS|EOM)" });
  }
  try {
    assertObjectSectionInScope(scope, warehouseId, section);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }

  const scopedMovement = movementScopeWhere(scope);

  const basePartsIssued: Prisma.StockMovementWhereInput[] = [{ direction: "OUT" }];
  if (Object.keys(scopedMovement).length) basePartsIssued.push(scopedMovement);
  basePartsIssued.push({ warehouseId });
  basePartsIssued.push({
    OR: [
      { issueRequest: { is: { section } } },
      { operation: { is: { section } } }
    ]
  });

  const issuedRows = await prisma.stockMovement.groupBy({
    by: ["materialId"],
    where: basePartsIssued.length > 1 ? { AND: basePartsIssued } : basePartsIssued[0],
    _sum: { quantity: true }
  });

  const basePartsArrived: Prisma.StockMovementWhereInput[] = [{ direction: "IN" }];
  if (Object.keys(scopedMovement).length) basePartsArrived.push(scopedMovement);
  basePartsArrived.push({ warehouseId });
  basePartsArrived.push({
    operation: {
      is: {
        type: OperationType.INCOME,
        section,
        warehouseId
      }
    }
  });

  const arrivedRows = await prisma.stockMovement.groupBy({
    by: ["materialId"],
    where: basePartsArrived.length > 1 ? { AND: basePartsArrived } : basePartsArrived[0],
    _sum: { quantity: true }
  });

  const openReceiptItems = await prisma.receiptRequestItem.findMany({
    where: {
      receiptRequest: {
        warehouseId,
        section,
        status: { in: ["NEW", "IN_PROGRESS"] }
      }
    },
    select: {
      mappedMaterialId: true,
      quantity: true,
      acceptedQty: true,
      limitNode: { select: { materialId: true } }
    }
  });

  const onOrderByMaterial = new Map<string, number>();
  for (const it of openReceiptItems) {
    const mid = it.mappedMaterialId || it.limitNode?.materialId;
    if (!mid) continue;
    const rem = Math.max(0, Number(it.quantity) - Number(it.acceptedQty || 0));
    if (rem <= 0) continue;
    onOrderByMaterial.set(mid, (onOrderByMaterial.get(mid) || 0) + rem);
  }

  const stocks = await prisma.stock.findMany({
    where: { warehouseId, section },
    select: { materialId: true, quantity: true }
  });

  const stockByMat = new Map(stocks.map((s) => [s.materialId, Number(s.quantity) || 0]));

  const arrivedMap = new Map(
    arrivedRows.map((x) => [x.materialId, Number(x._sum.quantity || 0) || 0])
  );
  const issuedMap = new Map(
    issuedRows.map((x) => [x.materialId, Number(x._sum.quantity || 0) || 0])
  );

  const allIds = new Set<string>();
  for (const id of issuedMap.keys()) allIds.add(id);
  for (const id of arrivedMap.keys()) allIds.add(id);
  for (const id of onOrderByMaterial.keys()) allIds.add(id);
  for (const id of stockByMat.keys()) allIds.add(id);

  const out = [...allIds].map((materialId) => ({
    materialId,
    arrivedQty: arrivedMap.get(materialId) || 0,
    issuedQty: issuedMap.get(materialId) || 0,
    onOrderQty: onOrderByMaterial.get(materialId) || 0,
    stockQty: stockByMat.get(materialId) || 0
  }));

  return res.json(out);
});

stockMovementsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const materialId = typeof req.query.materialId === "string" ? req.query.materialId : undefined;
  const take = Math.min(Number(req.query.take) || 100, 500);

  if (warehouseId && !scope.unrestricted && scope.warehouseIds?.length && !scope.warehouseIds.includes(warehouseId)) {
    return res.status(403).json({ error: "FORBIDDEN_WAREHOUSE" });
  }

  const scopeWh = movementScopeWhere(scope);
  const parts: Prisma.StockMovementWhereInput[] = [];
  if (Object.keys(scopeWh).length) {
    parts.push(scopeWh);
  }
  if (warehouseId) {
    parts.push({ warehouseId });
  }
  if (materialId) {
    parts.push({ materialId });
  }
  const where: Prisma.StockMovementWhereInput = parts.length > 1 ? { AND: parts } : parts[0] ?? {};

  const rows = await prisma.stockMovement.findMany({
    where,
    include: {
      warehouse: { select: { id: true, name: true } },
      material: { select: { id: true, name: true, unit: true } },
      operation: { select: { id: true, type: true, documentNumber: true } },
      issueRequest: { select: { id: true, number: true } }
    },
    orderBy: { createdAt: "desc" },
    take
  });
  return res.json(rows);
});
