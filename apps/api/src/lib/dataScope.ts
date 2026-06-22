import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import type { AuthedRequest } from "../middleware/auth.js";
import { resolveAllowedSectionPairs, type ObjectSection } from "./objectAccess.js";

const scopeCache = new WeakMap<AuthedRequest, Promise<DataScope>>();

type SectionPair = { warehouseId: string; section: ObjectSection };

export type DataScope = {
  unrestricted: boolean;
  /** Если непустой — пользователь видит только эти склады. Пусто в БД = без ограничения по складу. */
  warehouseIds: string[] | null;
  /** Если непустой — ограничение по проектам (заявки, лимиты, проекты в списке). */
  projectIds: string[] | null;
  /** Текущий активный раздел (для списков без ?section=). */
  sectionScopes: SectionPair[];
  /** Все разрешённые пары объект+раздел (без фильтра activeSection). */
  allowedSectionPairs: SectionPair[];
};

export type QuerySectionContext = {
  warehouseId?: string;
  section?: "SS" | "EOM";
};

function bothSectionsForWarehouse(warehouseId: string): SectionPair[] {
  return [
    { warehouseId, section: "SS" },
    { warehouseId, section: "EOM" }
  ];
}

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

/** Сводка главной — всегда по всем доступным объектам, без фильтра «текущий объект» в шапке. */
export async function getHomeOverviewDataScope(req: AuthedRequest): Promise<DataScope> {
  if (!req.user) {
    throw new Error("Unauthorized");
  }
  const { userId, permissions } = req.user;
  if (permissions.includes("*")) {
    return {
      unrestricted: true,
      warehouseIds: null,
      projectIds: null,
      sectionScopes: [],
      allowedSectionPairs: []
    };
  }
  const [whRows, pjRows, sectionRows] = await Promise.all([
    prisma.userWarehouseScope.findMany({ where: { userId }, select: { warehouseId: true } }),
    prisma.userProjectScope.findMany({ where: { userId }, select: { projectId: true } }),
    prisma.userWarehouseSectionScope.findMany({ where: { userId }, select: { warehouseId: true, section: true } })
  ]);
  return {
    unrestricted: false,
    warehouseIds: whRows.length ? whRows.map((r) => r.warehouseId) : [],
    projectIds: pjRows.length ? pjRows.map((r) => r.projectId) : null,
    sectionScopes: sectionRows.map((s) => ({
      warehouseId: s.warehouseId,
      section: s.section
    })),
    allowedSectionPairs: resolveAllowedSectionPairs(
      whRows.map((r) => r.warehouseId),
      sectionRows
    )
  };
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
      const whId = userRow.activeWarehouseId;
      return {
        unrestricted: false,
        warehouseIds: [whId],
        projectIds: null,
        sectionScopes: userRow.activeSection
          ? [{ warehouseId: whId, section: userRow.activeSection }]
          : [],
        allowedSectionPairs: bothSectionsForWarehouse(whId)
      };
    }
    return {
      unrestricted: true,
      warehouseIds: null,
      projectIds: null,
      sectionScopes: [],
      allowedSectionPairs: []
    };
  }
  const activeWarehouseId = userRow?.activeWarehouseId || null;
  const activeSection = userRow?.activeSection || null;
  const scopedWarehouses = whRows.map((r) => r.warehouseId);
  const warehouseIds =
    activeWarehouseId && scopedWarehouses.includes(activeWarehouseId) ? [activeWarehouseId] : scopedWarehouses;
  const warehousesForPairs =
    activeWarehouseId && scopedWarehouses.includes(activeWarehouseId) ? [activeWarehouseId] : scopedWarehouses;
  const allowedSectionPairs = resolveAllowedSectionPairs(warehousesForPairs, sectionRows);
  const sectionScopes = activeSection
    ? allowedSectionPairs.filter((s) => s.section === activeSection)
    : allowedSectionPairs;
  return {
    unrestricted: false,
    warehouseIds: warehouseIds.length ? warehouseIds : [],
    projectIds: pjRows.length ? pjRows.map((r) => r.projectId) : null,
    sectionScopes,
    allowedSectionPairs
  };
}

