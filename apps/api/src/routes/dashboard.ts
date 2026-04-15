import {
  IntegrationJobStatus,
  IssueRequestStatus,
  MaterialMatchQueueStatus,
  NotificationLevel,
  OperationType,
  ToolStatus,
  TransportWaybillStatus,
  UserStatus
} from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { Router } from "express";
import {
  getRequestDataScope,
  issueWhereFromScope,
  mergeIssueWhere,
  operationWhereFromScope,
  projectLimitWhereFromScope,
  projectWhereFromScope,
  stockWhereFromScope,
  toolWhereFromScope,
  waybillWhereFromScope
} from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

function startOfUtcDay(d = new Date()) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

function andMerge(a: Prisma.OperationWhereInput, b: Prisma.OperationWhereInput): Prisma.OperationWhereInput {
  const parts = [a, b].filter((x) => Object.keys(x).length > 0);
  if (!parts.length) {
    return {};
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return { AND: parts };
}

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);
dashboardRouter.use(requirePermission("dashboard.read"));

dashboardRouter.get("/summary", async (req: AuthedRequest, res) => {
  const role = req.user?.role ?? "VIEWER";
  const today = startOfUtcDay();
  const weekAgo = new Date(Date.now() - 7 * 86400000);
  const scope = await getRequestDataScope(req);

  const opScope = operationWhereFromScope(scope);
  const stScope = stockWhereFromScope(scope);
  const tbScope = waybillWhereFromScope(scope);
  const tlScope = toolWhereFromScope(scope);
  const prScope = projectWhereFromScope(scope);
  const limScope = projectLimitWhereFromScope(scope);

  const receiptsWhere = andMerge(opScope, {
    type: OperationType.INCOME,
    operationDate: { gte: today },
    status: "POSTED"
  });
  const expensesWhere = andMerge(opScope, {
    type: OperationType.EXPENSE,
    operationDate: { gte: today },
    status: "POSTED"
  });
  const transfersWhere = andMerge(opScope, {
    type: OperationType.TRANSFER,
    operationDate: { gte: today },
    status: "POSTED"
  });

  const issuesIssuedWhere = mergeIssueWhere(scope, {
    status: IssueRequestStatus.ISSUED,
    updatedAt: { gte: today }
  });
  const pendingApprovalsWhere = mergeIssueWhere(scope, { status: IssueRequestStatus.ON_APPROVAL });
  const staleIssuesWhere = mergeIssueWhere(scope, {
    status: {
      notIn: [IssueRequestStatus.ISSUED, IssueRequestStatus.REJECTED, IssueRequestStatus.CANCELLED]
    },
    createdAt: { lt: weekAgo }
  });

  const lowStockWhere =
    Object.keys(stScope).length > 0 ? { AND: [stScope, { quantity: { lt: 5 } }] } : { quantity: { lt: 5 } };

  const toolsRepairWhere =
    Object.keys(tlScope).length > 0
      ? { AND: [tlScope, { status: ToolStatus.IN_REPAIR }] }
      : { status: ToolStatus.IN_REPAIR };

  const waybillsOpenWhere =
    Object.keys(tbScope).length > 0
      ? { AND: [tbScope, { status: { not: TransportWaybillStatus.CLOSED } }] }
      : { status: { not: TransportWaybillStatus.CLOSED } };

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
    failedIntegrations24h,
    unreadNotifications,
    errorNotifications24h,
    activeUsers,
    auditEvents24h,
    projectsCount
  ] = await Promise.all([
    prisma.operation.count({ where: receiptsWhere }),
    prisma.operation.count({ where: expensesWhere }),
    prisma.operation.count({ where: transfersWhere }),
    prisma.issueRequest.count({ where: issuesIssuedWhere }),
    prisma.issueRequest.count({ where: pendingApprovalsWhere }),
    prisma.stock.count({ where: lowStockWhere }),
    prisma.issueRequest.count({ where: staleIssuesWhere }),
    prisma.tool.count({ where: toolsRepairWhere }),
    prisma.transportWaybill.count({ where: waybillsOpenWhere }),
    prisma.materialMatchQueue.count({
      where: { status: MaterialMatchQueueStatus.PENDING }
    }),
    prisma.integrationJob.count({
      where: {
        status: IntegrationJobStatus.FAILED,
        createdAt: { gte: new Date(Date.now() - 86400000) }
      }
    }),
    prisma.notification.count({
      where: { userId: req.user!.userId, isRead: false }
    }),
    prisma.notification.count({
      where: {
        userId: req.user!.userId,
        level: NotificationLevel.ERROR,
        createdAt: { gte: new Date(Date.now() - 86400000) }
      }
    }),
    prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
    prisma.auditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 86400000) } } }),
    prisma.project.count({ where: prScope })
  ]);

  const limitItems = await prisma.projectLimitItem.findMany({
    where: Object.keys(limScope).length ? { projectLimit: limScope } : {},
    select: { plannedQty: true, issuedQty: true, reservedQty: true }
  });
  const overspendLines = limitItems.filter(
    (x) => Number(x.issuedQty) + Number(x.reservedQty) > Number(x.plannedQty)
  ).length;

  const base = {
    role,
    generatedAt: new Date().toISOString(),
    scoped: !scope.unrestricted,
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
      matchQueuePending,
      failedIntegrations24h,
      unreadNotifications,
      errorNotifications24h
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
