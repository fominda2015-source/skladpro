import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { handlePrismaError } from "../lib/errors.js";
import { isAdminEquivalent } from "../lib/openAccess.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { MaterialKind } from "@prisma/client";

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (!isAdminEquivalent(req.user.role)) {
    return res.status(403).json({ error: "Только администратор может выполнять эту операцию" });
  }
  return next();
}

const createMaterialSchema = z.object({
  name: z.string().min(2),
  sku: z.string().min(1).optional(),
  unit: z.string().min(1),
  kind: z.nativeEnum(MaterialKind).optional(),
  unitPrice: z.coerce.number().nonnegative().optional().nullable(),
  category: z.string().min(1).optional(),
  synonyms: z.array(z.string().min(1)).optional()
});

const updateMaterialSchema = z.object({
  name: z.string().min(2).optional(),
  sku: z.string().min(1).nullable().optional(),
  unit: z.string().min(1).optional(),
  kind: z.nativeEnum(MaterialKind).optional(),
  unitPrice: z.coerce.number().nonnegative().nullable().optional(),
  category: z.string().min(1).nullable().optional()
});

const addSynonymSchema = z.object({
  value: z.string().min(1)
});

export const materialsRouter = Router();
materialsRouter.use(requireAuth);
materialsRouter.use(requirePermission("materials.read"));

materialsRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
  const unit = typeof req.query.unit === "string" ? req.query.unit.trim() : "";
  const kindParam = typeof req.query.kind === "string" ? req.query.kind.toUpperCase() : "";
  const kindFilter =
    kindParam === "MATERIAL" || kindParam === "CONSUMABLE" || kindParam === "WORKWEAR"
      ? { kind: kindParam as MaterialKind }
      : {};
  const includeMerged = req.query.includeMerged === "1";
  const expandMerged = req.query.expandMerged === "1";

  const rows = await prisma.material.findMany({
    where: {
      ...(includeMerged ? {} : { mergedIntoId: null }),
      ...kindFilter,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { sku: { contains: q, mode: "insensitive" } },
              { synonyms: { some: { value: { contains: q, mode: "insensitive" } } } }
            ]
          }
        : {}),
      ...(category ? { category: { equals: category, mode: "insensitive" } } : {}),
      ...(unit ? { unit: { equals: unit, mode: "insensitive" } } : {})
    },
    include: {
      synonyms: true,
      ...(expandMerged
        ? {
            mergedFrom: {
              where: includeMerged ? {} : { mergedIntoId: { not: null } },
              include: { synonyms: true }
            }
          }
        : {})
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });

  return res.json(rows);
});

materialsRouter.post("/", requirePermission("materials.write"), async (req, res) => {
  const parsed = createMaterialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const data = parsed.data;
  try {
    const created = await prisma.material.create({
      data: {
        name: data.name,
        sku: data.sku,
        unit: data.unit,
        kind: data.kind ?? MaterialKind.MATERIAL,
        unitPrice: data.unitPrice ?? undefined,
        category: data.category,
        synonyms: data.synonyms?.length
          ? { create: data.synonyms.map((value) => ({ value: value.trim() })) }
          : undefined
      },
      include: { synonyms: true }
    });

    return res.status(201).json(created);
  } catch (error) {
    const handled = handlePrismaError(error);
    return res.status(handled.status).json(handled.body);
  }
});

materialsRouter.get("/:id", async (req, res) => {
  const materialId = String(req.params.id);
  const row = await prisma.material.findUnique({
    where: { id: materialId },
    include: { synonyms: { orderBy: { value: "asc" } } }
  });
  if (!row) {
    return res.status(404).json({ error: "Material not found" });
  }
  return res.json(row);
});

materialsRouter.patch("/:id", requirePermission("materials.write"), async (req, res) => {
  const parsed = updateMaterialSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const materialId = String(req.params.id);
  try {
    const updated = await prisma.material.update({
      where: { id: materialId },
      data: parsed.data,
      include: { synonyms: true }
    });

    return res.json(updated);
  } catch (error) {
    const handled = handlePrismaError(error);
    return res.status(handled.status).json(handled.body);
  }
});

materialsRouter.post(
  "/:id/synonyms",
  requirePermission("materials.write"),
  async (req, res) => {
    const parsed = addSynonymSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }

    const materialId = String(req.params.id);
    try {
      const synonym = await prisma.materialSynonym.create({
        data: {
          materialId,
          value: parsed.data.value.trim()
        }
      });

      return res.status(201).json(synonym);
    } catch (error) {
      const handled = handlePrismaError(error);
      return res.status(handled.status).json(handled.body);
    }
  }
);

