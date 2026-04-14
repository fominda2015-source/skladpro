import { ToolStatus } from "@prisma/client";
import { Router } from "express";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { z } from "zod";
import { handlePrismaError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const createToolSchema = z.object({
  name: z.string().min(1),
  inventoryNumber: z.string().min(1),
  serialNumber: z.string().optional(),
  warehouseId: z.string().optional(),
  projectId: z.string().optional(),
  responsible: z.string().optional(),
  note: z.string().optional()
});

const updateToolSchema = z.object({
  name: z.string().min(1).optional(),
  serialNumber: z.string().optional(),
  warehouseId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  responsible: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  status: z.nativeEnum(ToolStatus).optional()
});
const toolActionSchema = z.object({
  action: z.enum(["ISSUE", "RETURN", "SEND_TO_REPAIR", "MARK_DAMAGED", "MARK_LOST", "MARK_DISPUTED", "WRITE_OFF"]),
  comment: z.string().optional(),
  responsible: z.string().optional()
});

const nextStatusByAction: Record<z.infer<typeof toolActionSchema>["action"], ToolStatus> = {
  ISSUE: ToolStatus.ISSUED,
  RETURN: ToolStatus.IN_STOCK,
  SEND_TO_REPAIR: ToolStatus.IN_REPAIR,
  MARK_DAMAGED: ToolStatus.DAMAGED,
  MARK_LOST: ToolStatus.LOST,
  MARK_DISPUTED: ToolStatus.DISPUTED,
  WRITE_OFF: ToolStatus.WRITTEN_OFF
};

function buildQrCode(inventoryNumber: string) {
  return `TOOL:${inventoryNumber}`;
}

export const toolsRouter = Router();
toolsRouter.use(requireAuth);
toolsRouter.use(requirePermission("tools.read"));

toolsRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const status =
    typeof req.query.status === "string" && Object.values(ToolStatus).includes(req.query.status as ToolStatus)
      ? (req.query.status as ToolStatus)
      : undefined;
  const rows = await prisma.tool.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { inventoryNumber: { contains: q, mode: "insensitive" } },
              { serialNumber: { contains: q, mode: "insensitive" } },
              { qrCode: { contains: q, mode: "insensitive" } }
            ]
          }
        : {})
    },
    include: {
      warehouse: true,
      project: true
    },
    orderBy: { createdAt: "desc" },
    take: 300
  });
  return res.json(rows);
});

toolsRouter.post("/", requirePermission("tools.write"), async (req, res) => {
  const parsed = createToolSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    const qrCode = buildQrCode(parsed.data.inventoryNumber);
    const created = await prisma.tool.create({
      data: {
        ...parsed.data,
        qrCode
      },
      include: { events: true }
    });
    await prisma.toolEvent.create({
      data: {
        toolId: created.id,
        action: "CREATE",
        status: created.status
      }
    });
    return res.status(201).json(created);
  } catch (error) {
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.patch("/:id", requirePermission("tools.write"), async (req, res) => {
  const parsed = updateToolSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  try {
    const updated = await prisma.tool.update({
      where: { id: String(req.params.id) },
      data: parsed.data
    });
    return res.json(updated);
  } catch (error) {
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.post("/:id/action", requirePermission("tools.write"), async (req, res) => {
  const parsed = toolActionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  if (parsed.data.action === "ISSUE" && !parsed.data.responsible?.trim()) {
    return res.status(400).json({ error: "responsible is required for ISSUE" });
  }
  const id = String(req.params.id);
  const nextStatus = nextStatusByAction[parsed.data.action];
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const tool = await tx.tool.update({
        where: { id },
        data: {
          status: nextStatus,
          ...(parsed.data.action === "ISSUE" ? { responsible: parsed.data.responsible?.trim() } : {}),
          ...(parsed.data.action === "RETURN" ? { responsible: null } : {})
        }
      });
      await tx.toolEvent.create({
        data: {
          toolId: id,
          action: parsed.data.action,
          status: nextStatus,
          comment:
            parsed.data.action === "ISSUE"
              ? `Responsible: ${parsed.data.responsible?.trim()}${parsed.data.comment ? `; ${parsed.data.comment}` : ""}`
              : parsed.data.comment
        }
      });
      return tool;
    });
    return res.json(updated);
  } catch (error) {
    const mapped = handlePrismaError(error);
    return res.status(mapped.status).json(mapped.body);
  }
});

toolsRouter.get("/:id/events", async (req, res) => {
  const id = String(req.params.id);
  const events = await prisma.toolEvent.findMany({
    where: { toolId: id },
    orderBy: { createdAt: "desc" },
    take: 200
  });
  return res.json(events);
});

toolsRouter.get("/:id/qr", async (req, res) => {
  const tool = await prisma.tool.findUnique({ where: { id: String(req.params.id) } });
  if (!tool) {
    return res.status(404).json({ error: "Tool not found" });
  }
  const dataUrl = await QRCode.toDataURL(tool.qrCode, { margin: 1, width: 512 });
  return res.json({ id: tool.id, qrCode: tool.qrCode, dataUrl });
});

toolsRouter.get("/labels/pdf", async (req, res) => {
  const idsRaw = typeof req.query.ids === "string" ? req.query.ids : "";
  const ids = idsRaw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!ids.length) {
    return res.status(400).json({ error: "ids query param is required" });
  }

  const tools = await prisma.tool.findMany({
    where: { id: { in: ids } },
    orderBy: { createdAt: "desc" }
  });
  if (!tools.length) {
    return res.status(404).json({ error: "Tools not found" });
  }

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=tool-labels.pdf");
  const doc = new PDFDocument({ size: "A4", margin: 24 });
  doc.pipe(res);

  const cols = 3;
  const rows = 8;
  const gap = 10;
  const pageWidth = 595.28 - 24 * 2;
  const pageHeight = 841.89 - 24 * 2;
  const cellWidth = (pageWidth - gap * (cols - 1)) / cols;
  const cellHeight = (pageHeight - gap * (rows - 1)) / rows;

  for (let i = 0; i < tools.length; i += 1) {
    const tool = tools[i];
    if (i > 0 && i % (cols * rows) === 0) {
      doc.addPage();
    }

    const cellIndex = i % (cols * rows);
    const col = cellIndex % cols;
    const row = Math.floor(cellIndex / cols);
    const x = 24 + col * (cellWidth + gap);
    const y = 24 + row * (cellHeight + gap);

    doc.rect(x, y, cellWidth, cellHeight).lineWidth(0.5).strokeColor("#999").stroke();

    const qrSize = Math.min(cellHeight - 22, cellWidth * 0.45);
    const png = await QRCode.toBuffer(tool.qrCode, { margin: 1, width: 220 });
    doc.image(png, x + 6, y + 6, { width: qrSize, height: qrSize });
    doc.fontSize(8).fillColor("#111").text(tool.inventoryNumber, x + qrSize + 10, y + 8, { width: cellWidth - qrSize - 14 });
    doc.fontSize(7).text(tool.name, x + qrSize + 10, y + 22, { width: cellWidth - qrSize - 14, height: 22 });
    doc.fontSize(7).text(tool.qrCode, x + 6, y + qrSize + 10, { width: cellWidth - 12 });
  }

  doc.end();
});
