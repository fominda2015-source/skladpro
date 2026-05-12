import type { Prisma } from "@prisma/client";
import { Router } from "express";
import path from "node:path";
import PDFDocument from "pdfkit";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import {
  assertWarehouseInScope,
  type DataScope,
  getRequestDataScope,
  issueWhereFromScope,
  objectLimitTemplateWhereFromScope,
  operationWhereFromScope,
  projectWhereFromScope,
  stockWhereFromScope,
  toolWhereFromScope
} from "../lib/dataScope.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);
reportsRouter.use(requirePermission("dashboard.read"));

function num(x: unknown): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

function stockWhereForWarehouse(scope: DataScope, warehouseId: string): Prisma.StockWhereInput {
  const base: Prisma.StockWhereInput = { warehouseId };
  const scoped = stockWhereFromScope(scope);
  return Object.keys(scoped).length ? { AND: [scoped, base] } : base;
}

function issueWhereForWarehouse(scope: DataScope, warehouseId: string): Prisma.IssueRequestWhereInput {
  const base: Prisma.IssueRequestWhereInput = { warehouseId };
  const scoped = issueWhereFromScope(scope);
  return Object.keys(scoped).length ? { AND: [scoped, base] } : base;
}

function operationWhereForWarehouse(scope: DataScope, warehouseId: string): Prisma.OperationWhereInput {
  const base: Prisma.OperationWhereInput = { warehouseId };
  const scoped = operationWhereFromScope(scope);
  return Object.keys(scoped).length ? { AND: [scoped, base] } : base;
}

function toolWhereForWarehouse(scope: DataScope, warehouseId: string): Prisma.ToolWhereInput {
  const base: Prisma.ToolWhereInput = { warehouseId };
  const scoped = toolWhereFromScope(scope);
  return Object.keys(scoped).length ? { AND: [scoped, base] } : base;
}

function receiptWhereForWarehouse(scope: DataScope, warehouseId: string): Prisma.ReceiptRequestWhereInput {
  const base: Prisma.ReceiptRequestWhereInput = { warehouseId };
  if (scope.unrestricted || !scope.sectionScopes.length) return base;
  const sections = scope.sectionScopes.filter((s) => s.warehouseId === warehouseId).map((s) => s.section);
  if (!sections.length) return { AND: [base, { id: "___none___" }] };
  return {
    AND: [base, { OR: sections.map((section) => ({ section })) }]
  };
}

function campWhereForWarehouse(scope: DataScope, warehouseId: string): Prisma.CampItemWhereInput {
  const base: Prisma.CampItemWhereInput = { warehouseId };
  if (scope.unrestricted || !scope.sectionScopes.length) return base;
  const sections = scope.sectionScopes.filter((s) => s.warehouseId === warehouseId).map((s) => s.section);
  if (!sections.length) return { AND: [base, { id: "___none___" }] };
  return { AND: [base, { OR: sections.map((section) => ({ section })) }] };
}

export type WarehouseSnapshot = {
  generatedAt: string;
  warehouse: { id: string; name: string; address: string | null; isActive: boolean };
  counts: {
    stockLines: number;
    totalStockQty: number;
    issuesTotal: number;
    issuesByStatus: Record<string, number>;
    operationsLast30d: { income: number; expense: number };
    waybillsOpen: number;
    tools: number;
    campItems: number;
    receiptRequests: { total: number; byStatus: Record<string, number> };
    limitTemplates: number;
    linkedProjects: number;
  };
  stocksBySection: Array<{ section: string; lines: number; quantity: number }>;
  topMaterials: Array<{ materialId: string; name: string; unit: string; quantity: number; ss: number; eom: number }>;
  projectLimits: Array<{
    projectId: string;
    projectName: string;
    projectCode: string | null;
    limitId: string;
    limitName: string;
    version: number;
    items: Array<{
      materialId: string;
      materialName: string;
      unit: string;
      planned: number;
      issued: number;
      reserved: number;
      onStock: number;
      usagePercent: number;
      remainingPlan: number;
    }>;
  }>;
  limitUsageTop: Array<{ name: string; issued: number; planned: number; percent: number; projectName: string }>;
};

