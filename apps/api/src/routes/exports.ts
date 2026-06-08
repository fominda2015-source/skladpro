import type { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { hasPermission } from "../lib/permissions.js";
import { loadUserPermissions, requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import {
  getRequestDataScope,
  mergeIssueWhere,
  objectLimitTemplateWhereFromScope,
  operationWhereFromScope,
  resolveReadScope,
  stockWhereFromScope,
  stockMovementWhereFromScope,
  toolWhereFromScope,
  type DataScope
} from "../lib/dataScope.js";
import {
  buildStyledWorkbook,
  sendStyledXlsx,
  type ReportColumn,
  type ReportMetaRow,
  type ReportSheetDef
} from "../lib/xlsxReport.js";

export const exportsRouter = Router();
exportsRouter.use(requireAuth);

const EXPORT_ROW_LIMIT = 15_000;
const EXPORT_ISSUE_LIMIT = 8_000;

exportsRouter.get("/ping", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

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
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return { error: "Invalid from/to" };
    if (t < f) return { error: "to < from" };
    from = f;
    to = t;
    label = `${fmtDate(from)} … ${fmtDate(to)}`;
  } else {
    from = new Date(now.getTime() - 30 * 86400000);
    label = "Последние 30 дней";
  }

  if (to.getTime() - from.getTime() > 366 * 86400000) {
    return { error: "Период не может превышать 366 дней" };
  }
  return { from, to, label };
}

function receiptRequestWhereFromScope(scope: DataScope): Prisma.ReceiptRequestWhereInput {
  if (scope.unrestricted) return {};
  if (scope.sectionScopes.length) {
    return {
      OR: scope.sectionScopes.map((s) => ({ warehouseId: s.warehouseId, section: s.section }))
    };
  }
  if (scope.warehouseIds?.length) return { warehouseId: { in: scope.warehouseIds } };
  return { warehouseId: { in: [] } };
}

function parseExportWarehouseQuery(
  query: Record<string, unknown>,
  scope: DataScope
): { warehouseId?: string; section?: "SS" | "EOM"; error?: string } {
  const wh = typeof query.warehouseId === "string" ? query.warehouseId.trim() : "";
  const secRaw = typeof query.section === "string" ? query.section.toUpperCase() : "";
  const section = secRaw === "EOM" ? "EOM" : secRaw === "SS" ? "SS" : undefined;
  if (!wh) return {};
  if (scope.unrestricted || !scope.warehouseIds?.length) return { warehouseId: wh, section };
  if (!scope.warehouseIds.includes(wh)) return { error: "FORBIDDEN_WAREHOUSE" };
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
  const whParts: Prisma.StockMovementWhereInput[] = [];
  if (exportWh.warehouseId) whParts.push({ warehouseId: exportWh.warehouseId });
  if (exportWh.section) {
    whParts.push({
      OR: [
        { operation: { is: { section: exportWh.section } } },
        { issueRequest: { is: { section: exportWh.section } } }
      ]
    });
  }
  const parts: Prisma.StockMovementWhereInput[] = [time, base, ...whParts].filter(
    (p) => Object.keys(p).length
  );
  if (parts.length === 1) return parts[0] as Prisma.StockMovementWhereInput;
  return { AND: parts };
}

function labelMaterialKind(k: string | null | undefined): string {
  if (k === "CONSUMABLE") return "Расходник";
  if (k === "WORKWEAR") return "СИЗ / спецодежда";
  return "Основной";
}

function labelDirection(d: string): string {
  if (d === "IN") return "Приход";
  if (d === "OUT") return "Расход";
  return d;
}

function labelToolStatus(s: string): string {
  const map: Record<string, string> = {
    IN_STOCK: "На складе",
    ISSUED: "Выдан",
    IN_REPAIR: "В ремонте",
    DAMAGED: "Повреждён",
    LOST: "Утерян",
    WRITTEN_OFF: "Списан",
    DISPUTED: "Спорный"
  };
  return map[s] || s;
}

function labelIssueStatus(s: string): string {
  const map: Record<string, string> = {
    DRAFT: "Черновик",
    ON_APPROVAL: "На согласовании",
    APPROVED: "Согласована",
    REJECTED: "Отклонена",
    ISSUED: "Выдана",
    CANCELLED: "Отменена"
  };
  return map[s] || s;
}

function labelReceiptStatus(s: string): string {
  const map: Record<string, string> = {
    NEW: "Новая",
    IN_PROGRESS: "В работе",
    RECEIVED: "Принята",
    CANCELLED: "Отменена"
  };
  return map[s] || s;
}

function pctFillColor(pct: unknown): string | undefined {
  const n = Number(pct);
  if (!Number.isFinite(n)) return undefined;
  if (n >= 100) return "FFFEE2E2";
  if (n >= 80) return "FFFEF3C7";
  if (n >= 50) return "FFECFDF5";
  return undefined;
}

function labelSection(s: string): string {
  return s === "EOM" ? "ЭОМ" : s === "SS" ? "СС" : s;
}

type LimitNodeRef = {
  id: string;
  parentId: string | null;
  nodeType: string;
  title: string;
  indexLabel: string | null;
};

function limitNodePath(nodeId: string, byId: Map<string, LimitNodeRef>): string {
  const parts: string[] = [];
  let cur: string | null | undefined = nodeId;
  while (cur && byId.has(cur)) {
    const node: LimitNodeRef = byId.get(cur)!;
    if (node.nodeType === "GROUP") {
      const label = [node.indexLabel, node.title].filter(Boolean).join(" ").trim();
      if (label) parts.unshift(label);
    }
    cur = node.parentId;
  }
  return parts.join(" / ");
}

async function sendReport(
  res: import("express").Response,
  metaTitle: string,
  range: Range,
  userEmail: string | undefined,
  warehouseLabel: string,
  sectionLabel: string,
  sheets: ReportSheetDef[]
) {
  const metaRows: ReportMetaRow[] = [
    { label: "Период", value: range.label },
    { label: "С", value: fmtDateTime(range.from) },
    { label: "По", value: fmtDateTime(range.to) },
    { label: "Объект", value: warehouseLabel || "Все доступные" },
    { label: "Раздел", value: sectionLabel || "СС и ЭОМ" },
    { label: "Сформировано", value: fmtDateTime(new Date()) },
    { label: "Пользователь", value: userEmail || "" }
  ];
  const fileName = buildExportFileName(metaTitle, range, warehouseLabel);
  const buffer = await buildStyledWorkbook({ title: metaTitle, rows: metaRows }, sheets);
  sendStyledXlsx(res, buffer, fileName);
}

function buildExportFileName(metaTitle: string, range: Range, warehouseLabel: string): string {
  const titlePart = metaTitle
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^\w\u0400-\u04FF.\- ]+/g, "")
    .replace(/\s+/g, "_");
  const whPart =
    warehouseLabel && warehouseLabel !== "Все доступные"
      ? warehouseLabel.replace(/\s+/g, "_").replace(/[^\w\u0400-\u04FF.\-_]+/g, "")
      : "";
  const parts = [titlePart, whPart, fmtDate(range.from), fmtDate(range.to)].filter(Boolean);
  return `${parts.join("_")}.xlsx`;
}

