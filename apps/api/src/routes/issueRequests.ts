import { IssueRequestStatus, OperationType } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createIssueSchema = z.object({
  warehouseId: z.string().min(1),
  projectId: z.string().optional(),
  note: z.string().optional(),
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

export const issueRequestsRouter = Router();
issueRequestsRouter.use(requireAuth);
issueRequestsRouter.use(requirePermission("issues.read"));

issueRequestsRouter.get("/", async (_req, res) => {
  const statusParam = typeof _req.query.status === "string" ? _req.query.status : undefined;
  const where =
    statusParam && Object.values(IssueRequestStatus).includes(statusParam as IssueRequestStatus)
      ? { status: statusParam as IssueRequestStatus }
      : {};
  const rows = await prisma.issueRequest.findMany({
    where,
    include: {
      items: { include: { material: true } },
      warehouse: true,
      requestedBy: true,
      approvedBy: true
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return res.json(rows);
});

issueRequestsRouter.post("/", requirePermission("issues.write"), async (req: AuthedRequest, res) => {
  const parsed = createIssueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
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

  const created = await prisma.issueRequest.create({
    data: {
      number,
      warehouseId: parsed.data.warehouseId,
      projectId: parsed.data.projectId,
      note: parsed.data.note,
      requestedById: req.user!.userId,
      status: initialStatus,
      items: {
        create: parsed.data.items.map((item) => ({
          materialId: item.materialId,
          quantity: item.quantity
        }))
      }
    },
    include: { items: true }
  });

  return res.status(201).json(created);
});

issueRequestsRouter.patch(
  "/:id/send-for-approval",
  requirePermission("issues.write"),
  async (req, res) => {
    const id = String(req.params.id);
    const updated = await prisma.issueRequest.update({
      where: { id },
      data: { status: IssueRequestStatus.ON_APPROVAL }
    });
    return res.json(updated);
  }
);

issueRequestsRouter.patch("/:id/approve", requirePermission("issues.approve"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const updated = await prisma.issueRequest.update({
    where: { id },
    data: { status: IssueRequestStatus.APPROVED, approvedById: req.user!.userId }
  });
  return res.json(updated);
});

issueRequestsRouter.patch("/:id/reject", requirePermission("issues.approve"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const updated = await prisma.issueRequest.update({
    where: { id },
    data: { status: IssueRequestStatus.REJECTED, approvedById: req.user!.userId }
  });
  return res.json(updated);
});

issueRequestsRouter.patch("/:id/issue", requirePermission("operations.write"), async (req, res) => {
  const id = String(req.params.id);
  const issue = await prisma.issueRequest.findUnique({
    where: { id },
    include: { items: true }
  });
  if (!issue) {
    return res.status(404).json({ error: "Issue request not found" });
  }
  if (issue.status !== IssueRequestStatus.APPROVED && issue.status !== IssueRequestStatus.DRAFT) {
    return res.status(409).json({ error: `Wrong status: ${issue.status}` });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      for (const item of issue.items) {
        const stock = await tx.stock.findUnique({
          where: {
            warehouseId_materialId: {
              warehouseId: issue.warehouseId,
              materialId: item.materialId
            }
          }
        });
        if (!stock || Number(stock.quantity) < Number(item.quantity)) {
          throw new Error(`INSUFFICIENT_STOCK:${item.materialId}`);
        }
      }

      if (issue.projectId) {
        const latestLimit = await tx.projectLimit.findFirst({
          where: { projectId: issue.projectId },
          include: { items: true },
          orderBy: { version: "desc" }
        });

        if (latestLimit) {
          const map = new Map(latestLimit.items.map((x) => [x.materialId, x]));
          const exceededNow = issue.items.some((item) => {
            const lim = map.get(item.materialId);
            if (!lim) return false;
            return Number(lim.issuedQty) + Number(lim.reservedQty) + Number(item.quantity) > Number(lim.plannedQty);
          });
          if (exceededNow && issue.status !== IssueRequestStatus.APPROVED) {
            throw new Error("LIMIT_EXCEEDED_NEEDS_APPROVAL");
          }
        }
      }

      const operation = await tx.operation.create({
        data: {
          type: OperationType.EXPENSE,
          warehouseId: issue.warehouseId,
          projectId: issue.projectId ?? undefined,
          documentNumber: issue.number,
          status: "POSTED",
          issueRequestId: issue.id,
          items: {
            create: issue.items.map((item) => ({
              materialId: item.materialId,
              quantity: item.quantity
            }))
          }
        }
      });

      for (const item of issue.items) {
        await tx.stock.update({
          where: {
            warehouseId_materialId: {
              warehouseId: issue.warehouseId,
              materialId: item.materialId
            }
          },
          data: { quantity: { decrement: item.quantity } }
        });

        if (issue.projectId) {
          const latestLimit = await tx.projectLimit.findFirst({
            where: { projectId: issue.projectId },
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
        where: { id: issue.id },
        data: { status: IssueRequestStatus.ISSUED }
      });

      return { operation, issue: updatedIssue };
    });

    return res.json(result);
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
