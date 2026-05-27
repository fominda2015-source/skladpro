import type { Prisma } from "@prisma/client";
import { Router } from "express";
import xlsx from "xlsx";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import {
  getRequestDataScope,
  mergeIssueWhere,
  operationWhereFromScope,
  stockWhereFromScope,
  stockMovementWhereFromScope,
  toolWhereFromScope,
  projectWhereFromScope,
  type DataScope
} from "../lib/dataScope.js";

// Локальный helper: фильтр для ReceiptRequest по scope (по аналогии с reports.ts).
function receiptRequestWhereFromScope(scope: DataScope): Prisma.ReceiptRequestWhereInput {
  if (scope.unrestricted) return {};
  if (scope.sectionScopes.length) {
    return {
      OR: scope.sectionScopes.map((s) => ({ warehouseId: s.warehouseId, section: s.section }))
    };
  }
  if (scope.warehouseIds?.length) {
    return { warehouseId: { in: scope.warehouseIds } };
  }
  return {};
}

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

const EXPORT_ROW_LIMIT = 15_000;
const EXPORT_ISSUE_LIMIT = 8_000;

exportsRouter.get("/ping", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ----- helpers -----

function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return "";
  return `${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

type Range = { from: Date; to: Date; label: string };

// Разбор query: ?period=day|week|month|year | ?from=YYYY-MM-DD&to=YYYY-MM-DD
// Ограничение: диапазон не более 366 дней. По умолчанию — последние 30 дней.
function parseRange(query: Record<string, unknown>): Range | { error: string } {
  const period = String(query.period || "").toLowerCase();
  const fromRaw = typeof query.from === "string" ? query.from : "";
  const toRaw = typeof query.to === "string" ? query.to : "";
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  let from: Date;
  let to: Date = endOfToday;
  let label = "";

  if (period === "day") {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    label = "1 день";
  } else if (period === "week") {
    from = new Date(now.getTime() - 7 * 86400000);
    label = "Неделя";
  } else if (period === "month") {
    from = new Date(now.getTime() - 30 * 86400000);
    label = "Месяц";
  } else if (period === "year") {
    from = new Date(now.getTime() - 365 * 86400000);
    label = "Год";
  } else if (fromRaw || toRaw) {
    const f = fromRaw ? new Date(fromRaw) : new Date(now.getTime() - 30 * 86400000);
    const t = toRaw ? new Date(toRaw) : endOfToday;
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) {
      return { error: "Invalid from/to" };
    }
    if (t < f) return { error: "to < from" };
    from = f;
    to = t;
    label = `${fmtDate(from)} … ${fmtDate(to)}`;
  } else {
    from = new Date(now.getTime() - 30 * 86400000);
    label = "Последние 30 дней";
  }

  const span = to.getTime() - from.getTime();
  if (span > 366 * 86400000) {
    return { error: "Период не может превышать 366 дней" };
  }
  return { from, to, label };
}

// Утилита: построить workbook из плоского массива объектов на лист.
function appendSheet(wb: xlsx.WorkBook, name: string, rows: Array<Record<string, unknown>>, columns?: string[]) {
  const ws = rows.length
    ? xlsx.utils.json_to_sheet(rows, columns ? { header: columns } : undefined)
    : xlsx.utils.aoa_to_sheet([["нет данных"]]);
  // Имя листа в Excel — макс. 31 символ, нельзя : \ / ? * [ ]
  const safe = String(name).replace(/[\\/:?*\[\]]/g, " ").slice(0, 31) || "Sheet";
  xlsx.utils.book_append_sheet(wb, ws, safe);
}

function sendXlsx(res: import("express").Response, wb: xlsx.WorkBook, fileName: string) {
  const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const safe =
    fileName.replace(/[^\w\u0400-\u04FF.\-]+/gi, "_").slice(0, 120) || "export.xlsx";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}"`);
  res.setHeader("Content-Length", String(buf.length));
  res.send(buf);
}

