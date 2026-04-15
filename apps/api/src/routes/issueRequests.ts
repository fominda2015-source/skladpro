import {
  IssueBasisType,
  IssueRequestStatus,
  NotificationLevel,
  OperationType,
  StockMovementDirection
} from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { recordAudit } from "../lib/audit.js";
import {
  assertProjectInScope,
  assertWarehouseInScope,
  getRequestDataScope,
  mergeIssueWhere
} from "../lib/dataScope.js";
import { notifyUser } from "../lib/notifications.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createIssueSchema = z.object({
  warehouseId: z.string().min(1),
  projectId: z.string().optional(),
  note: z.string().optional(),
  responsibleName: z.string().max(160).optional().nullable(),
  flowType: z.enum(["REQUEST", "DIRECT_ISSUE"]).optional(),
  basisType: z.nativeEnum(IssueBasisType).optional(),
  basisRef: z.string().max(500).optional().nullable(),
  items: z
    .array(
      z.object({
        materialId: z.string().min(1),
        quantity: z.number().positive()
      })
    )
    .min(1)
});

async function getLatestProjectLimit(projectId: string) {
  return prisma.projectLimit.findFirst({
    where: { projectId },
    include: { items: true },
    orderBy: { version: "desc" }
  });
}

async function safeNotify(params: Parameters<typeof notifyUser>[0]) {
  try {
    await notifyUser(params);
  } catch {
    // Best-effort side effect: notification failure must not break core flow.
  }
}

export const issueRequestsRouter = Router();
issueRequestsRouter.use(requireAuth);
issueRequestsRouter.use(requirePermission("issues.read"));

issueRequestsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const pageRaw = Number(req.query.page);
  const pageSizeRaw = Number(req.query.pageSize);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(100, Math.max(1, Math.floor(pageSizeRaw))) : 20;
  const sort =
    typeof req.query.sort === "string" && ["created_desc", "status", "number"].includes(req.query.sort)
      ? req.query.sort
      : "created_desc";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
  const statusFilter =
    statusParam && Object.values(IssueRequestStatus).includes(statusParam as IssueRequestStatus)
      ? { status: statusParam as IssueRequestStatus }
      : {};
  const basisParam = typeof req.query.basisType === "string" ? req.query.basisType : undefined;
  const basisFilter =
    basisParam && Object.values(IssueBasisType).includes(basisParam as IssueBasisType)
      ? { basisType: basisParam as IssueBasisType }
      : {};
  const searchFilter = q
    ? {
        OR: [
          { number: { contains: q, mode: "insensitive" as const } },
          { basisRef: { contains: q, mode: "insensitive" as const } },
          { note: { contains: q, mode: "insensitive" as const } },
          { responsibleName: { contains: q, mode: "insensitive" as const } }
        ]
      }
    : {};
  const where = mergeIssueWhere(scope, { ...statusFilter, ...basisFilter, ...searchFilter } as any);
  const [total, rows] = await prisma.$transaction([
    prisma.issueRequest.count({ where }),
    prisma.issueRequest.findMany({
      where,
      include: {
        items: { include: { material: true } },
        warehouse: true,
        project: true,
        requestedBy: true,
        approvedBy: true
      },
      orderBy:
        sort === "status"
          ? { status: "asc" }
          : sort === "number"
            ? { number: "asc" }
            : { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  return res.json({
    items: rows,
    total,
    page,
    pageSize
  });
});

issueRequestsRouter.post("/", requirePermission("issues.write"), async (req: AuthedRequest, res) => {
  const parsed = createIssueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  try {
    const scope = await getRequestDataScope(req);
    assertWarehouseInScope(scope, parsed.data.warehouseId);
    assertProjectInScope(scope, parsed.data.projectId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) {
      return res.status(403).json({ error: err.message });
    }
    throw e;
  }

  const count = await prisma.issueRequest.count();
  const number = `REQ-${String(count + 1).padStart(5, "0")}`;

  let initialStatus: IssueRequestStatus = IssueRequestStatus.DRAFT;
  if (parsed.data.projectId) {
    const limit = await getLatestProjectLimit(parsed.data.projectId);
    if (limit) {
      const byMaterial = new Map(limit.items.map((x) => [x.materialId, x]));
      const exceeds = parsed.data.items.some((item) => {
        const lim = byMaterial.get(item.materialId);
        if (!lim) return false;
        const planned = Number(lim.plannedQty);
        const issued = Number(lim.issuedQty);
        const reserved = Number(lim.reservedQty);
        return issued + reserved + item.quantity > planned;
      });
      if (exceeds) {
        initialStatus = IssueRequestStatus.ON_APPROVAL;
      }
    }
  }

  const basisType =
    parsed.data.basisType ??
    (parsed.data.projectId ? IssueBasisType.PROJECT_WORK : IssueBasisType.OTHER);

  const created = await prisma.issueRequest.create({
    data: {
      number,
      flowType: parsed.data.flowType ?? "REQUEST",
      warehouseId: parsed.data.warehouseId,
      projectId: parsed.data.projectId,
      note: parsed.data.note,
      responsibleName: parsed.data.responsibleName ?? undefined,
      basisType,
      basisRef: parsed.data.basisRef ?? undefined,
      requestedById: req.user!.userId,
      status: initialStatus,
      items: {
        create: parsed.data.items.map((item) => ({
          materialId: item.materialId,
          quantity: item.quantity
        }))
      }
    } as any,
    include: { items: true }
  });

  return res.status(201).json(created);
});

const updateDraftIssueSchema = z.object({
  note: z.string().optional().nullable(),
  responsibleName: z.string().max(160).optional().nullable(),
  flowType: z.enum(["REQUEST", "DIRECT_ISSUE"]).optional(),
  basisType: z.nativeEnum(IssueBasisType).optional(),
  basisRef: z.string().max(500).optional().nullable()
});

issueRequestsRouter.patch(
  "/:id",
  requirePermission("issues.write"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const parsed = updateDraftIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const scope = await getRequestDataScope(req);
    const existing = await prisma.issueRequest.findFirst({ where: mergeIssueWhere(scope, { id }) });
    if (!existing) {
      return res.status(404).json({ error: "Issue request not found" });
    }
    if (existing.status !== IssueRequestStatus.DRAFT) {
      return res.status(409).json({ error: "Only DRAFT requests can be edited" });
    }
    const updated = await prisma.issueRequest.update({
      where: { id },
      data: {
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
        ...(parsed.data.responsibleName !== undefined ? { responsibleName: parsed.data.responsibleName } : {}),
        ...(parsed.data.flowType !== undefined ? { flowType: parsed.data.flowType } : {}),
        ...(parsed.data.basisType !== undefined ? { basisType: parsed.data.basisType } : {}),
        ...(parsed.data.basisRef !== undefined ? { basisRef: parsed.data.basisRef } : {})
      }
    });
    return res.json(updated);
  }
);

issueRequestsRouter.patch(
  "/:id/send-for-approval",
  requirePermission("issues.write"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const scope = await getRequestDataScope(req);
    const existing = await prisma.issueRequest.findFirst({ where: mergeIssueWhere(scope, { id }) });
    if (!existing) {
      return res.status(404).json({ error: "Issue request not found" });
    }
    if (existing.status === IssueRequestStatus.ON_APPROVAL) {
      return res.json(existing);
    }
    if (existing.status !== IssueRequestStatus.DRAFT) {
      return res.status(409).json({ error: `Cannot send for approval from status ${existing.status}` });
    }
    const updated = await prisma.issueRequest.update({
      where: { id },
      data: { status: IssueRequestStatus.ON_APPROVAL }
    });
    await safeNotify({
      userId: updated.requestedById,
      title: "Заявка отправлена на согласование",
      message: `Заявка ${updated.number} переведена в ON_APPROVAL.`,
      entityType: "IssueRequest",
      entityId: updated.id
    });
    return res.json(updated);
  }
);

issueRequestsRouter.patch("/:id/approve", requirePermission("issues.approve"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const scope = await getRequestDataScope(req);
  const prev = await prisma.issueRequest.findFirst({ where: mergeIssueWhere(scope, { id }) });
  if (!prev) {
    return res.status(404).json({ error: "Issue request not found" });
  }
  if (prev.status === IssueRequestStatus.APPROVED) {
    return res.json(prev);
  }
  if (prev.status !== IssueRequestStatus.ON_APPROVAL) {
    return res.status(409).json({ error: `Approve allowed only from ON_APPROVAL, got ${prev.status}` });
  }
  const updated = await prisma.issueRequest.update({
    where: { id },
    data: { status: IssueRequestStatus.APPROVED, approvedById: req.user!.userId }
  });
  await recordAudit({
    userId: req.user!.userId,
    action: "ISSUE_REQUEST_APPROVE",
    entityType: "IssueRequest",
    entityId: id,
    before: { status: prev.status, approvedById: prev.approvedById },
    after: { status: updated.status, approvedById: updated.approvedById }
  });
  await safeNotify({
    userId: updated.requestedById,
    title: "Заявка согласована",
    message: `Заявка ${updated.number} одобрена и готова к выдаче.`,
    entityType: "IssueRequest",
    entityId: updated.id
  });
  return res.json(updated);
});

issueRequestsRouter.patch("/:id/reject", requirePermission("issues.approve"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const scope = await getRequestDataScope(req);
  const prev = await prisma.issueRequest.findFirst({ where: mergeIssueWhere(scope, { id }) });
  if (!prev) {
    return res.status(404).json({ error: "Issue request not found" });
  }
  if (prev.status !== IssueRequestStatus.ON_APPROVAL) {
    return res.status(409).json({ error: `Reject allowed only from ON_APPROVAL, got ${prev.status}` });
  }
  const updated = await prisma.issueRequest.update({
    where: { id },
    data: { status: IssueRequestStatus.REJECTED, approvedById: req.user!.userId }
  });
  await recordAudit({
    userId: req.user!.userId,
    action: "ISSUE_REQUEST_REJECT",
    entityType: "IssueRequest",
    entityId: id,
    before: { status: prev.status },
    after: { status: updated.status }
  });
  await safeNotify({
    userId: updated.requestedById,
    title: "Заявка отклонена",
    message: `Заявка ${updated.number} отклонена. Проверьте детали и при необходимости исправьте черновик.`,
    level: NotificationLevel.WARNING,
    entityType: "IssueRequest",
    entityId: updated.id
  });
  return res.json(updated);
});

issueRequestsRouter.patch("/:id/cancel", requirePermission("issues.write"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const scope = await getRequestDataScope(req);
  const prev = await prisma.issueRequest.findFirst({ where: mergeIssueWhere(scope, { id }) });
  if (!prev) {
    return res.status(404).json({ error: "Issue request not found" });
  }
  if (prev.status === IssueRequestStatus.CANCELLED) {
    return res.json(prev);
  }
  if (prev.status !== IssueRequestStatus.DRAFT && prev.status !== IssueRequestStatus.ON_APPROVAL) {
    return res.status(409).json({ error: `Cancel allowed only from DRAFT or ON_APPROVAL, got ${prev.status}` });
  }
  const updated = await prisma.issueRequest.update({
    where: { id },
    data: { status: IssueRequestStatus.CANCELLED }
  });
  await recordAudit({
    userId: req.user!.userId,
    action: "ISSUE_REQUEST_CANCEL",
    entityType: "IssueRequest",
    entityId: id,
    before: { status: prev.status },
    after: { status: updated.status }
  });
  await safeNotify({
    userId: updated.requestedById,
    title: "Заявка отменена",
    message: `Заявка ${updated.number} отменена.`,
    level: NotificationLevel.WARNING,
    entityType: "IssueRequest",
    entityId: updated.id
  });
  return res.json(updated);
});

issueRequestsRouter.patch("/:id/issue", requirePermission("operations.write"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const scope = await getRequestDataScope(req);
  const issueRow = await prisma.issueRequest.findFirst({
    where: mergeIssueWhere(scope, { id }),
    include: { items: true }
  });
  if (!issueRow) {
    return res.status(404).json({ error: "Issue request not found" });
  }
  if (issueRow.status === IssueRequestStatus.ON_APPROVAL) {
    return res.status(409).json({ error: "Issue request is pending approval" });
  }
  if (
    issueRow.status !== IssueRequestStatus.APPROVED &&
    issueRow.status !== IssueRequestStatus.DRAFT
  ) {
    return res.status(409).json({ error: `Wrong status: ${issueRow.status}` });
  }

  try {
    const prevStatus = issueRow.status;
    const result = await prisma.$transaction(async (tx) => {
      for (const item of issueRow.items) {
        const stock = await tx.stock.findUnique({
          where: {
            warehouseId_materialId: {
              warehouseId: issueRow.warehouseId,
              materialId: item.materialId
            }
          }
        });
        if (!stock || Number(stock.quantity) < Number(item.quantity)) {
          throw new Error(`INSUFFICIENT_STOCK:${item.materialId}`);
        }
      }

      if (issueRow.projectId) {
        const latestLimit = await tx.projectLimit.findFirst({
          where: { projectId: issueRow.projectId },
          include: { items: true },
          orderBy: { version: "desc" }
        });

        if (latestLimit) {
          const map = new Map(latestLimit.items.map((x) => [x.materialId, x]));
          const exceededNow = issueRow.items.some((item) => {
            const lim = map.get(item.materialId);
            if (!lim) return false;
            return Number(lim.issuedQty) + Number(lim.reservedQty) + Number(item.quantity) > Number(lim.plannedQty);
          });
          if (exceededNow && issueRow.status !== IssueRequestStatus.APPROVED) {
            throw new Error("LIMIT_EXCEEDED_NEEDS_APPROVAL");
          }
        }
      }

      const operation = await tx.operation.create({
        data: {
          type: OperationType.EXPENSE,
          warehouseId: issueRow.warehouseId,
          projectId: issueRow.projectId ?? undefined,
          documentNumber: issueRow.number,
          status: "POSTED",
          issueRequestId: issueRow.id,
          items: {
            create: issueRow.items.map((item) => ({
              materialId: item.materialId,
              quantity: item.quantity
            }))
          }
        }
      });

      for (const item of issueRow.items) {
        await tx.stock.update({
          where: {
            warehouseId_materialId: {
              warehouseId: issueRow.warehouseId,
              materialId: item.materialId
            }
          },
          data: { quantity: { decrement: item.quantity } }
        });

        await tx.stockMovement.create({
          data: {
            warehouseId: issueRow.warehouseId,
            materialId: item.materialId,
            quantity: item.quantity,
            direction: StockMovementDirection.OUT,
            sourceDocumentType: "OPERATION",
            sourceDocumentId: operation.id,
            operationId: operation.id,
            issueRequestId: issueRow.id,
            createdById: req.user!.userId
          }
        });

        if (issueRow.projectId) {
          const latestLimit = await tx.projectLimit.findFirst({
            where: { projectId: issueRow.projectId },
            orderBy: { version: "desc" }
          });
          if (latestLimit) {
            await tx.projectLimitItem.updateMany({
              where: { projectLimitId: latestLimit.id, materialId: item.materialId },
              data: { issuedQty: { increment: item.quantity } }
            });
          }
        }
      }

      const updatedIssue = await tx.issueRequest.update({
        where: { id: issueRow.id },
        data: { status: IssueRequestStatus.ISSUED }
      });

      return { operation, issue: updatedIssue };
    });

    const { operation, issue } = result;
    await recordAudit({
      userId: req.user!.userId,
      action: "ISSUE_REQUEST_ISSUE",
      entityType: "IssueRequest",
      entityId: id,
      before: { status: prevStatus as IssueRequestStatus },
      after: { status: issue.status, operationId: operation.id }
    });
    await safeNotify({
      userId: issue.requestedById,
      title: "Материалы выданы по заявке",
      message: `Заявка ${issue.number} проведена. Операция: ${operation.documentNumber || operation.id}.`,
      entityType: "IssueRequest",
      entityId: issue.id
    });

    return res.json({ operation, issue });
  } catch (error) {
    if (error instanceof Error && error.message === "LIMIT_EXCEEDED_NEEDS_APPROVAL") {
      return res.status(409).json({ error: "Limit exceeded. Send request for approval." });
    }
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_STOCK:")) {
      return res.status(409).json({ error: "Insufficient stock", materialId: error.message.split(":")[1] });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});
