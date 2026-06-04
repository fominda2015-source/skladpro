import { NotificationLevel, OperationType, StockCondition, StockMovementDirection, CampItemStatus, type Prisma } from "@prisma/client";
import { receiptCategoryToCampCategory } from "../lib/campCatalog.js";
import { receiptCategoryToToolSection } from "../lib/toolCatalog.js";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { recordAudit } from "../lib/audit.js";
import { assertWarehouseInScope, getRequestDataScope, resolveReadScope } from "../lib/dataScope.js";
import { handlePrismaError } from "../lib/errors.js";
import { dispatchCriticalNotification, dispatchNotification, notifyUser } from "../lib/notifications.js";
import {
  checkLimitPlanOverageForAccept,
  resolvePrimaryReceiptLimitNode
} from "../lib/receiptLimitBinding.js";
import {
  attachMaterialToLimitNode,
  ensureMaterialInCurrentLimitTemplate,
  findLimitNodesAcrossWarehouse,
  resolveMaterialIdForLimitNode,
  resolveReceiptAcceptLimitNode,
  spreadLimitNodePicks
} from "../lib/receiptOverageLimits.js";
import { prisma } from "../lib/prisma.js";
import { materialQtySchema, toQtyNumber } from "../lib/quantity.js";
import {
  isReceiptFullyAccepted,
  isReceiptItemOpen as receiptItemIsOpen,
  plannedQtyForItemClose,
  receiptAcceptedQty,
  receiptCompletionStatus,
  receiptItemRemaining,
  receiptPlannedQty
} from "../lib/receiptQty.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { analyzeCatalogNames, parseOrderSheet } from "../lib/parseOrderSheet.js";
import { findReceiptInvoiceDoc, syncReceiptItemToLimitTemplate } from "../lib/receiptLimitSync.js";
import { decodeUploadedOriginalName } from "../lib/uploadFileName.js";
import { allocateReceiptRequestNumber } from "../lib/allocateReceiptNumber.js";

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

const receiptItemCategorySchema = z.enum([
  "EQUIPMENT",
  "CONSUMABLE",
  "CABLE",
  "TOOL_MANUAL",
  "TOOL_ELECTRIC_CORDLESS",
  "TOOL_ELECTRIC_CORDED",
  "PPE",
  "TOOL_CONSUMABLE",
  "KIP",
  "OTHER"
]);