export async function buildWarehouseSnapshot(scope: DataScope, warehouseId: string): Promise<WarehouseSnapshot> {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: warehouseId },
    select: { id: true, name: true, address: true, isActive: true }
  });
  if (!warehouse) {
    const err = new Error("WAREHOUSE_NOT_FOUND");
    (err as Error & { status: number }).status = 404;
    throw err;
  }

  const sw = stockWhereForWarehouse(scope, warehouseId);
  const iw = issueWhereForWarehouse(scope, warehouseId);
  const ow = operationWhereForWarehouse(scope, warehouseId);
  const tw = toolWhereForWarehouse(scope, warehouseId);
  const rw = receiptWhereForWarehouse(scope, warehouseId);
  const cw = campWhereForWarehouse(scope, warehouseId);
  const tmplWhere: Prisma.ObjectLimitTemplateWhereInput = {
    AND: [objectLimitTemplateWhereFromScope(scope), { warehouseId }]
  };

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);

  const [
    stockGroupSection,
    stocksForTop,
    stockLinesCount,
    issuesTotal,
    issuesByStatus,
    income30,
    expense30,
    openWaybills,
    toolsCount,
    campCount,
    receiptByStatus,
    limitTemplatesCount,
    projectLinks
  ] = await Promise.all([
    prisma.stock.groupBy({
      by: ["section"],
      where: sw,
      _sum: { quantity: true },
      _count: { materialId: true }
    }),
    prisma.stock.findMany({
      where: sw,
      include: { material: true },
      take: 4000
    }),
    prisma.stock.count({ where: sw }),
    prisma.issueRequest.count({ where: iw }),
    prisma.issueRequest.groupBy({
      by: ["status"],
      where: iw,
      _count: { id: true }
    }),
    prisma.operation.count({
      where: {
        AND: [ow, { type: "INCOME" as const, operationDate: { gte: thirtyDaysAgo } }]
      }
    }),
    prisma.operation.count({
      where: {
        AND: [ow, { type: "EXPENSE" as const, operationDate: { gte: thirtyDaysAgo } }]
      }
    }),
    prisma.transportWaybill.count({
      where: {
        status: { not: "CLOSED" },
        OR: [{ issueRequest: iw }, { fromWarehouseId: warehouseId }, { operation: ow }]
      }
    }),
    prisma.tool.count({ where: tw }),
    prisma.campItem.count({ where: cw }),
    prisma.receiptRequest.groupBy({
      by: ["status"],
      where: rw,
      _count: { id: true }
    }),
    prisma.objectLimitTemplate.count({ where: tmplWhere }),
    prisma.projectWarehouse.findMany({
      where: { warehouseId },
      include: {
        project: {
          select: { id: true, name: true, code: true }
        }
      }
    })
  ]);

  const scopedProjectIds = scope.unrestricted ? null : scope.projectIds?.length ? scope.projectIds : null;
  const linksFiltered = scopedProjectIds
    ? projectLinks.filter((l) => scopedProjectIds.includes(l.projectId))
    : projectLinks;

  const stocksBySection = stockGroupSection.map((g) => ({
    section: g.section,
    lines: g._count.materialId,
    quantity: num(g._sum.quantity)
  }));

  const qtyByMaterial = new Map<string, { ss: number; eom: number; name: string; unit: string }>();
  for (const s of stocksForTop) {
    const id = s.materialId;
    const cur = qtyByMaterial.get(id) || { ss: 0, eom: 0, name: s.material.name, unit: s.material.unit };
    const q = num(s.quantity);
    if (s.section === "SS") cur.ss += q;
    else cur.eom += q;
    qtyByMaterial.set(id, cur);
  }

  const topMaterials = Array.from(qtyByMaterial.entries())
    .map(([materialId, v]) => ({
      materialId,
      name: v.name,
      unit: v.unit,
      quantity: v.ss + v.eom,
      ss: v.ss,
      eom: v.eom
    }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 20);

  const issuesMap: Record<string, number> = {};
  for (const row of issuesByStatus) {
    issuesMap[row.status] = row._count.id;
  }

  const receiptMap: Record<string, number> = {};
  let receiptTotal = 0;
  for (const row of receiptByStatus) {
    receiptMap[row.status] = row._count.id;
    receiptTotal += row._count.id;
  }

  const projectLimitsPayload: WarehouseSnapshot["projectLimits"] = [];

  for (const link of linksFiltered) {
    const projectScoped = await prisma.project.findFirst({
      where: { AND: [projectWhereFromScope(scope), { id: link.project.id }] },
      select: { id: true }
    });
    if (!projectScoped) continue;

    const limit = await prisma.projectLimit.findFirst({
      where: { projectId: link.project.id },
      orderBy: { version: "desc" },
      include: {
        items: { include: { material: true } }
      }
    });
    if (!limit) continue;

    const stockRowsScoped = await prisma.stock.findMany({
      where: {
        AND: [sw, { materialId: { in: limit.items.map((i) => i.materialId) } }]
      },
      select: { materialId: true, quantity: true }
    });
    const onStockScoped = new Map<string, number>();
    for (const st of stockRowsScoped) {
      onStockScoped.set(st.materialId, (onStockScoped.get(st.materialId) || 0) + num(st.quantity));
    }

    const items = limit.items.map((it) => {
      const planned = num(it.plannedQty);
      const issued = num(it.issuedQty);
      const reserved = num(it.reservedQty);
      const onStock = onStockScoped.get(it.materialId) || 0;
      const usagePercent = planned > 0 ? Math.min(100, Math.round((issued / planned) * 1000) / 10) : 0;
      const remainingPlan = Math.max(0, planned - issued - reserved);
      return {
        materialId: it.materialId,
        materialName: it.material.name,
        unit: it.material.unit,
        planned,
        issued,
        reserved,
        onStock,
        usagePercent,
        remainingPlan
      };
    });

    projectLimitsPayload.push({
      projectId: link.project.id,
      projectName: link.project.name,
      projectCode: link.project.code,
      limitId: limit.id,
      limitName: limit.name,
      version: limit.version,
      items
    });
  }

  const limitChartRows: WarehouseSnapshot["limitUsageTop"] = [];
  for (const pl of projectLimitsPayload) {
    for (const it of pl.items.slice(0, 50)) {
      if (num(it.planned) <= 0) continue;
      limitChartRows.push({
        name: it.materialName.length > 42 ? `${it.materialName.slice(0, 40)}…` : it.materialName,
        issued: it.issued,
        planned: it.planned,
        percent: it.usagePercent,
        projectName: pl.projectName
      });
    }
  }
  limitChartRows.sort((a, b) => b.percent - a.percent);

  const totalStockQty = Array.from(qtyByMaterial.values()).reduce((s, v) => s + v.ss + v.eom, 0);

  return {
    generatedAt: new Date().toISOString(),
    warehouse,
    counts: {
      stockLines: stockLinesCount,
      totalStockQty,
      issuesTotal,
      issuesByStatus: issuesMap,
      operationsLast30d: { income: income30, expense: expense30 },
      waybillsOpen: openWaybills,
      tools: toolsCount,
      campItems: campCount,
      receiptRequests: { total: receiptTotal, byStatus: receiptMap },
      limitTemplates: limitTemplatesCount,
      linkedProjects: linksFiltered.length
    },
    stocksBySection,
    topMaterials,
    projectLimits: projectLimitsPayload,
    limitUsageTop: limitChartRows.slice(0, 15)
  };
}

