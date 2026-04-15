import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const markReadSchema = z.object({
  ids: z.array(z.string().min(1)).min(1)
});

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);
notificationsRouter.use(requirePermission("notifications.read"));

notificationsRouter.get("/", async (req: AuthedRequest, res) => {
  const unreadOnly = req.query.unreadOnly === "1";
  const rows = await prisma.notification.findMany({
    where: {
      userId: req.user!.userId,
      ...(unreadOnly ? { isRead: false } : {})
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return res.json(rows);
});

notificationsRouter.patch("/read", requirePermission("notifications.write"), async (req: AuthedRequest, res) => {
  const parsed = markReadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  await prisma.notification.updateMany({
    where: {
      id: { in: parsed.data.ids },
      userId: req.user!.userId
    },
    data: {
      isRead: true,
      readAt: new Date()
    }
  });

  return res.json({ ok: true });
});