const acceptItemSchema = z.object({
  itemId: z.string().min(1),
  /** Карточка-«коробка» (номенклатура / лимит); не путать с factLabel. */
  materialId: z.string().optional(),
  /** Наименование по УПД — только для выдачи и справочника соответствий. */
  factLabel: z.string().max(500).optional(),
  factLabelUnit: z.string().max(50).optional(),
  /** Устар.: только создание новой карточки без привязки к лимиту; не подставлять УПД. */
  newMaterialName: z.string().max(500).optional(),
  newMaterialUnit: z.string().max(50).optional(),
  acceptedQty: materialQtySchema,
  // Опциональная привязка к конкретному узлу шаблона лимита (раздел/подраздел).
  // Если в шаблоне один и тот же материал лежит сразу в нескольких узлах,
  // мы спрашиваем пользователя «куда пихаем»; иначе пусто.
  limitNodeId: z.string().min(1).nullable().optional(),
  /** Куда отнести излишек сверх плана лимита в текущем подразделе */
  spreadLimitNodeId: z.string().min(1).nullable().optional(),
  category: receiptItemCategorySchema.nullable().optional(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  storagePlace: z.string().max(200).nullable().optional()
});

const patchReceiptItemSchema = z.object({
  category: receiptItemCategorySchema.nullable().optional(),
  unitPrice: z.number().nonnegative().nullable().optional(),
  storagePlace: z.string().max(200).nullable().optional()
});

const closeReceiptSchema = z.object({ reason: z.string().min(1).max(2000) });

const acceptSchema = z.object({
  itemMappings: z.array(acceptItemSchema).min(1),
  documentNumber: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
  /** Разрешить принять больше, чем осталось по заявке (критическое уведомление + лимиты). */
  allowOverage: z.boolean().optional(),
  /** Превышение плана лимита в подразделе позиции (перерасход или «размазать»). */
  allowLimitOverage: z.boolean().optional(),
  /** Только учёт по заявке — без операции прихода и остатков на складе (только ADMIN). */
  skipWarehouseStock: z.boolean().optional()
});

const limitLinkSchema = z.object({
  fromLimit: z.boolean(),
  objectLimitTemplateId: z.string().nullable().optional()
});

async function saveReceiptDocumentFile(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  opts: {
    receiptId: string;
    type: string;
    file: Express.Multer.File;
    userId: string;
  }
) {
  const safe = opts.file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storedFileName = `${Date.now()}_${safe}`;
  await fs.promises.writeFile(path.join(uploadDirAbs, storedFileName), opts.file.buffer);
  await tx.documentFile.create({
    data: {
      groupId: crypto.randomUUID(),
      version: 1,
      entityType: "receipt",
      entityId: opts.receiptId,
      type: opts.type,
      fileName: decodeUploadedOriginalName(opts.file.originalname),
      filePath: `${config.uploadsDir}/${storedFileName}`.replace(/\\/g, "/"),
      mimeType: opts.file.mimetype,
      size: opts.file.size,
      checksumSha256: crypto.createHash("sha256").update(opts.file.buffer).digest("hex"),
      createdBy: opts.userId
    }
  });
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

type ReceiptAcceptTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function upsertWarehouseMaterialMapping(
  tx: ReceiptAcceptTx,
  opts: {
    warehouseId: string;
    section: "SS" | "EOM";
    sourceName: string;
    sourceUnit: string;
    targetMaterialId: string;
    createdById: string;
  }
) {
  const sourceName = opts.sourceName.trim();
  if (!sourceName) return;
  const sourceUnit = opts.sourceUnit.trim() || "шт";
  await tx.materialMappingLibrary.upsert({
    where: {
      warehouseId_section_sourceName_sourceUnit: {
        warehouseId: opts.warehouseId,
        section: opts.section,
        sourceName,
        sourceUnit
      }
    },
    create: {
      warehouseId: opts.warehouseId,
      section: opts.section,
      sourceName,
      sourceUnit,
      targetMaterialId: opts.targetMaterialId,
      createdById: opts.createdById
    },
    update: { targetMaterialId: opts.targetMaterialId }
  });
}

/** Карточка материала = номенклатура из заявки/лимита, не наименование по УПД. */
async function resolveReceiptTargetMaterialId(
  tx: ReceiptAcceptTx,
  item: { sourceName: string; sourceUnit: string; mappedMaterialId: string | null; limitNodeId: string | null },
  mapping: { materialId?: string; newMaterialName?: string }
): Promise<string | undefined> {
  if (item.limitNodeId) {
    const fromNode = await resolveMaterialIdForLimitNode(tx, item.limitNodeId);
    if (fromNode) return fromNode;
  }
  if (mapping.materialId) return mapping.materialId;
  if (item.mappedMaterialId) return item.mappedMaterialId;
  const cardName = item.sourceName.trim();
  if (cardName) {
    return findOrCreateMaterial(tx, cardName, item.sourceUnit || "шт");
  }
  const legacyName = mapping.newMaterialName?.trim();
  if (legacyName) {
    return findOrCreateMaterial(tx, legacyName, item.sourceUnit || "шт");
  }
  return undefined;
}

function receiptAcceptFactLabel(
  mapping: { factLabel?: string; newMaterialName?: string },
  item: { sourceName: string },
  cardName: string
): string | null {
  const raw = (mapping.factLabel ?? "").trim() || (mapping.newMaterialName ?? "").trim();
  if (!raw) return null;
  const canon = cardName.trim();
  const limitName = item.sourceName.trim();
  if (raw === canon || raw === limitName) return null;
  return raw;
}

async function resolveReceiptItemMaterialIdForOverage(
  it: {
    sourceName: string;
    sourceUnit: string;
    mappedMaterialId: string | null;
    limitNodeId: string | null;
  },
  mappingMaterialId?: string
): Promise<string> {
  if (mappingMaterialId) return mappingMaterialId;
  if (it.limitNodeId) {
    const fromNode = await resolveMaterialIdForLimitNode(prisma, it.limitNodeId);
    if (fromNode) return fromNode;
  }
  if (it.mappedMaterialId) return it.mappedMaterialId;
  const found = await prisma.material.findFirst({
    where: { name: it.sourceName.trim(), unit: it.sourceUnit || "шт" }
  });
  return found?.id || "";
}

async function buildSpreadLimitSuggestions(
  row: { warehouseId: string; objectLimitTemplateId: string | null },
  it: {
    id: string;
    sourceName: string;
    sourceUnit: string;
    mappedMaterialId: string | null;
    limitNodeId: string | null;
    limitSectionPath: string | null;
    limitCatalogNameN: string | null;
    limitCatalogNameO: string | null;
    acceptedQty: unknown;
  },
  mapping: { limitNodeId?: string | null; materialId?: string }
) {
  const materialId = await resolveReceiptItemMaterialIdForOverage(it, mapping.materialId);
  const itemRef = {
    id: it.id,
    sourceName: it.sourceName,
    mappedMaterialId: it.mappedMaterialId,
    limitNodeId: mapping.limitNodeId ?? it.limitNodeId,
    limitSectionPath: it.limitSectionPath,
    limitCatalogNameN: it.limitCatalogNameN,
    limitCatalogNameO: it.limitCatalogNameO,
    acceptedQty: it.acceptedQty
  };
  let primaryNodeId: string | null = null;
  let primaryPath = "";
  if (row.objectLimitTemplateId) {
    const allTree = await prisma.objectLimitNode.findMany({
      where: { templateId: row.objectLimitTemplateId },
      select: {
        id: true,
        parentId: true,
        nodeType: true,
        title: true,
        materialName: true,
        indexLabel: true,
        materialId: true,
        plannedQty: true
      }
    });
    const materialNodes = allTree.filter((n) => n.nodeType === "MATERIAL");
    const primary = resolvePrimaryReceiptLimitNode(allTree, materialNodes, itemRef);
    primaryNodeId = primary?.id ?? null;
  }
  const picks = await findLimitNodesAcrossWarehouse(
    row.warehouseId,
    materialId,
    it.sourceName,
    row.objectLimitTemplateId
  );
  const spread = spreadLimitNodePicks(picks, primaryNodeId);
  if (primaryNodeId) {
    const hit = [...picks.current, ...picks.otherSections].find((p) => p.id === primaryNodeId);
    primaryPath = hit?.path || "";
  }
  return {
    primaryNodeId,
    primaryPath,
    suggestions: {
      current: primaryNodeId && primaryPath ? [{ id: primaryNodeId, path: primaryPath }] : [],
      otherSections: spread.map((p) => ({ id: p.id, path: p.path }))
    }
  };
}

const receiptRequestInclude = {
  items: {
    orderBy: { createdAt: "asc" as const },
    include: { mappedMaterial: { select: { id: true, name: true, unit: true } } }
  },
  limitTemplate: { select: { id: true, title: true } }
} as const;

type ReceiptRequestWithRelations = Prisma.ReceiptRequestGetPayload<{ include: typeof receiptRequestInclude }>;

function serializeReceiptRequest(row: ReceiptRequestWithRelations) {
  const items = row.items.map((it) => ({
    ...it,
    quantity: receiptPlannedQty(it.quantity),
    acceptedQty: receiptAcceptedQty(it.acceptedQty),
    unitPrice: toQtyNumber(it.unitPrice)
  }));
  if (row.status === "CANCELLED") {
    return { ...row, status: row.status, items };
  }
  const hasOpenItems = items.some((it) => receiptItemIsOpen(it));
  const anyAccepted = items.some((it) => receiptAcceptedQty(it.acceptedQty) > 0);
  let status: ReceiptRequestWithRelations["status"] = row.status;
  if (!hasOpenItems) {
    status = "RECEIVED";
  } else if (status === "RECEIVED") {
    status = anyAccepted ? "IN_PROGRESS" : "NEW";
  } else if (status === "NEW" && anyAccepted) {
    status = "IN_PROGRESS";
  }
  return {
    ...row,
    status,
    items
  };
}

async function loadSerializedReceiptRequest(id: string) {
  await reconcileReceiptRequestStatus(id);
  const row = await prisma.receiptRequest.findUnique({
    where: { id },
    include: receiptRequestInclude
  });
  return row ? serializeReceiptRequest(row) : null;
}

type ReceiptTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function completeAllReceiptItems(
  receiptId: string,
  items: Array<{ id: string; quantity: unknown }>,
  tx: ReceiptTx | typeof prisma = prisma
) {
  for (const it of items) {
    await tx.receiptRequestItem.update({
      where: { id: it.id },
      data: { acceptedQty: plannedQtyForItemClose(it) }
    });
  }
  await tx.receiptRequest.update({
    where: { id: receiptId },
    data: { status: "RECEIVED", acceptedAt: new Date() }
  });
}

async function reconcileReceiptRequestStatus(receiptId: string, tx: ReceiptTx | typeof prisma = prisma) {
  const row = await tx.receiptRequest.findUnique({
    where: { id: receiptId },
    include: { items: true }
  });
  if (!row || row.status === "CANCELLED") return row;
  const next = receiptCompletionStatus(row, row.items);
  if (next.status === row.status) return row;
  if (next.status === "RECEIVED") {
    await completeAllReceiptItems(receiptId, row.items, tx);
    return tx.receiptRequest.findUnique({
      where: { id: receiptId },
      include: { items: true }
    });
  }
  return tx.receiptRequest.update({
    where: { id: receiptId },
    data: {
      status: next.status,
      acceptedAt: row.acceptedAt
    },
    include: { items: true }
  });
}

function receiptRequestHasOpenItems(row: {
  status: ReceiptRequestWithRelations["status"];
  items: Array<{ quantity: number; acceptedQty: number | null }>;
}): boolean {
  if (row.status === "CANCELLED" || row.status === "RECEIVED") return false;
  return row.items.some((it) => receiptItemIsOpen(it));
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

    const warehouse = await prisma.warehouse.findUnique({
      where: { id: parsed.data.warehouseId },
      select: { id: true, name: true }
    });
    if (!warehouse) {
      return res.status(400).json({
        error: "WAREHOUSE_NOT_FOUND",
        message: "Объект не найден. Выберите конкретный склад в шапке (не «Все объекты»)."
      });
    }

    let parsedSheet;
    try {
      parsedSheet = parseOrderSheet(req.file.buffer);
    } catch (e) {
      console.error("parseOrderSheet failed:", e);
      return res.status(400).json({
        error: "INVALID_EXCEL",
        message: "Не удалось прочитать Excel. Проверьте формат файла (.xlsx)."
      });
    }

    const { items, orderNumber, projectTitle, format: sheetFormat } = parsedSheet;
    if (!items.length) {
      return res.status(400).json({
        error: "EMPTY_SHEET",
        message:
          "В файле не найдена таблица позиций (Товар, Количество; для нового формата — колонки L, M, N, O)"
      });
    }

    const sourceFileName = decodeUploadedOriginalName(req.file.originalname);
    const objectWhere = { warehouseId: parsed.data.warehouseId };

    let receiptNumber: string;
    let externalOrderNumber: string | null;
    try {
      const allocated = await allocateReceiptRequestNumber(parsed.data.warehouseId, orderNumber);
      receiptNumber = allocated.number;
      externalOrderNumber = allocated.externalOrderNumber;
    } catch {
      return res.status(500).json({ error: "Не удалось выделить номер заявки" });
    }

    const dupByFile = await prisma.receiptRequest.findFirst({
      where: {
        ...objectWhere,
        sourceFileName: { equals: sourceFileName, mode: "insensitive" }
      },
      select: { id: true, number: true, sourceFileName: true }
    });
    if (dupByFile) {
      return res.status(409).json({
        error: "DUPLICATE_FILE",
        message: `Файл «${sourceFileName}» уже загружался на этом объекте (заявка ${dupByFile.number}).`
      });
    }

    try {
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
            number: receiptNumber,
            externalOrderNumber,
            warehouseId: parsed.data.warehouseId,
            section: parsed.data.section,
            sourceFileName,
            createdById: req.user!.userId,
            fromLimit: fromLimitFlag,
            objectLimitTemplateId: attachedTemplateId ?? null,
            items: {
              create: items.map((i) => ({
                sourceName: i.namePartC,
                sourceUnit: i.unit,
                quantity: i.quantity,
                category: i.category,
                limitSectionPath: i.limitSectionPath,
                namePartD: i.namePartD || null,
                namePartE: i.namePartE || null,
                limitCatalogNameN: i.limitCatalogNameN,
                limitCatalogNameO: i.limitCatalogNameO,
                externalComment: i.externalComment,
                limitNameRenamed: false
              }))
            }
          },
          include: { items: true, limitTemplate: { select: { id: true, title: true } } }
        });

        if (attachedTemplateId) {
          for (let idx = 0; idx < receipt.items.length; idx += 1) {
            const item = receipt.items[idx]!;
            const src = items[idx];
            if (!src) continue;
            const sync = await syncReceiptItemToLimitTemplate(tx, attachedTemplateId, src);
            if (sync.limitNodeId || sync.limitNameRenamed) {
              const mappedMaterialId = sync.limitNodeId
                ? await resolveMaterialIdForLimitNode(tx, sync.limitNodeId)
                : null;
              await tx.receiptRequestItem.update({
                where: { id: item.id },
                data: {
                  limitNodeId: sync.limitNodeId,
                  limitNameRenamed: sync.limitNameRenamed,
                  ...(mappedMaterialId ? { mappedMaterialId } : {})
                }
              });
            }
          }
        }

        await saveReceiptDocumentFile(tx, {
          receiptId: receipt.id,
          type: "receipt-request",
          file: req.file!,
          userId: req.user!.userId
        });

        return tx.receiptRequest.findUniqueOrThrow({
          where: { id: receipt.id },
          include: { items: true, limitTemplate: { select: { id: true, title: true } } }
        });
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
        detectedProjectTitle: projectTitle || null,
        sheetFormat
      });
    } catch (e) {
      console.error("receipt upload failed:", e);
      const mapped = handlePrismaError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  }
);

