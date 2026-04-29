import { NotificationLevel, OperationType, StockMovementDirection } from "@prisma/client";
import multer from "multer";
import { Router } from "express";
import xlsx from "xlsx";
import { z } from "zod";
import { assertWarehouseInScope, getRequestDataScope } from "../lib/dataScope.js";
import { notifyUser } from "../lib/notifications.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const uploadRequestSchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"])
});

const acceptSchema = z.object({
  itemMappings: z.array(
    z.object({
      itemId: z.string().min(1),
      materialId: z.string().min(1),
      acceptedQty: z.number().positive().optional()
    })
  ),
  documentNumber: z.string().max(120).optional()
});

function parseOrderSheet(file: Buffer) {
  const wb = xlsx.read(file, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json<Record<string, string | number>>(ws, { defval: "" });
  const out: Array<{ name: string; unit: string; quantity: number }> = [];
  for (const row of rows) {
    const entries = Object.entries(row).map(([k, v]) => [k.toLowerCase(), String(v).trim()] as const);
    const name = entries.find(([k]) => k.includes("товар") || k.includes("номенк"))?.[1] || "";
    const unit = entries.find(([k]) => k.includes("ед") || k.includes("изм"))?.[1] || "шт";
    const qtyRaw = (entries.find(([k]) => k.includes("кол"))?.[1] || "").replace(",", ".");
    const quantity = Number(qtyRaw);
    if (name && Number.isFinite(quantity) && quantity > 0) {
      out.push({ name, unit, quantity });
    }
  }
  return out;
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
    const items = parseOrderSheet(req.file.buffer);
    if (!items.length) return res.status(400).json({ error: "No valid rows found in xlsx" });
    const count = await prisma.receiptRequest.count();
    const number = `ORD-${String(count + 1).padStart(5, "0")}`;
    const created = await prisma.receiptRequest.create({
      data: {
        number,
        warehouseId: parsed.data.warehouseId,
        section: parsed.data.section,
        sourceFileName: req.file.originalname,
        createdById: req.user!.userId,
        items: {
          create: items.map((i) => ({
            sourceName: i.name,
            sourceUnit: i.unit,
            quantity: i.quantity
          }))
        }
      },
      include: { items: true }
    });
    return res.status(201).json(created);
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
      items: { include: { mappedMaterial: { select: { id: true, name: true, unit: true } } } }
    },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  return res.json(rows);
});

receiptRequestsRouter.post("/:id/accept", requirePermission("operations.write"), async (req: AuthedRequest, res) => {
  const parsed = acceptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  const id = String(req.params.id);
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
  const mapping = new Map(parsed.data.itemMappings.map((x) => [x.itemId, x]));
  const op = await prisma.$transaction(async (tx) => {
    const operation = await tx.operation.create({
      data: {
        type: OperationType.INCOME,
        warehouseId: row.warehouseId,
        section: row.section,
        documentNumber: parsed.data.documentNumber?.trim() || row.number,
        status: "POSTED",
        items: {
          create: row.items
            .filter((it) => mapping.has(it.id))
            .map((it) => {
              const m = mapping.get(it.id)!;
              return { materialId: m.materialId, quantity: m.acceptedQty ?? Number(it.quantity) };
            })
        }
      },
      include: { items: true }
    });
    for (const it of row.items) {
      const m = mapping.get(it.id);
      if (!m) continue;
      await tx.receiptRequestItem.update({
        where: { id: it.id },
        data: { mappedMaterialId: m.materialId, acceptedQty: m.acceptedQty ?? Number(it.quantity) }
      });
      const qty = m.acceptedQty ?? Number(it.quantity);
      await tx.stock.upsert({
        where: {
          warehouseId_materialId_section: {
            warehouseId: row.warehouseId,
            materialId: m.materialId,
            section: row.section
          }
        },
        create: {
          warehouseId: row.warehouseId,
          section: row.section,
          materialId: m.materialId,
          quantity: qty,
          reserved: 0
        },
        update: { quantity: { increment: qty } }
      });
      await tx.stockMovement.create({
        data: {
          warehouseId: row.warehouseId,
          materialId: m.materialId,
          quantity: qty,
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
            sourceName: it.sourceName,
            sourceUnit: it.sourceUnit || ""
          }
        },
        create: {
          warehouseId: row.warehouseId,
          section: row.section,
          sourceName: it.sourceName,
          sourceUnit: it.sourceUnit || "",
          targetMaterialId: m.materialId,
          createdById: req.user!.userId
        },
        update: { targetMaterialId: m.materialId }
      });
    }
    await tx.receiptRequest.update({
      where: { id: row.id },
      data: { status: "RECEIVED", acceptedAt: new Date() }
    });
    return operation;
  });

  if (row.createdById && row.createdById !== req.user!.userId) {
    await notifyUser({
      userId: row.createdById,
      title: "Заявка на приемку обработана",
      message: `Заявка ${row.number} принята на склад.`,
      level: NotificationLevel.INFO,
      entityType: "ReceiptRequest",
      entityId: row.id
    }).catch(() => undefined);
  }
  return res.json({ ok: true, operationId: op.id });
});
