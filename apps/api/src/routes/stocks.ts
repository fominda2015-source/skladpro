import { Router } from "express";
import { getRequestDataScope, stockWhereFromScope } from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

export const stocksRouter = Router();
stocksRouter.use(requireAuth);
stocksRouter.use(requirePermission("stocks.read"));

stocksRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const materialId = typeof req.query.materialId === "string" ? req.query.materialId : undefined;
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
      materialId: row.materialId,
      materialName: row.material.name,
      materialSku: row.material.sku,
      materialUnit: row.material.unit,
      quantity: qty,
      reserved,
      available,
      isLow: available <= 0,
      updatedAt: row.updatedAt
    };
  });

  return res.json(onlyLow ? mapped.filter((x) => x.isLow) : mapped);
});
