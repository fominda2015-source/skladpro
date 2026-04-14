import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const auditRouter = Router();
auditRouter.use(requireAuth);
auditRouter.use(requirePermission("audit.read"));

auditRouter.get("/", async (req, res) => {
  const entityType = typeof req.query.entityType === "string" ? req.query.entityType : undefined;
  const entityId = typeof req.query.entityId === "string" ? req.query.entityId : undefined;
  const userId = typeof req.query.userId === "string" ? req.query.userId : undefined;
  const take = Math.min(Number(req.query.take) || 100, 500);

  const rows = await prisma.auditLog.findMany({
    where: {
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(userId ? { userId } : {})
    },
    include: { user: { select: { id: true, email: true, fullName: true } } },
    orderBy: { createdAt: "desc" },
    take
  });
  return res.json(rows);
});