function parseExportWarehouseQuery(
  query: Record<string, unknown>,
  scope: DataScope
): { warehouseId?: string; section?: "SS" | "EOM"; error?: string } {
  const wh = typeof query.warehouseId === "string" ? query.warehouseId.trim() : "";
  const secRaw = typeof query.section === "string" ? query.section.toUpperCase() : "";
  const section = secRaw === "EOM" ? "EOM" : secRaw === "SS" ? "SS" : undefined;
  if (!wh) return {};
  if (scope.unrestricted || !scope.warehouseIds?.length) {
    return { warehouseId: wh, section };
  }
  if (!scope.warehouseIds.includes(wh)) {
    return { error: "FORBIDDEN_WAREHOUSE" };
  }
  return { warehouseId: wh, section };
}

function mergeStockWhere(
  scope: DataScope,
  exportWh: { warehouseId?: string; section?: "SS" | "EOM" }
): Prisma.StockWhereInput {
  const base = stockWhereFromScope(scope);
  if (!exportWh.warehouseId) return base;
  const extra: Prisma.StockWhereInput = {
    warehouseId: exportWh.warehouseId,
    ...(exportWh.section ? { section: exportWh.section } : {})
  };
  if (!Object.keys(base).length) return extra;
  return { AND: [base, extra] };
}

function mergeMovementWhere(
  scope: DataScope,
  range: Range,
  exportWh: { warehouseId?: string; section?: "SS" | "EOM" }
): Prisma.StockMovementWhereInput {
  const base = stockMovementWhereFromScope(scope);
  const time = { createdAt: { gte: range.from, lte: range.to } };
  const wh = exportWh.warehouseId
    ? {
        warehouseId: exportWh.warehouseId,
        ...(exportWh.section ? { section: exportWh.section } : {})
      }
    : {};
  const parts: Prisma.StockMovementWhereInput[] = [time, base, wh].filter(
    (p) => Object.keys(p).length
  );
  if (parts.length === 1) return parts[0] as Prisma.StockMovementWhereInput;
  return { AND: parts };
}

function metaSheet(wb: xlsx.WorkBook, title: string, range: Range, userEmail?: string) {
  appendSheet(wb, "Параметры", [
    { Параметр: "Раздел", Значение: title },
    { Параметр: "Период", Значение: range.label },
    { Параметр: "С", Значение: fmtDateTime(range.from) },
    { Параметр: "По", Значение: fmtDateTime(range.to) },
    { Параметр: "Сформировано", Значение: fmtDateTime(new Date()) },
    { Параметр: "Пользователь", Значение: userEmail || "" }
  ]);
}

// ----- middleware: проверка прав на конкретный раздел -----

const sectionPermissions: Record<string, string[]> = {
  stocks: ["stocks.read"],
  warehouse: ["stocks.read"],
  limits: ["limits.read"],
  materialReport: ["materialReport.read"],
  tools: ["tools.read"],
  issues: ["issues.read"],
  receipts: ["operations.read"],
  operations: ["operations.read"]
};

function requireSectionPerm(section: string) {
  const perms = sectionPermissions[section] || [];
  return (req: AuthedRequest, res: import("express").Response, next: import("express").NextFunction) => {
    if (req.user?.role === "ADMIN") return next();
    const owned = Array.isArray(req.user?.permissions) ? req.user!.permissions : [];
    if (perms.some((p) => owned.includes(p))) return next();
    return res.status(403).json({ error: "Недостаточно прав на экспорт раздела" });
  };
}

// ----- эндпойнты -----