const sectionPermissions: Record<string, string[]> = {
  stocks: ["stocks.read"],
  limits: ["limits.read"],
  materialReport: ["materialReport.read"],
  tools: ["tools.read"],
  issues: ["issues.read"],
  receipts: ["operations.read"]
};

function requireSectionPerm(section: string) {
  const perms = sectionPermissions[section] || [];
  return async (req: AuthedRequest, res: import("express").Response, next: import("express").NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (req.user.role === "ADMIN") return next();
    try {
      const owned = await loadUserPermissions(req.user.userId);
      req.user.permissions = owned;
      if (perms.some((p) => hasPermission(owned, p))) return next();
      return res.status(403).json({ error: "Недостаточно прав на экспорт раздела" });
    } catch (e) {
      console.error("requireSectionPerm failed:", e);
      return res.status(500).json({ error: "Ошибка проверки доступа" });
    }
  };
}

type ExportHandler = (req: AuthedRequest, res: import("express").Response) => void | Promise<void>;

function withExportError(label: string, handler: ExportHandler): ExportHandler {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      console.error(`export ${label} failed:`, e);
      if (!res.headersSent) {
        res.status(500).json({
          error:
            "Не удалось сформировать Excel-отчёт. Сузьте период, выберите один объект или обратитесь к администратору."
        });
      }
    }
  };
}

async function warehouseLabel(warehouseId?: string): Promise<string> {
  if (!warehouseId) return "";
  const w = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { name: true } });
  return w?.name || warehouseId;
}

// ----- endpoints -----

