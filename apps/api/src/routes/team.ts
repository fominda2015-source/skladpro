import { Router } from "express";
import { NotificationLevel } from "@prisma/client";
import { z } from "zod";
import { notifyUser } from "../lib/notifications.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createTaskSchema = z.object({
  assigneeId: z.string().min(1),
  title: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  projectId: z.string().min(1).optional(),
  warehouseId: z.string().min(1).optional(),
  dueAt: z.string().datetime().optional()
});
const updateTaskStatusSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "DONE", "VERIFIED"])
});

export const teamRouter = Router();
teamRouter.use(requireAuth);
teamRouter.use(requirePermission("team.read"));

teamRouter.get("/employees", async (_req, res) => {
  const users = await prisma.user.findMany({
    include: {
      role: true,
      warehouseScopes: { include: { warehouse: true } },
      projectScopes: { include: { project: true } }
    },
    orderBy: [{ fullName: "asc" }]
  });

  return res.json(
    users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      avatarUrl: u.avatarUrl,
      role: u.role.name,
      status: u.status,
      warehouses: u.warehouseScopes.map((x) => ({ id: x.warehouseId, name: x.warehouse.name })),
      projects: u.projectScopes.map((x) => ({ id: x.projectId, name: x.project.name }))
    }))
  );
});

teamRouter.get("/tasks", async (req: AuthedRequest, res) => {
  const mineOnly = req.query.mineOnly === "1";
  const rows = await prisma.staffTask.findMany({
    where: mineOnly ? { assigneeId: req.user!.userId } : undefined,
    include: {
      assignee: { include: { role: true } },
      createdBy: { include: { role: true } },
      project: true,
      warehouse: true
    },
    orderBy: [{ createdAt: "desc" }],
    take: 300
  });
  return res.json(rows);
});

teamRouter.post("/tasks", requirePermission("team.tasks.write"), async (req: AuthedRequest, res) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const created = await prisma.staffTask.create({
    data: {
      assigneeId: parsed.data.assigneeId,
      title: parsed.data.title.trim(),
      description: parsed.data.description?.trim(),
      projectId: parsed.data.projectId,
      warehouseId: parsed.data.warehouseId,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      createdById: req.user!.userId
    },
    include: {
      assignee: { include: { role: true } },
      createdBy: { include: { role: true } },
      project: true,
      warehouse: true
    }
  });

  if (created.assigneeId !== req.user!.userId) {
    await notifyUser({
      userId: created.assigneeId,
      title: "Новая задача от руководителя",
      message: `Вам поставлена задача: "${created.title}".`,
      level: NotificationLevel.INFO,
      entityType: "StaffTask",
      entityId: created.id
    });
  }

  return res.status(201).json(created);
});

teamRouter.patch("/tasks/:id/close", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const task = await prisma.staffTask.findUnique({ where: { id } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (task.assigneeId !== req.user!.userId && task.createdById !== req.user!.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const updated = await prisma.staffTask.update({
    where: { id },
    data: { status: "DONE" }
  });
  return res.json(updated);
});

teamRouter.patch("/tasks/:id/status", async (req: AuthedRequest, res) => {
  const parsed = updateTaskStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const id = String(req.params.id);
  const task = await prisma.staffTask.findUnique({ where: { id } });
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (task.assigneeId !== req.user!.userId && task.createdById !== req.user!.userId) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const updated = await prisma.staffTask.update({
    where: { id },
    data: { status: parsed.data.status }
  });
  return res.json(updated);
});