// Склад: текущий снимок + движения (StockMovement) за период.
exportsRouter.get("/stocks.xlsx", requireSectionPerm("stocks"), async (req: AuthedRequest, res) => {
  const range = parseRange(req.query as Record<string, unknown>);
  if ("error" in range) return res.status(400).json({ error: range.error });
  const scope = await getRequestDataScope(req);
  const exportWh = parseExportWarehouseQuery(req.query as Record<string, unknown>, scope);
  if (exportWh.error) return res.status(403).json({ error: exportWh.error });

  const stocks = await prisma.stock.findMany({
    where: mergeStockWhere(scope, exportWh),
    include: { material: true, warehouse: true },
    take: EXPORT_ROW_LIMIT,
    orderBy: [{ warehouseId: "asc" }, { section: "asc" }]
  });
  const movements = await prisma.stockMovement.findMany({
    where: mergeMovementWhere(scope, range, exportWh),
    include: { material: true, warehouse: true },
    orderBy: { createdAt: "desc" },
    take: EXPORT_ROW_LIMIT
  });

  const wb = xlsx.utils.book_new();
  metaSheet(wb, "Склад", range, req.user?.email);
  appendSheet(
    wb,
    "Остатки",
    stocks.map((s) => ({
      Склад: s.warehouse.name,
      Раздел: s.section,
      Материал: s.material.name,
      Ед: s.material.unit,
      Количество: num(s.quantity),
      Резерв: num(s.reserved),
      Доступно: num(s.quantity) - num(s.reserved),
      "Цена за ед": s.material.unitPrice != null ? num(s.material.unitPrice) : "",
      Артикул: s.material.sku || ""
    }))
  );
  appendSheet(
    wb,
    "Движения",
    movements.map((m) => ({
      Дата: fmtDateTime(m.createdAt),
      Склад: m.warehouse?.name || "",
      Материал: m.material?.name || "",
      Ед: m.material?.unit || "",
      Направление: m.direction,
      Количество: num(m.quantity),
      Документ: m.sourceDocumentType,
      "ID документа": m.sourceDocumentId || "",
      "ID операции": m.operationId || "",
      "ID заявки на выдачу": m.issueRequestId || "",
      Комментарий: m.note || ""
    }))
  );

  sendXlsx(res, wb, `stocks_${fmtDate(range.from)}_${fmtDate(range.to)}.xlsx`);
});

// Лимиты: лимиты проектов и фактическая выдача (issued) на период.
exportsRouter.get("/limits.xlsx", requireSectionPerm("limits"), async (req: AuthedRequest, res) => {
  const range = parseRange(req.query as Record<string, unknown>);
  if ("error" in range) return res.status(400).json({ error: range.error });
  const scope = await getRequestDataScope(req);
  const exportWh = parseExportWarehouseQuery(req.query as Record<string, unknown>, scope);
  if (exportWh.error) return res.status(403).json({ error: exportWh.error });

  const projectWhere: Prisma.ProjectWhereInput = {
    ...projectWhereFromScope(scope),
    ...(exportWh.warehouseId
      ? {
          warehouseId: exportWh.warehouseId,
          ...(exportWh.section ? { section: exportWh.section } : {})
        }
      : {})
  };

  const projects = await prisma.project.findMany({
    where: projectWhere,
    select: { id: true, name: true, code: true },
    take: 5000
  });
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const projectIds = projects.map((p) => p.id);

  const limitsRaw = projectIds.length
    ? await prisma.projectLimit.findMany({
        where: { projectId: { in: projectIds } },
        include: { items: { include: { material: true } } },
        orderBy: [{ projectId: "asc" }, { version: "desc" }]
      })
    : [];

  const latestLimitByProject = new Map<string, (typeof limitsRaw)[number]>();
  for (const lim of limitsRaw) {
    if (!latestLimitByProject.has(lim.projectId)) {
      latestLimitByProject.set(lim.projectId, lim);
    }
  }

  const allRows: Array<Record<string, unknown>> = [];
  for (const limit of latestLimitByProject.values()) {
    const p = projectById.get(limit.projectId);
    if (!p) continue;
    for (const it of limit.items) {
      const planned = num(it.plannedQty);
      const issued = num(it.issuedQty);
      const reserved = num(it.reservedQty);
      allRows.push({
        Проект: p.name,
        "Код проекта": p.code || "",
        Лимит: limit.name,
        Версия: limit.version,
        Материал: it.material.name,
        Ед: it.material.unit,
        План: planned,
        Выдано: issued,
        Резерв: reserved,
        "Остаток плана": Math.max(0, planned - issued - reserved),
        "Использовано, %": planned > 0 ? Math.round((issued / planned) * 1000) / 10 : 0
      });
    }
  }

  // Выдача за период по StockMovement OUT, в разрезе материала/склада/проекта (через IssueRequest).
  const issuedRows = await prisma.stockMovement.findMany({
    where: {
      AND: [{ direction: "OUT" }, mergeMovementWhere(scope, range, exportWh)]
    },
    include: { material: true, warehouse: true, issueRequest: { include: { project: true } } },
    take: EXPORT_ROW_LIMIT
  });
  const issuedAgg = new Map<string, { warehouse: string; project: string; material: string; unit: string; qty: number }>();
  for (const m of issuedRows) {
    const project = m.issueRequest?.project?.name || "(без проекта)";
    const key = `${m.warehouseId}::${project}::${m.materialId}`;
    const cur = issuedAgg.get(key) || {
      warehouse: m.warehouse?.name || "",
      project,
      material: m.material?.name || "",
      unit: m.material?.unit || "",
      qty: 0
    };
    cur.qty += num(m.quantity);
    issuedAgg.set(key, cur);
  }

  const wb = xlsx.utils.book_new();
  metaSheet(wb, "Лимиты проектов", range, req.user?.email);
  appendSheet(wb, "План vs Факт", allRows);
  appendSheet(
    wb,
    "Выдача за период",
    Array.from(issuedAgg.values()).map((v) => ({
      Склад: v.warehouse,
      Проект: v.project,
      Материал: v.material,
      Ед: v.unit,
      "Выдано за период": v.qty
    }))
  );

  sendXlsx(res, wb, `limits_${fmtDate(range.from)}_${fmtDate(range.to)}.xlsx`);
});

