import { LimitNodeType, ToolStatus, type Prisma } from "@prisma/client";
import {
  objectLimitTemplateWhereFromScope,
  toolWhereFromScope,
  warehouseWhereFromScope,
  type DataScope
} from "./dataScope.js";
import { prisma } from "./prisma.js";

export type HomeToolCategory = {
  key: string;
  label: string;
  icon: string | null;
  count: number;
  inStock: number;
  issued: number;
  inRepair: number;
};

export type HomeObjectOverview = {
  warehouseId: string;
  name: string;
  campCount: number;
  limits: {
    hasTemplate: boolean;
    plannedQty: number;
    issuedQty: number;
    percent: number;
    overCount: number;
  };
  tools: {
    total: number;
    inStock: number;
    issued: number;
    inRepair: number;
    categories: HomeToolCategory[];
  };
};

function movementScopeWhere(scope: DataScope): Prisma.StockMovementWhereInput {
  if (scope.unrestricted) return {};
  if (scope.sectionScopes.length) {
    return {
      OR: scope.sectionScopes.map((s) => ({
        warehouseId: s.warehouseId,
        OR: [
          { issueRequest: { is: { section: s.section } } },
          { operation: { is: { section: s.section } } }
        ]
      }))
    };
  }
  if (scope.warehouseIds?.length) {
    return { warehouseId: { in: scope.warehouseIds } };
  }
  return {};
}

function buildToolCategories(
  tools: Array<{ name: string; categoryId: string | null; status: ToolStatus }>,
  categories: Array<{ id: string; name: string; icon: string | null }>
): HomeToolCategory[] {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const cards = new Map<string, HomeToolCategory>();
  const ensure = (key: string, label: string, icon: string | null) => {
    let c = cards.get(key);
    if (!c) {
      c = { key, label, icon, count: 0, inStock: 0, issued: 0, inRepair: 0 };
      cards.set(key, c);
    }
    return c;
  };
  for (const cat of categories) {
    ensure(`cat:${cat.id}`, cat.name, cat.icon);
  }
  for (const t of tools) {
    let card: HomeToolCategory;
    if (t.categoryId && catById.has(t.categoryId)) {
      const cat = catById.get(t.categoryId)!;
      card = ensure(`cat:${cat.id}`, cat.name, cat.icon);
    } else {
      const label = (t.name || "Без названия").trim() || "Без названия";
      card = ensure(`name:${label.toLowerCase()}`, label, null);
    }
    card.count += 1;
    if (t.status === ToolStatus.IN_STOCK) card.inStock += 1;
    else if (t.status === ToolStatus.ISSUED) card.issued += 1;
    else if (t.status === ToolStatus.IN_REPAIR) card.inRepair += 1;
  }
  return [...cards.values()]
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"));
}