/** Явный ?section= в запросе — не смешивать с устаревшим activeSection в scope. */
export function assertQuerySectionAllowed(scope: DataScope, query: QuerySectionContext) {
  if (!query.section) return;
  if (scope.unrestricted && !scope.allowedSectionPairs.length) {
    return;
  }
  const pairs = scope.allowedSectionPairs.length ? scope.allowedSectionPairs : scope.sectionScopes;
  if (!pairs.length) {
    return;
  }
  if (query.warehouseId) {
    assertWarehouseInScope(scope, query.warehouseId);
    if (!pairs.some((p) => p.warehouseId === query.warehouseId && p.section === query.section)) {
      const err = new Error("FORBIDDEN_SECTION");
      (err as Error & { status: number }).status = 403;
      throw err;
    }
    return;
  }
  if (!pairs.some((p) => p.section === query.section)) {
    const err = new Error("FORBIDDEN_SECTION");
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}

function explicitSectionWhere(
  scope: DataScope,
  query: QuerySectionContext
): { warehouseId?: string; section: "SS" | "EOM" } | null {
  if (!query.section) return null;
  assertQuerySectionAllowed(scope, query);
  if (query.warehouseId) {
    return { warehouseId: query.warehouseId, section: query.section };
  }
  return { section: query.section };
}

export function stockWhereForQuery(
  scope: DataScope,
  query: QuerySectionContext
): Prisma.StockWhereInput {
  const explicit = explicitSectionWhere(scope, query);
  if (!explicit) return stockWhereFromScope(scope);
  if (explicit.warehouseId) {
    return { warehouseId: explicit.warehouseId, section: explicit.section };
  }
  if (scope.warehouseIds?.length) {
    return { warehouseId: { in: scope.warehouseIds }, section: explicit.section };
  }
  return { section: explicit.section };
}

export function toolWhereForQuery(
  scope: DataScope,
  query: QuerySectionContext
): Prisma.ToolWhereInput {
  const explicit = explicitSectionWhere(scope, query);
  if (!explicit) return toolWhereFromScope(scope);
  if (explicit.warehouseId) {
    return { warehouseId: explicit.warehouseId, section: explicit.section };
  }
  if (scope.warehouseIds?.length) {
    return { warehouseId: { in: scope.warehouseIds }, section: explicit.section };
  }
  return { section: explicit.section };
}

export function operationWhereForQuery(
  scope: DataScope,
  query: QuerySectionContext
): Prisma.OperationWhereInput {
  const explicit = explicitSectionWhere(scope, query);
  if (!explicit) return operationWhereFromScope(scope);
  if (explicit.warehouseId) {
    return { warehouseId: explicit.warehouseId, section: explicit.section };
  }
  if (scope.warehouseIds?.length) {
    return { warehouseId: { in: scope.warehouseIds }, section: explicit.section };
  }
  return { section: explicit.section };
}

export function issueWhereForQuery(
  scope: DataScope,
  query: QuerySectionContext
): Prisma.IssueRequestWhereInput {
  const explicit = explicitSectionWhere(scope, query);
  if (!explicit) return issueWhereFromScope(scope);
  let base: Prisma.IssueRequestWhereInput;
  if (explicit.warehouseId) {
    base = { warehouseId: explicit.warehouseId, section: explicit.section };
  } else if (scope.warehouseIds?.length) {
    base = { warehouseId: { in: scope.warehouseIds }, section: explicit.section };
  } else {
    base = { section: explicit.section };
  }
  if (!scope.unrestricted && scope.projectIds?.length) {
    return {
      AND: [base, { OR: [{ projectId: null }, { projectId: { in: scope.projectIds } }] }]
    };
  }
  return base;
}

export function objectLimitTemplateWhereForQuery(
  scope: DataScope,
  query: QuerySectionContext
): Prisma.ObjectLimitTemplateWhereInput {
  const explicit = explicitSectionWhere(scope, query);
  if (!explicit) return objectLimitTemplateWhereFromScope(scope);
  if (explicit.warehouseId) {
    return { warehouseId: explicit.warehouseId, section: explicit.section };
  }
  if (scope.warehouseIds?.length) {
    return { warehouseId: { in: scope.warehouseIds }, section: explicit.section };
  }
  return { section: explicit.section };
}

export function stockMovementWhereFromScope(scope: DataScope): Prisma.StockMovementWhereInput {
  if (scope.unrestricted) {
    return {};
  }
  if (scope.sectionScopes.length) {
    return {
      OR: scope.sectionScopes.map((s) => ({
        warehouseId: s.warehouseId,
        OR: [
          { operation: { is: { section: s.section, warehouseId: s.warehouseId } } },
          { issueRequest: { is: { section: s.section, warehouseId: s.warehouseId } } }
        ]
      }))
    };
  }
  if (scope.warehouseIds?.length) {
    return { warehouseId: { in: scope.warehouseIds } };
  }
  return { warehouseId: { in: [] } };
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
  return { warehouseId: { in: [] } };
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
  if (!scope.unrestricted && !scope.sectionScopes.length && !scope.warehouseIds?.length) {
    return { warehouseId: { in: [] } };
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
  return { warehouseId: { in: [] } };
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
    return { warehouseId: { in: [] } };
  }
  return {
    OR: [{ warehouseId: { in: scope.warehouseIds } }, { warehouseId: null }]
  };
}

export function waybillWhereFromScope(scope: DataScope): Prisma.TransportWaybillWhereInput {
  if (scope.unrestricted) {
    return {};
  }
  if (!scope.warehouseIds?.length) {
    return { fromWarehouseId: { in: [] } };
  }
  return {
    OR: [{ fromWarehouseId: { in: scope.warehouseIds } }, { fromWarehouseId: null }]
  };
}

export function warehouseWhereFromScope(scope: DataScope): Prisma.WarehouseWhereInput {
  if (scope.unrestricted) {
    return {};
  }
  if (!scope.warehouseIds?.length) {
    return { id: { in: [] } };
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
    return { id: { in: [] } };
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

export function objectLimitTemplateWhereFromScope(scope: DataScope): Prisma.ObjectLimitTemplateWhereInput {
  if (scope.unrestricted) {
    return {};
  }
  if (scope.sectionScopes.length) {
    return {
      OR: scope.sectionScopes.map((s) => ({ warehouseId: s.warehouseId, section: s.section }))
    };
  }
  if (scope.warehouseIds?.length) {
    return { warehouseId: { in: scope.warehouseIds } };
  }
  return { warehouseId: { in: [] } };
}

/**
 * Область для чтения по явному warehouseId в query (главная, drill по объектам).
 * Не сужается до активного склада в шапке — иначе периодические 403 при просмотре «чужих» объектов.
 */
export async function resolveReadScope(
  req: AuthedRequest,
  opts?: { warehouseId?: string }
): Promise<DataScope> {
  if (opts?.warehouseId) {
    return getHomeOverviewDataScope(req);
  }
  return getRequestDataScope(req);
}

export function assertWarehouseInScope(scope: DataScope, warehouseId: string) {
  if (scope.unrestricted) {
    return;
  }
  if (!scope.warehouseIds?.length) {
    const err = new Error("FORBIDDEN_WAREHOUSE") as Error & { status: number };
    err.status = 403;
    throw err;
  }
  if (!scope.warehouseIds.includes(warehouseId)) {
    const err = new Error("FORBIDDEN_WAREHOUSE") as Error & { status: number };
    err.status = 403;
    throw err;
  }
}

export function assertObjectSectionInScope(scope: DataScope, warehouseId: string, section: "SS" | "EOM") {
  assertWarehouseInScope(scope, warehouseId);
  if (scope.unrestricted && !scope.allowedSectionPairs.length) {
    return;
  }
  const pairs = scope.allowedSectionPairs.length ? scope.allowedSectionPairs : scope.sectionScopes;
  if (!pairs.length) {
    return;
  }
  if (!pairs.some((s) => s.warehouseId === warehouseId && s.section === section)) {
    const err = new Error("FORBIDDEN_SECTION");
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

export function mergeIssueWhere(
  scope: DataScope,
  extra: Prisma.IssueRequestWhereInput,
  query?: QuerySectionContext
): Prisma.IssueRequestWhereInput {
  const s = query?.section ? issueWhereForQuery(scope, query) : issueWhereFromScope(scope);
  if (!Object.keys(s).length) {
    return extra;
  }
  if (!Object.keys(extra).length) {
    return s;
  }
  return { AND: [s, extra] };
}

export function transferRequestWhereFromScope(scope: DataScope, userId: string): Prisma.TransferRequestWhereInput {
  if (scope.unrestricted && !scope.warehouseIds?.length) {
    return {};
  }
  const or: Prisma.TransferRequestWhereInput[] = [{ requestedById: userId }];
  if (scope.warehouseIds?.length) {
    or.push({ fromWarehouseId: { in: scope.warehouseIds } }, { toWarehouseId: { in: scope.warehouseIds } });
  }
  return { OR: or };
}