// Материальный отчёт: списания с подотчёта (MaterialHolderWriteoff) за период.
exportsRouter.get("/materialReport.xlsx", requireSectionPerm("materialReport"), async (req: AuthedRequest, res) => {
  const range = parseRange(req.query as Record<string, unknown>);
  if ("error" in range) return res.status(400).json({ error: range.error });
  const scope = await getRequestDataScope(req);
  const exportWh = parseExportWarehouseQuery(req.query as Record<string, unknown>, scope);
  if (exportWh.error) return res.status(403).json({ error: exportWh.error });

  const scopeWh =
    scope.unrestricted || !scope.warehouseIds?.length
      ? {}
      : { warehouseId: { in: scope.warehouseIds } };
  const where: Prisma.MaterialHolderWriteoffWhereInput = {
    AND: [
      { createdAt: { gte: range.from, lte: range.to } },
      scopeWh,
      exportWh.warehouseId
        ? {
            warehouseId: exportWh.warehouseId,
            ...(exportWh.section ? { section: exportWh.section } : {})
          }
        : {}
    ].filter((p) => Object.keys(p).length)
  };
  const rows = await prisma.materialHolderWriteoff.findMany({
    where,
    include: { material: true, warehouse: true, holderUser: true, actorUser: true },
    orderBy: { createdAt: "desc" },
    take: EXPORT_ROW_LIMIT
  });

  const wb = xlsx.utils.book_new();
  metaSheet(wb, "Материальный отчёт", range, req.user?.email);
  appendSheet(
    wb,
    "Списания",
    rows.map((r) => ({
      Дата: fmtDateTime(r.createdAt),
      Склад: r.warehouse?.name || "",
      Раздел: r.section,
      "Ответственный (с кого списано)": r.holderName || r.holderUser?.fullName || "",
      "Кто провёл списание": r.actorUser?.fullName || "",
      Материал: r.material?.name || "",
      Ед: r.material?.unit || "",
      Количество: num(r.quantity),
      Комментарий: r.comment || ""
    }))
  );

  sendXlsx(res, wb, `material-report_${fmtDate(range.from)}_${fmtDate(range.to)}.xlsx`);
});

