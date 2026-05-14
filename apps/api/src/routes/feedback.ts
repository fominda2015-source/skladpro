import { ConversationKind, FeedbackTicketStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { hasPermission } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";

const attachmentParts = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().optional(),
  dataUrl: z.string().min(1).max(500000)
});

const messageSchema = z.object({
  text: z.string().min(1).max(4000),
  attachments: z.array(attachmentParts).default([])
});

const ticketCreateSchema = z.object({
  subject: z.string().trim().max(400).optional().default(""),
  text: z.string().min(1).max(4000),
  attachments: z.array(attachmentParts).default([])
});

const ticketMessageSchema = z.object({
  text: z.string().min(1).max(4000),
  attachments: z.array(attachmentParts).default([])
});

const ticketPatchSchema = z.object({
  status: z.nativeEnum(FeedbackTicketStatus)
});

function canManageFeedback(req: AuthedRequest) {
  return hasPermission(req.user!.permissions, "feedback.manage");
}

function singleRouteParam(param: unknown): string | undefined {
  if (typeof param === "string") return param;
  if (Array.isArray(param) && param.length && typeof param[0] === "string") return param[0];
  return undefined;
}

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

const ticketsRouter = Router();

async function notifyFeedbackManagers(
  title: string,
  message: string,
  ticketId: string,
  options?: { excludeUserId?: string }
) {
  const roles = await prisma.role.findMany({ select: { id: true, permissions: true } });
  const roleIds = roles
    .filter((r) => {
      const perms = r.permissions as unknown;
      return Array.isArray(perms) && (perms.includes("feedback.manage") || perms.includes("*"));
    })
    .map((r) => r.id);

  const users =
    roleIds.length > 0
      ? await prisma.user.findMany({
          where: {
            status: "ACTIVE",
            ...(options?.excludeUserId ? { id: { not: options.excludeUserId } } : {}),
            roleId: { in: roleIds }
          },
          select: { id: true }
        })
      : [];

  const ids = [...new Set(users.map((u) => u.id))];
  if (!ids.length) return;

  await prisma.notification.createMany({
    data: ids.map((userId) => ({
      userId,
      title: title.slice(0, 200),
      message: message.slice(0, 500),
      entityType: "FeedbackTicket",
      entityId: ticketId
    }))
  });
}

ticketsRouter.get("/", async (req: AuthedRequest, res) => {
  const manage = canManageFeedback(req);
  const rows = await prisma.feedbackTicket.findMany({
    where: manage ? {} : { authorId: req.user!.userId },
    orderBy: { updatedAt: "desc" },
    take: 300,
    include: {
      author: { select: { id: true, fullName: true, email: true } },
      _count: { select: { messages: true } }
    }
  });
  return res.json(
    rows.map((t) => ({
      id: t.id,
      number: `ОБ-${t.seq}`,
      subject: t.subject,
      status: t.status,
      authorId: t.authorId,
      authorName: t.author.fullName,
      messageCount: t._count.messages,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt
    }))
  );
});

ticketsRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = ticketCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const subject = parsed.data.subject?.trim() ?? "";
  const text = parsed.data.text.trim();

  const ticket = await prisma.$transaction(async (tx) => {
    const t = await tx.feedbackTicket.create({
      data: {
        authorId: req.user!.userId,
        subject,
        messages: {
          create: [
            {
              senderId: req.user!.userId,
              text,
              attachments: parsed.data.attachments.length
                ? {
                    create: parsed.data.attachments.map((a) => ({
                      fileName: a.fileName,
                      mimeType: a.mimeType,
                      dataUrl: a.dataUrl
                    }))
                  }
                : undefined
            }
          ]
        }
      },
      include: {
        messages: {
          include: { sender: true, attachments: true },
          orderBy: { createdAt: "asc" }
        },
        author: { select: { id: true, fullName: true } }
      }
    });
    return t;
  });

  const preview = `${ticket.author.fullName}: ${subject || text.slice(0, 120)}`;
  await notifyFeedbackManagers("Новое обращение", preview, ticket.id, { excludeUserId: req.user!.userId }).catch(
    () => undefined
  );

  const full = await prisma.feedbackTicket.findUniqueOrThrow({
    where: { id: ticket.id },
    include: {
      messages: { include: { sender: true, attachments: true }, orderBy: { createdAt: "asc" } },
      author: { select: { id: true, fullName: true, email: true } }
    }
  });

  return res.status(201).json({
    id: full.id,
    number: `ОБ-${full.seq}`,
    subject: full.subject,
    status: full.status,
    authorId: full.authorId,
    messages: full.messages.map((m) => ({
      id: m.id,
      text: m.text,
      createdAt: m.createdAt,
      senderId: m.senderId,
      sender: { id: m.sender.id, fullName: m.sender.fullName },
      attachments: m.attachments
    }))
  });
});

