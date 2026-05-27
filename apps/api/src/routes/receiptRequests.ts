import { NotificationLevel, OperationType, StockMovementDirection } from "@prisma/client";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import xlsx from "xlsx";
import { z } from "zod";
import { config } from "../config.js";
import { recordAudit } from "../lib/audit.js";
import { assertWarehouseInScope, getRequestDataScope } from "../lib/dataScope.js";
import { dispatchCriticalNotification, dispatchNotification, notifyUser } from "../lib/notifications.js";
import {
  ensureMaterialInCurrentLimitTemplate,
  findLimitNodesAcrossWarehouse
} from "../lib/receiptOverageLimits.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { decodeUploadedOriginalName } from "../lib/uploadFileName.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const uploadDirAbs = path.resolve(process.cwd(), config.uploadsDir);
if (!fs.existsSync(uploadDirAbs)) {
  fs.mkdirSync(uploadDirAbs, { recursive: true });
}

const uploadRequestSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  fromLimit: z.string().optional(),
  objectLimitTemplateId: z.string().optional()
});

const acceptItemSchema = z.object({
  itemId: z.string().min(1),
  // либо ссылка на существующий материал, либо новое название (УПД)
  materialId: z.string().optional(),
  newMaterialName: z.string().max(500).optional(),
  newMaterialUnit: z.string().max(50).optional(),
  acceptedQty: z.number().positive(),
  // Опциональная привязка к конкретному узлу шаблона лимита (раздел/подраздел).
  // Если в шаблоне один и тот же материал лежит сразу в нескольких узлах,
  // мы спрашиваем пользователя «куда пихаем»; иначе пусто.
  limitNodeId: z.string().min(1).nullable().optional()
});

const acceptSchema = z.object({
  itemMappings: z.array(acceptItemSchema).min(1),
  documentNumber: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
  /** Разрешить принять больше, чем осталось по заявке (критическое уведомление + лимиты). */
  allowOverage: z.boolean().optional()
});

const limitLinkSchema = z.object({
  fromLimit: z.boolean(),
  objectLimitTemplateId: z.string().nullable().optional()
});

function parseOrderSheet(file: Buffer): {
  items: Array<{ name: string; unit: string; quantity: number }>;
  orderNumber?: string;
  projectTitle?: string;
} {
  const wb = xlsx.read(file, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws || !ws["!ref"]) return { items: [] };
  const range = xlsx.utils.decode_range(ws["!ref"]);
  const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
  const getCell = (r: number, c: number) => norm(ws[xlsx.utils.encode_cell({ r, c })]?.v);

  // 1. Метаданные сверху: «Номер заявки», «Проект».
  let orderNumber: string | undefined;
  let projectTitle: string | undefined;
  const scanRows = Math.min(range.e.r, 60);
  for (let r = 0; r <= scanRows; r += 1) {
    for (let c = 0; c <= Math.min(range.e.c, 12); c += 1) {
      const label = getCell(r, c).toLowerCase();
      if (!orderNumber && label.includes("номер заявки")) {
        // ищем числовое значение в той же строке или строкой ниже, правее label
        for (let rr = r; rr <= Math.min(r + 1, range.e.r); rr += 1) {
          for (let cc = c + 1; cc <= Math.min(range.e.c, c + 8); cc += 1) {
            const v = getCell(rr, cc);
            if (/^\d{2,}$/.test(v)) {
              orderNumber = v;
              break;
            }
          }
          if (orderNumber) break;
        }
      }
      if (!projectTitle && label === "проект") {
        // значение обычно в строке ниже под этой колонкой
        for (let rr = r; rr <= Math.min(r + 1, range.e.r); rr += 1) {
          const v = getCell(rr, c) || getCell(rr, c + 1) || getCell(rr + 1, c) || getCell(rr + 1, c + 1);
          if (v && v.toLowerCase() !== "проект") {
            projectTitle = v;
            break;
          }
        }
      }
    }
  }

  // 2. Шапка таблицы — ищем строку с заголовками «Товар»/«Количество»/«Ед.изм.»
  let headerRow = -1;
  let colName = -1;
  let colQty = -1;
  let colUnit = -1;
  for (let r = 0; r <= range.e.r; r += 1) {
    let foundName = -1;
    let foundQty = -1;
    let foundUnit = -1;
    for (let c = 0; c <= range.e.c; c += 1) {
      const v = getCell(r, c).toLowerCase();
      if (foundName < 0 && (v === "товар" || v === "наименование" || v === "номенклатура" || v.startsWith("товар") || v.startsWith("наимен") || v.startsWith("номенк"))) {
        foundName = c;
      }
      if (foundQty < 0 && (v === "количество" || v === "кол-во" || v === "колво" || v.includes("количеств"))) {
        foundQty = c;
      }
      if (foundUnit < 0 && (v.startsWith("ед.") || v === "ед" || v.includes("единиц") || v.includes("изм."))) {
        foundUnit = c;
      }
    }
    if (foundName >= 0 && foundQty >= 0) {
      headerRow = r;
      colName = foundName;
      colQty = foundQty;
      colUnit = foundUnit;
      break;
    }
  }

  const items: Array<{ name: string; unit: string; quantity: number }> = [];
  if (headerRow < 0) return { items, orderNumber, projectTitle };

  for (let r = headerRow + 1; r <= range.e.r; r += 1) {
    const name = getCell(r, colName);
    const qtyRaw = getCell(r, colQty).replace(",", ".");
    const unit = colUnit >= 0 ? getCell(r, colUnit) : "шт";
    if (!name) continue;
    const quantity = Number(qtyRaw);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    items.push({ name, unit: unit || "шт", quantity });
  }
  return { items, orderNumber, projectTitle };
}

