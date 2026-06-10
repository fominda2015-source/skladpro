import {
  LimitNodeType,
  OperationType,
  ReceiptRequestStatus,
  ToolStatus,
  type CampItemCategory,
  type Prisma
} from "@prisma/client";
import { CAMP_CATEGORY_DEFS } from "./campCatalog.js";
import {
  objectLimitTemplateWhereFromScope,
  stockWhereFromScope,
  toolWhereFromScope,
  warehouseWhereFromScope,
  type DataScope
} from "./dataScope.js";
import { prisma } from "./prisma.js";

export type HomeCampCategory = {
  key: string;
  label: string;
  icon: string | null;
  count: number;
};

export type HomeToolCategory = {
  key: string;
  label: string;
  icon: string | null;
  count: number;
  inStock: number;
  issued: number;
  inRepair: number;
};

export type HomeLimitSlice = {
  hasTemplate: boolean;
  plannedQty: number;
  issuedQty: number;
  arrivedQty: number;
  onOrderQty: number;
  percent: number;
  overCount: number;
};

export type HomeMovementTrendRow = {
  day: string;
  income: number;
  outcome: number;
};

export type HomeOverviewSummary = {
  objectCount: number;
  campTotal: number;
  limitsSs: HomeLimitSlice;
  limitsEom: HomeLimitSlice;
  limitsOverLines: number;
  objectsWithoutTemplate: number;
  toolsTotal: number;
  toolsInStock: number;
  toolsIssued: number;
  toolsInRepair: number;
  stockLines: number;
  receiptOpen: number;
  toolsByCategory: HomeToolCategory[];
  campByCategory: HomeCampCategory[];
  movementTrend30d: HomeMovementTrendRow[];
};

export type HomeObjectOverview = {
  warehouseId: string;
  name: string;
  campSs: number;
  campEom: number;
  stockLines: number;
  receiptOpen: number;
  limitsSs: HomeLimitSlice;
  limitsEom: HomeLimitSlice;
  camp: {
    total: number;
    categories: HomeCampCategory[];
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

function movementPartsForSection(
  scope: DataScope,
  warehouseIds: string[],
  section: "SS" | "EOM"
): Prisma.StockMovementWhereInput {
  const parts: Prisma.StockMovementWhereInput[] = [
    { direction: "OUT" },
    { warehouseId: { in: warehouseIds } },
    {
      OR: [
        { issueRequest: { is: { section } } },
        { operation: { is: { section } } }
      ]
    }
  ];
  const scoped = movementScopeWhere(scope);
  if (Object.keys(scoped).length) parts.push(scoped);
  return parts.length > 1 ? { AND: parts } : parts[0];
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

function buildCampCategories(
  counts: Partial<Record<CampItemCategory, number>>
): HomeCampCategory[] {
  return CAMP_CATEGORY_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    icon: d.icon,
    count: counts[d.key] ?? 0
  })).filter((c) => c.count > 0);
}

function movementArrivedForSection(
  scope: DataScope,
  warehouseIds: string[],
  section: "SS" | "EOM"
): Prisma.StockMovementWhereInput {
  const scoped = movementScopeWhere(scope);
  const parts: Prisma.StockMovementWhereInput[] = [
    { direction: "IN" },
    { warehouseId: { in: warehouseIds } },
    {
      operation: {
        is: {
          type: OperationType.INCOME,
          section,
          warehouseId: { in: warehouseIds }
        }
      }
    }
  ];
  if (Object.keys(scoped).length) parts.push(scoped);
  return parts.length > 1 ? { AND: parts } : parts[0];
}

