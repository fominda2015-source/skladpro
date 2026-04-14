import { TransportWaybillStatus } from "@prisma/client";
import { Router } from "express";
import pdfMake from "pdfmake/build/pdfmake.js";
import pdfFonts from "pdfmake/build/vfs_fonts.js";
import { z } from "zod";
import { handlePrismaError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const pdfMakeAny = pdfMake as unknown as {
  vfs?: Record<string, string>;
  createPdf: (docDefinition: unknown) => { getBuffer: (cb: (data: Uint8Array) => void) => void };
};
const pdfFontsAny = pdfFonts as unknown as { pdfMake?: { vfs?: Record<string, string> }; vfs?: Record<string, string> };
pdfMakeAny.vfs = pdfFontsAny.pdfMake?.vfs || pdfFontsAny.vfs || {};

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

  const docDefinition: unknown = {
    pageSize: "A4",
    pageMargins: [28, 28, 28, 28] as [number, number, number, number],
    defaultStyle: { font: "Roboto", fontSize: 10 },
    content: [
      { text: `Транспортная накладная ${waybill.number}`, style: "title" },
      { text: `Статус: ${waybill.status}`, margin: [0, 0, 0, 10] },
      { text: `Склад отправитель: ${waybill.fromWarehouse?.name || "-"}` },
      { text: `Точка назначения: ${waybill.toLocation}` },
      { text: `Отправитель: ${waybill.sender || "-"}` },
      { text: `Получатель: ${waybill.recipient || "-"}` },
      { text: `Транспорт: ${waybill.vehicle || "-"}` },
      { text: `Водитель: ${waybill.driverName || "-"}` },
      { text: `Маршрут: ${waybill.route || "-"}`, margin: [0, 0, 0, 10] },
      {
        table: {
          headerRows: 1,
          widths: [24, "*", 50, 70],
          body: tableBody
        }
      },
      { text: `Создано: ${waybill.createdAt.toISOString()}`, margin: [0, 14, 0, 14] },
      { text: "Подпись отправителя: ____________________", margin: [0, 8, 0, 0] },
      { text: "Подпись получателя: ____________________", margin: [0, 8, 0, 0] }
    ],
    styles: {
      title: { fontSize: 18, bold: true, alignment: "center" as const, margin: [0, 0, 0, 6] }
    }
  };

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    pdfMakeAny.createPdf(docDefinition).getBuffer((data: Uint8Array) => {
      try {
        resolve(Buffer.from(data));
      } catch (error) {
        reject(error);
      }
    });
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=${waybill.number}.pdf`);
  return res.send(buffer);
});
