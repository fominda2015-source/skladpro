import {
  IssueRequestStatus,
  MaterialMatchQueueStatus,
  OperationType,
  ToolStatus,
  TransportWaybillStatus,
  UserStatus
} from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

function startOfUtcDay(d = new Date()) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.use(requirePermission("dashboard.read"));

dashboardRouter.get("/summary", async (req: AuthedRequest, res) => {
  const role = req.user?.role ?? "VIEWER";
  const today = startOfUtcDay();
  const weekAgo = new Date(Date.now() - 7 * 86400000);

  const [
    receiptsToday,
    expensesToday,
    transfersToday,
    issuesIssuedToday,
    pendingApprovals,
    lowStockLines,
    staleOpenIssues,
    toolsInRepair,
    waybillsOpen,
    matchQueuePending,
    activeUsers,
    auditEvents24h,
    projectsCount
  ] = await Promise.all([
    prisma.operation.count({
      where: { type: OperationType.INCOME, operationDate: { gte: today }, status: "POSTED" }
    }),
    prisma.operation.count({
      where: { type: OperationType.EXPENSE, operationDate: { gte: today }, status: "POSTED" }
    }),
    prisma.operation.count({
      where: { type: OperationType.TRANSFER, operationDate: { gte: today }, status: "POSTED" }
    }),
    prisma.issueRequest.count({
      where: { status: IssueRequestStatus.ISSUED, updatedAt: { gte: today } }
    }),
    prisma.issueRequest.count({ where: { status: IssueRequestStatus.ON_APPROVAL } }),
    prisma.stock.count({
      where: { quantity: { lt: 5 } }
    }),
    prisma.issueRequest.count({
      where: {
        status: { notIn: [IssueRequestStatus.ISSUED, IssueRequestStatus.REJECTED] },
        createdAt: { lt: weekAgo }
      }
    }),
    prisma.tool.count({ where: { status: ToolStatus.IN_REPAIR } }),
    prisma.transportWaybill.count({
      where: { status: { not: TransportWaybillStatus.CLOSED } }
    }),
    prisma.materialMatchQueue.count({
      where: { status: MaterialMatchQueueStatus.PENDING }
    }),
    prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
    prisma.auditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000) } } }),
    prisma.project.count()
  ]);

  const limitItems = await prisma.projectLimitItem.findMany({
    select: { plannedQty: true, issuedQty: true, reservedQty: true }
  });
  const overspendLines = limitItems.filter(
    (x) => Number(x.issuedQty) + Number(x.reservedQty) > Number(x.plannedQty)
  ).length;

  const base = {
    role,
    generatedAt: new Date().toISOString(),
    warehouse: {
      receiptsToday,
      issuesOperationsToday: expensesToday,
      issuesRequestsIssuedToday: issuesIssuedToday,
      transfersToday,
      pendingApprovals,
      lowStockLines,
      staleOpenIssues,
      toolsInRepair,
      waybillsOpen,
      matchQueuePending
    },
    project: {
      projectsCount,
      overspendLimitLines: overspendLines
    },
    admin:
      role === "ADMIN"
        ? {
            activeUsers,
            auditEvents24h
          }
        : undefined
  };

  return res.json(base);
});
