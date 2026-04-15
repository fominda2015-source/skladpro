import { IntegrationJobStatus, NotificationLevel, type Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { notifyUser } from "../lib/notifications.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createJobSchema = z.object({
  kind: z.string().min(1),
  payload: z.record(z.string(), z.unknown()).optional()
});

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);
integrationsRouter.use(requirePermission("integrations.read"));

integrationsRouter.get("/jobs", async (req, res) => {
  const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
  const kind = typeof req.query.kind === "string" ? req.query.kind.trim() : "";
  const status =
    statusParam && Object.values(IntegrationJobStatus).includes(statusParam as IntegrationJobStatus)
      ? (statusParam as IntegrationJobStatus)
      : undefined;

  const rows = await prisma.integrationJob.findMany({
    where: {
      ...(kind ? { kind: { contains: kind, mode: "insensitive" } } : {}),
      ...(status ? { status } : {})
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return res.json(rows);
});

integrationsRouter.post("/jobs", requirePermission("integrations.write"), async (req: AuthedRequest, res) => {
  const parsed = createJobSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const job = await prisma.integrationJob.create({
    data: {
      kind: parsed.data.kind.trim(),
      status: IntegrationJobStatus.PENDING,
      payload: parsed.data.payload as Prisma.InputJsonValue | undefined,
      requestedBy: req.user?.userId
    }
  });

  return res.status(201).json(job);
});

// Demo executor for staged rollout: allows checking lifecycle now.
integrationsRouter.patch(
  "/jobs/:id/run",
  requirePermission("integrations.write"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const existing = await prisma.integrationJob.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Integration job not found" });
    }
    if (existing.status === IntegrationJobStatus.RUNNING) {
      return res.status(409).json({ error: "Job is already running" });
    }

    const started = await prisma.integrationJob.update({
      where: { id },
      data: {
        status: IntegrationJobStatus.RUNNING,
        startedAt: new Date(),
        error: null
      }
    });

    const shouldFail = Boolean((started.payload as Record<string, unknown> | null)?.["forceFail"]);
    const finished = await prisma.integrationJob.update({
      where: { id },
      data: {
        status: shouldFail ? IntegrationJobStatus.FAILED : IntegrationJobStatus.SUCCESS,
        finishedAt: new Date(),
        result: shouldFail ? undefined : { ok: true, processedAt: new Date().toISOString() },
        error: shouldFail ? "Forced failure by payload.forceFail" : null
      }
    });

    if (req.user?.userId) {
      await notifyUser({
        userId: req.user.userId,
        title: shouldFail ? "Интеграция завершилась с ошибкой" : "Интеграция завершена",
        message: `Задача ${finished.kind} получила статус ${finished.status}.`,
        level: shouldFail ? NotificationLevel.ERROR : NotificationLevel.INFO,
        entityType: "IntegrationJob",
        entityId: finished.id
      });
    }

    return res.json(finished);
  }
);
