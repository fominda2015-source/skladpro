import { ConversationKind } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

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

export const feedbackRouter = Router();
feedbackRouter.use(requireAuth);

async function ensureFeedbackConversation(userId: string) {
  const admin = await prisma.user.findFirst({
    where: { role: { name: "ADMIN" }, status: "ACTIVE" },
    orderBy: { createdAt: "asc" }
  });
  if (!admin) return null;
  const existing = await prisma.conversation.findFirst({
    where: {
      kind: ConversationKind.FEEDBACK,
      AND: [
        { participants: { some: { userId } } },
        { participants: { some: { userId: admin.id } } }
      ]
    }
  });
  if (existing) return existing.id;
  const created = await prisma.conversation.create({
    data: {
      kind: ConversationKind.FEEDBACK,
      participants: { create: [{ userId }, { userId: admin.id }] }
    }
  });
  return created.id;
}

feedbackRouter.get("/messages", async (req: AuthedRequest, res) => {
  const conversationId = await ensureFeedbackConversation(req.user!.userId);
  if (!conversationId) return res.status(404).json({ error: "Admin account not found" });
  const rows = await prisma.message.findMany({
    where: { conversationId },
    include: { sender: true, attachments: true },
    orderBy: { createdAt: "asc" },
    take: 500
  });
  return res.json({ conversationId, items: rows });
});

feedbackRouter.post("/messages", async (req: AuthedRequest, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const conversationId = await ensureFeedbackConversation(req.user!.userId);
  if (!conversationId) return res.status(404).json({ error: "Admin account not found" });
  const created = await prisma.message.create({
    data: {
      conversationId,
      senderId: req.user!.userId,
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