async function findOrCreateMaterial(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  nameRaw: string,
  unitRaw: string | undefined | null
): Promise<string | undefined> {
  const name = String(nameRaw || "").trim();
  if (!name) return undefined;
  const unit = String(unitRaw || "шт").trim() || "шт";
  const existing = await tx.material.findFirst({ where: { name, unit } });
  if (existing) return existing.id;
  const created = await tx.material.create({ data: { name, unit } });
  return created.id;
}

export const receiptRequestsRouter = Router();
receiptRequestsRouter.use(requireAuth);
receiptRequestsRouter.use(requirePermission("operations.read"));

receiptRequestsRouter.post(
  "/upload",
  requirePermission("operations.write"),
  upload.single("file"),
  async (req: AuthedRequest, res) => {
    const parsed = uploadRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    if (!req.file?.buffer) return res.status(400).json({ error: "file is required" });
    const scope = await getRequestDataScope(req);
    try {
      assertWarehouseInScope(scope, parsed.data.warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
    const { items, orderNumber, projectTitle } = parseOrderSheet(req.file.buffer);
    if (!items.length) {
      return res.status(400).json({ error: "В файле не найдена таблица позиций (нужны колонки: Товар, Количество, Ед. изм.)" });
    }

    // Сформируем уникальный номер. Если в файле найден номер заявки — пытаемся использовать его.
    let number = orderNumber ? `ORD-${orderNumber}` : "";
    if (number) {
      const dup = await prisma.receiptRequest.findUnique({ where: { number } });
      if (dup) number = `${number}-${Date.now().toString().slice(-4)}`;
    } else {
      const count = await prisma.receiptRequest.count();
      number = `ORD-${String(count + 1).padStart(5, "0")}`;
    }

    // Опциональная привязка к шаблону лимита (если уже передали при загрузке).
    let attachedTemplateId: string | undefined;
    if (parsed.data.objectLimitTemplateId) {
      const tpl = await prisma.objectLimitTemplate.findUnique({
        where: { id: parsed.data.objectLimitTemplateId }
      });
      if (tpl && tpl.warehouseId === parsed.data.warehouseId && tpl.section === parsed.data.section) {
        attachedTemplateId = tpl.id;
      }
    }
    const fromLimitFlag = parsed.data.fromLimit === "1" || parsed.data.fromLimit === "true" || Boolean(attachedTemplateId);

    const created = await prisma.$transaction(async (tx) => {
      const receipt = await tx.receiptRequest.create({
        data: {
          number,
          warehouseId: parsed.data.warehouseId,
          section: parsed.data.section,
          sourceFileName: decodeUploadedOriginalName(req.file!.originalname),
          createdById: req.user!.userId,
          fromLimit: fromLimitFlag,
          objectLimitTemplateId: attachedTemplateId ?? null,
          items: {
            create: items.map((i) => ({
              sourceName: i.name,
              sourceUnit: i.unit,
              quantity: i.quantity
            }))
          }
        },
        include: { items: true, limitTemplate: { select: { id: true, title: true } } }
      });

      const safe = req.file!.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storedFileName = `${Date.now()}_${safe}`;
      await fs.promises.writeFile(path.join(uploadDirAbs, storedFileName), req.file!.buffer);
      await tx.documentFile.create({
        data: {
          groupId: crypto.randomUUID(),
          version: 1,
          entityType: "receipt",
          entityId: receipt.id,
          type: "receipt-request",
          fileName: decodeUploadedOriginalName(req.file!.originalname),
          filePath: `${config.uploadsDir}/${storedFileName}`.replace(/\\/g, "/"),
          mimeType: req.file!.mimetype,
          size: req.file!.size,
          checksumSha256: crypto.createHash("sha256").update(req.file!.buffer).digest("hex"),
          createdBy: req.user!.userId
        }
      });

      return receipt;
    });
    await dispatchNotification({
      eventCode: "RECEIPT_CREATED",
      title: "Новая заявка на приход",
      message: `${created.number}: ${created.items.length} позиций`,
      entityType: "ReceiptRequest",
      entityId: created.id,
      excludeUserIds: [req.user!.userId]
    }).catch(() => undefined);
    return res.status(201).json({
      ...created,
      detectedOrderNumber: orderNumber || null,
      detectedProjectTitle: projectTitle || null
    });
  }
);

// Привязать/отвязать заявку к шаблону лимита (модалка «Заявка из лимита?»).
receiptRequestsRouter.patch(
  "/:id/limit",
  requirePermission("operations.write"),
  async (req: AuthedRequest, res) => {
    const parsed = limitLinkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    const id = String(req.params.id);
    const row = await prisma.receiptRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Request not found" });
    const scope = await getRequestDataScope(req);
    try {
      assertWarehouseInScope(scope, row.warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
    let nextTemplateId: string | null = null;
    if (parsed.data.fromLimit && parsed.data.objectLimitTemplateId) {
      const tpl = await prisma.objectLimitTemplate.findUnique({
        where: { id: parsed.data.objectLimitTemplateId }
      });
      if (!tpl || tpl.warehouseId !== row.warehouseId || tpl.section !== row.section) {
        return res.status(400).json({ error: "Шаблон лимита не относится к этому объекту/разделу" });
      }
      nextTemplateId = tpl.id;
    }
    const updated = await prisma.receiptRequest.update({
      where: { id },
      data: {
        fromLimit: parsed.data.fromLimit,
        objectLimitTemplateId: parsed.data.fromLimit ? nextTemplateId : null
      },
      include: {
        items: { include: { mappedMaterial: { select: { id: true, name: true, unit: true } } } },
        limitTemplate: { select: { id: true, title: true } }
      }
    });
    return res.json(updated);
  }
);

// Возвращает по каждой позиции заявки список подходящих узлов в шаблоне лимита,
// чтобы UI мог спросить «куда отнести» при множественных совпадениях.
receiptRequestsRouter.get("/:id/limit-suggestions", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const row = await prisma.receiptRequest.findUnique({
    where: { id },
    include: {
      items: {
        include: { mappedMaterial: { select: { id: true, name: true, unit: true } } }
      }
    }
  });
  if (!row) return res.status(404).json({ error: "Request not found" });
  const scope = await getRequestDataScope(req);
  try {
    assertWarehouseInScope(scope, row.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  if (!row.objectLimitTemplateId) {
    return res.json({ items: row.items.map((it) => ({ itemId: it.id, suggestions: [] })) });
  }
  // Все узлы шаблона со всеми возможными свойствами для матчинга.
  const nodes = await prisma.objectLimitNode.findMany({
    where: { templateId: row.objectLimitTemplateId, nodeType: "MATERIAL" },
    select: {
      id: true,
      title: true,
      indexLabel: true,
      materialId: true,
      materialName: true,
      parentId: true,
      plannedQty: true,
      issuedQty: true,
      unit: true
    }
  });
  // Построим путь до узла (для красивого отображения "Раздел / Подраздел / Материал").
  const allNodes = await prisma.objectLimitNode.findMany({
    where: { templateId: row.objectLimitTemplateId },
    select: { id: true, parentId: true, title: true, indexLabel: true }
  });
  // Явный тип, иначе TS жалуется на цикл при использовании `nodeById.get(cur)!` внутри замыкания.
  type LimitPathNode = { id: string; parentId: string | null; title: string; indexLabel: string | null };
  const nodeById = new Map<string, LimitPathNode>(allNodes.map((n) => [n.id, n] as [string, LimitPathNode]));
  function pathFor(nodeId: string): string {
    const parts: string[] = [];
    let cur: string | null | undefined = nodeId;
    while (cur && nodeById.has(cur)) {
      const n: LimitPathNode = nodeById.get(cur)!;
      const label = [n.indexLabel, n.title].filter(Boolean).join(" ").trim();
      if (label) parts.unshift(label);
      cur = n.parentId ?? null;
    }
    return parts.join(" / ");
  }
  const normalize = (s: string | null | undefined) =>
    String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  function nodeMatchesItem(
    node: (typeof nodes)[number],
    materialId: string | null,
    sourceName: string
  ): boolean {
    if (materialId && node.materialId && node.materialId === materialId) return true;
    if (!materialId && node.materialName && sourceName && normalize(node.materialName) === normalize(sourceName)) {
      return true;
    }
    return false;
  }
  const result = row.items.map((it) => {
    const matched = nodes
      .filter((n) => nodeMatchesItem(n, it.mappedMaterialId ?? null, it.sourceName))
      .map((n) => ({
        id: n.id,
        title: n.title,
        indexLabel: n.indexLabel,
        path: pathFor(n.id),
        plannedQty: n.plannedQty != null ? Number(n.plannedQty) : null,
        issuedQty: n.issuedQty != null ? Number(n.issuedQty) : 0,
        unit: n.unit
      }));
    return { itemId: it.id, currentLimitNodeId: it.limitNodeId ?? null, suggestions: matched };
  });
  return res.json({ items: result, hasTemplate: true });
});

receiptRequestsRouter.get("/:id/overage-limit-options", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const itemId = typeof req.query.itemId === "string" ? req.query.itemId : "";
  const materialIdQ = typeof req.query.materialId === "string" ? req.query.materialId : "";
  const row = await prisma.receiptRequest.findUnique({
    where: { id },
    include: { items: true }
  });
  if (!row) return res.status(404).json({ error: "Request not found" });
  const scope = await getRequestDataScope(req);
  try {
    assertWarehouseInScope(scope, row.warehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }
  const item = itemId ? row.items.find((it) => it.id === itemId) : row.items[0];
  if (!item) return res.status(400).json({ error: "itemId обязателен" });
  const materialId = materialIdQ || item.mappedMaterialId || "";
  const picks = await findLimitNodesAcrossWarehouse(
    row.warehouseId,
    materialId,
    item.sourceName,
    row.objectLimitTemplateId
  );
  return res.json({
    itemId: item.id,
    sourceName: item.sourceName,
    orderedQty: Number(item.quantity),
    acceptedQty: Number(item.acceptedQty || 0),
    currentTemplateId: row.objectLimitTemplateId,
    ...picks
  });
});

receiptRequestsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : undefined;
  if (warehouseId) {
    try {
      assertWarehouseInScope(scope, warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
  }
  const rows = await prisma.receiptRequest.findMany({
    where: {
      ...(warehouseId ? { warehouseId } : {}),
      ...(section ? { section } : {})
    },
    include: {
      items: { include: { mappedMaterial: { select: { id: true, name: true, unit: true } } } },
      limitTemplate: { select: { id: true, title: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  return res.json(rows);
});

receiptRequestsRouter.post(
  "/:id/accept",
  requirePermission("operations.write"),
  upload.array("scan", 20),
  async (req: AuthedRequest, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    // Тело может прийти как JSON (Content-Type: application/json) или как multipart (поле "payload" — JSON-строка).
    let bodyRaw: unknown = req.body;
    if (typeof req.body?.payload === "string") {
      try {
        bodyRaw = JSON.parse(req.body.payload);
      } catch {
        return res.status(400).json({ error: "Поле payload должно быть валидным JSON" });
      }
    }
    const parsed = acceptSchema.safeParse(bodyRaw);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }

    const id = String(req.params.id);
    const row = await prisma.receiptRequest.findUnique({ where: { id }, include: { items: true } });
    if (!row) return res.status(404).json({ error: "Request not found" });
    const scope = await getRequestDataScope(req);
    try {
      assertWarehouseInScope(scope, row.warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
    if (row.status === "RECEIVED" || row.status === "CANCELLED") {
      return res.status(400).json({ error: "Заявка уже завершена" });
    }

    // Валидация позиций
    const itemsById = new Map(row.items.map((it) => [it.id, it]));
    for (const m of parsed.data.itemMappings) {
      const it = itemsById.get(m.itemId);
      if (!it) return res.status(400).json({ error: `Позиция ${m.itemId} не найдена в заявке` });
      if (!m.materialId && !m.newMaterialName?.trim()) {
        return res.status(400).json({
          error: `Для «${it.sourceName}» нужно выбрать материал или ввести новое название`
        });
      }
      const remaining = Number(it.quantity) - Number(it.acceptedQty || 0);
      const isOver = m.acceptedQty > remaining + 1e-6;
      if (isOver && !parsed.data.allowOverage) {
        let materialId = m.materialId;
        if (!materialId && m.newMaterialName?.trim()) {
          const found = await prisma.material.findFirst({
            where: { name: m.newMaterialName.trim(), unit: m.newMaterialUnit?.trim() || it.sourceUnit || "шт" }
          });
          materialId = found?.id;
        }
        const picks = await findLimitNodesAcrossWarehouse(
          row.warehouseId,
          materialId || "",
          it.sourceName,
          row.objectLimitTemplateId
        );
        return res.status(409).json({
          error: "RECEIPT_OVERAGE_NEEDS_CONFIRM",
          message: `По «${it.sourceName}» в заявке ${Number(it.quantity)}, осталось ${remaining}, передали ${m.acceptedQty}`,
          itemId: m.itemId,
          orderedQty: Number(it.quantity),
          remainingQty: remaining,
          acceptedQty: m.acceptedQty,
          suggestions: picks
        });
      }
      if (isOver && parsed.data.allowOverage) {
        let materialId = m.materialId;
        if (!materialId && m.newMaterialName?.trim()) {
          const found = await prisma.material.findFirst({
            where: { name: m.newMaterialName.trim(), unit: m.newMaterialUnit?.trim() || it.sourceUnit || "шт" }
          });
          materialId = found?.id;
        }
        const picks = await findLimitNodesAcrossWarehouse(
          row.warehouseId,
          materialId || "",
          it.sourceName,
          row.objectLimitTemplateId
        );
        const hasOther = picks.otherSections.length > 0;
        if (hasOther && !m.limitNodeId) {
          return res.status(409).json({
            error: "RECEIPT_OVERAGE_PICK_LIMIT",
            message: `Превышение по «${it.sourceName}»: выберите раздел лимита для излишка`,
            itemId: m.itemId,
            suggestions: picks
          });
        }
      }
    }

    // Валидация limitNodeId — узел должен принадлежать шаблону этой заявки.
    const proposedNodeIds = parsed.data.itemMappings
      .map((m) => m.limitNodeId)
      .filter((x): x is string => typeof x === "string" && x.length > 0);
    if (proposedNodeIds.length && !row.objectLimitTemplateId) {
      return res.status(400).json({ error: "Заявка не привязана к шаблону лимита" });
    }
    let nodeOwnership = new Map<string, true>();
    if (proposedNodeIds.length && row.objectLimitTemplateId) {
      const nodes = await prisma.objectLimitNode.findMany({
        where: { templateId: row.objectLimitTemplateId, id: { in: proposedNodeIds } },
        select: { id: true }
      });
      nodeOwnership = new Map(nodes.map((n) => [n.id, true as const]));
      const missing = proposedNodeIds.find((nid) => !nodeOwnership.has(nid));
      if (missing) {
        return res.status(400).json({ error: `Узел лимита ${missing} не принадлежит шаблону заявки` });
      }
    }

    const op = await prisma.$transaction(async (tx) => {
      const resolved: Array<{
        item: (typeof row.items)[number];
        materialId: string;
        acceptedQty: number;
        sourceUnit: string;
        limitNodeId: string | null;
      }> = [];
      for (const m of parsed.data.itemMappings) {
        const it = itemsById.get(m.itemId)!;
        const unitHint = m.newMaterialUnit?.trim() || it.sourceUnit || "шт";
        let materialId: string | undefined = m.materialId;
        if (!materialId && m.newMaterialName?.trim()) {
          materialId = await findOrCreateMaterial(tx, m.newMaterialName.trim(), unitHint);
        }
        if (!materialId) {
          throw new Error(`Не удалось определить материал для позиции ${it.sourceName}`);
        }
        resolved.push({
          item: it,
          materialId,
          acceptedQty: m.acceptedQty,
          sourceUnit: unitHint,
          limitNodeId: m.limitNodeId ?? null
        });
      }

      const operation = await tx.operation.create({
        data: {
          type: OperationType.INCOME,
          warehouseId: row.warehouseId,
          section: row.section,
          documentNumber: parsed.data.documentNumber?.trim() || row.number,
          status: "POSTED",
          items: {
            create: resolved.map((r) => ({ materialId: r.materialId, quantity: r.acceptedQty }))
          }
        },
        include: { items: true }
      });

      for (const r of resolved) {
        await tx.receiptRequestItem.update({
          where: { id: r.item.id },
          data: {
            mappedMaterialId: r.materialId,
            // накопительно: уже принятое + только что принятое
            acceptedQty: { increment: r.acceptedQty },
            // Если пользователь выбрал узел шаблона, сохраняем. Иначе оставляем как было.
            ...(r.limitNodeId ? { limitNodeId: r.limitNodeId } : {})
          }
        });
        await tx.stock.upsert({
          where: {
            warehouseId_materialId_section: {
              warehouseId: row.warehouseId,
              materialId: r.materialId,
              section: row.section
            }
          },
          create: {
            warehouseId: row.warehouseId,
            section: row.section,
            materialId: r.materialId,
            quantity: r.acceptedQty,
            reserved: 0
          },
          update: { quantity: { increment: r.acceptedQty } }
        });
        await tx.stockMovement.create({
          data: {
            warehouseId: row.warehouseId,
            materialId: r.materialId,
            quantity: r.acceptedQty,
            direction: StockMovementDirection.IN,
            sourceDocumentType: "OPERATION",
            sourceDocumentId: operation.id,
            operationId: operation.id,
            createdById: req.user!.userId
          }
        });
        await tx.materialMappingLibrary.upsert({
          where: {
            warehouseId_section_sourceName_sourceUnit: {
              warehouseId: row.warehouseId,
              section: row.section,
              sourceName: r.item.sourceName,
              sourceUnit: r.item.sourceUnit || ""
            }
          },
          create: {
            warehouseId: row.warehouseId,
            section: row.section,
            sourceName: r.item.sourceName,
            sourceUnit: r.item.sourceUnit || "",
            targetMaterialId: r.materialId,
            createdById: req.user!.userId
          },
          update: { targetMaterialId: r.materialId }
        });
      }

      // Сохраним опциональные сканы УПД/ТН и прикрепим каждый и к заявке, и к операции.
      for (const f of files) {
        if (!f.buffer || !f.size) continue;
        const displayName = decodeUploadedOriginalName(f.originalname);
        const safe = displayName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storedFileName = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safe}`;
        await fs.promises.writeFile(path.join(uploadDirAbs, storedFileName), f.buffer);
        const checksum = crypto.createHash("sha256").update(f.buffer).digest("hex");
        const filePath = `${config.uploadsDir}/${storedFileName}`.replace(/\\/g, "/");
        await tx.documentFile.create({
          data: {
            groupId: crypto.randomUUID(),
            version: 1,
            entityType: "receipt",
            entityId: row.id,
            type: "upd-scan",
            fileName: displayName,
            filePath,
            mimeType: f.mimetype,
            size: f.size,
            checksumSha256: checksum,
            createdBy: req.user!.userId
          }
        });
        await tx.documentFile.create({
          data: {
            groupId: crypto.randomUUID(),
            version: 1,
            entityType: "operation",
            entityId: operation.id,
            type: "upd-scan",
            fileName: displayName,
            filePath,
            mimeType: f.mimetype,
            size: f.size,
            checksumSha256: checksum,
            createdBy: req.user!.userId
          }
        });
      }

      // Пересчёт статуса: смотрим, есть ли позиции, где осталось принять > 0.
      const fresh = await tx.receiptRequest.findUnique({
        where: { id: row.id },
        include: { items: true }
      });
      let allDone = true;
      let anyAccepted = false;
      for (const it of fresh?.items ?? []) {
        const acc = Number(it.acceptedQty || 0);
        if (acc > 0) anyAccepted = true;
        if (acc + 1e-6 < Number(it.quantity)) {
          allDone = false;
        }
      }
      await tx.receiptRequest.update({
        where: { id: row.id },
        data: {
          status: allDone ? "RECEIVED" : anyAccepted ? "IN_PROGRESS" : row.status,
          acceptedAt: allDone ? new Date() : row.acceptedAt
        }
      });

      const overageActions: Array<{
        itemId: string;
        sourceName: string;
        excessQty: number;
        limitNodeId: string;
        autoCreated: boolean;
        targetPath?: string;
      }> = [];

      for (const r of resolved) {
        const prevAccepted = Number(r.item.acceptedQty || 0);
        const newTotal = prevAccepted + r.acceptedQty;
        const ordered = Number(r.item.quantity);
        if (newTotal <= ordered + 1e-6) continue;

        const excessQty = newTotal - ordered;
        let limitNodeId = r.limitNodeId;
        let autoCreated = false;
        let targetPath: string | undefined;

        const picks = await findLimitNodesAcrossWarehouse(
          row.warehouseId,
          r.materialId,
          r.item.sourceName,
          row.objectLimitTemplateId
        );

        if (!limitNodeId && picks.otherSections.length === 1) {
          limitNodeId = picks.otherSections[0]!.id;
          targetPath = picks.otherSections[0]!.path;
        } else if (!limitNodeId && picks.current.length === 1) {
          limitNodeId = picks.current[0]!.id;
          targetPath = picks.current[0]!.path;
        } else if (!limitNodeId && row.objectLimitTemplateId) {
          const mat = await tx.material.findUnique({
            where: { id: r.materialId },
            select: { name: true, unit: true }
          });
          limitNodeId = await ensureMaterialInCurrentLimitTemplate(
            tx,
            row.objectLimitTemplateId,
            r.materialId,
            mat?.name || r.item.sourceName,
            mat?.unit || r.sourceUnit,
            excessQty
          );
          autoCreated = true;
          targetPath = "текущий раздел лимита (добавлено автоматически)";
        }

        if (limitNodeId) {
          await tx.receiptRequestItem.update({
            where: { id: r.item.id },
            data: { limitNodeId }
          });
        }

        overageActions.push({
          itemId: r.item.id,
          sourceName: r.item.sourceName,
          excessQty,
          limitNodeId: limitNodeId || "",
          autoCreated,
          targetPath
        });
      }

      return {
        operation,
        acceptedItems: resolved.map((r) => ({
          materialId: r.materialId,
          quantity: r.acceptedQty,
          receiptRequestItemId: r.item.id,
          sourceName: r.item.sourceName,
          sourceUnit: r.item.sourceUnit
        })),
        overageActions
      };
    });

    await recordAudit({
      userId: req.user!.userId,
      action: "RECEIPT_REQUEST_ACCEPT",
      entityType: "ReceiptRequest",
      entityId: row.id,
      summary: `Приёмка по заявке ${row.number}: позиций ${op.acceptedItems.length}`,
      after: {
        requestId: row.id,
        operationId: op.operation.id,
        warehouseId: row.warehouseId,
        section: row.section,
        items: op.acceptedItems
      }
    });

    if (row.createdById && row.createdById !== req.user!.userId) {
      await notifyUser({
        userId: row.createdById,
        title: "Приёмка по заявке",
        message: `По заявке ${row.number} оформлен новый приход${parsed.data.documentNumber ? ` (${parsed.data.documentNumber})` : ""}.`,
        level: NotificationLevel.INFO,
        entityType: "ReceiptRequest",
        entityId: row.id,
        eventCode: "RECEIPT_ACCEPTED"
      }).catch(() => undefined);
    }
    // Шинная рассылка по правилам подписки.
    await dispatchNotification({
      eventCode: "RECEIPT_ACCEPTED",
      title: "Приёмка по заявке",
      message: `Заявка ${row.number}: принято позиций ${op.acceptedItems.length}.`,
      entityType: "ReceiptRequest",
      entityId: row.id,
      excludeUserIds: [req.user!.userId, ...(row.createdById ? [row.createdById] : [])]
    }).catch(() => undefined);

    for (const ov of op.overageActions || []) {
      const limitHint = ov.targetPath
        ? `\nЛимит: ${ov.targetPath}${ov.autoCreated ? " (создана позиция)" : ""}`
        : ov.limitNodeId
          ? ""
          : "\nЛимит: не привязан (нет шаблона)";
      void dispatchCriticalNotification({
        warehouseId: row.warehouseId,
        eventCode: "RECEIPT_OVER_ORDER",
        title: "Приход больше заявки",
        message: `Заявка ${row.number}: «${ov.sourceName}» — принято сверх заявки на ${ov.excessQty.toLocaleString("ru-RU")}${limitHint}`,
        entityType: "ReceiptRequest",
        entityId: row.id,
        excludeUserIds: [req.user!.userId]
      }).catch(() => undefined);
    }

    return res.json({
      ok: true,
      operationId: op.operation.id,
      overageActions: op.overageActions || []
    });
  }
);

// Отмена заявки на приход (статус CANCELLED) — нельзя отменить уже принятые заявки без force.
const cancelReceiptSchema = z.object({ reason: z.string().min(1).max(2000) });
const deleteReceiptSchema = z.object({
  reason: z.string().min(1).max(2000),
  force: z.boolean().optional()
});

receiptRequestsRouter.patch(
  "/:id/cancel",
  requirePermission("operations.write"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const parsed = cancelReceiptSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "REASON_REQUIRED", details: parsed.error.flatten() });
    }
    const reason = parsed.data.reason.trim();
    const row = await prisma.receiptRequest.findUnique({ where: { id } });
    if (!row) return res.status(404).json({ error: "Receipt request not found" });
    const scope = await getRequestDataScope(req);
    try {
      assertWarehouseInScope(scope, row.warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
    if (row.status === "CANCELLED") {
      return res.json(row);
    }
    if (row.status === "RECEIVED") {
      return res.status(409).json({
        error: "RECEIPT_ALREADY_DONE",
        hint: "Заявка уже принята полностью — отмена недоступна."
      });
    }
    const updated = await prisma.receiptRequest.update({
      where: { id },
      data: { status: "CANCELLED" }
    });
    await recordAudit({
      userId: req.user!.userId,
      action: "RECEIPT_REQUEST_CANCEL",
      entityType: "ReceiptRequest",
      entityId: id,
      summary: `Заявка на приход ${updated.number} отменена. Причина: ${reason}`,
      before: { status: row.status },
      after: { status: updated.status, reason }
    });
    if (row.createdById) {
      await notifyUser({
        userId: row.createdById,
        title: "Заявка на приход отменена",
        message: `${updated.number}\nПричина: ${reason}`,
        level: NotificationLevel.WARNING,
        entityType: "ReceiptRequest",
        entityId: id,
        eventCode: "RECEIPT_CANCELLED"
      }).catch(() => undefined);
    }
    await dispatchNotification({
      eventCode: "RECEIPT_CANCELLED",
      title: "Заявка на приход отменена",
      message: `${updated.number}\nПричина: ${reason}`,
      entityType: "ReceiptRequest",
      entityId: id,
      excludeUserIds: [req.user!.userId, ...(row.createdById ? [row.createdById] : [])]
    }).catch(() => undefined);
    return res.json(updated);
  }
);

// Удаление заявки на приход. Без force запрещаем удалять уже принятые/частично принятые.
receiptRequestsRouter.delete(
  "/:id",
  requirePermission("operations.write"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const parsed = deleteReceiptSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "REASON_REQUIRED", details: parsed.error.flatten() });
    }
    const reason = parsed.data.reason.trim();
    const wantsForce = Boolean(parsed.data.force);
    const force = wantsForce && req.user?.role === "ADMIN";
    const row = await prisma.receiptRequest.findUnique({
      where: { id },
      include: { items: true }
    });
    if (!row) return res.status(404).json({ error: "Receipt request not found" });
    const scope = await getRequestDataScope(req);
    try {
      assertWarehouseInScope(scope, row.warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
    const anyAccepted = row.items.some((it) => Number(it.acceptedQty || 0) > 0);
    if ((anyAccepted || row.status === "RECEIVED") && !force) {
      return res.status(409).json({
        error: "RECEIPT_HAS_ACCEPTANCE",
        hint:
          "По заявке уже была проведена приёмка. Принудительное удаление доступно только администратору с force=true."
      });
    }
    await prisma.receiptRequest.delete({ where: { id } });
    await recordAudit({
      userId: req.user!.userId,
      action: "RECEIPT_REQUEST_DELETE",
      entityType: "ReceiptRequest",
      entityId: id,
      summary: `Заявка на приход ${row.number} удалена. Причина: ${reason}${force ? " (force, ADMIN)" : ""}`,
      before: {
        number: row.number,
        status: row.status,
        itemsCount: row.items.length,
        anyAccepted,
        reason
      }
    });
    if (row.createdById) {
      await notifyUser({
        userId: row.createdById,
        title: "Заявка на приход удалена",
        message: `${row.number}\nПричина: ${reason}`,
        level: NotificationLevel.WARNING,
        entityType: "ReceiptRequest",
        entityId: id,
        eventCode: "RECEIPT_DELETED"
      }).catch(() => undefined);
    }
    await dispatchNotification({
      eventCode: "RECEIPT_DELETED",
      title: "Заявка на приход удалена",
      message: `${row.number}\nПричина: ${reason}`,
      entityType: "ReceiptRequest",
      entityId: id,
      excludeUserIds: [req.user!.userId, ...(row.createdById ? [row.createdById] : [])]
    }).catch(() => undefined);
    return res.json({ ok: true, force });
  }
);