ticketsRouter.get("/:ticketId", async (req: AuthedRequest, res) => {
  const ticketId = singleRouteParam(req.params.ticketId);
  if (!ticketId) return res.status(400).json({ error: "BAD_TICKET" });
  const manage = canManageFeedback(req);
  const full = await prisma.feedbackTicket.findFirst({
    where: {
      id: ticketId,
      ...(manage ? {} : { authorId: req.user!.userId })
    },
    include: {
      messages: { include: { sender: true, attachments: true }, orderBy: { createdAt: "asc" } },
      author: { select: { id: true, fullName: true, email: true } }
    }
  });
  if (!full) return res.status(404).json({ error: "NOT_FOUND" });
  return res.json({
    id: full.id,
    number: `ОБ-${full.seq}`,
    subject: full.subject,
    status: full.status,
    authorId: full.authorId,
    authorName: full.author.fullName,
    messages: full.messages.map((m) => ({
      id: m.id,
      text: m.text,
      createdAt: m.createdAt,
      senderId: m.senderId,
      sender: { id: m.sender.id, fullName: m.sender.fullName },
      attachments: m.attachments
    }))
  });
});

ticketsRouter.post("/:ticketId/messages", async (req: AuthedRequest, res) => {
  const parsed = ticketMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const ticketId = singleRouteParam(req.params.ticketId);
  if (!ticketId) return res.status(400).json({ error: "BAD_TICKET" });

  const manage = canManageFeedback(req);
  const ticket = await prisma.feedbackTicket.findFirst({
    where: {
      id: ticketId,
      ...(manage ? {} : { authorId: req.user!.userId })
    }
  });
  if (!ticket) return res.status(404).json({ error: "NOT_FOUND" });
  if (!manage && ticket.status === FeedbackTicketStatus.CLOSED) {
    return res.status(400).json({ error: "TICKET_CLOSED" });
  }

  const msg = await prisma.feedbackTicketMessage.create({
    data: {
      ticketId: ticket.id,
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

  let nextStatus: FeedbackTicketStatus | null = null;
  if (manage && ticket.authorId !== req.user!.userId) {
    nextStatus = FeedbackTicketStatus.IN_PROGRESS;
  } else if (!manage && ticket.authorId === req.user!.userId) {
    nextStatus = FeedbackTicketStatus.WAITING_REPLY;
  }

  if (nextStatus !== null && nextStatus !== ticket.status) {
    await prisma.feedbackTicket.update({
      where: { id: ticket.id },
      data: { status: nextStatus }
    });
  }

  if (manage && ticket.authorId !== req.user!.userId) {
    await prisma.notification.create({
      data: {
        userId: ticket.authorId,
        title: "Ответ по обращению",
        message: `Ответили по ${`ОБ-${ticket.seq}`}`,
        entityType: "FeedbackTicket",
        entityId: ticket.id
      }
    });
  } else if (!manage && ticket.authorId === req.user!.userId) {
    await notifyFeedbackManagers(
      "Комментарий в обращении",
      `ОБ-${ticket.seq}: добавлен текст`,
      ticket.id,
      { excludeUserId: req.user!.userId }
    ).catch(() => undefined);
  }

  return res.status(201).json({
    id: msg.id,
    text: msg.text,
    createdAt: msg.createdAt,
    senderId: msg.senderId,
    sender: { id: msg.sender.id, fullName: msg.sender.fullName },
    attachments: msg.attachments
  });
});

ticketsRouter.patch("/:ticketId", async (req: AuthedRequest, res) => {
  if (!canManageFeedback(req)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const ticketId = singleRouteParam(req.params.ticketId);
  if (!ticketId) return res.status(400).json({ error: "BAD_TICKET" });
  const parsed = ticketPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    const row = await prisma.feedbackTicket.update({
      where: { id: ticketId },
      data: { status: parsed.data.status }
    });
    if (row.authorId !== req.user!.userId) {
      await prisma.notification.create({
        data: {
          userId: row.authorId,
          title: "Статус обращения",
          message: `${`ОБ-${row.seq}`}: ${parsed.data.status}`,
          entityType: "FeedbackTicket",
          entityId: row.id
        }
      });
    }
    return res.json({ id: row.id, number: `ОБ-${row.seq}`, status: row.status });
  } catch {
    return res.status(404).json({ error: "NOT_FOUND" });
  }
});

feedbackRouter.use("/tickets", ticketsRouter);