function computeLimitSlice(
  whId: string,
  section: "SS" | "EOM",
  tmpl: { nodes: Array<{ materialId: string | null; plannedQty: unknown }> } | undefined,
  issuedByWhMat: Map<string, number>,
  stockByWhSecMat: Map<string, number>,
  arrivedByWhMat: Map<string, number>,
  acceptedByWhSecMat: Map<string, number>,
  onOrderByWhSecMat: Map<string, number>
): HomeLimitSlice {
  const materialNodes = tmpl?.nodes || [];
  const plannedQty = materialNodes.reduce((s, n) => s + Number(n.plannedQty || 0), 0);
  let issuedQty = 0;
  let arrivedQty = 0;
  let onOrderQty = 0;
  let overCount = 0;
  for (const n of materialNodes) {
    if (!n.materialId) continue;
    const mid = n.materialId;
    const issued = issuedByWhMat.get(`${whId}:${mid}`) || 0;
    issuedQty += issued;
    const planned = Number(n.plannedQty || 0);
    if (planned > 0 && issued > planned) overCount += 1;
    const stock = stockByWhSecMat.get(`${whId}:${section}:${mid}`) || 0;
    const movement = arrivedByWhMat.get(`${whId}:${mid}`) || 0;
    const accepted = acceptedByWhSecMat.get(`${whId}:${section}:${mid}`) || 0;
    arrivedQty += Math.max(stock, movement, accepted);
    onOrderQty += onOrderByWhSecMat.get(`${whId}:${section}:${mid}`) || 0;
  }
  const percent = plannedQty > 0 ? Math.min(100, Math.round((issuedQty / plannedQty) * 100)) : 0;
  return {
    hasTemplate: Boolean(tmpl),
    plannedQty,
    issuedQty,
    arrivedQty,
    onOrderQty,
    percent,
    overCount
  };
}

function aggregateLimitSlices(objects: HomeObjectOverview[], pick: (o: HomeObjectOverview) => HomeLimitSlice): HomeLimitSlice {
  let plannedQty = 0;
  let issuedQty = 0;
  let arrivedQty = 0;
  let onOrderQty = 0;
  let overCount = 0;
  let hasAnyTemplate = false;
  for (const o of objects) {
    const s = pick(o);
    if (s.hasTemplate) hasAnyTemplate = true;
    plannedQty += s.plannedQty;
    issuedQty += s.issuedQty;
    arrivedQty += s.arrivedQty;
    onOrderQty += s.onOrderQty;
    overCount += s.overCount;
  }
  const percent = plannedQty > 0 ? Math.min(100, Math.round((issuedQty / plannedQty) * 100)) : 0;
  return { hasTemplate: hasAnyTemplate, plannedQty, issuedQty, arrivedQty, onOrderQty, percent, overCount };
}

const emptySummary = (): HomeOverviewSummary => ({
  objectCount: 0,
  campTotal: 0,
  limitsSs: { hasTemplate: false, plannedQty: 0, issuedQty: 0, arrivedQty: 0, onOrderQty: 0, percent: 0, overCount: 0 },
  limitsEom: { hasTemplate: false, plannedQty: 0, issuedQty: 0, arrivedQty: 0, onOrderQty: 0, percent: 0, overCount: 0 },
  limitsOverLines: 0,
  objectsWithoutTemplate: 0,
  toolsTotal: 0,
  toolsInStock: 0,
  toolsIssued: 0,
  toolsInRepair: 0,
  stockLines: 0,
  receiptOpen: 0,
  toolsByCategory: [],
  campByCategory: [],
  movementTrend30d: []
});

