import { ConversationKind } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { getEffectivePermissions } from "../lib/access.js";
import { prisma } from "../lib/prisma.js";
import { getAllowedWarehouses } from "../lib/userWarehouses.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

const dmSchema = z.object({
  userId: z.string().min(1)
});

const messageSchema = z
  .object({
    text: z.string().max(4000).optional().default(""),
    attachments: z
      .array(
        z.object({
          fileName: z.string().min(1),
          mimeType: z.string().optional(),
          dataUrl: z.string().min(1).max(500000)
        })
      )
      .default([])
  })
  .refine((d) => d.text.trim().length > 0 || d.attachments.length > 0, {
    message: "MESSAGE_EMPTY"
  });

export const chatRouter = Router();
chatRouter.use(requireAuth);

function serializeChatUser(u: {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  role: { name: string };
  position: { name: string } | null;
}) {
  return {
    id: u.id,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    avatarUrl: u.avatarUrl,
    role: u.role.name,
    position: u.position?.name || null
  };
}

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
  return res.json(rows.map((u) => serializeChatUser(u)));
});

chatRouter.get("/users/:userId", async (req: AuthedRequest, res) => {
  const targetId = String(req.params.userId);
  const target = await prisma.user.findFirst({
    where: { id: targetId, status: "ACTIVE" },
    include: { role: true, position: true }
  });
  if (!target) return res.status(404).json({ error: "User not found" });
  const permissions = getEffectivePermissions(target.role.permissions, target.customPermissions);
  const warehouses = await getAllowedWarehouses(target.id, permissions);
  return res.json({
    ...serializeChatUser(target),
    warehouses: warehouses.map((w) => ({ id: w.id, name: w.name }))
  });
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
  return res.json(
    rows.map((conv) => {
      const myParticipant = conv.participants.find((p) => p.userId === me);
      return {
        id: conv.id,
        kind: conv.kind,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        myLastReadAt: myParticipant?.lastReadAt ?? null,
        participants: conv.participants.map((p) => ({
          user: serializeChatUser(p.user)
        })),
        messages: conv.messages
      };
    })
  );
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

chatRouter.post("/conversations/:id/read", async (req: AuthedRequest, res) => {
  const conversationId = String(req.params.id);
  const me = req.user!.userId;
  const allowed = await ensureParticipant(conversationId, me);
  if (!allowed) return res.status(403).json({ error: "Forbidden" });
  const now = new Date();
  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: me } },
    data: { lastReadAt: now }
  });
  return res.json({ ok: true, lastReadAt: now.toISOString() });
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
  const now = new Date();
  await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: now }
    }),
    prisma.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: senderId } },
      data: { lastReadAt: now }
    })
  ]);
  return res.status(201).json(created);
});