// Инструменты: текущий парк + события (ToolEvent) за период.
exportsRouter.get("/tools.xlsx", requireSectionPerm("tools"), async (req: AuthedRequest, res) => {
  const range = parseRange(req.query as Record<string, unknown>);
  if ("error" in range) return res.status(400).json({ error: range.error });
  const scope = await getRequestDataScope(req);
  const exportWh = parseExportWarehouseQuery(req.query as Record<string, unknown>, scope);
  if (exportWh.error) return res.status(403).json({ error: exportWh.error });

  const toolBase = toolWhereFromScope(scope);
  const toolWhere: Prisma.ToolWhereInput = exportWh.warehouseId
    ? {
        AND: [
          toolBase,
          {
            warehouseId: exportWh.warehouseId,
            ...(exportWh.section ? { section: exportWh.section } : {})
          }
        ]
      }
    : toolBase;

  const tools = await prisma.tool.findMany({
    where: toolWhere,
    include: { warehouse: true, project: true, category: true },
    orderBy: [{ name: "asc" }, { inventoryNumber: "asc" }],
    take: EXPORT_ROW_LIMIT
  });
  const events = await prisma.toolEvent.findMany({
    where: {
      AND: [
        { createdAt: { gte: range.from, lte: range.to } },
        { tool: { is: toolWhere } }
      ]
    },
    include: { tool: { include: { warehouse: true } } },
    orderBy: { createdAt: "desc" },
    take: EXPORT_ROW_LIMIT
  });

  const wb = xlsx.utils.book_new();
  metaSheet(wb, "Инструменты", range, req.user?.email);
  appendSheet(
    wb,
    "Парк",
    tools.map((t) => ({
      Категория: t.category?.name || "",
      Название: t.name,
      "Инв. №": t.inventoryNumber,
      "Сер. №": t.serialNumber || "",
      Статус: t.status,
      Склад: t.warehouse?.name || "",
      Раздел: t.section,
      Проект: t.project?.name || "",
      Ответственный: t.responsible || "",
      Примечание: t.note || ""
    }))
  );
  appendSheet(
    wb,
    "События",
    events.map((e) => ({
      Дата: fmtDateTime(e.createdAt),
      Инструмент: e.tool?.name || "",
      "Инв. №": e.tool?.inventoryNumber || "",
      Склад: e.tool?.warehouse?.name || "",
      Действие: e.action,
      Статус: e.status,
      Комментарий: e.comment || ""
    }))
  );

  sendXlsx(res, wb, `tools_${fmtDate(range.from)}_${fmtDate(range.to)}.xlsx`);
});

// Выдачи: заявки на выдачу за период (по createdAt) + позиции.
exportsRouter.get("/issues.xlsx", requireSectionPerm("issues"), async (req: AuthedRequest, res) => {
  const range = parseRange(req.query as Record<string, unknown>);
  if ("error" in range) return res.status(400).json({ error: range.error });
  const scope = await getRequestDataScope(req);
  const exportWh = parseExportWarehouseQuery(req.query as Record<string, unknown>, scope);
  if (exportWh.error) return res.status(403).json({ error: exportWh.error });

  const where: Prisma.IssueRequestWhereInput = mergeIssueWhere(scope, {
    createdAt: { gte: range.from, lte: range.to },
    ...(exportWh.warehouseId
      ? {
          warehouseId: exportWh.warehouseId,
          ...(exportWh.section ? { section: exportWh.section } : {})
        }
      : {})
  });
  const issues = await prisma.issueRequest.findMany({
    where,
    include: {
      warehouse: true,
      project: true,
      requestedBy: true,
      approvedBy: true,
      items: { include: { material: true } }
    },
    orderBy: { createdAt: "desc" },
    take: EXPORT_ISSUE_LIMIT
  });

  const header = issues.map((r) => ({
    Дата: fmtDateTime(r.createdAt),
    Номер: r.number,
    Статус: r.status,
    Поток: r.flowType,
    Раздел: r.section,
    Склад: r.warehouse?.name || "",
    Проект: r.project?.name || "",
    "Кто запросил": r.requestedBy?.fullName || "",
    "Кто согласовал": r.approvedBy?.fullName || "",
    Ответственный: r.responsibleName || "",
    "Фактический получатель": r.actualRecipientName || "",
    Примечание: r.note || "",
    Позиций: r.items.length,
    "Всего количество": r.items.reduce((s, it) => s + num(it.quantity), 0)
  }));

  const lines: Array<Record<string, unknown>> = [];
  for (const r of issues) {
    for (const it of r.items) {
      lines.push({
        Дата: fmtDateTime(r.createdAt),
        "Номер заявки": r.number,
        Статус: r.status,
        Склад: r.warehouse?.name || "",
        Проект: r.project?.name || "",
        Материал: it.material?.name || "",
        Ед: it.material?.unit || "",
        Количество: num(it.quantity)
      });
    }
  }

  const wb = xlsx.utils.book_new();
  metaSheet(wb, "Заявки на выдачу", range, req.user?.email);
  appendSheet(wb, "Заявки", header);
  appendSheet(wb, "Позиции", lines);
  sendXlsx(res, wb, `issues_${fmtDate(range.from)}_${fmtDate(range.to)}.xlsx`);
});

