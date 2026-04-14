import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  assertProjectInScope,
  getRequestDataScope,
  projectLimitWhereFromScope
} from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createProjectLimitSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(2),
  version: z.number().int().positive().optional(),
  items: z
    .array(
      z.object({
        materialId: z.string().min(1),
        plannedQty: z.number().positive()
      })
    )
    .min(1)
});

export const projectLimitsRouter = Router();
projectLimitsRouter.use(requireAuth);
projectLimitsRouter.use(requirePermission("limits.read"));

projectLimitsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const projectId = typeof req.query.projectId === "string" ? req.query.projectId : undefined;
  if (projectId) {
    try {
      assertProjectInScope(scope, projectId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) {
        return res.status(403).json({ error: err.message });
      }
      throw e;
    }
  }
  const scopeParts: Prisma.ProjectLimitWhereInput[] = [];
  const base = projectLimitWhereFromScope(scope);
  if (Object.keys(base).length) {
    scopeParts.push(base);
  }
  if (projectId) {
    scopeParts.push({ projectId });
  }
  const where: Prisma.ProjectLimitWhereInput = scopeParts.length ? { AND: scopeParts } : {};

  const rows = await prisma.projectLimit.findMany({
    where,
    include: {
      project: true,
      items: { include: { material: true } }
    },
    orderBy: [{ projectId: "asc" }, { version: "desc" }],
    take: 200
  });
  return res.json(rows);
});

projectLimitsRouter.post("/", requirePermission("limits.write"), async (req: AuthedRequest, res) => {
  const parsed = createProjectLimitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const data = parsed.data;
  try {
    const scope = await getRequestDataScope(req);
    assertProjectInScope(scope, data.projectId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) {
      return res.status(403).json({ error: err.message });
    }
    throw e;
  }

  let version = data.version;
  if (!version) {
    const last = await prisma.projectLimit.findFirst({
      where: { projectId: data.projectId },
      orderBy: { version: "desc" }
    });
    version = (last?.version ?? 0) + 1;
  }

  const created = await prisma.projectLimit.create({
    data: {
      projectId: data.projectId,
      name: data.name,
      version,
      items: {
        create: data.items.map((item) => ({
          materialId: item.materialId,
          plannedQty: item.plannedQty
        }))
      }
    },
    include: { items: true }
  });
  return res.status(201).json(created);
});

projectLimitsRouter.get("/:id/summary", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const scope = await getRequestDataScope(req);
  const limScope = projectLimitWhereFromScope(scope);
  const row = await prisma.projectLimit.findFirst({
    where: Object.keys(limScope).length ? { AND: [{ id }, limScope] } : { id },
    include: { items: { include: { material: true } }, project: true }
  });
  if (!row) {
    return res.status(404).json({ error: "Limit not found" });
  }

  const summary = row.items.map((item) => {
    const planned = Number(item.plannedQty);
    const issued = Number(item.issuedQty);
    const reserved = Number(item.reservedQty);
    const remaining = planned - issued - reserved;
    return {
      materialId: item.materialId,
      materialName: item.material.name,
      plannedQty: planned,
      issuedQty: issued,
      reservedQty: reserved,
      remainingQty: remaining,
      isOver: remaining < 0
    };
  });
  return res.json({
    id: row.id,
    name: row.name,
    version: row.version,
    projectId: row.projectId,
    projectName: row.project.name,
    items: summary
  });
});