exportsRouter.get(
  "/stocks.xlsx",
  requireSectionPerm("stocks"),
  withExportError("stocks", async (req, res) => {
    const range = parseRange(req.query as Record<string, unknown>);
    if ("error" in range) {
      res.status(400).json({ error: range.error });
      return;
    }
    const scope = await getRequestDataScope(req);
    const exportWh = parseExportWarehouseQuery(req.query as Record<string, unknown>, scope);
    if (exportWh.error) {
      res.status(403).json({ error: exportWh.error });
      return;
    }

    const stocks = await prisma.stock.findMany({
      where: mergeStockWhere(scope, exportWh),
      include: { material: true, warehouse: true },
      take: EXPORT_ROW_LIMIT,
      orderBy: [{ warehouseId: "asc" }, { section: "asc" }, { material: { name: "asc" } }]
    });
    const movements = await prisma.stockMovement.findMany({
      where: mergeMovementWhere(scope, range, exportWh),
      include: {
        material: true,
        warehouse: true,
        operation: { select: { section: true, documentNumber: true, type: true } },
        issueRequest: { select: { section: true, number: true } }
      },
      orderBy: { createdAt: "desc" },
      take: EXPORT_ROW_LIMIT
    });

    const stockCols: ReportColumn[] = [
      { header: "Объект", key: "warehouse", width: 22 },
      { header: "Раздел", key: "section", width: 8 },
      { header: "Материал", key: "material", width: 36 },
      { header: "Вид", key: "kind", width: 14 },
      { header: "Каталог инстр.", key: "toolSection", width: 16 },
      { header: "Ед.", key: "unit", width: 8 },
      { header: "Количество", key: "qty", width: 12, numFmt: "#,##0.###" },
      { header: "Резерв", key: "reserved", width: 10, numFmt: "#,##0.###" },
      { header: "Доступно", key: "available", width: 12, numFmt: "#,##0.###" },
      { header: "Цена, ₽", key: "price", width: 12, numFmt: "#,##0.00" },
      { header: "Сумма, ₽", key: "sum", width: 14, numFmt: "#,##0.00" },
      { header: "Комната", key: "room", width: 14 },
      { header: "Ячейка", key: "cell", width: 14 },
      { header: "Артикул", key: "sku", width: 14 },
      { header: "Обновлено", key: "updated", width: 18 }
    ];

    const moveCols: ReportColumn[] = [
      { header: "Дата", key: "date", width: 18 },
      { header: "Объект", key: "warehouse", width: 22 },
      { header: "Раздел", key: "section", width: 8 },
      { header: "Материал", key: "material", width: 32 },
      { header: "Ед.", key: "unit", width: 8 },
      { header: "Направление", key: "direction", width: 12, textColor: (v) => (v === "Приход" ? "FF16A34A" : v === "Расход" ? "FFDC2626" : undefined) },
      { header: "Количество", key: "qty", width: 12, numFmt: "#,##0.###" },
      { header: "Тип документа", key: "docType", width: 16 },
      { header: "№ документа", key: "docNo", width: 18 },
      { header: "Заявка на выдачу", key: "issueNo", width: 16 },
      { header: "Комментарий", key: "note", width: 24 }
    ];

    await sendReport(
      res,
      "Склад — остатки и движения",
      range,
      req.user?.email,
      await warehouseLabel(exportWh.warehouseId),
      exportWh.section ? labelSection(exportWh.section) : "",
      [
        {
          name: "Остатки",
          columns: stockCols,
          rows: stocks.map((s) => {
            const qty = num(s.quantity);
            const price = s.material.unitPrice != null ? num(s.material.unitPrice) : null;
            return {
              warehouse: s.warehouse.name,
              section: labelSection(s.section),
              material: s.material.name,
              kind: labelMaterialKind(s.material.kind),
              toolSection: s.material.toolCatalogSection || "",
              unit: s.material.unit,
              qty,
              reserved: num(s.reserved),
              available: qty - num(s.reserved),
              price: price ?? "",
              sum: price != null ? qty * price : "",
              room: s.storageRoom || "",
              cell: s.storageCell || "",
              sku: s.material.sku || "",
              updated: fmtDateTime(s.updatedAt)
            };
          })
        },
        {
          name: "Движения",
          columns: moveCols,
          rows: movements.map((m) => ({
            date: fmtDateTime(m.createdAt),
            warehouse: m.warehouse?.name || "",
            section: labelSection(m.operation?.section || m.issueRequest?.section || ""),
            material: m.material?.name || "",
            unit: m.material?.unit || "",
            direction: labelDirection(m.direction),
            qty: num(m.quantity),
            docType: m.sourceDocumentType,
            docNo: m.operation?.documentNumber || m.sourceDocumentId || "",
            issueNo: m.issueRequest?.number || "",
            note: m.note || ""
          }))
        }
      ]
    );
  })
);

