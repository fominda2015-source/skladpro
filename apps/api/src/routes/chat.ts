import { ConversationKind } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

const dmSchema = z.object({
  userId: z.string().min(1)
});

const messageSchema = z.object({
  text: z.string().min(1).max(4000),
  attachments: z
    .array(
      z.object({
        fileName: z.string().min(1),
        mimeType: z.string().optional(),
        dataUrl: z.string().min(1).max(500000)
      })
    )
    .default([])
});

export const chatRouter = Router();
chatRouter.use(requireAuth);

async function ensureParticipant(conversationId: string, userId: string) {
  const p = await prisma.conversationParticipant.findFirst({
    where: { conversationId, userId }
  });
  return Boolean(p);
}

chatRouter.get("/users", async (req: AuthedRequest, res) => {
  const me = req.user!.userId;
  const rows = await prisma.user.findMany({
    where: { id: { not: me }, status: "ACTIVE" },
    include: { role: true, position: true },
    orderBy: { fullName: "asc" },
    take: 500
  });
  return res.json(
    rows.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      avatarUrl: u.avatarUrl,
      role: u.role.name,
      position: u.position?.name || null
    }))
  );
});

chatRouter.get("/conversations", async (req: AuthedRequest, res) => {
  const me = req.user!.userId;
  const rows = await prisma.conversation.findMany({
    where: { participants: { some: { userId: me } } },
    include: {
      participants: { include: { user: { include: { role: true, position: true } } } },
      messages: {
        include: { sender: true, attachments: true },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    },
    orderBy: { updatedAt: "desc" },
    take: 200
  });
  return res.json(rows);
});

chatRouter.post("/conversations/dm", async (req: AuthedRequest, res) => {
  const parsed = dmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const me = req.user!.userId;
  if (parsed.data.userId === me) {
    return res.status(400).json({ error: "Cannot create chat with self" });
  }
  const target = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!target) return res.status(404).json({ error: "User not found" });

  const existing = await prisma.conversation.findFirst({
    where: {
      kind: ConversationKind.DM,
      AND: [
        { participants: { some: { userId: me } } },
        { participants: { some: { userId: parsed.data.userId } } }
      ]
    },
    include: { participants: true }
  });
  if (existing) return res.json(existing);

  const created = await prisma.conversation.create({
    data: {
      kind: ConversationKind.DM,
      participants: {
        create: [{ userId: me }, { userId: parsed.data.userId }]
      }
    },
    include: { participants: true }
  });
  return res.status(201).json(created);
});

chatRouter.get("/conversations/:id/messages", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const me = req.user!.userId;
  const allowed = await ensureParticipant(id, me);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  const rows = await prisma.message.findMany({
    where: { conversationId: id },
    include: { sender: true, attachments: true },
    orderBy: { createdAt: "asc" },
    take: 500
  });
  return res.json(rows);
});

chatRouter.post("/conversations/:id/messages", async (req: AuthedRequest, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const conversationId = String(req.params.id);
  const senderId = req.user!.userId;
  const allowed = await ensureParticipant(conversationId, senderId);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  const created = await prisma.message.create({
    data: {
      conversationId,
      senderId,
      text: parsed.data.text.trim(),
      attachments: parsed.data.attachments.length
        ? {
            create: parsed.data.attachments.map((a) => ({
              fileName: a.fileName,
              mimeType: a.mimeType,
              dataUrl: a.dataUrl
            }))
          }
        : undefined
    },
    include: { sender: true, attachments: true }
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() }
  });
  return res.status(201).json(created);
});
