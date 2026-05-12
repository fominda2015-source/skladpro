import { NotificationLevel, OperationType, StockMovementDirection } from "@prisma/client";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import xlsx from "xlsx";
import { z } from "zod";
import { config } from "../config.js";
import { assertWarehouseInScope, getRequestDataScope } from "../lib/dataScope.js";
import { notifyUser } from "../lib/notifications.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

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
  acceptedQty: z.number().positive()
});

const acceptSchema = z.object({
  itemMappings: z.array(acceptItemSchema).min(1),
  documentNumber: z.string().max(120).optional(),
  note: z.string().max(500).optional()
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
          sourceFileName: req.file!.originalname,
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
          fileName: req.file!.originalname,
          filePath: `${config.uploadsDir}/${storedFileName}`.replace(/\\/g, "/"),
          mimeType: req.file!.mimetype,
          size: req.file!.size,
          checksumSha256: crypto.createHash("sha256").update(req.file!.buffer).digest("hex"),
          createdBy: req.user!.userId
        }
      });

      return receipt;
    });
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
  upload.single("scan"),
  async (req: AuthedRequest, res) => {
    // Тело может прийти как JSON (Content-Type: application/json) или как multipart (поле "payload" — JSON-строка).
    let bodyRaw: unknown = req.body;
    if (req.file && typeof req.body?.payload === "string") {
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
      if (m.acceptedQty > remaining + 1e-6) {
        return res.status(400).json({
          error: `По «${it.sourceName}» осталось принять ${remaining}, передали ${m.acceptedQty}`
        });
      }
    }

    const op = await prisma.$transaction(async (tx) => {
      // На этом приёме формируем по каждой позиции свой materialId (новый или существующий).
      const resolved: Array<{
        item: (typeof row.items)[number];
        materialId: string;
        acceptedQty: number;
        sourceUnit: string;
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
        resolved.push({ item: it, materialId, acceptedQty: m.acceptedQty, sourceUnit: unitHint });
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
            acceptedQty: { increment: r.acceptedQty }
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

      // Сохраним опциональный скан УПД/ТН и прикрепим его к заявке.
      if (req.file && req.file.buffer && req.file.size > 0) {
        const safe = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storedFileName = `${Date.now()}_${safe}`;
        await fs.promises.writeFile(path.join(uploadDirAbs, storedFileName), req.file.buffer);
        await tx.documentFile.create({
          data: {
            groupId: crypto.randomUUID(),
            version: 1,
            entityType: "receipt",
            entityId: row.id,
            type: "upd-scan",
            fileName: req.file.originalname,
            filePath: `${config.uploadsDir}/${storedFileName}`.replace(/\\/g, "/"),
            mimeType: req.file.mimetype,
            size: req.file.size,
            checksumSha256: crypto.createHash("sha256").update(req.file.buffer).digest("hex"),
            createdBy: req.user!.userId
          }
        });
        // и заодно к самой операции, чтобы было видно из истории приходов
        await tx.documentFile.create({
          data: {
            groupId: crypto.randomUUID(),
            version: 1,
            entityType: "operation",
            entityId: operation.id,
            type: "upd-scan",
            fileName: req.file.originalname,
            filePath: `${config.uploadsDir}/${storedFileName}`.replace(/\\/g, "/"),
            mimeType: req.file.mimetype,
            size: req.file.size,
            checksumSha256: crypto.createHash("sha256").update(req.file.buffer).digest("hex"),
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

      return operation;
    });

    if (row.createdById && row.createdById !== req.user!.userId) {
      await notifyUser({
        userId: row.createdById,
        title: "Приёмка по заявке",
        message: `По заявке ${row.number} оформлен новый приход${parsed.data.documentNumber ? ` (${parsed.data.documentNumber})` : ""}.`,
        level: NotificationLevel.INFO,
        entityType: "ReceiptRequest",
        entityId: row.id
      }).catch(() => undefined);
    }
    return res.json({ ok: true, operationId: op.id });
  }
);