exportsRouter.get(
  "/limits.xlsx",
  requireSectionPerm("limits"),
  withExportError("limits", async (req, res) => {
    const range = parseRange(req.query as Record<string, unknown>);
    if ("error" in range) {
      res.status(400).json({ error: range.error });
      return;
    }
    const scope = await getRequestDataScope(req);
    const exportWh = parseExportWarehouseQuery(req.query as Record<string, unknown>, scope);
    if (exportWh.error) {
      res.status(403).json({ error: exportWh.error });
      return;
    }

    const tplWhere: Prisma.ObjectLimitTemplateWhereInput = {
      AND: [
        objectLimitTemplateWhereFromScope(scope),
        exportWh.warehouseId
          ? {
              warehouseId: exportWh.warehouseId,
              ...(exportWh.section ? { section: exportWh.section } : {})
            }
          : {}
      ].filter((p) => Object.keys(p).length)
    };

    const templates = await prisma.objectLimitTemplate.findMany({
      where: tplWhere,
      include: {
        warehouse: true,
        nodes: { include: { material: true }, orderBy: { orderNo: "asc" } }
      },
      orderBy: { createdAt: "desc" },
      take: 20
    });

    const limitRows: Array<Record<string, unknown>> = [];
    const templateRows: Array<Record<string, unknown>> = [];

    for (const tpl of templates) {
      templateRows.push({
        object: tpl.warehouse.name,
        section: labelSection(tpl.section),
        title: tpl.title,
        file: tpl.sourceFileName || "",
        created: fmtDateTime(tpl.createdAt),
        materials: tpl.nodes.filter((n) => n.nodeType === "MATERIAL").length,
        groups: tpl.nodes.filter((n) => n.nodeType === "GROUP").length
      });

      const byId = new Map(
        tpl.nodes.map((n) => [
          n.id,
          {
            id: n.id,
            parentId: n.parentId,
            nodeType: n.nodeType,
            title: n.title,
            indexLabel: n.indexLabel
          }
        ])
      );

      for (const n of tpl.nodes.filter((x) => x.nodeType === "MATERIAL")) {
        const planned = num(n.plannedQty);
        const issued = num(n.issuedQty);
        limitRows.push({
          object: tpl.warehouse.name,
          section: labelSection(tpl.section),
          template: tpl.title,
          path: limitNodePath(n.id, byId),
          material: n.materialName || n.title,
          unit: n.unit || "шт",
          planned,
          issued,
          remain: Math.max(0, planned - issued),
          pct: planned > 0 ? Math.round((issued / planned) * 1000) / 10 : 0,
          card: n.material?.name || "",
          sku: n.material?.sku || ""
        });
      }
    }

    const issuedRows = await prisma.stockMovement.findMany({
      where: { AND: [{ direction: "OUT" }, mergeMovementWhere(scope, range, exportWh)] },
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

    await sendReport(
      res,
      "Лимиты объектов",
      range,
      req.user?.email,
      await warehouseLabel(exportWh.warehouseId),
      exportWh.section ? labelSection(exportWh.section) : "",
      [
        {
          name: "Шаблоны",
          columns: [
            { header: "Объект", key: "object", width: 22 },
            { header: "Раздел", key: "section", width: 8 },
            { header: "Шаблон", key: "title", width: 28 },
            { header: "Файл", key: "file", width: 24 },
            { header: "Загружен", key: "created", width: 18 },
            { header: "Материалов", key: "materials", width: 12 },
            { header: "Разделов", key: "groups", width: 10 }
          ],
          rows: templateRows
        },
        {
          name: "План vs выдача",
          columns: [
            { header: "Объект", key: "object", width: 20 },
            { header: "Раздел", key: "section", width: 8 },
            { header: "Шаблон", key: "template", width: 22 },
            { header: "Путь в лимите", key: "path", width: 32 },
            { header: "Материал", key: "material", width: 32 },
            { header: "Ед.", key: "unit", width: 8 },
            { header: "План", key: "planned", width: 12, numFmt: "#,##0.###" },
            { header: "Выдано", key: "issued", width: 12, numFmt: "#,##0.###" },
            { header: "Остаток", key: "remain", width: 12, numFmt: "#,##0.###" },
            { header: "%, выдача", key: "pct", width: 10, numFmt: "0.0", fillColor: pctFillColor },
            { header: "Карточка склада", key: "card", width: 28 },
            { header: "Артикул", key: "sku", width: 14 }
          ],
          rows: limitRows
        },
        {
          name: "Выдача за период",
          columns: [
            { header: "Объект", key: "warehouse", width: 22 },
            { header: "Проект", key: "project", width: 22 },
            { header: "Материал", key: "material", width: 32 },
            { header: "Ед.", key: "unit", width: 8 },
            { header: "Выдано", key: "qty", width: 12, numFmt: "#,##0.###" }
          ],
          rows: Array.from(issuedAgg.values()).map((v) => ({ ...v }))
        }
      ]
    );
  })
);

exportsRouter.get(
  "/materialReport.xlsx",
  requireSectionPerm("materialReport"),
  withExportError("materialReport", async (req, res) => {
    const range = parseRange(req.query as Record<string, unknown>);
    if ("error" in range) {
      res.status(400).json({ error: range.error });
      return;
    }
    const scope = await getRequestDataScope(req);
    const exportWh = parseExportWarehouseQuery(req.query as Record<string, unknown>, scope);
    if (exportWh.error) {
      res.status(403).json({ error: exportWh.error });
      return;
    }

    const scopeWh =
      scope.unrestricted || !scope.warehouseIds?.length ? {} : { warehouseId: { in: scope.warehouseIds } };
    const rows = await prisma.materialHolderWriteoff.findMany({
      where: {
        AND: [
          { createdAt: { gte: range.from, lte: range.to } },
          scopeWh,
          exportWh.warehouseId
            ? { warehouseId: exportWh.warehouseId, ...(exportWh.section ? { section: exportWh.section } : {}) }
            : {}
        ].filter((p) => Object.keys(p).length)
      },
      include: { material: true, warehouse: true, holderUser: true, actorUser: true },
      orderBy: { createdAt: "desc" },
      take: EXPORT_ROW_LIMIT
    });

    await sendReport(
      res,
      "Материальный отчёт — списания",
      range,
      req.user?.email,
      await warehouseLabel(exportWh.warehouseId),
      exportWh.section ? labelSection(exportWh.section) : "",
      [
        {
          name: "Списания",
          columns: [
            { header: "Дата", key: "date", width: 18 },
            { header: "Объект", key: "warehouse", width: 22 },
            { header: "Раздел", key: "section", width: 8 },
            { header: "Ответственный", key: "holder", width: 24 },
            { header: "Кто списал", key: "actor", width: 22 },
            { header: "Материал", key: "material", width: 32 },
            { header: "Ед.", key: "unit", width: 8 },
            { header: "Количество", key: "qty", width: 12, numFmt: "#,##0.###" },
            { header: "Комментарий", key: "comment", width: 32 }
          ],
          rows: rows.map((r) => ({
            date: fmtDateTime(r.createdAt),
            warehouse: r.warehouse?.name || "",
            section: labelSection(r.section),
            holder: r.holderName || r.holderUser?.fullName || "",
            actor: r.actorUser?.fullName || "",
            material: r.material?.name || "",
            unit: r.material?.unit || "",
            qty: num(r.quantity),
            comment: r.comment || ""
          }))
        }
      ]
    );
  })
);

exportsRouter.get(
  "/tools.xlsx",
  requireSectionPerm("tools"),
  withExportError("tools", async (req, res) => {
    const range = parseRange(req.query as Record<string, unknown>);
    if ("error" in range) {
      res.status(400).json({ error: range.error });
      return;
    }
    const scope = await getRequestDataScope(req);
    const exportWh = parseExportWarehouseQuery(req.query as Record<string, unknown>, scope);
    if (exportWh.error) {
      res.status(403).json({ error: exportWh.error });
      return;
    }

    const toolBase = toolWhereFromScope(scope);
    const toolWhere: Prisma.ToolWhereInput = exportWh.warehouseId
      ? { AND: [toolBase, { warehouseId: exportWh.warehouseId, ...(exportWh.section ? { section: exportWh.section } : {}) }] }
      : toolBase;

    const tools = await prisma.tool.findMany({
      where: toolWhere,
      include: { warehouse: true, project: true, category: true },
      orderBy: [{ name: "asc" }, { inventoryNumber: "asc" }],
      take: EXPORT_ROW_LIMIT
    });
    const events = await prisma.toolEvent.findMany({
      where: { AND: [{ createdAt: { gte: range.from, lte: range.to } }, { tool: { is: toolWhere } }] },
      include: { tool: { include: { warehouse: true, category: true } } },
      orderBy: { createdAt: "desc" },
      take: EXPORT_ROW_LIMIT
    });

    await sendReport(
      res,
      "Инструменты и СИЗ",
      range,
      req.user?.email,
      await warehouseLabel(exportWh.warehouseId),
      exportWh.section ? labelSection(exportWh.section) : "",
      [
        {
          name: "Парк",
          columns: [
            { header: "Категория", key: "category", width: 18 },
            { header: "Название", key: "name", width: 28 },
            { header: "Марка", key: "brand", width: 16 },
            { header: "Вид", key: "kind", width: 16 },
            { header: "Инв. №", key: "inv", width: 16 },
            { header: "Сер. №", key: "serial", width: 16 },
            { header: "Статус", key: "status", width: 14 },
            { header: "Объект", key: "warehouse", width: 22 },
            { header: "Раздел", key: "section", width: 8 },
            { header: "Проект", key: "project", width: 20 },
            { header: "Ответственный", key: "responsible", width: 20 },
            { header: "Примечание", key: "note", width: 24 }
          ],
          rows: tools.map((t) => ({
            category: t.category?.name || "",
            name: t.name,
            brand: t.brand || "",
            kind: t.toolType || "",
            inv: t.inventoryNumber,
            serial: t.serialNumber || "",
            status: labelToolStatus(t.status),
            warehouse: t.warehouse?.name || "",
            section: labelSection(t.section),
            project: t.project?.name || "",
            responsible: t.responsible || "",
            note: t.note || ""
          }))
        },
        {
          name: "События",
          columns: [
            { header: "Дата", key: "date", width: 18 },
            { header: "Инструмент", key: "tool", width: 28 },
            { header: "Категория", key: "category", width: 16 },
            { header: "Инв. №", key: "inv", width: 14 },
            { header: "Объект", key: "warehouse", width: 22 },
            { header: "Действие", key: "action", width: 18 },
            { header: "Статус", key: "status", width: 14 },
            { header: "Комментарий", key: "comment", width: 28 }
          ],
          rows: events.map((e) => ({
            date: fmtDateTime(e.createdAt),
            tool: e.tool?.name || "",
            category: e.tool?.category?.name || "",
            inv: e.tool?.inventoryNumber || "",
            warehouse: e.tool?.warehouse?.name || "",
            action: e.action,
            status: labelToolStatus(e.status),
            comment: e.comment || ""
          }))
        }
      ]
    );
  })
);

exportsRouter.get(
  "/issues.xlsx",
  requireSectionPerm("issues"),
  withExportError("issues", async (req, res) => {
    const range = parseRange(req.query as Record<string, unknown>);
    if ("error" in range) {
      res.status(400).json({ error: range.error });
      return;
    }
    const exportWhQ = req.query as Record<string, unknown>;
    const whHint = typeof exportWhQ.warehouseId === "string" ? exportWhQ.warehouseId : undefined;
    const scope = await resolveReadScope(req, { warehouseId: whHint });
    const exportWh = parseExportWarehouseQuery(exportWhQ, scope);
    if (exportWh.error) {
      res.status(403).json({ error: exportWh.error });
      return;
    }

    const issues = await prisma.issueRequest.findMany({
      where: mergeIssueWhere(scope, {
        createdAt: { gte: range.from, lte: range.to },
        ...(exportWh.warehouseId
          ? { warehouseId: exportWh.warehouseId, ...(exportWh.section ? { section: exportWh.section } : {}) }
          : {})
      }),
      select: {
        createdAt: true,
        number: true,
        status: true,
        flowType: true,
        domain: true,
        section: true,
        limitReleasePath: true,
        responsibleName: true,
        actualRecipientName: true,
        note: true,
        warehouse: { select: { name: true } },
        project: { select: { name: true } },
        requestedBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
        items: { select: { quantity: true, material: { select: { name: true, unit: true } } } }
      },
      orderBy: { createdAt: "desc" },
      take: EXPORT_ISSUE_LIMIT
    });

    const headerRows = issues.map((r) => ({
      date: fmtDateTime(r.createdAt),
      number: r.number,
      status: labelIssueStatus(r.status),
      flow: r.flowType,
      domain: r.domain,
      section: labelSection(r.section),
      warehouse: r.warehouse?.name || "",
      project: r.project?.name || "",
      limitPath: r.limitReleasePath || "",
      requestedBy: r.requestedBy?.fullName || "",
      approvedBy: r.approvedBy?.fullName || "",
      responsible: r.responsibleName || "",
      recipient: r.actualRecipientName || "",
      note: r.note || "",
      items: r.items.length,
      totalQty: r.items.reduce((s, it) => s + num(it.quantity), 0)
    }));

    const lineRows: Array<Record<string, unknown>> = [];
    for (const r of issues) {
      for (const it of r.items) {
        lineRows.push({
          date: fmtDateTime(r.createdAt),
          number: r.number,
          status: labelIssueStatus(r.status),
          warehouse: r.warehouse?.name || "",
          project: r.project?.name || "",
          limitPath: r.limitReleasePath || "",
          material: it.material?.name || "",
          unit: it.material?.unit || "",
          qty: num(it.quantity)
        });
      }
    }

    await sendReport(
      res,
      "Заявки на выдачу",
      range,
      req.user?.email,
      await warehouseLabel(exportWh.warehouseId),
      exportWh.section ? labelSection(exportWh.section) : "",
      [
        {
          name: "Заявки",
          columns: [
            { header: "Дата", key: "date", width: 18 },
            { header: "Номер", key: "number", width: 16 },
            { header: "Статус", key: "status", width: 14 },
            { header: "Поток", key: "flow", width: 12 },
            { header: "Тип", key: "domain", width: 14 },
            { header: "Раздел", key: "section", width: 8 },
            { header: "Объект", key: "warehouse", width: 22 },
            { header: "Проект", key: "project", width: 20 },
            { header: "Раздел лимита", key: "limitPath", width: 28 },
            { header: "Запросил", key: "requestedBy", width: 20 },
            { header: "Согласовал", key: "approvedBy", width: 20 },
            { header: "Ответственный", key: "responsible", width: 20 },
            { header: "Получатель", key: "recipient", width: 20 },
            { header: "Позиций", key: "items", width: 10 },
            { header: "Кол-во", key: "totalQty", width: 12, numFmt: "#,##0.###" },
            { header: "Примечание", key: "note", width: 28 }
          ],
          rows: headerRows
        },
        {
          name: "Позиции",
          columns: [
            { header: "Дата", key: "date", width: 18 },
            { header: "Номер заявки", key: "number", width: 16 },
            { header: "Статус", key: "status", width: 14 },
            { header: "Объект", key: "warehouse", width: 22 },
            { header: "Проект", key: "project", width: 20 },
            { header: "Раздел лимита", key: "limitPath", width: 28 },
            { header: "Материал", key: "material", width: 32 },
            { header: "Ед.", key: "unit", width: 8 },
            { header: "Количество", key: "qty", width: 12, numFmt: "#,##0.###" }
          ],
          rows: lineRows
        }
      ]
    );
  })
);

exportsRouter.get(
  "/receipts.xlsx",
  requireSectionPerm("receipts"),
  withExportError("receipts", async (req, res) => {
    const range = parseRange(req.query as Record<string, unknown>);
    if ("error" in range) {
      res.status(400).json({ error: range.error });
      return;
    }
    const scope = await getRequestDataScope(req);
    const exportWh = parseExportWarehouseQuery(req.query as Record<string, unknown>, scope);
    if (exportWh.error) {
      res.status(403).json({ error: exportWh.error });
      return;
    }

    const receiptExtra = exportWh.warehouseId
      ? { warehouseId: exportWh.warehouseId, ...(exportWh.section ? { section: exportWh.section } : {}) }
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
        limitTemplate: { select: { title: true } },
        items: { include: { mappedMaterial: true } }
      },
      orderBy: { createdAt: "desc" },
      take: EXPORT_ISSUE_LIMIT
    });

    const operations = await prisma.operation.findMany({
      where: {
        AND: [
          { type: "INCOME", operationDate: { gte: range.from, lte: range.to } },
          operationWhereFromScope(scope),
          receiptExtra
        ].filter((p) => Object.keys(p).length)
      },
      include: { warehouse: true, project: true, items: { include: { material: true } } },
      orderBy: { operationDate: "desc" },
      take: EXPORT_ISSUE_LIMIT
    });

    const receiptLines: Array<Record<string, unknown>> = [];
    for (const r of receipts) {
      for (const it of r.items) {
        receiptLines.push({
          date: fmtDateTime(r.createdAt),
          number: r.number,
          warehouse: r.warehouse?.name || "",
          section: labelSection(r.section),
          fromLimit: r.fromLimit ? "Да" : "Нет",
          limitTemplate: r.limitTemplate?.title || "",
          sourceName: it.sourceName,
          sourceUnit: it.sourceUnit,
          mapped: it.mappedMaterial?.name || "",
          category: it.category || "",
          qty: num(it.quantity),
          accepted: num(it.acceptedQty || 0),
          price: it.unitPrice != null ? num(it.unitPrice) : "",
          storage: it.storagePlace || "",
          limitPath: it.limitSectionPath || ""
        });
      }
    }

    const opLines: Array<Record<string, unknown>> = [];
    for (const o of operations) {
      for (const it of o.items) {
        opLines.push({
          date: fmtDateTime(o.operationDate),
          doc: o.documentNumber || "",
          warehouse: o.warehouse?.name || "",
          section: labelSection(o.section),
          project: o.project?.name || "",
          material: it.material?.name || "",
          unit: it.material?.unit || "",
          qty: num(it.quantity),
          price: it.price != null ? num(it.price) : "",
          sum: num(it.quantity) * num(it.price)
        });
      }
    }

    await sendReport(
      res,
      "Поступления и приёмки",
      range,
      req.user?.email,
      await warehouseLabel(exportWh.warehouseId),
      exportWh.section ? labelSection(exportWh.section) : "",
      [
        {
          name: "Заявки на приход",
          columns: [
            { header: "Дата", key: "date", width: 18 },
            { header: "Номер", key: "number", width: 16 },
            { header: "Статус", key: "status", width: 14 },
            { header: "Объект", key: "warehouse", width: 22 },
            { header: "Раздел", key: "section", width: 8 },
            { header: "Из лимита", key: "fromLimit", width: 10 },
            { header: "Шаблон лимита", key: "limitTemplate", width: 22 },
            { header: "Файл", key: "file", width: 24 },
            { header: "Автор", key: "author", width: 20 },
            { header: "Позиций", key: "items", width: 10 },
            { header: "План, кол-во", key: "planQty", width: 14, numFmt: "#,##0.###" },
            { header: "Принято", key: "acceptedQty", width: 14, numFmt: "#,##0.###" }
          ],
          rows: receipts.map((r) => ({
            date: fmtDateTime(r.createdAt),
            number: r.number,
            status: labelReceiptStatus(r.status),
            warehouse: r.warehouse?.name || "",
            section: labelSection(r.section),
            fromLimit: r.fromLimit ? "Да" : "Нет",
            limitTemplate: r.limitTemplate?.title || "",
            file: r.sourceFileName || "",
            author: r.createdBy?.fullName || "",
            items: r.items.length,
            planQty: r.items.reduce((s, it) => s + num(it.quantity), 0),
            acceptedQty: r.items.reduce((s, it) => s + num(it.acceptedQty || 0), 0)
          }))
        },
        {
          name: "Позиции заявок",
          columns: [
            { header: "Дата", key: "date", width: 18 },
            { header: "Заявка", key: "number", width: 14 },
            { header: "Объект", key: "warehouse", width: 20 },
            { header: "Раздел", key: "section", width: 8 },
            { header: "Из лимита", key: "fromLimit", width: 10 },
            { header: "Путь лимита", key: "limitPath", width: 28 },
            { header: "Название в файле", key: "sourceName", width: 32 },
            { header: "Ед.", key: "sourceUnit", width: 8 },
            { header: "Категория", key: "category", width: 16 },
            { header: "Карточка", key: "mapped", width: 28 },
            { header: "План", key: "qty", width: 12, numFmt: "#,##0.###" },
            { header: "Принято", key: "accepted", width: 12, numFmt: "#,##0.###" },
            { header: "Цена, ₽", key: "price", width: 12, numFmt: "#,##0.00" },
            { header: "Место хранения", key: "storage", width: 20 }
          ],
          rows: receiptLines
        },
        {
          name: "Операции прихода",
          columns: [
            { header: "Дата", key: "date", width: 18 },
            { header: "Документ", key: "doc", width: 18 },
            { header: "Объект", key: "warehouse", width: 22 },
            { header: "Раздел", key: "section", width: 8 },
            { header: "Проект", key: "project", width: 20 },
            { header: "Позиций", key: "items", width: 10 },
            { header: "Кол-во", key: "qty", width: 12, numFmt: "#,##0.###" },
            { header: "Сумма, ₽", key: "sum", width: 14, numFmt: "#,##0.00" }
          ],
          rows: operations.map((o) => ({
            date: fmtDateTime(o.operationDate),
            doc: o.documentNumber || "",
            warehouse: o.warehouse?.name || "",
            section: labelSection(o.section),
            project: o.project?.name || "",
            items: o.items.length,
            qty: o.items.reduce((s, it) => s + num(it.quantity), 0),
            sum: o.items.reduce((s, it) => s + num(it.quantity) * num(it.price), 0)
          }))
        },
        {
          name: "Позиции приходов",
          columns: [
            { header: "Дата", key: "date", width: 18 },
            { header: "Документ", key: "doc", width: 18 },
            { header: "Объект", key: "warehouse", width: 22 },
            { header: "Раздел", key: "section", width: 8 },
            { header: "Материал", key: "material", width: 32 },
            { header: "Ед.", key: "unit", width: 8 },
            { header: "Количество", key: "qty", width: 12, numFmt: "#,##0.###" },
            { header: "Цена, ₽", key: "price", width: 12, numFmt: "#,##0.00" },
            { header: "Сумма, ₽", key: "sum", width: 14, numFmt: "#,##0.00" }
          ],
          rows: opLines
        }
      ]
    );
  })
);