reportsRouter.get("/warehouse/:warehouseId/snapshot", async (req: AuthedRequest, res) => {
  const warehouseId = String(req.params.warehouseId);
  const scope = await getRequestDataScope(req);
  try {
    assertWarehouseInScope(scope, warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  try {
    const snap = await buildWarehouseSnapshot(scope, warehouseId);
    return res.json(snap);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 404) return res.status(404).json({ error: "Warehouse not found" });
    throw e;
  }
});

reportsRouter.get("/warehouse/:warehouseId/summary.pdf", async (req: AuthedRequest, res) => {
  const warehouseId = String(req.params.warehouseId);
  const scope = await getRequestDataScope(req);
  try {
    assertWarehouseInScope(scope, warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  let snap: WarehouseSnapshot;
  try {
    snap = await buildWarehouseSnapshot(scope, warehouseId);
  } catch {
    return res.status(404).json({ error: "Warehouse not found" });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=warehouse-summary-${warehouseId.slice(0, 8)}.pdf`);
  const fontPath = path.resolve(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
  const doc = new PDFDocument({ size: "A4", margin: 28 });
  doc.pipe(res);
  doc.font(fontPath);
  doc.fontSize(18).text(`Сводка: ${snap.warehouse.name}`, { align: "center" });
  doc.fontSize(10).text(snap.warehouse.address || "", { align: "center" });
  doc.moveDown(0.8);
  doc.fontSize(12).text("Ключевые показатели");
  doc.fontSize(10);
  doc.text(`Строк остатков: ${snap.counts.stockLines} · суммарно по количеству: ${snap.counts.totalStockQty.toFixed(2)}`);
  doc.text(`Заявки на выдачу: ${snap.counts.issuesTotal}`);
  doc.text(`Операции за 30 дней: приход ${snap.counts.operationsLast30d.income}, расход ${snap.counts.operationsLast30d.expense}`);
  doc.text(`Открытые ТН: ${snap.counts.waybillsOpen} · инструментов: ${snap.counts.tools} · городок: ${snap.counts.campItems}`);
  doc.text(
    `Заявки на приход: ${snap.counts.receiptRequests.total} · шаблонов лимитов: ${snap.counts.limitTemplates} · проектов: ${snap.counts.linkedProjects}`
  );
  doc.moveDown(0.6);
  doc.fontSize(12).text("Остатки по разделам");
  doc.fontSize(10);
  for (const s of snap.stocksBySection) {
    doc.text(`- ${s.section}: строк ${s.lines}, количество ${s.quantity.toFixed(2)}`);
  }
  doc.moveDown(0.6);
  doc.fontSize(12).text("ТОП позиций на складе");
  doc.fontSize(9);
  snap.topMaterials.slice(0, 25).forEach((r, idx) => {
    doc.text(`${idx + 1}. ${r.name} (${r.unit}) — ${r.quantity.toFixed(2)}`);
  });
  doc.moveDown(0.6);
  doc.fontSize(12).text("Лимиты проектов (фрагмент)");
  doc.fontSize(9);
  for (const pl of snap.projectLimits) {
    doc.moveDown(0.2);
    doc.fontSize(10).text(`${pl.projectName} — ${pl.limitName} v${pl.version}`, { underline: true });
    doc.fontSize(9);
    pl.items.slice(0, 35).forEach((it, i) => {
      doc.text(
        `${i + 1}. ${it.materialName}: план ${it.planned} · выдано ${it.issued} · загрузка ${it.usagePercent}%`
      );
    });
  }
  doc.end();
});

reportsRouter.get("/object/:projectId/summary.pdf", async (req: AuthedRequest, res) => {
  const projectId = String(req.params.projectId);
  const scope = await getRequestDataScope(req);
  const project = await prisma.project.findFirst({
    where: {
      AND: [projectWhereFromScope(scope), { id: projectId }]
    },
    include: {
      warehouseLinks: { include: { warehouse: true } }
    }
  });
  if (!project) return res.status(404).json({ error: "Project not found" });

  const warehouseIds = project.warehouseLinks.map((x) => x.warehouseId);
  const [issuesCount, openWaybillsCount, toolsCount, stockRows] = await Promise.all([
    prisma.issueRequest.count({ where: { projectId } }),
    prisma.transportWaybill.count({
      where: { issueRequest: { projectId }, status: { in: ["DRAFT", "FORMED", "SHIPPED", "RECEIVED"] } }
    }),
    prisma.tool.count({ where: { projectId } }),
    warehouseIds.length
      ? prisma.stock.findMany({
          where: { warehouseId: { in: warehouseIds } },
          include: { material: true, warehouse: true },
          orderBy: [{ warehouseId: "asc" }],
          take: 300
        })
      : Promise.resolve([])
  ]);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=object-summary-${project.code || project.id}.pdf`
  );
  const fontPath = path.resolve(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
  const doc = new PDFDocument({ size: "A4", margin: 28 });
  doc.pipe(res);
  doc.font(fontPath);
  doc.fontSize(18).text(`Сводка по объекту: ${project.name}`, { align: "center" });
  doc.moveDown(0.4);
  doc.fontSize(10).text(`Код: ${project.code || "-"}`, { align: "center" });
  doc.moveDown(0.8);
  doc.fontSize(12).text("Ключевые показатели");
  doc.fontSize(10).text(`Заявок: ${issuesCount}`);
  doc.fontSize(10).text(`Открытых ТН: ${openWaybillsCount}`);
  doc.fontSize(10).text(`Инструментов на объекте: ${toolsCount}`);
  doc.moveDown(0.7);
  doc.fontSize(12).text("Привязанные склады");
  if (!project.warehouseLinks.length) {
    doc.fontSize(10).text("Склады к объекту не привязаны.");
  } else {
    for (const w of project.warehouseLinks) {
      doc.fontSize(10).text(`- ${w.warehouse.name}`);
    }
  }
  doc.moveDown(0.7);
  doc.fontSize(12).text("Остатки по складам объекта (первые 300 строк)");
  if (!stockRows.length) {
    doc.fontSize(10).text("Нет данных по остаткам.");
  } else {
    stockRows.forEach((s, idx) => {
      doc
        .fontSize(9)
        .text(
          `${idx + 1}. ${s.warehouse.name} | ${s.material.name} (${s.material.unit}) | Кол-во: ${s.quantity} | Резерв: ${s.reserved}`
        );
    });
  }
  doc.end();
});
