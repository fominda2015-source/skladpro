import { LimitNodeType, ReceiptRequestStatus, ToolStatus, type Prisma } from "@prisma/client";
import {
  objectLimitTemplateWhereFromScope,
  stockWhereFromScope,
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

export type HomeOverviewSummary = {
  objectCount: number;
  campTotal: number;
  limitsPlanned: number;
  limitsIssued: number;
  limitsPercent: number;
  limitsOverLines: number;
  objectsWithoutTemplate: number;
  toolsTotal: number;
  toolsInStock: number;
  toolsIssued: number;
  toolsInRepair: number;
  stockLines: number;
  receiptOpen: number;
  topToolCategories: HomeToolCategory[];
};

export type HomeObjectOverview = {
  warehouseId: string;
  name: string;
  campCount: number;
  stockLines: number;
  receiptOpen: number;
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

function aggregateTopToolCategories(
  objects: HomeObjectOverview[],
  limit = 8
): HomeToolCategory[] {
  const merged = new Map<string, HomeToolCategory>();
  for (const obj of objects) {
    for (const c of obj.tools.categories) {
      const prev = merged.get(c.key);
      if (!prev) {
        merged.set(c.key, { ...c });
      } else {
        prev.count += c.count;
        prev.inStock += c.inStock;
        prev.issued += c.issued;
        prev.inRepair += c.inRepair;
      }
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru"))
    .slice(0, limit);
}

export async function buildHomeOverview(
  scope: DataScope,
  section: "SS" | "EOM"
): Promise<{ objects: HomeObjectOverview[]; summary: HomeOverviewSummary }> {
  const whWhere = warehouseWhereFromScope(scope);
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true, ...(Object.keys(whWhere).length ? whWhere : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" }
  });
  if (!warehouses.length) {
    return {
      objects: [],
      summary: {
        objectCount: 0,
        campTotal: 0,
        limitsPlanned: 0,
        limitsIssued: 0,
        limitsPercent: 0,
        limitsOverLines: 0,
        objectsWithoutTemplate: 0,
        toolsTotal: 0,
        toolsInStock: 0,
        toolsIssued: 0,
        toolsInRepair: 0,
        stockLines: 0,
        receiptOpen: 0,
        topToolCategories: []
      }
    };
  }

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

  const stockScoped = stockWhereFromScope(scope);
  const stockWhere: Prisma.StockWhereInput = {
    ...(Object.keys(stockScoped).length ? { AND: [stockScoped] } : {}),
    warehouseId: { in: warehouseIds },
    section
  };

  const [templates, issuedRows, campGroups, toolRows, categories, stockGroups, receiptGroups] =
    await Promise.all([
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
    prisma.toolCategory.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] }),
    prisma.stock.groupBy({
      by: ["warehouseId"],
      where: stockWhere,
      _count: { materialId: true }
    }),
    prisma.receiptRequest.groupBy({
      by: ["warehouseId"],
      where: {
        warehouseId: { in: warehouseIds },
        section,
        status: { in: [ReceiptRequestStatus.NEW, ReceiptRequestStatus.IN_PROGRESS] }
      },
      _count: { id: true }
    })
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
  const stockByWh = new Map(
    stockGroups.map((g) => [g.warehouseId, g._count.materialId])
  );
  const receiptByWh = new Map(
    receiptGroups.map((g) => [g.warehouseId, g._count.id])
  );

  const objects: HomeObjectOverview[] = warehouses.map((wh) => {
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
      stockLines: stockByWh.get(wh.id) ?? 0,
      receiptOpen: receiptByWh.get(wh.id) ?? 0,
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

  let campTotal = 0;
  let limitsPlanned = 0;
  let limitsIssued = 0;
  let limitsOverLines = 0;
  let objectsWithoutTemplate = 0;
  let toolsTotal = 0;
  let toolsInStock = 0;
  let toolsIssued = 0;
  let toolsInRepair = 0;
  let stockLines = 0;
  let receiptOpen = 0;
  for (const o of objects) {
    campTotal += o.campCount;
    limitsPlanned += o.limits.plannedQty;
    limitsIssued += o.limits.issuedQty;
    limitsOverLines += o.limits.overCount;
    if (!o.limits.hasTemplate) objectsWithoutTemplate += 1;
    toolsTotal += o.tools.total;
    toolsInStock += o.tools.inStock;
    toolsIssued += o.tools.issued;
    toolsInRepair += o.tools.inRepair;
    stockLines += o.stockLines;
    receiptOpen += o.receiptOpen;
  }
  const limitsPercent =
    limitsPlanned > 0 ? Math.min(100, Math.round((limitsIssued / limitsPlanned) * 100)) : 0;

  return {
    objects,
    summary: {
      objectCount: objects.length,
      campTotal,
      limitsPlanned,
      limitsIssued,
      limitsPercent,
      limitsOverLines,
      objectsWithoutTemplate,
      toolsTotal,
      toolsInStock,
      toolsIssued,
      toolsInRepair,
      stockLines,
      receiptOpen,
      topToolCategories: aggregateTopToolCategories(objects)
    }
  };
}
