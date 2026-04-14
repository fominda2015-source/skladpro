import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const createProjectSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(1).optional()
});

export const projectsRouter = Router();
projectsRouter.use(requireAuth);
projectsRouter.use(requirePermission("limits.read"));

projectsRouter.get("/", async (_req, res) => {
  const rows = await prisma.project.findMany({
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return res.json(rows);
});

projectsRouter.post("/", requirePermission("limits.write"), async (req, res) => {
  const parsed = createProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const created = await prisma.project.create({
    data: {
      name: parsed.data.name,
      code: parsed.data.code
    }
  });
  return res.status(201).json(created);
});
