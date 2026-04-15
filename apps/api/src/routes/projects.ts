import { Router } from "express";
import { z } from "zod";
import { getRequestDataScope, projectWhereFromScope } from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createProjectSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(1).optional(),
  warehouseIds: z.array(z.string().min(1)).default([])
});

export const projectsRouter = Router();
projectsRouter.use(requireAuth);
projectsRouter.use(requirePermission("limits.read"));

projectsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const rows = await prisma.project.findMany({
    where: projectWhereFromScope(scope),
    include: { warehouseLinks: { select: { warehouseId: true } } },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return res.json(rows.map((p) => ({ ...p, warehouseIds: p.warehouseLinks.map((x) => x.warehouseId) })));
});

projectsRouter.post("/", requirePermission("limits.write"), async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const created = await prisma.project.create({
    data: {
      name: parsed.data.name,
      code: parsed.data.code,
      warehouseLinks: parsed.data.warehouseIds.length
        ? { create: parsed.data.warehouseIds.map((warehouseId) => ({ warehouseId })) }
        : undefined
    },
    include: { warehouseLinks: { select: { warehouseId: true } } }
  });
  return res.status(201).json({ ...created, warehouseIds: created.warehouseLinks.map((x) => x.warehouseId) });
});
