import { TransportWaybillStatus } from "@prisma/client";
import path from "node:path";
import { Router } from "express";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { handlePrismaError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const createWaybillSchema = z.object({
  fromWarehouseId: z.string().optional(),
  toLocation: z.string().min(1),
  sender: z.string().optional(),
  recipient: z.string().optional(),
  vehicle: z.string().optional(),
  driverName: z.string().optional(),
  route: z.string().optional(),
  operationId: z.string().optional(),
  issueRequestId: z.string().optional(),
  items: z.array(z.object({ materialId: z.string().min(1), quantity: z.number().positive() })).min(1)
});

const setStatusSchema = z.object({
  status: z.nativeEnum(TransportWaybillStatus),
  comment: z.string().optional()
});

function deriveDates(status: TransportWaybillStatus) {
  const now = new Date();
  return {
    shippedAt: status === "SHIPPED" || status === "RECEIVED" || status === "CLOSED" ? now : undefined,
    receivedAt: status === "RECEIVED" || status === "CLOSED" ? now : undefined,
    closedAt: status === "CLOSED" ? now : undefined
  };
}

export const transportWaybillsRouter = Router();
transportWaybillsRouter.use(requireAuth);
transportWaybillsRouter.use(requirePermission("waybills.read"));

transportWaybillsRouter.get("/", async (req, res) => {
  const status =
    typeof req.query.status === "string" && Object.values(TransportWaybillStatus).includes(req.query.status as TransportWaybillStatus)
      ? (req.query.status as TransportWaybillStatus)
      : undefined;

  const rows = await prisma.transportWaybill.findMany({
    where: status ? { status } : undefined,
    include: {
      fromWarehouse: true,
      operation: true,
      issueRequest: true,
      items: { include: { material: true } },
      events: { orderBy: { createdAt: "desc" }, take: 5 }
    },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return res.json(rows);
});

transportWaybillsRouter.post("/", requirePermission("waybills.write"), async (req, res) => {
  const parsed = createWaybillSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    const count = await prisma.transportWaybill.count();
    const number = `TN-${String(count + 1).padStart(5, "0")}`;
    const created = await prisma.transportWaybill.create({
      data: {
        number,
        status: TransportWaybillStatus.DRAFT,
        fromWarehouseId: parsed.data.fromWarehouseId,
        toLocation: parsed.data.toLocation,
        sender: parsed.data.sender,
        recipient: parsed.data.recipient,
        vehicle: parsed.data.vehicle,
        driverName: parsed.data.driverName,
        route: parsed.data.route,
        operationId: parsed.data.operationId,
        issueRequestId: parsed.data.issueRequestId,
        items: {
          create: parsed.data.items.map((x) => ({ materialId: x.materialId, quantity: x.quantity }))
        },
        events: {
          create: [{ status: TransportWaybillStatus.DRAFT, comment: "Created" }]
        }
      },
      include: { items: true }
    });
    return res.status(201).json(created);
  } catch (error) {
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

transportWaybillsRouter.patch("/:id/status", requirePermission("waybills.write"), async (req, res) => {
  const parsed = setStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  const id = String(req.params.id);
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.transportWaybill.update({
        where: { id },
        data: {
          status: parsed.data.status,
          ...deriveDates(parsed.data.status),
          events: {
            create: [{ status: parsed.data.status, comment: parsed.data.comment }]
          }
        }
      });
      return row;
    });
    return res.json(updated);
  } catch (error) {
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

transportWaybillsRouter.get("/:id/events", async (req, res) => {
  const id = String(req.params.id);
  const events = await prisma.transportWaybillEvent.findMany({
    where: { transportWaybillId: id },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return res.json(events);
});

transportWaybillsRouter.get("/:id/pdf", async (req, res) => {
  const id = String(req.params.id);
  const waybill = await prisma.transportWaybill.findUnique({
    where: { id },
    include: {
      fromWarehouse: true,
      items: { include: { material: true } }
    }
  });
  if (!waybill) {
    return res.status(404).json({ error: "Waybill not found" });
  }

  const tableBody: Array<Array<string>> = [
    ["№", "Материал", "Ед.", "Количество"]
  ];
  waybill.items.forEach((item: (typeof waybill.items)[number], idx: number) => {
    tableBody.push([
      String(idx + 1),
      item.material.name,
      item.material.unit,
      String(item.quantity)
    ]);
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${waybill.number}.pdf`);
  const fontPath = path.resolve(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
  const doc = new PDFDocument({ size: "A4", margin: 28 });
  doc.pipe(res);
  doc.font(fontPath);
  doc.fontSize(18).text(`Транспортная накладная ${waybill.number}`, { align: "center" });
  doc.moveDown(0.4);
  doc.fontSize(11).text(`Статус: ${waybill.status}`, { align: "center" });
  doc.moveDown(0.6);
  doc.fontSize(10).text(`Склад отправитель: ${waybill.fromWarehouse?.name || "-"}`);
  doc.text(`Точка назначения: ${waybill.toLocation}`);
  doc.text(`Отправитель: ${waybill.sender || "-"}`);
  doc.text(`Получатель: ${waybill.recipient || "-"}`);
  doc.text(`Транспорт: ${waybill.vehicle || "-"}`);
  doc.text(`Водитель: ${waybill.driverName || "-"}`);
  doc.text(`Маршрут: ${waybill.route || "-"}`);
  doc.moveDown(1);
  doc.fontSize(12).text("Позиции");
  doc.moveDown(0.2);
  tableBody.forEach((row) => {
    doc.fontSize(10).text(row.join(" | "));
  });
  doc.moveDown(1.2);
  doc.text(`Создано: ${waybill.createdAt.toISOString()}`);
  doc.moveDown(2);
  doc.text("Подпись отправителя: ____________________");
  doc.moveDown(1);
  doc.text("Подпись получателя: ____________________");
  doc.end();
  return;
});
