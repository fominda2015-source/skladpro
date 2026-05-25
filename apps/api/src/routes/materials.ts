import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { handlePrismaError } from "../lib/errors.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { MaterialKind } from "@prisma/client";

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