export async function buildHomeOverview(
  scope: DataScope,
  section: "SS" | "EOM"
): Promise<HomeObjectOverview[]> {
  const whWhere = warehouseWhereFromScope(scope);
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true, ...(Object.keys(whWhere).length ? whWhere : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" }
  });
  if (!warehouses.length) return [];

  const warehouseIds = warehouses.map((w) => w.id);
  const tmplScoped = objectLimitTemplateWhereFromScope(scope);
  const tmplWhere: Prisma.ObjectLimitTemplateWhereInput = {
    ...(Object.keys(tmplScoped).length ? { AND: [tmplScoped] } : {}),
    warehouseId: { in: warehouseIds },
    section
  };

  const movementParts: Prisma.StockMovementWhereInput[] = [
    { direction: "OUT" },
    { warehouseId: { in: warehouseIds } },
    {
      OR: [
        { issueRequest: { is: { section } } },
        { operation: { is: { section } } }
      ]
    }
  ];
  const scopedMove = movementScopeWhere(scope);
  if (Object.keys(scopedMove).length) movementParts.push(scopedMove);

  const campWhere: Prisma.CampItemWhereInput =
    scope.sectionScopes.length > 0
      ? {
          OR: scope.sectionScopes
            .filter((s) => s.section === section && warehouseIds.includes(s.warehouseId))
            .map((s) => ({ warehouseId: s.warehouseId, section: s.section }))
        }
      : { warehouseId: { in: warehouseIds }, section };

  const toolWhere: Prisma.ToolWhereInput = {
    AND: [toolWhereFromScope(scope), { warehouseId: { in: warehouseIds }, section }]
  };

  const [templates, issuedRows, campGroups, toolRows, categories] = await Promise.all([
    prisma.objectLimitTemplate.findMany({
      where: tmplWhere,
      include: {
        nodes: {
          where: { nodeType: LimitNodeType.MATERIAL },
          select: { materialId: true, plannedQty: true }
        }
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.stockMovement.groupBy({
      by: ["warehouseId", "materialId"],
      where: movementParts.length > 1 ? { AND: movementParts } : movementParts[0],
      _sum: { quantity: true }
    }),
    prisma.campItem.groupBy({
      by: ["warehouseId"],
      where: campWhere,
      _count: { _all: true }
    }),
    prisma.tool.findMany({
      where: toolWhere,
      select: { warehouseId: true, name: true, categoryId: true, status: true }
    }),
    prisma.toolCategory.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] })
  ]);

  const latestTemplateByWh = new Map<string, (typeof templates)[0]>();
  for (const t of templates) {
    if (!latestTemplateByWh.has(t.warehouseId)) latestTemplateByWh.set(t.warehouseId, t);
  }

  const issuedByWhMat = new Map<string, number>();
  for (const row of issuedRows) {
    if (!row.warehouseId) continue;
    const key = `${row.warehouseId}:${row.materialId}`;
    issuedByWhMat.set(key, Number(row._sum.quantity || 0));
  }

  const toolsByWh = new Map<string, typeof toolRows>();
  for (const t of toolRows) {
    if (!t.warehouseId) continue;
    const list = toolsByWh.get(t.warehouseId) || [];
    list.push(t);
    toolsByWh.set(t.warehouseId, list);
  }

  const campByWh = new Map(
    campGroups.map((g) => [g.warehouseId || "", g._count._all])
  );

  return warehouses.map((wh) => {
    const tmpl = latestTemplateByWh.get(wh.id);
    const materialNodes = tmpl?.nodes || [];
    const plannedQty = materialNodes.reduce((s, n) => s + Number(n.plannedQty || 0), 0);
    let issuedQty = 0;
    let overCount = 0;
    for (const n of materialNodes) {
      if (!n.materialId) continue;
      const issued = issuedByWhMat.get(`${wh.id}:${n.materialId}`) || 0;
      issuedQty += issued;
      const planned = Number(n.plannedQty || 0);
      if (planned > 0 && issued > planned) overCount += 1;
    }
    const percent = plannedQty > 0 ? Math.min(100, Math.round((issuedQty / plannedQty) * 100)) : 0;
    const whTools = toolsByWh.get(wh.id) || [];
    const cats = buildToolCategories(whTools, categories);
    const toolsTotal = whTools.length;
    const toolsInStock = whTools.filter((t) => t.status === ToolStatus.IN_STOCK).length;
    const toolsIssued = whTools.filter((t) => t.status === ToolStatus.ISSUED).length;
    const toolsInRepair = whTools.filter((t) => t.status === ToolStatus.IN_REPAIR).length;

    return {
      warehouseId: wh.id,
      name: wh.name,
      campCount: campByWh.get(wh.id) ?? 0,
      limits: {
        hasTemplate: Boolean(tmpl),
        plannedQty,
        issuedQty,
        percent,
        overCount
      },
      tools: {
        total: toolsTotal,
        inStock: toolsInStock,
        issued: toolsIssued,
        inRepair: toolsInRepair,
        categories: cats.slice(0, 8)
      }
    };
  });
}