export async function buildHomeOverview(
  scope: DataScope,
  section?: "SS" | "EOM"
): Promise<{ objects: HomeObjectOverview[]; summary: HomeOverviewSummary }> {
  const whWhere = warehouseWhereFromScope(scope);
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true, ...(Object.keys(whWhere).length ? whWhere : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" }
  });
  if (!warehouses.length) {
    return { objects: [], summary: emptySummary() };
  }

  const warehouseIds = warehouses.map((w) => w.id);
  const tmplScoped = objectLimitTemplateWhereFromScope(scope);
  const tmplBase: Prisma.ObjectLimitTemplateWhereInput = {
    ...(Object.keys(tmplScoped).length ? { AND: [tmplScoped] } : {}),
    warehouseId: { in: warehouseIds }
  };

  const toolWhere: Prisma.ToolWhereInput = {
    AND: [
      toolWhereFromScope(scope),
      { warehouseId: { in: warehouseIds } },
      ...(section ? [{ section }] : [])
    ]
  };

  const stockScoped = stockWhereFromScope(scope);
  const stockWhere: Prisma.StockWhereInput = {
    ...(Object.keys(stockScoped).length ? { AND: [stockScoped] } : {}),
    warehouseId: { in: warehouseIds },
    section: { in: ["SS", "EOM"] }
  };

  const campWhere: Prisma.CampItemWhereInput =
    scope.sectionScopes.length > 0
      ? {
          OR: scope.sectionScopes.map((s) => ({
            warehouseId: s.warehouseId,
            section: s.section
          }))
        }
      : { warehouseId: { in: warehouseIds } };

  const [
    templatesSs,
    templatesEom,
    issuedSs,
    issuedEom,
    campGroups,
    campCatGroups,
    toolRows,
    movementRows,
    categories,
    stockGroups,
    receiptGroups,
    stockDetailRows,
    arrivedSsRows,
    arrivedEomRows,
    receiptItemRows
  ] = await Promise.all([
    prisma.objectLimitTemplate.findMany({
      where: { ...tmplBase, section: "SS" },
      include: {
        nodes: {
          where: { nodeType: LimitNodeType.MATERIAL },
          select: { materialId: true, plannedQty: true }
        }
      },
      orderBy: { createdAt: "desc" }
    }),
    prisma.objectLimitTemplate.findMany({
      where: { ...tmplBase, section: "EOM" },
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
      where: movementPartsForSection(scope, warehouseIds, "SS"),
      _sum: { quantity: true }
    }),
    prisma.stockMovement.groupBy({
      by: ["warehouseId", "materialId"],
      where: movementPartsForSection(scope, warehouseIds, "EOM"),
      _sum: { quantity: true }
    }),
    prisma.campItem.groupBy({
      by: ["warehouseId", "section"],
      where: campWhere,
      _count: { _all: true }
    }),
    prisma.campItem.groupBy({
      by: ["warehouseId", "section", "category"],
      where: campWhere,
      _count: { _all: true }
    }),
    prisma.tool.findMany({
      where: toolWhere,
      select: {
        warehouseId: true,
        name: true,
        categoryId: true,
        status: true,
        section: true
      }
    }),
    prisma.stockMovement.findMany({
      where: {
        ...movementScopeWhere(scope),
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      },
      select: { createdAt: true, direction: true, quantity: true }
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
        section: { in: ["SS", "EOM"] },
        status: { in: [ReceiptRequestStatus.NEW, ReceiptRequestStatus.IN_PROGRESS] }
      },
      _count: { id: true }
    }),
    prisma.stock.findMany({
      where: stockWhere,
      select: { warehouseId: true, section: true, materialId: true, quantity: true }
    }),
    prisma.stockMovement.groupBy({
      by: ["warehouseId", "materialId"],
      where: movementArrivedForSection(scope, warehouseIds, "SS"),
      _sum: { quantity: true }
    }),
    prisma.stockMovement.groupBy({
      by: ["warehouseId", "materialId"],
      where: movementArrivedForSection(scope, warehouseIds, "EOM"),
      _sum: { quantity: true }
    }),
    prisma.receiptRequestItem.findMany({
      where: {
        receiptRequest: {
          warehouseId: { in: warehouseIds },
          section: { in: ["SS", "EOM"] }
        }
      },
      select: {
        quantity: true,
        acceptedQty: true,
        mappedMaterialId: true,
        limitNode: { select: { materialId: true } },
        receiptRequest: { select: { warehouseId: true, section: true, status: true } }
      }
    })
  ]);

  const latestTmplSs = new Map<string, (typeof templatesSs)[0]>();
  for (const t of templatesSs) {
    if (!latestTmplSs.has(t.warehouseId)) latestTmplSs.set(t.warehouseId, t);
  }
  const latestTmplEom = new Map<string, (typeof templatesEom)[0]>();
  for (const t of templatesEom) {
    if (!latestTmplEom.has(t.warehouseId)) latestTmplEom.set(t.warehouseId, t);
  }

  const issuedMap = (rows: typeof issuedSs) => {
    const m = new Map<string, number>();
    for (const row of rows) {
      if (!row.warehouseId) continue;
      m.set(`${row.warehouseId}:${row.materialId}`, Number(row._sum.quantity || 0));
    }
    return m;
  };
  const issuedSsMap = issuedMap(issuedSs);
  const issuedEomMap = issuedMap(issuedEom);

  const stockByWhSecMat = new Map<string, number>();
  for (const s of stockDetailRows) {
    stockByWhSecMat.set(`${s.warehouseId}:${s.section}:${s.materialId}`, Number(s.quantity) || 0);
  }

  const buildArrivedByWhMat = (rows: typeof arrivedSsRows) => {
    const m = new Map<string, number>();
    for (const row of rows) {
      if (!row.warehouseId) continue;
      m.set(`${row.warehouseId}:${row.materialId}`, Number(row._sum.quantity || 0));
    }
    return m;
  };
  const arrivedSsByWhMat = buildArrivedByWhMat(arrivedSsRows);
  const arrivedEomByWhMat = buildArrivedByWhMat(arrivedEomRows);

  const acceptedByWhSecMat = new Map<string, number>();
  const onOrderByWhSecMat = new Map<string, number>();
  for (const it of receiptItemRows) {
    const rr = it.receiptRequest;
    const mid = it.mappedMaterialId || it.limitNode?.materialId;
    if (!mid || !rr.warehouseId) continue;
    const key = `${rr.warehouseId}:${rr.section}:${mid}`;
    acceptedByWhSecMat.set(key, (acceptedByWhSecMat.get(key) || 0) + Number(it.acceptedQty || 0));
    if (rr.status === ReceiptRequestStatus.NEW || rr.status === ReceiptRequestStatus.IN_PROGRESS) {
      const rem = Math.max(0, Number(it.quantity) - Number(it.acceptedQty || 0));
      if (rem > 0) onOrderByWhSecMat.set(key, (onOrderByWhSecMat.get(key) || 0) + rem);
    }
  }

  const campByWhSec = new Map<string, number>();
  for (const g of campGroups) {
    if (!g.warehouseId) continue;
    campByWhSec.set(`${g.warehouseId}:${g.section}`, g._count._all);
  }

  const campCatByWh = new Map<string, Partial<Record<CampItemCategory, number>>>();
  for (const g of campCatGroups) {
    if (!g.warehouseId) continue;
    const key = g.warehouseId;
    const bucket = campCatByWh.get(key) || {};
    bucket[g.category] = (bucket[g.category] ?? 0) + g._count._all;
    campCatByWh.set(key, bucket);
  }

  const globalCampCounts: Partial<Record<CampItemCategory, number>> = {};
  for (const g of campCatGroups) {
    globalCampCounts[g.category] = (globalCampCounts[g.category] ?? 0) + g._count._all;
  }

  const toolsByWh = new Map<string, typeof toolRows>();
  for (const t of toolRows) {
    if (!t.warehouseId) continue;
    const list = toolsByWh.get(t.warehouseId) || [];
    list.push(t);
    toolsByWh.set(t.warehouseId, list);
  }

  const stockByWh = new Map(stockGroups.map((g) => [g.warehouseId, g._count.materialId]));
  const receiptByWh = new Map(receiptGroups.map((g) => [g.warehouseId, g._count.id]));

  const objects: HomeObjectOverview[] = warehouses.map((wh) => {
    const whTools = toolsByWh.get(wh.id) || [];
    const cats = buildToolCategories(whTools, categories);
    const campSs = campByWhSec.get(`${wh.id}:SS`) ?? 0;
    const campEom = campByWhSec.get(`${wh.id}:EOM`) ?? 0;
    return {
      warehouseId: wh.id,
      name: wh.name,
      campSs,
      campEom,
      stockLines: stockByWh.get(wh.id) ?? 0,
      receiptOpen: receiptByWh.get(wh.id) ?? 0,
      limitsSs: computeLimitSlice(
        wh.id,
        "SS",
        latestTmplSs.get(wh.id),
        issuedSsMap,
        stockByWhSecMat,
        arrivedSsByWhMat,
        acceptedByWhSecMat,
        onOrderByWhSecMat
      ),
      limitsEom: computeLimitSlice(
        wh.id,
        "EOM",
        latestTmplEom.get(wh.id),
        issuedEomMap,
        stockByWhSecMat,
        arrivedEomByWhMat,
        acceptedByWhSecMat,
        onOrderByWhSecMat
      ),
      camp: {
        total: campSs + campEom,
        categories: buildCampCategories(campCatByWh.get(wh.id) || {})
      },
      tools: {
        total: whTools.length,
        inStock: whTools.filter((t) => t.status === ToolStatus.IN_STOCK).length,
        issued: whTools.filter((t) => t.status === ToolStatus.ISSUED).length,
        inRepair: whTools.filter((t) => t.status === ToolStatus.IN_REPAIR).length,
        categories: cats.slice(0, 8)
      }
    };
  });

  const toolsByCategory = buildToolCategories(toolRows, categories);
  const toolsTotal = toolRows.length;
  const toolsInStock = toolRows.filter((t) => t.status === ToolStatus.IN_STOCK).length;
  const toolsIssued = toolRows.filter((t) => t.status === ToolStatus.ISSUED).length;
  const toolsInRepair = toolRows.filter((t) => t.status === ToolStatus.IN_REPAIR).length;

  const trendMap = new Map<string, { income: number; outcome: number }>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    trendMap.set(key, { income: 0, outcome: 0 });
  }
  for (const m of movementRows) {
    const key = new Date(m.createdAt).toISOString().slice(0, 10);
    const bucket = trendMap.get(key);
    if (!bucket) continue;
    const q = Math.abs(Number(m.quantity) || 0);
    if (m.direction === "IN") bucket.income += q;
    else bucket.outcome += q;
  }
  const movementTrend30d = Array.from(trendMap.entries()).map(([day, v]) => ({
    day,
    income: Math.round(v.income * 1000) / 1000,
    outcome: Math.round(v.outcome * 1000) / 1000
  }));

  let limitsOverLines = 0;
  let objectsWithoutTemplate = 0;
  let stockLines = 0;
  let receiptOpen = 0;
  for (const o of objects) {
    limitsOverLines += o.limitsSs.overCount + o.limitsEom.overCount;
    if (!o.limitsSs.hasTemplate && !o.limitsEom.hasTemplate) objectsWithoutTemplate += 1;
    stockLines += o.stockLines;
    receiptOpen += o.receiptOpen;
  }

  return {
    objects,
    summary: {
      objectCount: objects.length,
      campTotal: objects.reduce((s, o) => s + o.campSs + o.campEom, 0),
      limitsSs: aggregateLimitSlices(objects, (o) => o.limitsSs),
      limitsEom: aggregateLimitSlices(objects, (o) => o.limitsEom),
      limitsOverLines,
      objectsWithoutTemplate,
      toolsTotal,
      toolsInStock,
      toolsIssued,
      toolsInRepair,
      stockLines,
      receiptOpen,
      toolsByCategory,
      campByCategory: buildCampCategories(globalCampCounts),
      movementTrend30d
    }
  };
}