receiptRequestsRouter.post(
  "/:id/invoice",
  requirePermission("operations.write"),
  upload.single("file"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    if (!req.file?.buffer) return res.status(400).json({ error: "file is required" });
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
    await prisma.$transaction(async (tx) => {
      await saveReceiptDocumentFile(tx, {
        receiptId: id,
        type: "receipt-invoice",
        file: req.file!,
        userId: req.user!.userId
      });
    });
    const doc = await findReceiptInvoiceDoc(id);
    return res.status(201).json(doc);
  }
);

receiptRequestsRouter.get("/:id/invoice", async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
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
  const doc = await findReceiptInvoiceDoc(id);
  if (!doc) return res.status(404).json({ error: "INVOICE_NOT_FOUND" });
  return res.json(doc);
});

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
    const updated = await prisma.$transaction(async (tx) => {
      const rowUpd = await tx.receiptRequest.update({
        where: { id },
        data: {
          fromLimit: parsed.data.fromLimit,
          objectLimitTemplateId: parsed.data.fromLimit ? nextTemplateId : null
        },
        include: { items: true }
      });

      if (parsed.data.fromLimit && nextTemplateId) {
        for (const item of rowUpd.items) {
          const meta = analyzeCatalogNames(
            item.sourceName,
            item.namePartD || "",
            item.namePartE || "",
            item.limitCatalogNameN || "",
            item.limitCatalogNameO || "",
            item.externalComment || ""
          );
          const sync = await syncReceiptItemToLimitTemplate(tx, nextTemplateId, {
            limitSectionPath: item.limitSectionPath,
            namePartC: item.sourceName,
            limitCatalogNameN: item.limitCatalogNameN,
            limitCatalogNameO: item.limitCatalogNameO,
            renameLimitToO: meta.renameLimitToO,
            limitDisplayName: meta.limitDisplayName,
            nameAlertNote: meta.nameAlertNote
          });
          if (sync.limitNodeId) {
            const mappedMaterialId = await resolveMaterialIdForLimitNode(tx, sync.limitNodeId);
            await tx.receiptRequestItem.update({
              where: { id: item.id },
              data: {
                limitNodeId: sync.limitNodeId,
                limitNameRenamed: sync.limitNameRenamed,
                ...(mappedMaterialId ? { mappedMaterialId } : {})
              }
            });
          }
        }
      }

      return tx.receiptRequest.findUniqueOrThrow({
        where: { id },
        include: {
          items: { include: { mappedMaterial: { select: { id: true, name: true, unit: true } } } },
          limitTemplate: { select: { id: true, title: true } }
        }
      });
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
      nodeType: true,
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
    select: { id: true, parentId: true, title: true, indexLabel: true, nodeType: true, materialName: true }
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
  const result = row.items.map((it) => {
    const primary = resolvePrimaryReceiptLimitNode(allNodes, nodes, {
      id: it.id,
      sourceName: it.sourceName,
      mappedMaterialId: it.mappedMaterialId,
      limitNodeId: it.limitNodeId,
      limitSectionPath: it.limitSectionPath,
      limitCatalogNameN: it.limitCatalogNameN,
      limitCatalogNameO: it.limitCatalogNameO,
      acceptedQty: it.acceptedQty
    });
    const node = primary ? nodes.find((n) => n.id === primary.id) : undefined;
    const suggestions = node
      ? [
          {
            id: node.id,
            title: node.title,
            indexLabel: node.indexLabel,
            path: pathFor(node.id),
            plannedQty: node.plannedQty != null ? Number(node.plannedQty) : null,
            issuedQty: node.issuedQty != null ? Number(node.issuedQty) : 0,
            unit: node.unit
          }
        ]
      : [];
    return {
      itemId: it.id,
      currentLimitNodeId: primary?.id ?? it.limitNodeId ?? null,
      suggestions
    };
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
  const spreadInfo = await buildSpreadLimitSuggestions(row, item, {
    limitNodeId: item.limitNodeId,
    materialId: materialIdQ || item.mappedMaterialId || undefined
  });
  return res.json({
    itemId: item.id,
    sourceName: item.sourceName,
    orderedQty: receiptPlannedQty(item.quantity),
    acceptedQty: receiptAcceptedQty(item.acceptedQty),
    currentTemplateId: row.objectLimitTemplateId,
    primaryNodeId: spreadInfo.primaryNodeId,
    primaryPath: spreadInfo.primaryPath,
    ...spreadInfo.suggestions
  });
});

receiptRequestsRouter.get("/", async (req: AuthedRequest, res) => {
  const warehouseId = typeof req.query.warehouseId === "string" ? req.query.warehouseId : undefined;
  const scope = await resolveReadScope(req, { warehouseId });
  const sectionRaw = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionRaw === "SS" || sectionRaw === "EOM" ? sectionRaw : undefined;
  const openOnly = req.query.openOnly === "1" || req.query.openOnly === "true";
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
      ...(section ? { section } : {}),
      ...(openOnly
        ? {
            status: { notIn: ["RECEIVED", "CANCELLED"] }
          }
        : {})
    },
    include: receiptRequestInclude,
    orderBy: { createdAt: "desc" },
    take: 100
  });
  let list = rows;
  const stale = rows.filter(
    (row) => row.status !== "CANCELLED" && row.status !== "RECEIVED" && isReceiptFullyAccepted(row.items)
  );
  if (stale.length) {
    await Promise.all(stale.map((row) => reconcileReceiptRequestStatus(row.id)));
    list = await prisma.receiptRequest.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      include: receiptRequestInclude,
      orderBy: { createdAt: "desc" }
    });
  }
  const serialized = list.map(serializeReceiptRequest);
  const filtered = openOnly ? serialized.filter(receiptRequestHasOpenItems) : serialized;
  return res.json(filtered);
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
    if (parsed.data.skipWarehouseStock && req.user?.role !== "ADMIN") {
      return res.status(403).json({ error: "Принять без склада может только администратор" });
    }

    // Валидация позиций
    const itemsById = new Map(row.items.map((it) => [it.id, it]));
    for (const m of parsed.data.itemMappings) {
      const it = itemsById.get(m.itemId);
      if (!it) return res.status(400).json({ error: `Позиция ${m.itemId} не найдена в заявке` });
      const canResolveCard =
        Boolean(m.materialId) ||
        Boolean(it.mappedMaterialId) ||
        Boolean(it.limitNodeId) ||
        Boolean(it.sourceName.trim()) ||
        Boolean(m.newMaterialName?.trim());
      if (!canResolveCard) {
        return res.status(400).json({
          error: `Для «${it.sourceName}» не удалось определить номенклатуру карточки`
        });
      }
      const remaining = receiptItemRemaining(it);
      if (remaining <= 0 && !parsed.data.allowOverage) {
        return res.status(400).json({
          error: `Позиция «${it.sourceName}» уже принята полностью`
        });
      }
      const bindLimitNodeId = m.limitNodeId ?? it.limitNodeId ?? null;

      if (row.objectLimitTemplateId && !parsed.data.allowLimitOverage) {
        const allTree = await prisma.objectLimitNode.findMany({
          where: { templateId: row.objectLimitTemplateId },
          select: { id: true, parentId: true, title: true, indexLabel: true }
        });
        type PathNode = { id: string; parentId: string | null; title: string; indexLabel: string | null };
        const nodeById = new Map<string, PathNode>(allTree.map((n) => [n.id, n]));
        const pathFor = (nodeId: string) => {
          const parts: string[] = [];
          let cur: string | null = nodeId;
          for (let guard = 0; guard < 64 && cur && nodeById.has(cur); guard += 1) {
            const pathNode: PathNode = nodeById.get(cur)!;
            const label = [pathNode.indexLabel, pathNode.title].filter(Boolean).join(" ").trim();
            if (label) parts.unshift(label);
            cur = pathNode.parentId;
          }
          return parts.join(" / ");
        };
        const limitOver = await checkLimitPlanOverageForAccept(
          prisma,
          row.objectLimitTemplateId,
          {
            id: it.id,
            sourceName: it.sourceName,
            mappedMaterialId: it.mappedMaterialId,
            limitNodeId: bindLimitNodeId,
            limitSectionPath: it.limitSectionPath,
            limitCatalogNameN: it.limitCatalogNameN,
            limitCatalogNameO: it.limitCatalogNameO,
            acceptedQty: it.acceptedQty
          },
          m.acceptedQty,
          pathFor
        );
        if (limitOver) {
          const spreadInfo = await buildSpreadLimitSuggestions(row, it, {
            limitNodeId: bindLimitNodeId,
            materialId: m.materialId
          });
          const spread = spreadInfo.suggestions.otherSections;
          if (spread.length > 0 && !m.spreadLimitNodeId) {
            return res.status(409).json({
              error: "RECEIPT_LIMIT_OVERAGE_PICK",
              kind: "limit_plan",
              message: `По «${it.sourceName}» в подразделе «${limitOver.primaryPath}» план ${limitOver.plannedQty}, уже ${limitOver.receivedOnNode}, принимаете ${m.acceptedQty} — выберите, куда отнести излишек ${limitOver.excessQty}`,
              itemId: m.itemId,
              ...limitOver,
              suggestions: spreadInfo.suggestions
            });
          }
          if (!spread.length) {
            return res.status(409).json({
              error: "RECEIPT_LIMIT_OVERAGE_CONFIRM",
              kind: "limit_plan",
              message: `По «${it.sourceName}» в подразделе «${limitOver.primaryPath}» превышение плана на ${limitOver.excessQty} — в других разделах лимита материал не найден`,
              itemId: m.itemId,
              ...limitOver,
              suggestions: spreadInfo.suggestions
            });
          }
        }
      }

      const isOver = m.acceptedQty > remaining;
      if (isOver && !parsed.data.allowOverage) {
        const spreadInfo = await buildSpreadLimitSuggestions(row, it, {
          limitNodeId: bindLimitNodeId,
          materialId: m.materialId
        });
        return res.status(409).json({
          error: "RECEIPT_OVERAGE_NEEDS_CONFIRM",
          kind: "receipt_order",
          message: `По «${it.sourceName}» в заявке ${receiptPlannedQty(it.quantity)}, осталось ${remaining}, передали ${m.acceptedQty}`,
          itemId: m.itemId,
          orderedQty: receiptPlannedQty(it.quantity),
          remainingQty: remaining,
          acceptedQty: m.acceptedQty,
          suggestions: spreadInfo.suggestions
        });
      }
      if (isOver && parsed.data.allowOverage && !m.spreadLimitNodeId) {
        const spreadInfo = await buildSpreadLimitSuggestions(row, it, {
          limitNodeId: bindLimitNodeId,
          materialId: m.materialId
        });
        if (spreadInfo.suggestions.otherSections.length > 0) {
          return res.status(409).json({
            error: "RECEIPT_OVERAGE_PICK_LIMIT",
            kind: "receipt_order",
            message: `Превышение по «${it.sourceName}»: выберите раздел лимита для излишка`,
            itemId: m.itemId,
            suggestions: spreadInfo.suggestions
          });
        }
      }
    }

    // Валидация limitNodeId — узел должен принадлежать шаблону этой заявки.
    const proposedNodeIds = parsed.data.itemMappings
      .flatMap((m) => [m.limitNodeId, m.spreadLimitNodeId])
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

    try {
    const op = await prisma.$transaction(async (tx) => {
      const resolved: Array<{
        item: (typeof row.items)[number];
        materialId: string | null;
        acceptedQty: number;
        sourceUnit: string;
        limitNodeId: string | null;
        campCategory: ReturnType<typeof receiptCategoryToCampCategory>;
      }> = [];
      for (const m of parsed.data.itemMappings) {
        const it = itemsById.get(m.itemId)!;
        const unitHint = m.newMaterialUnit?.trim() || m.factLabelUnit?.trim() || it.sourceUnit || "шт";
        const itemCategory = m.category ?? it.category ?? null;
        const campCategory = receiptCategoryToCampCategory(itemCategory);
        const remainingBefore = receiptItemRemaining(it);
        const acceptedQty = parsed.data.allowOverage ? m.acceptedQty : Math.min(m.acceptedQty, remainingBefore);
        if (acceptedQty <= 0) continue;
        let materialId: string | undefined;
        if (!campCategory) {
          materialId = await resolveReceiptTargetMaterialId(tx, it, m);
          if (!materialId) {
            throw new Error(`Не удалось определить материал для позиции ${it.sourceName}`);
          }
        }
        resolved.push({
          item: it,
          materialId: materialId ?? null,
          acceptedQty,
          sourceUnit: unitHint,
          limitNodeId: m.limitNodeId ?? null,
          campCategory
        });
      }

      if (!resolved.length) {
        throw new Error("Нет позиций для приёмки — возможно, выбранные строки уже приняты полностью");
      }

      const stockResolved = parsed.data.skipWarehouseStock
        ? []
        : resolved.filter((r) => !r.campCategory && r.materialId);
      const operation =
        stockResolved.length > 0
          ? await tx.operation.create({
              data: {
                type: OperationType.INCOME,
                warehouseId: row.warehouseId,
                section: row.section,
                documentNumber: parsed.data.documentNumber?.trim() || row.number,
                status: "POSTED",
                items: {
                  create: stockResolved.map((r) => ({
                    materialId: r.materialId!,
                    quantity: r.acceptedQty
                  }))
                }
              },
              include: { items: true }
            })
          : null;

      for (const r of resolved) {
        const mapping = parsed.data.itemMappings.find((m) => m.itemId === r.item.id);
        const itemCategory = mapping?.category ?? r.item.category ?? null;
        const campCategory = r.campCategory ?? receiptCategoryToCampCategory(itemCategory);

        let limitNodeId = r.limitNodeId ?? r.item.limitNodeId ?? null;
        let cardName = r.item.sourceName;
        if (!campCategory && r.materialId) {
          const matRow = await tx.material.findUnique({
            where: { id: r.materialId },
            select: { name: true }
          });
          if (matRow?.name) cardName = matRow.name;
        }
        const factLabel =
          mapping && !campCategory && r.materialId
            ? receiptAcceptFactLabel(mapping, r.item, cardName)
            : null;
        const factUnit =
          factLabel != null
            ? (mapping?.factLabelUnit?.trim() || mapping?.newMaterialUnit?.trim() || r.sourceUnit || "шт")
            : null;

        if (!campCategory && row.objectLimitTemplateId && r.materialId) {
          limitNodeId = await resolveReceiptAcceptLimitNode(tx, row.objectLimitTemplateId, r.item, {
            explicitLimitNodeId: mapping?.limitNodeId ?? null,
            materialId: r.materialId,
            materialName: cardName,
            acceptedQty: r.acceptedQty
          });
          r.limitNodeId = limitNodeId;
        } else if (!campCategory && limitNodeId && r.materialId) {
          await attachMaterialToLimitNode(tx, limitNodeId, r.materialId);
        }

        await tx.receiptRequestItem.update({
          where: { id: r.item.id },
          data: {
            mappedMaterialId: campCategory ? null : r.materialId,
            acceptedQty: { increment: r.acceptedQty },
            ...(limitNodeId ? { limitNodeId } : {}),
            ...(factLabel ? { factLabel, factUnit: factUnit || r.sourceUnit } : {}),
            ...(mapping?.category !== undefined ? { category: mapping.category } : {}),
            ...(mapping?.unitPrice !== undefined ? { unitPrice: mapping.unitPrice } : {}),
            ...(mapping?.storagePlace !== undefined ? { storagePlace: mapping.storagePlace } : {})
          }
        });

        if (campCategory) {
          const qty = Math.max(1, Math.round(r.acceptedQty));
          for (let i = 0; i < qty; i++) {
            const suffix = qty > 1 ? ` (${i + 1}/${qty})` : "";
            const campRow = await tx.campItem.create({
              data: {
                name: `${r.item.sourceName.trim()}${suffix}`,
                category: campCategory,
                warehouseId: row.warehouseId,
                section: row.section,
                status: CampItemStatus.IN_USE,
                acquiredAt: new Date(),
                createdById: req.user!.userId,
                description: `Принято по заявке ${row.number}`
              }
            });
            await tx.auditLog.create({
              data: {
                userId: req.user!.userId,
                action: "CAMP_ITEM_CREATE",
                entityType: "CampItem",
                entityId: campRow.id,
                summary: `Принято по заявке ${row.number}: ${campRow.name}`,
                afterData: campRow as unknown as Prisma.InputJsonValue
              }
            });
          }
          continue;
        }

        if (!r.materialId) continue;

        const toolSection = receiptCategoryToToolSection(itemCategory);
        if (toolSection) {
          await tx.material.update({
            where: { id: r.materialId },
            data: { toolCatalogSection: toolSection }
          });
        }
        if (!operation || parsed.data.skipWarehouseStock) continue;
        await tx.stock.upsert({
          where: {
            warehouseId_materialId_section_condition: {
              warehouseId: row.warehouseId,
              materialId: r.materialId,
              section: row.section,
              condition: StockCondition.NEW
            }
          },
          create: {
            warehouseId: row.warehouseId,
            section: row.section,
            materialId: r.materialId,
            condition: StockCondition.NEW,
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
        await upsertWarehouseMaterialMapping(tx, {
          warehouseId: row.warehouseId,
          section: row.section,
          sourceName: r.item.sourceName,
          sourceUnit: r.item.sourceUnit || "",
          targetMaterialId: r.materialId,
          createdById: req.user!.userId
        });
        if (factLabel) {
          await upsertWarehouseMaterialMapping(tx, {
            warehouseId: row.warehouseId,
            section: row.section,
            sourceName: factLabel,
            sourceUnit: factUnit || r.sourceUnit || "шт",
            targetMaterialId: r.materialId,
            createdById: req.user!.userId
          });
        }

        if (row.objectLimitTemplateId && r.materialId && r.limitNodeId && mapping) {
          const allTree = await tx.objectLimitNode.findMany({
            where: { templateId: row.objectLimitTemplateId },
            select: { id: true, parentId: true, title: true, indexLabel: true }
          });
          type PathNode = { id: string; parentId: string | null; title: string; indexLabel: string | null };
          const nodeById = new Map<string, PathNode>(allTree.map((n) => [n.id, n]));
          const pathFor = (nodeId: string) => {
            const parts: string[] = [];
            let cur: string | null = nodeId;
            for (let guard = 0; guard < 64 && cur && nodeById.has(cur); guard += 1) {
              const pathNode: PathNode = nodeById.get(cur)!;
              const label = [pathNode.indexLabel, pathNode.title].filter(Boolean).join(" ").trim();
              if (label) parts.unshift(label);
              cur = pathNode.parentId;
            }
            return parts.join(" / ");
          };
          const limitOver = await checkLimitPlanOverageForAccept(
            tx,
            row.objectLimitTemplateId,
            {
              id: r.item.id,
              sourceName: r.item.sourceName,
              mappedMaterialId: r.materialId,
              limitNodeId: r.limitNodeId,
              limitSectionPath: r.item.limitSectionPath,
              limitCatalogNameN: r.item.limitCatalogNameN,
              limitCatalogNameO: r.item.limitCatalogNameO,
              acceptedQty: r.item.acceptedQty
            },
            r.acceptedQty,
            pathFor
          );
          if (limitOver && limitOver.excessQty > 0) {
            const spreadId = mapping.spreadLimitNodeId;
            if (spreadId) {
              await attachMaterialToLimitNode(tx, spreadId, r.materialId);
              const spreadNode = await tx.objectLimitNode.findUnique({
                where: { id: spreadId },
                select: { plannedQty: true }
              });
              const planned = Number(spreadNode?.plannedQty || 0);
              await tx.objectLimitNode.update({
                where: { id: spreadId },
                data: { plannedQty: planned + limitOver.excessQty }
              });
            } else if (parsed.data.allowLimitOverage) {
              const primaryNode = await tx.objectLimitNode.findUnique({
                where: { id: r.limitNodeId },
                select: { plannedQty: true }
              });
              const planned = Number(primaryNode?.plannedQty || 0);
              await tx.objectLimitNode.update({
                where: { id: r.limitNodeId },
                data: { plannedQty: planned + limitOver.excessQty }
              });
            }
          }
        }
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
        if (operation) {
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
      }

      const freshAfterAccept = await tx.receiptRequest.findUnique({
        where: { id: row.id },
        include: { items: true }
      });
      if (freshAfterAccept && isReceiptFullyAccepted(freshAfterAccept.items)) {
        await completeAllReceiptItems(row.id, freshAfterAccept.items, tx);
      } else {
        await reconcileReceiptRequestStatus(row.id, tx);
      }

      const overageActions: Array<{
        itemId: string;
        sourceName: string;
        excessQty: number;
        limitNodeId: string;
        autoCreated: boolean;
        targetPath?: string;
      }> = [];

      for (const r of resolved) {
        if (r.campCategory || !r.materialId) continue;
        const mapping = parsed.data.itemMappings.find((m) => m.itemId === r.item.id);
        const prevAccepted = receiptAcceptedQty(r.item.acceptedQty);
        const newTotal = prevAccepted + r.acceptedQty;
        const ordered = receiptPlannedQty(r.item.quantity);
        if (newTotal <= ordered) continue;

        const excessQty = newTotal - ordered;
        let targetPath: string | undefined;
        let autoCreated = false;

        if (mapping?.spreadLimitNodeId && row.objectLimitTemplateId) {
          await attachMaterialToLimitNode(tx, mapping.spreadLimitNodeId, r.materialId);
          const spreadNode = await tx.objectLimitNode.findUnique({
            where: { id: mapping.spreadLimitNodeId },
            select: { plannedQty: true }
          });
          const planned = Number(spreadNode?.plannedQty || 0);
          await tx.objectLimitNode.update({
            where: { id: mapping.spreadLimitNodeId },
            data: { plannedQty: planned + excessQty }
          });
          const spreadInfo = await buildSpreadLimitSuggestions(row, r.item, {
            limitNodeId: r.limitNodeId,
            materialId: r.materialId ?? undefined
          });
          const hit = spreadInfo.suggestions.otherSections.find((s) => s.id === mapping.spreadLimitNodeId);
          targetPath = hit?.path;
        } else if (parsed.data.allowOverage && r.limitNodeId && row.objectLimitTemplateId) {
          const primaryNode = await tx.objectLimitNode.findUnique({
            where: { id: r.limitNodeId },
            select: { plannedQty: true }
          });
          const planned = Number(primaryNode?.plannedQty || 0);
          await tx.objectLimitNode.update({
            where: { id: r.limitNodeId },
            data: { plannedQty: planned + excessQty }
          });
          const spreadInfo = await buildSpreadLimitSuggestions(row, r.item, {
            limitNodeId: r.limitNodeId,
            materialId: r.materialId ?? undefined
          });
          targetPath = spreadInfo.primaryPath || "текущий подраздел (перерасход по заявке)";
        } else if (!r.limitNodeId && row.objectLimitTemplateId) {
          const mat = await tx.material.findUnique({
            where: { id: r.materialId },
            select: { name: true, unit: true }
          });
          const createdNodeId = await ensureMaterialInCurrentLimitTemplate(
            tx,
            row.objectLimitTemplateId,
            r.materialId,
            mat?.name || r.item.sourceName,
            mat?.unit || r.sourceUnit,
            excessQty
          );
          autoCreated = true;
          targetPath = "текущий раздел лимита (добавлено автоматически)";
          await tx.receiptRequestItem.update({
            where: { id: r.item.id },
            data: { limitNodeId: createdNodeId }
          });
        }

        overageActions.push({
          itemId: r.item.id,
          sourceName: r.item.sourceName,
          excessQty,
          limitNodeId: r.limitNodeId || "",
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
        operationId: op.operation?.id ?? null,
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

    const receiptRequest = await loadSerializedReceiptRequest(row.id);

    return res.json({
      ok: true,
      operationId: op.operation?.id ?? null,
      overageActions: op.overageActions || [],
      receiptRequest
    });
    } catch (e) {
      console.error("receipt accept failed:", e);
      const mapped = handlePrismaError(e);
      return res.status(mapped.status).json(mapped.body);
    }
  }
);

// Ручное закрытие заявки (статус RECEIVED) — для «зависших» после приёмки.
receiptRequestsRouter.patch(
  "/:id/close",
  requirePermission("operations.write"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const parsed = closeReceiptSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "REASON_REQUIRED", details: parsed.error.flatten() });
    }
    const reason = parsed.data.reason.trim();
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
    if (row.status === "RECEIVED") {
      const serialized = await loadSerializedReceiptRequest(id);
      return res.json(serialized);
    }
    if (row.status === "CANCELLED") {
      return res.status(409).json({ error: "Заявка отменена — закрытие недоступно" });
    }
    await prisma.$transaction(async (tx) => {
      await completeAllReceiptItems(id, row.items, tx);
    });
    const updated = await prisma.receiptRequest.findUnique({
      where: { id },
      include: receiptRequestInclude
    });
    if (!updated) return res.status(404).json({ error: "Receipt request not found" });
    await recordAudit({
      userId: req.user!.userId,
      action: "RECEIPT_REQUEST_CLOSE",
      entityType: "ReceiptRequest",
      entityId: id,
      summary: `Заявка на приход ${updated.number} закрыта вручную (ADMIN). Причина: ${reason}`,
      before: { status: row.status },
      after: { status: updated.status, reason }
    });
    if (row.createdById) {
      await notifyUser({
        userId: row.createdById,
        title: "Заявка на приход закрыта",
        message: `${updated.number}\nЗакрыто администратором. Причина: ${reason}`,
        level: NotificationLevel.INFO,
        entityType: "ReceiptRequest",
        entityId: id,
        eventCode: "RECEIPT_CLOSED"
      }).catch(() => undefined);
    }
    await dispatchNotification({
      eventCode: "RECEIPT_CLOSED",
      title: "Заявка на приход закрыта вручную",
      message: `${updated.number}\nПричина: ${reason}`,
      entityType: "ReceiptRequest",
      entityId: id,
      excludeUserIds: [req.user!.userId, ...(row.createdById ? [row.createdById] : [])]
    }).catch(() => undefined);
    return res.json(serializeReceiptRequest(updated));
  }
);

receiptRequestsRouter.patch(
  "/:id/items/:itemId",
  requirePermission("operations.write"),
  async (req: AuthedRequest, res) => {
    const receiptId = String(req.params.id);
    const itemId = String(req.params.itemId);
    const parsed = patchReceiptItemSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    if (
      parsed.data.category === undefined &&
      parsed.data.unitPrice === undefined &&
      parsed.data.storagePlace === undefined
    ) {
      return res.status(400).json({ error: "Nothing to update" });
    }
    const row = await prisma.receiptRequest.findUnique({
      where: { id: receiptId },
      include: { items: { where: { id: itemId } } }
    });
    if (!row || !row.items[0]) {
      return res.status(404).json({ error: "Receipt item not found" });
    }
    if (row.status === "CANCELLED") {
      return res.status(409).json({ error: "Заявка отменена" });
    }
    const scope = await getRequestDataScope(req);
    try {
      assertWarehouseInScope(scope, row.warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
    const updated = await prisma.receiptRequestItem.update({
      where: { id: itemId },
      data: {
        ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
        ...(parsed.data.unitPrice !== undefined ? { unitPrice: parsed.data.unitPrice } : {}),
        ...(parsed.data.storagePlace !== undefined ? { storagePlace: parsed.data.storagePlace } : {})
      },
      include: { mappedMaterial: { select: { id: true, name: true, unit: true } } }
    });
    return res.json(updated);
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
