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
  /** Доступы по секциям внутри объекта (склада). */
  sectionScopes: Array<{ warehouseId: string; section: "SS" | "EOM" }>;
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
  const [userRow, whRows, pjRows, sectionRows] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { activeWarehouseId: true, activeSection: true }
    }),
    prisma.userWarehouseScope.findMany({ where: { userId }, select: { warehouseId: true } }),
    prisma.userProjectScope.findMany({ where: { userId }, select: { projectId: true } }),
    prisma.userWarehouseSectionScope.findMany({ where: { userId }, select: { warehouseId: true, section: true } })
  ]);
  if (permissions.includes("*")) {
    if (userRow?.activeWarehouseId) {
      return {
        unrestricted: false,
        warehouseIds: [userRow.activeWarehouseId],
        projectIds: null,
        sectionScopes: userRow.activeSection
          ? [{ warehouseId: userRow.activeWarehouseId, section: userRow.activeSection }]
          : []
      };
    }
    return { unrestricted: true, warehouseIds: null, projectIds: null, sectionScopes: [] };
  }
  const activeWarehouseId = userRow?.activeWarehouseId || null;
  const activeSection = userRow?.activeSection || null;
  const scopedWarehouses = whRows.map((r) => r.warehouseId);
  const warehouseIds =
    activeWarehouseId && scopedWarehouses.includes(activeWarehouseId) ? [activeWarehouseId] : scopedWarehouses;
  const filteredSections = sectionRows.filter((s) =>
    activeWarehouseId ? s.warehouseId === activeWarehouseId : true
  );
  const sectionScopes = activeSection
    ? filteredSections
        .filter((s) => s.section === activeSection)
        .map((s) => ({ warehouseId: s.warehouseId, section: s.section }))
    : filteredSections.map((s) => ({ warehouseId: s.warehouseId, section: s.section }));
  return {
    unrestricted: false,
    warehouseIds: warehouseIds.length ? warehouseIds : null,
    projectIds: pjRows.length ? pjRows.map((r) => r.projectId) : null,
    sectionScopes
  };
}

export function stockWhereFromScope(scope: DataScope): Prisma.StockWhereInput {
  if (scope.unrestricted) {
    return {};
  }
  if (scope.sectionScopes.length) {
    return {
      OR: scope.sectionScopes.map((s) => ({
        warehouseId: s.warehouseId,
        section: s.section
      }))
    };
  }
  if (scope.warehouseIds?.length) {
    return { warehouseId: { in: scope.warehouseIds } };
  }
  return {};
}

export function issueWhereFromScope(scope: DataScope): Prisma.IssueRequestWhereInput {
  const parts: Prisma.IssueRequestWhereInput[] = [];
  if (!scope.unrestricted && scope.sectionScopes.length) {
    parts.push({
      OR: scope.sectionScopes.map((s) => ({ warehouseId: s.warehouseId, section: s.section }))
    });
  } else if (!scope.unrestricted && scope.warehouseIds?.length) {
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
  if (scope.unrestricted) {
    return {};
  }
  if (scope.sectionScopes.length) {
    return {
      OR: scope.sectionScopes.map((s) => ({
        warehouseId: s.warehouseId,
        section: s.section
      }))
    };
  }
  if (scope.warehouseIds?.length) {
    return { warehouseId: { in: scope.warehouseIds } };
  }
  return {};
}

export function toolWhereFromScope(scope: DataScope): Prisma.ToolWhereInput {
  if (scope.unrestricted) {
    return {};
  }
  if (scope.sectionScopes.length) {
    return {
      OR: scope.sectionScopes.map((s) => ({
        warehouseId: s.warehouseId,
        section: s.section
      }))
    };
  }
  if (!scope.warehouseIds?.length) {
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
  if (scope.unrestricted) {
    return {};
  }
  const parts: Prisma.ProjectWhereInput[] = [];
  if (scope.projectIds?.length) {
    parts.push({ id: { in: scope.projectIds } });
  }
  if (scope.sectionScopes.length) {
    parts.push({
      OR: scope.sectionScopes.map((s) => ({
        warehouseId: s.warehouseId,
        section: s.section
      }))
    });
  }
  if (!parts.length) {
    return {};
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return { AND: parts };
}

export function projectLimitWhereFromScope(scope: DataScope): Prisma.ProjectLimitWhereInput {
  if (scope.unrestricted) {
    return {};
  }
  const pScope = projectWhereFromScope(scope);
  if (!Object.keys(pScope).length) {
    return {};
  }
  return { project: pScope };
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
