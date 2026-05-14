import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createSchema = z.object({
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(12000),
  isPinned: z.boolean().optional(),
  expiresAt: z.string().datetime().optional().nullable()
});

const patchSchema = createSchema.partial();

export const announcementsRouter = Router();
announcementsRouter.use(requireAuth);

announcementsRouter.get("/", async (_req: AuthedRequest, res) => {
  const now = new Date();
  const rows = await prisma.announcement.findMany({
    where: {
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }]
    },
    orderBy: [{ isPinned: "desc" }, { createdAt: "desc" }],
    take: 50,
    include: { author: { select: { id: true, fullName: true } } }
  });
  return res.json(rows);
});

announcementsRouter.post("/", requirePermission("announcements.write"), async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const row = await prisma.announcement.create({
    data: {
      title: parsed.data.title.trim(),
      body: parsed.data.body.trim(),
      isPinned: parsed.data.isPinned ?? false,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      authorId: req.user!.userId
    },
    include: { author: { select: { id: true, fullName: true } } }
  });
  return res.status(201).json(row);
});

announcementsRouter.patch("/:id", requirePermission("announcements.write"), async (req: AuthedRequest, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
  if (!id) {
    return res.status(400).json({ error: "BAD_ID" });
  }
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const body = parsed.data;
  const data: {
    title?: string;
    body?: string;
    isPinned?: boolean;
    expiresAt?: Date | null;
  } = {};
  if (body.title !== undefined) data.title = body.title.trim();
  if (body.body !== undefined) data.body = body.body.trim();
  if (body.isPinned !== undefined) data.isPinned = body.isPinned;
  if (body.expiresAt !== undefined) data.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;

  if (!Object.keys(data).length) {
    return res.status(400).json({ error: "No fields to update" });
  }

  try {
    const row = await prisma.announcement.update({
      where: { id },
      data,
      include: { author: { select: { id: true, fullName: true } } }
    });
    return res.json(row);
  } catch {
    return res.status(404).json({ error: "Not found" });
  }
});

announcementsRouter.delete("/:id", requirePermission("announcements.write"), async (req: AuthedRequest, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
  if (!id) {
    return res.status(400).json({ error: "BAD_ID" });
  }
  try {
    await prisma.announcement.delete({ where: { id } });
    return res.json({ ok: true });
  } catch {
    return res.status(404).json({ error: "Not found" });
  }
});