materialsRouter.delete(
  "/:id/synonyms/:synonymId",
  requirePermission("materials.write"),
  async (req, res) => {
    const materialId = String(req.params.id);
    const synonymId = String(req.params.synonymId);

    const deleted = await prisma.materialSynonym.deleteMany({
      where: { id: synonymId, materialId }
    });

    if (!deleted.count) {
      return res.status(404).json({ error: "Synonym not found" });
    }

    return res.status(204).send();
  }
);

// Удаление материала из каталога. Только для администратора.
// Без `?force=1`: блокируется 409, если на материал ссылаются документы (остатки, заявки, операции и т.п.).
// С `?force=1`: в одной транзакции зачищаются все ссылки (Stock/StockMovement/Operation* через каскады
// невозможно — поля Restrict), а сама позиция удаляется только после очистки этих записей.
materialsRouter.delete("/:id", requireAdmin, async (req: AuthedRequest, res) => {
  const materialId = String(req.params.id);
  const material = await prisma.material.findUnique({
    where: { id: materialId },
    select: { id: true, name: true }
  });
  if (!material) return res.status(404).json({ error: "Material not found" });

  const force =
    String(req.query.force ?? "").toLowerCase() === "1" ||
    String(req.query.force ?? "").toLowerCase() === "true" ||
    (req.body && (req.body as { force?: unknown }).force === true);

  // Соберём счётчики связей, которые блокируют удаление (поля с onDelete: Restrict).
  const [
    stockMovementCount,
    operationItemCount,
    issueItemCount,
    receiptItemCount,
    projectLimitItemCount,
    transferLineCount,
    holderWriteoffCount,
    mappingCount
  ] = await Promise.all([
    prisma.stockMovement.count({ where: { materialId } }),
    prisma.operationItem.count({ where: { materialId } }),
    prisma.issueRequestItem.count({ where: { materialId } }),
    prisma.receiptRequestItem.count({ where: { mappedMaterialId: materialId } }),
    prisma.projectLimitItem.count({ where: { materialId } }),
    prisma.transferRequestLine.count({ where: { materialId } }),
    prisma.materialHolderWriteoff.count({ where: { materialId } }),
    prisma.materialMappingLibrary.count({ where: { targetMaterialId: materialId } })
  ]);

  const totalRefs =
    stockMovementCount +
    operationItemCount +
    issueItemCount +
    receiptItemCount +
    projectLimitItemCount +
    transferLineCount +
    holderWriteoffCount +
    mappingCount;

  if (totalRefs > 0 && !force) {
    return res.status(409).json({
      error: "MATERIAL_HAS_REFERENCES",
      stockMovements: stockMovementCount,
      operationItems: operationItemCount,
      issueItems: issueItemCount,
      receiptItems: receiptItemCount,
      limitItems: projectLimitItemCount,
      transferLines: transferLineCount,
      materialReport: holderWriteoffCount,
      mappings: mappingCount,
      hint: "Передайте force=1, чтобы удалить вместе со всей историей по позиции."
    });
  }

  await prisma.$transaction(
    async (tx) => {
      if (force && totalRefs > 0) {
        // Зачищаем Restrict-связи. Cascade (Stock, MaterialSynonym) удалятся сами при .delete().
        await tx.stockMovement.deleteMany({ where: { materialId } });
        await tx.operationItem.deleteMany({ where: { materialId } });
        await tx.issueRequestItem.deleteMany({ where: { materialId } });
        await tx.receiptRequestItem.updateMany({
          where: { mappedMaterialId: materialId },
          data: { mappedMaterialId: null }
        });
        await tx.projectLimitItem.deleteMany({ where: { materialId } });
        await tx.transferRequestLine.deleteMany({ where: { materialId } });
        await tx.materialHolderWriteoff.deleteMany({ where: { materialId } });
        await tx.materialMappingLibrary.deleteMany({ where: { targetMaterialId: materialId } });
        // ObjectLimitNode.materialId — SetNull, очистим явно для чистоты данных.
        await tx.objectLimitNode.updateMany({
          where: { materialId },
          data: { materialId: null }
        });
        // Material.mergedIntoId — если кто-то указывал этот материал как «слитый в», обнулим.
        await tx.material.updateMany({
          where: { mergedIntoId: materialId },
          data: { mergedIntoId: null }
        });
      }
      await tx.material.delete({ where: { id: materialId } });
    },
    { timeout: 60_000 }
  );

  return res.json({ ok: true, force, wiped: force && totalRefs > 0, name: material.name });
});