// Поступления: заявки на приход (ReceiptRequest) + операции типа INCOME за период.
exportsRouter.get("/receipts.xlsx", requireSectionPerm("receipts"), async (req: AuthedRequest, res) => {
  const range = parseRange(req.query as Record<string, unknown>);
  if ("error" in range) return res.status(400).json({ error: range.error });
  const scope = await getRequestDataScope(req);
  const exportWh = parseExportWarehouseQuery(req.query as Record<string, unknown>, scope);
  if (exportWh.error) return res.status(403).json({ error: exportWh.error });

  const receiptExtra = exportWh.warehouseId
    ? {
        warehouseId: exportWh.warehouseId,
        ...(exportWh.section ? { section: exportWh.section } : {})
      }
    : {};

  const receipts = await prisma.receiptRequest.findMany({
    where: {
      AND: [
        { createdAt: { gte: range.from, lte: range.to } },
        receiptRequestWhereFromScope(scope),
        receiptExtra
      ].filter((p) => Object.keys(p).length)
    },
    include: {
      warehouse: true,
      createdBy: true,
      items: { include: { mappedMaterial: true } }
    },
    orderBy: { createdAt: "desc" },
    take: EXPORT_ISSUE_LIMIT
  });

  const operations = await prisma.operation.findMany({
    where: {
      AND: [
        { type: "INCOME" as const, operationDate: { gte: range.from, lte: range.to } },
        operationWhereFromScope(scope),
        receiptExtra
      ].filter((p) => Object.keys(p).length)
    },
    include: {
      warehouse: true,
      project: true,
      items: { include: { material: true } }
    },
    orderBy: { operationDate: "desc" },
    take: EXPORT_ISSUE_LIMIT
  });

  const wb = xlsx.utils.book_new();
  metaSheet(wb, "Поступления", range, req.user?.email);

  appendSheet(
    wb,
    "Заявки на приход",
    receipts.map((r) => ({
      Дата: fmtDateTime(r.createdAt),
      Номер: r.number,
      Статус: r.status,
      Склад: r.warehouse?.name || "",
      Раздел: r.section,
      "Источник (файл)": r.sourceFileName || "",
      Автор: r.createdBy?.fullName || "",
      Позиций: r.items.length,
      "Сумма количеств": r.items.reduce((s, it) => s + num(it.quantity), 0)
    }))
  );

  const receiptLines: Array<Record<string, unknown>> = [];
  for (const r of receipts) {
    for (const it of r.items) {
      receiptLines.push({
        Дата: fmtDateTime(r.createdAt),
        "Номер заявки": r.number,
        Склад: r.warehouse?.name || "",
        "Исходное название": it.sourceName,
        "Исходная ед.": it.sourceUnit,
        "Сопоставлено": it.mappedMaterial?.name || "",
        Количество: num(it.quantity),
        "Принято": num(it.acceptedQty || 0)
      });
    }
  }
  appendSheet(wb, "Позиции заявок", receiptLines);

  appendSheet(
    wb,
    "Операции (приход)",
    operations.map((o) => ({
      Дата: fmtDateTime(o.operationDate),
      Документ: o.documentNumber || "",
      Склад: o.warehouse?.name || "",
      Раздел: o.section,
      Проект: o.project?.name || "",
      Позиций: o.items.length,
      "Сумма количеств": o.items.reduce((s, it) => s + num(it.quantity), 0),
      "Сумма стоимости": o.items.reduce((s, it) => s + num(it.quantity) * num(it.price), 0)
    }))
  );

  const opLines: Array<Record<string, unknown>> = [];
  for (const o of operations) {
    for (const it of o.items) {
      opLines.push({
        Дата: fmtDateTime(o.operationDate),
        "Документ": o.documentNumber || "",
        Склад: o.warehouse?.name || "",
        Раздел: o.section,
        Материал: it.material?.name || "",
        Ед: it.material?.unit || "",
        Количество: num(it.quantity),
        "Цена за ед": it.price != null ? num(it.price) : "",
        Сумма: num(it.quantity) * num(it.price)
      });
    }
  }
  appendSheet(wb, "Позиции приходов", opLines);

  sendXlsx(res, wb, `receipts_${fmtDate(range.from)}_${fmtDate(range.to)}.xlsx`);
});
