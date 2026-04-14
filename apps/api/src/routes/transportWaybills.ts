import { TransportWaybillStatus } from "@prisma/client";
import PDFDocument from "pdfkit";
import { Router } from "express";
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
  status: z.nativeEnum(TransportWaybillStatus)
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
      items: { include: { material: true } }
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
    const updated = await prisma.transportWaybill.update({
      where: { id },
      data: {
        status: parsed.data.status,
        ...deriveDates(parsed.data.status)
      }
    });
    return res.json(updated);
  } catch (error) {
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
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

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${waybill.number}.pdf`);
  const doc = new PDFDocument({ size: "A4", margin: 28 });
  doc.pipe(res);

  doc.fontSize(18).text(`Transport waybill ${waybill.number}`);
  doc.moveDown(0.6);
  doc.fontSize(11).text(`Status: ${waybill.status}`);
  doc.text(`From warehouse: ${waybill.fromWarehouse?.name || "-"}`);
  doc.text(`To location: ${waybill.toLocation}`);
  doc.text(`Sender: ${waybill.sender || "-"}`);
  doc.text(`Recipient: ${waybill.recipient || "-"}`);
  doc.text(`Vehicle: ${waybill.vehicle || "-"}`);
  doc.text(`Driver: ${waybill.driverName || "-"}`);
  doc.text(`Route: ${waybill.route || "-"}`);
  doc.moveDown(1);
  doc.fontSize(12).text("Items");
  doc.moveDown(0.4);

  waybill.items.forEach((item: (typeof waybill.items)[number], idx: number) => {
    doc.fontSize(10).text(`${idx + 1}. ${item.material.name} (${item.material.unit}) - ${item.quantity}`);
  });

  doc.moveDown(2);
  doc.text(`Created at: ${waybill.createdAt.toISOString()}`);
  doc.end();
});
