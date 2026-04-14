import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import type { AuthedRequest } from "../middleware/auth.js";

const scopeCache = new WeakMap<AuthedRequest, Promise<DataScope>>();

export type DataScope = {
  unrestricted: boolean;
  /** Если непустой — пользователь видит только эти склады. Пусто в БД = без ограничения по складу. */
  warehouseIds: string[] | null;
  /** Если непустой — ограничение по проектам (заявки, лимиты, проекты в списке). */
  projectIds: string[] | null;
};

export async function getRequestDataScope(req: AuthedRequest): Promise<DataScope> {
  if (!req.user) {
    throw new Error("Unauthorized");
  }
  let p = scopeCache.get(req);
  if (!p) {
    p = loadDataScope(req.user.userId, req.user.permissions);
    scopeCache.set(req, p);
  }
  return p;
}

async function loadDataScope(userId: string, permissions: string[]): Promise<DataScope> {
  if (permissions.includes("*")) {
    return { unrestricted: true, warehouseIds: null, projectIds: null };
  }
  const [whRows, pjRows] = await Promise.all([
    prisma.userWarehouseScope.findMany({ where: { userId }, select: { warehouseId: true } }),
    prisma.userProjectScope.findMany({ where: { userId }, select: { projectId: true } })
  ]);
  return {
    unrestricted: false,
    warehouseIds: whRows.length ? whRows.map((r) => r.warehouseId) : null,
    projectIds: pjRows.length ? pjRows.map((r) => r.projectId) : null
  };
}

export function stockWhereFromScope(scope: DataScope): Prisma.StockWhereInput {
  if (scope.unrestricted || !scope.warehouseIds?.length) {
    return {};
  }
  return { warehouseId: { in: scope.warehouseIds } };
}

export function issueWhereFromScope(scope: DataScope): Prisma.IssueRequestWhereInput {
  const parts: Prisma.IssueRequestWhereInput[] = [];
  if (!scope.unrestricted && scope.warehouseIds?.length) {
    parts.push({ warehouseId: { in: scope.warehouseIds } });
  }
  if (!scope.unrestricted && scope.projectIds?.length) {
    parts.push({ OR: [{ projectId: null }, { projectId: { in: scope.projectIds } }] });
  }
  if (!parts.length) {
    return {};
  }
  return { AND: parts };
}

export function operationWhereFromScope(scope: DataScope): Prisma.OperationWhereInput {
  if (scope.unrestricted || !scope.warehouseIds?.length) {
    return {};
  }
  return { warehouseId: { in: scope.warehouseIds } };
}

export function toolWhereFromScope(scope: DataScope): Prisma.ToolWhereInput {
  if (scope.unrestricted || !scope.warehouseIds?.length) {
    return {};
  }
  return {
    OR: [{ warehouseId: { in: scope.warehouseIds } }, { warehouseId: null }]
  };
}

export function waybillWhereFromScope(scope: DataScope): Prisma.TransportWaybillWhereInput {
  if (scope.unrestricted || !scope.warehouseIds?.length) {
    return {};
  }
  return {
    OR: [{ fromWarehouseId: { in: scope.warehouseIds } }, { fromWarehouseId: null }]
  };
}

export function warehouseWhereFromScope(scope: DataScope): Prisma.WarehouseWhereInput {
  if (scope.unrestricted || !scope.warehouseIds?.length) {
    return {};
  }
  return { id: { in: scope.warehouseIds } };
}

export function projectWhereFromScope(scope: DataScope): Prisma.ProjectWhereInput {
  if (scope.unrestricted || !scope.projectIds?.length) {
    return {};
  }
  return { id: { in: scope.projectIds } };
}

export function projectLimitWhereFromScope(scope: DataScope): Prisma.ProjectLimitWhereInput {
  if (scope.unrestricted || !scope.projectIds?.length) {
    return {};
  }
  return { projectId: { in: scope.projectIds } };
}

export function assertWarehouseInScope(scope: DataScope, warehouseId: string) {
  if (scope.unrestricted || !scope.warehouseIds?.length) {
    return;
  }
  if (!scope.warehouseIds.includes(warehouseId)) {
    const err = new Error("FORBIDDEN_WAREHOUSE");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}

export function assertProjectInScope(scope: DataScope, projectId: string | null | undefined) {
  if (!projectId) {
    return;
  }
  if (scope.unrestricted || !scope.projectIds?.length) {
    return;
  }
  if (!scope.projectIds.includes(projectId)) {
    const err = new Error("FORBIDDEN_PROJECT");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}

export function mergeIssueWhere(scope: DataScope, extra: Prisma.IssueRequestWhereInput): Prisma.IssueRequestWhereInput {
  const s = issueWhereFromScope(scope);
  if (!Object.keys(s).length) {
    return extra;
  }
  if (!Object.keys(extra).length) {
    return s;
  }
  return { AND: [s, extra] };
}
