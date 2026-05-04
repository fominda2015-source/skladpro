import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { assertObjectSectionInScope, getRequestDataScope, type DataScope } from "../lib/dataScope.js";
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
  const scope = await getRequestDataScope(req);
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
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
