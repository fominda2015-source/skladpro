import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { getRequestDataScope } from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

export const stockMovementsRouter = Router();
stockMovementsRouter.use(requireAuth);
stockMovementsRouter.use(requirePermission("stocks.read"));

stockMovementsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const materialId = typeof req.query.materialId === "string" ? req.query.materialId : undefined;
  const take = Math.min(Number(req.query.take) || 100, 500);

  if (warehouseId && !scope.unrestricted && scope.warehouseIds?.length && !scope.warehouseIds.includes(warehouseId)) {
    return res.status(403).json({ error: "FORBIDDEN_WAREHOUSE" });
  }

  const scopeWh: Prisma.StockMovementWhereInput =
    scope.unrestricted || !scope.warehouseIds?.length ? {} : { warehouseId: { in: scope.warehouseIds } };
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
