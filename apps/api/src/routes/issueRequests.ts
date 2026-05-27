import {
  IssueBasisType,
  IssueRequestDomain,
  IssueRequestStatus,
  MaterialKind,
  NotificationLevel,
  OperationType,
  StockMovementDirection,
  ToolStatus
} from "@prisma/client";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { Router } from "express";
import multer from "multer";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { config } from "../config.js";
import { recordAudit } from "../lib/audit.js";
import {
  assertProjectInScope,
  assertWarehouseInScope,
  getRequestDataScope,
  mergeIssueWhere
} from "../lib/dataScope.js";
import { dispatchNotification, getLowStockThreshold, notifyUser } from "../lib/notifications.js";

const cancelSchema = z.object({ reason: z.string().min(1).max(2000) });
const deleteIssueSchema = z.object({
  reason: z.string().min(1).max(2000),
  force: z.boolean().optional()
});
import { sha256File } from "../lib/fileHash.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const createIssueSchema = z
  .object({
    warehouseId: z.string().min(1),
    section: z.enum(["SS", "EOM"]).default("SS"),
    projectId: z.string().optional(),
    note: z.string().optional(),
    responsibleName: z.string().max(160).optional().nullable(),
    flowType: z.enum(["REQUEST", "DIRECT_ISSUE"]).optional(),
    basisType: z.nativeEnum(IssueBasisType).optional(),
    basisRef: z.string().max(500).optional().nullable(),
    /** Явный тип заявки по материалам; для инструмента не используется (см. toolItems). */
    domain: z.nativeEnum(IssueRequestDomain).optional(),
    limitReleasePath: z.string().max(2000).optional().nullable(),
    items: z
      .array(
        z.object({
          materialId: z.string().min(1),
          quantity: z.number().positive(),
          factLabel: z.string().max(500).optional().nullable()
        })
      )
      .optional()
      .default([]),
    toolItems: z.array(z.object({ toolId: z.string().min(1) })).optional().default([])
  })
  .superRefine((data, ctx) => {
    const nm = data.items.length;
    const nt = data.toolItems.length;
    if (nm > 0 && nt > 0) {
      ctx.addIssue({
        code: "custom",
        message: "В одной заявке нельзя смешивать материалы и инструмент — выберите что-то одно.",
        path: ["items"]
      });
      return;
    }
    if (nm === 0 && nt === 0) {
      ctx.addIssue({ code: "custom", message: "Добавьте строки материалов или инструментов.", path: ["items"] });
      return;
    }
    if (nt > 0) {
      const ids = data.toolItems.map((x) => x.toolId);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: "custom", message: "Инструмент указан несколько раз.", path: ["toolItems"] });
      }
    }
  });

const issueActionSchema = z.object({
  actualRecipientName: z.string().trim().min(1).max(160).optional()
});

const uploadDirAbs = path.resolve(process.cwd(), config.uploadsDir);
if (!fs.existsSync(uploadDirAbs)) {
  fs.mkdirSync(uploadDirAbs, { recursive: true });
}

const issueUploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDirAbs),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${safe}`);
  }
});
const issueUpload = multer({ storage: issueUploadStorage });

async function getLatestProjectLimit(projectId: string) {
  return prisma.projectLimit.findFirst({
    where: { projectId },
    include: { items: true },
    orderBy: { version: "desc" }
  });
}

function materialIssueActTitle(domain: IssueRequestDomain): string {
  switch (domain) {
    case IssueRequestDomain.WORKWEAR:
      return "Акт выдачи спецодежды";
    case IssueRequestDomain.CONSUMABLES:
      return "Акт выдачи расходников";
    default:
      return "Акт выдачи материалов";
  }
}

function limitSectionPdfLabel(issue: { limitReleasePath?: string | null }): string {
  const t = issue.limitReleasePath?.trim();
  return t && t.length > 0 ? t : "Не указан (выдача вне дерева лимита)";
}

function basisPdfLine(basisType: IssueBasisType, basisRef: string | null | undefined): string {
  const refTrim = basisRef?.trim() ?? "";
  const extra = refTrim ? ` Реквизиты основания: ${refTrim}` : "";
  switch (basisType) {
    case IssueBasisType.PROJECT_WORK:
      return `Основание выдачи: производство работ.${extra}`;
    case IssueBasisType.INTERNAL_NEED:
      return `Основание выдачи: внутренняя потребность.${extra}`;
    case IssueBasisType.EMERGENCY:
      return `Основание выдачи: срочная / аварийная необходимость.${extra}`;
    case IssueBasisType.OTHER:
    default:
      return refTrim.length
        ? `Основание выдачи: прочее.${extra}`
        : "Основание выдачи: прочее (реквизиты основания не заполнены).";
  }
}

function expectedMaterialKind(domain: IssueRequestDomain): MaterialKind | null {
  if (domain === IssueRequestDomain.CONSUMABLES) return MaterialKind.CONSUMABLE;
  if (domain === IssueRequestDomain.WORKWEAR) return MaterialKind.WORKWEAR;
  if (domain === IssueRequestDomain.MATERIALS) return MaterialKind.MATERIAL;
  return null;
}

function inferMaterialDomain(rows: Array<{ kind: MaterialKind }>): IssueRequestDomain | null {
  const kinds = new Set(rows.map((r) => r.kind));
  if (kinds.size !== 1) return null;
  const k = [...kinds][0];
  if (k === MaterialKind.CONSUMABLE) return IssueRequestDomain.CONSUMABLES;
  if (k === MaterialKind.WORKWEAR) return IssueRequestDomain.WORKWEAR;
  return IssueRequestDomain.MATERIALS;
}

function validateMaterialsForDomain(
  rows: Array<{ id: string; kind: MaterialKind }>,
  materialIds: string[],
  domain: IssueRequestDomain
): string | undefined {
  if (rows.length !== materialIds.length) {
    return "Не все материалы найдены в справочнике.";
  }
  const expected = expectedMaterialKind(domain);
  if (!expected) return undefined;
  for (const r of rows) {
    if (r.kind !== expected) {
      return `Вид номенклатуры не соответствует типу заявки (ожидается ${expected}).`;
    }
  }
  return undefined;
}

async function safeNotify(params: Parameters<typeof notifyUser>[0]) {
  try {
    await notifyUser(params);
  } catch {
    // Best-effort side effect: notification failure must not break core flow.
  }
}

function writePdfToFile(doc: PDFKit.PDFDocument, filePath: string) {
  return new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);
    doc.end();
  });
}

async function createIssueActDocument(params: {
  issueId: string;
  operationId: string;
  storekeeperId: string;
  actualRecipientName: string;
}) {
  const issue = await prisma.issueRequest.findUnique({
    where: { id: params.issueId },
    include: {
      warehouse: true,
      project: true,
      requestedBy: true,
      approvedBy: true,
      items: { include: { material: true } }
    }
  });
  if (!issue) {
    throw new Error("Issue not found for act generation");
  }
  const storekeeper = await prisma.user.findUnique({ where: { id: params.storekeeperId } });
  const safeNumber = issue.number.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `issue-act-${safeNumber}.pdf`;
  const storedFileName = `${Date.now()}_${fileName}`;
  const absPath = path.join(uploadDirAbs, storedFileName);
  const fontPath = path.resolve(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf");

  const doc = new PDFDocument({ size: "A4", margin: 32 });
  doc.font(fontPath);
  doc.fontSize(17).text(`${materialIssueActTitle(issue.domain)} ${issue.number}`, { align: "center" });
  doc.moveDown(0.6);
  doc.fontSize(10);
  doc.text(`Дата формирования: ${new Date().toLocaleString("ru-RU")}`);
  doc.text(`Склад: ${issue.warehouse?.name || issue.warehouseId}`);
  doc.text(`Учётный раздел: ${issue.section === "SS" ? "СС" : "ЭОМ"}`);
  doc.text(`Раздел (путь в лимитах): ${limitSectionPdfLabel(issue)}`);
  doc.text(basisPdfLine(issue.basisType, issue.basisRef));
  doc.text(`Ответственное лицо: ${issue.responsibleName || "-"}`);
  doc.text(`Фактически получил: ${params.actualRecipientName}`);
  doc.text(`Кладовщик: ${storekeeper?.fullName || storekeeper?.email || params.storekeeperId}`);
  doc.moveDown(0.8);

  doc.fontSize(12).text("Позиции", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(9);
  doc.text("№ | Материал | Ед. | Количество");
  doc.moveDown(0.2);
  issue.items.forEach((item, idx) => {
    const label = item.factLabel?.trim() || item.material.name;
    doc.text(`${idx + 1} | ${label} | ${item.material.unit} | ${String(item.quantity)}`);
  });

  doc.moveDown(1.2);
  if (issue.note) {
    doc.fontSize(10).text(`Примечание: ${issue.note}`);
    doc.moveDown(0.8);
  }
  doc.text("Материалы выданы и приняты по указанному количеству.");
  doc.moveDown(2);
  doc.text(`Ответственное лицо / получил: ${params.actualRecipientName}`);
  doc.moveDown(1);
  doc.text("Подпись: ______________________________");
  doc.moveDown(1.2);
  doc.text(`Кладовщик: ${storekeeper?.fullName || storekeeper?.email || ""}`);
  doc.moveDown(1);
  doc.text("Подпись: ______________________________");

  await writePdfToFile(doc, absPath);
  const fileBuffer = await fs.promises.readFile(absPath);
  const checksumSha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const filePath = `${config.uploadsDir}/${storedFileName}`.replace(/\\/g, "/");

  return prisma.$transaction(async (tx) => {
    const created = await tx.documentFile.create({
      data: {
        groupId: crypto.randomUUID(),
        version: 1,
        entityType: "issue",
        entityId: issue.id,
        type: "issue-act",
        fileName,
        filePath,
        mimeType: "application/pdf",
        size: fileBuffer.length,
        checksumSha256,
        createdBy: params.storekeeperId
      }
    });
    await tx.documentLink.create({
      data: {
        documentFileId: created.id,
        entityType: "operation",
        entityId: params.operationId,
        createdById: params.storekeeperId
      }
    });
    return created;
  });
}

async function createToolIssueActDocument(params: {
  issueId: string;
  storekeeperId: string;
  actualRecipientName: string;
}) {
  const issue = await prisma.issueRequest.findUnique({
    where: { id: params.issueId },
    include: {
      warehouse: true,
      project: true,
      requestedBy: true,
      approvedBy: true,
      toolItems: { include: { tool: true } }
    }
  });
  if (!issue || !issue.toolItems.length) {
    throw new Error("Tool issue not found for act generation");
  }
  const storekeeper = await prisma.user.findUnique({ where: { id: params.storekeeperId } });
  const safeNumber = issue.number.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `issue-tool-act-${safeNumber}.pdf`;
  const storedFileName = `${Date.now()}_${fileName}`;
  const absPath = path.join(uploadDirAbs, storedFileName);
  const fontPath = path.resolve(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf");

  const doc = new PDFDocument({ size: "A4", margin: 32 });
  doc.font(fontPath);
  doc.fontSize(17).text(`Акт выдачи инструмента ${issue.number}`, { align: "center" });
  doc.moveDown(0.6);
  doc.fontSize(10);
  doc.text(`Дата формирования: ${new Date().toLocaleString("ru-RU")}`);
  doc.text(`Склад: ${issue.warehouse?.name || issue.warehouseId}`);
  doc.text(`Учётный раздел: ${issue.section === "SS" ? "СС" : "ЭОМ"}`);
  doc.text(`Раздел (путь в лимитах): ${limitSectionPdfLabel(issue)}`);
  doc.text(basisPdfLine(issue.basisType, issue.basisRef));
  doc.text(`Ответственное лицо: ${issue.responsibleName || "-"}`);
  doc.text(`Фактически получил: ${params.actualRecipientName}`);
  doc.text(`Кладовщик: ${storekeeper?.fullName || storekeeper?.email || params.storekeeperId}`);
  doc.moveDown(0.8);

  doc.fontSize(12).text("Инструменты", { underline: true });
  doc.moveDown(0.3);
  doc.fontSize(9);
  doc.text("№ | Инв. № | Наименование | Статус до выдачи");
  doc.moveDown(0.2);
  issue.toolItems.forEach((row, idx) => {
    doc.text(
      `${idx + 1} | ${row.tool.inventoryNumber} | ${row.tool.name} | ${row.tool.status}`
    );
  });

  doc.moveDown(1.2);
  if (issue.note) {
    doc.fontSize(10).text(`Примечание: ${issue.note}`);
    doc.moveDown(0.8);
  }
  doc.text("Инструмент выдан и принят получателем (по перечню).");
  doc.moveDown(2);
  doc.text(`Ответственное лицо / получил: ${params.actualRecipientName}`);
  doc.moveDown(1);
  doc.text("Подпись: ______________________________");
  doc.moveDown(1.2);
  doc.text(`Кладовщик: ${storekeeper?.fullName || storekeeper?.email || ""}`);
  doc.moveDown(1);
  doc.text("Подпись: ______________________________");

  await writePdfToFile(doc, absPath);
  const fileBuffer = await fs.promises.readFile(absPath);
  const checksumSha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
  const filePath = `${config.uploadsDir}/${storedFileName}`.replace(/\\/g, "/");

  return prisma.$transaction(async (tx) => {
    const created = await tx.documentFile.create({
      data: {
        groupId: crypto.randomUUID(),
        version: 1,
        entityType: "issue",
        entityId: issue.id,
        type: "issue-act-tools",
        fileName,
        filePath,
        mimeType: "application/pdf",
        size: fileBuffer.length,
        checksumSha256,
        createdBy: params.storekeeperId
      }
    });
    await tx.documentLink.create({
      data: {
        documentFileId: created.id,
        entityType: "issue",
        entityId: issue.id,
        createdById: params.storekeeperId
      }
    });
    return created;
  });
}

async function attachSignedIssueAttachment(params: {
  issueId: string;
  operationId: string | null;
  userId: string;
  file: Express.Multer.File;
}) {
  const absPath = path.join(uploadDirAbs, params.file.filename);
  const checksumSha256 = await sha256File(absPath);
  const relPath = `${config.uploadsDir}/${params.file.filename}`.replace(/\\/g, "/");
  return prisma.$transaction(async (tx) => {
    const row = await tx.documentFile.create({
      data: {
        groupId: crypto.randomUUID(),
        version: 1,
        entityType: "issue",
        entityId: params.issueId,
        type: "issue-signed-attachment",
        fileName: params.file.originalname || "signed-issue-scan",
        filePath: relPath,
        mimeType: params.file.mimetype || "application/octet-stream",
        size: params.file.size,
        checksumSha256,
        createdBy: params.userId
      }
    });
    if (params.operationId) {
      await tx.documentLink.create({
        data: {
          documentFileId: row.id,
          entityType: "operation",
          entityId: params.operationId,
          createdById: params.userId
        }
      });
    }
    return row;
  });
}

export const issueRequestsRouter = Router();
issueRequestsRouter.use(requireAuth);
issueRequestsRouter.use(requirePermission("issues.read"));

issueRequestsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const pageRaw = Number(req.query.page);
  const pageSizeRaw = Number(req.query.pageSize);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(100, Math.max(1, Math.floor(pageSizeRaw))) : 20;
  const sort =
    typeof req.query.sort === "string" && ["created_desc", "status", "number"].includes(req.query.sort)
      ? req.query.sort
      : "created_desc";
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const statusParam = typeof req.query.status === "string" ? req.query.status : undefined;
  const statusFilter =
    statusParam && Object.values(IssueRequestStatus).includes(statusParam as IssueRequestStatus)
      ? { status: statusParam as IssueRequestStatus }
      : {};
  const basisParam = typeof req.query.basisType === "string" ? req.query.basisType : undefined;
  const basisFilter =
    basisParam && Object.values(IssueBasisType).includes(basisParam as IssueBasisType)
      ? { basisType: basisParam as IssueBasisType }
      : {};
  const flowParam = typeof req.query.flowType === "string" ? req.query.flowType : undefined;
  const flowFilter =
    flowParam === "REQUEST" || flowParam === "DIRECT_ISSUE"
      ? { flowType: flowParam }
      : {};
  const searchFilter = q
    ? {
        OR: [
          { number: { contains: q, mode: "insensitive" as const } },
          { basisRef: { contains: q, mode: "insensitive" as const } },
          { note: { contains: q, mode: "insensitive" as const } },
          { responsibleName: { contains: q, mode: "insensitive" as const } }
        ]
      }
    : {};
  const sectionParam = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const sectionFilter = sectionParam === "SS" || sectionParam === "EOM" ? { section: sectionParam } : {};
  const domainParam = typeof req.query.domain === "string" ? req.query.domain.toUpperCase() : "";
  const domainFilter =
    domainParam === "MATERIALS" ||
    domainParam === "TOOLS" ||
    domainParam === "CONSUMABLES" ||
    domainParam === "WORKWEAR"
      ? { domain: domainParam as IssueRequestDomain }
      : {};
  const where = mergeIssueWhere(scope, {
    ...statusFilter,
    ...basisFilter,
    ...flowFilter,
    ...sectionFilter,
    ...searchFilter,
    ...domainFilter
  } as any);
  const [total, rows] = await prisma.$transaction([
    prisma.issueRequest.count({ where }),
    prisma.issueRequest.findMany({
      where,
      include: {
        items: { include: { material: true } },
        toolItems: { include: { tool: true } },
        warehouse: true,
        project: true,
        requestedBy: true,
        approvedBy: true
      },
      orderBy:
        sort === "status"
          ? { status: "asc" }
          : sort === "number"
            ? { number: "asc" }
            : { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ]);
  return res.json({
    items: rows,
    total,
    page,
    pageSize
  });
});

issueRequestsRouter.post("/", requirePermission("issues.write"), async (req: AuthedRequest, res) => {
  const parsed = createIssueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  try {
    const scope = await getRequestDataScope(req);
    assertWarehouseInScope(scope, parsed.data.warehouseId);
    assertProjectInScope(scope, parsed.data.projectId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) {
      return res.status(403).json({ error: err.message });
    }
    throw e;
  }

  const count = await prisma.issueRequest.count();
  const number = `REQ-${String(count + 1).padStart(5, "0")}`;

  let domain: IssueRequestDomain;
  const toolLen = parsed.data.toolItems.length;
  const itemLen = parsed.data.items.length;

  if (toolLen > 0) {
    domain = IssueRequestDomain.TOOLS;
    if (parsed.data.domain && parsed.data.domain !== IssueRequestDomain.TOOLS) {
      return res.status(400).json({ error: "Для заявки на инструмент не указывайте domain по материалам." });
    }
  } else if (itemLen === 0) {
    return res.status(400).json({ error: "Добавьте строки материалов или инструментов." });
  } else {
    const materialIds = [...new Set(parsed.data.items.map((i) => i.materialId))];
    const matRows = await prisma.material.findMany({
      where: { id: { in: materialIds } },
      select: { id: true, kind: true }
    });

    if (parsed.data.domain === IssueRequestDomain.TOOLS) {
      return res.status(400).json({ error: "Для инструмента передайте toolItems, а не строки материалов." });
    }

    if (parsed.data.domain) {
      domain = parsed.data.domain;
      const verr = validateMaterialsForDomain(matRows, materialIds, domain);
      if (verr) {
        return res.status(400).json({ error: verr });
      }
    } else {
      const inferred = inferMaterialDomain(matRows);
      if (!inferred) {
        return res.status(400).json({
          error:
            "В заявке смешаны виды номенклатуры (материал / расходник / спецодежда) или не найдены позиции — явно передайте domain: MATERIALS, CONSUMABLES или WORKWEAR."
        });
      }
      domain = inferred;
    }
  }

  let initialStatus: IssueRequestStatus = IssueRequestStatus.DRAFT;
  if (
    (domain === IssueRequestDomain.MATERIALS || domain === IssueRequestDomain.CONSUMABLES) &&
    parsed.data.projectId
  ) {
    const limit = await getLatestProjectLimit(parsed.data.projectId);
    if (limit) {
      const byMaterial = new Map(limit.items.map((x) => [x.materialId, x]));
      const exceeds = parsed.data.items.some((item) => {
        const lim = byMaterial.get(item.materialId);
        if (!lim) return false;
        const planned = Number(lim.plannedQty);
        const issued = Number(lim.issuedQty);
        const reserved = Number(lim.reservedQty);
        return issued + reserved + item.quantity > planned;
      });
      if (exceeds) {
        initialStatus = IssueRequestStatus.ON_APPROVAL;
      }
    }
  }

  const basisType =
    parsed.data.basisType ??
    (parsed.data.projectId ? IssueBasisType.PROJECT_WORK : IssueBasisType.OTHER);

  const created = await prisma.issueRequest.create({
    data: {
      number,
      domain,
      limitReleasePath: parsed.data.limitReleasePath?.trim() ? parsed.data.limitReleasePath.trim() : undefined,
      flowType: parsed.data.flowType ?? "REQUEST",
      warehouseId: parsed.data.warehouseId,
      section: parsed.data.section,
      projectId: parsed.data.projectId,
      note: parsed.data.note,
      responsibleName: parsed.data.responsibleName ?? undefined,
      basisType,
      basisRef: parsed.data.basisRef ?? undefined,
      requestedById: req.user!.userId,
      status: initialStatus,
      ...(domain !== IssueRequestDomain.TOOLS
        ? {
            items: {
              create: parsed.data.items.map((item) => ({
                materialId: item.materialId,
                quantity: item.quantity,
                factLabel: item.factLabel?.trim() || null
              }))
            }
          }
        : {
            toolItems: {
              create: parsed.data.toolItems.map((item) => ({
                toolId: item.toolId
              }))
            }
          })
    },
    include: { items: { include: { material: true } }, toolItems: { include: { tool: true } } }
  });

  return res.status(201).json(created);
});

const updateDraftIssueSchema = z.object({
  note: z.string().optional().nullable(),
  responsibleName: z.string().max(160).optional().nullable(),
  flowType: z.enum(["REQUEST", "DIRECT_ISSUE"]).optional(),
  basisType: z.nativeEnum(IssueBasisType).optional(),
  basisRef: z.string().max(500).optional().nullable(),
  limitReleasePath: z.string().max(2000).optional().nullable()
});

issueRequestsRouter.patch(
  "/:id",
  requirePermission("issues.write"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const parsed = updateDraftIssueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const scope = await getRequestDataScope(req);
    const existing = await prisma.issueRequest.findFirst({ where: mergeIssueWhere(scope, { id }) });
    if (!existing) {
      return res.status(404).json({ error: "Issue request not found" });
    }
    if (existing.status !== IssueRequestStatus.DRAFT) {
      return res.status(409).json({ error: "Only DRAFT requests can be edited" });
    }
    const updated = await prisma.issueRequest.update({
      where: { id },
      data: {
        ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
        ...(parsed.data.responsibleName !== undefined ? { responsibleName: parsed.data.responsibleName } : {}),
        ...(parsed.data.flowType !== undefined ? { flowType: parsed.data.flowType } : {}),
        ...(parsed.data.basisType !== undefined ? { basisType: parsed.data.basisType } : {}),
        ...(parsed.data.basisRef !== undefined ? { basisRef: parsed.data.basisRef } : {}),
        ...(parsed.data.limitReleasePath !== undefined
          ? { limitReleasePath: parsed.data.limitReleasePath?.trim() || null }
          : {})
      }
    });
    return res.json(updated);
  }
);

issueRequestsRouter.patch(
  "/:id/send-for-approval",
  requirePermission("issues.write"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const scope = await getRequestDataScope(req);
    const existing = await prisma.issueRequest.findFirst({ where: mergeIssueWhere(scope, { id }) });
    if (!existing) {
      return res.status(404).json({ error: "Issue request not found" });
    }
    if (existing.status === IssueRequestStatus.ON_APPROVAL) {
      return res.json(existing);
    }
    if (existing.status !== IssueRequestStatus.DRAFT) {
      return res.status(409).json({ error: `Cannot send for approval from status ${existing.status}` });
    }
    const updated = await prisma.issueRequest.update({
      where: { id },
      data: { status: IssueRequestStatus.ON_APPROVAL }
    });
    await safeNotify({
      userId: updated.requestedById,
      title: "Заявка отправлена на согласование",
      message: `Заявка ${updated.number} переведена в ON_APPROVAL.`,
      entityType: "IssueRequest",
      entityId: updated.id
    });
    return res.json(updated);
  }
);

issueRequestsRouter.patch("/:id/approve", requirePermission("issues.approve"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const scope = await getRequestDataScope(req);
  const prev = await prisma.issueRequest.findFirst({ where: mergeIssueWhere(scope, { id }) });
  if (!prev) {
    return res.status(404).json({ error: "Issue request not found" });
  }
  if (prev.status === IssueRequestStatus.APPROVED) {
    return res.json(prev);
  }
  if (prev.status !== IssueRequestStatus.ON_APPROVAL) {
    return res.status(409).json({ error: `Approve allowed only from ON_APPROVAL, got ${prev.status}` });
  }
  const updated = await prisma.issueRequest.update({
    where: { id },
    data: { status: IssueRequestStatus.APPROVED, approvedById: req.user!.userId }
  });
  await recordAudit({
    userId: req.user!.userId,
    action: "ISSUE_REQUEST_APPROVE",
    entityType: "IssueRequest",
    entityId: id,
    summary: `Заявка ${updated.number} согласована`,
    before: { status: prev.status, approvedById: prev.approvedById },
    after: { status: updated.status, approvedById: updated.approvedById }
  });
  await safeNotify({
    userId: updated.requestedById,
    title: "Заявка согласована",
    message: `Заявка ${updated.number} одобрена и готова к выдаче.`,
    entityType: "IssueRequest",
    entityId: updated.id
  });
  return res.json(updated);
});

issueRequestsRouter.patch("/:id/reject", requirePermission("issues.approve"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const scope = await getRequestDataScope(req);
  const prev = await prisma.issueRequest.findFirst({ where: mergeIssueWhere(scope, { id }) });
  if (!prev) {
    return res.status(404).json({ error: "Issue request not found" });
  }
  if (prev.status !== IssueRequestStatus.ON_APPROVAL) {
    return res.status(409).json({ error: `Reject allowed only from ON_APPROVAL, got ${prev.status}` });
  }
  const updated = await prisma.issueRequest.update({
    where: { id },
    data: { status: IssueRequestStatus.REJECTED, approvedById: req.user!.userId }
  });
  await recordAudit({
    userId: req.user!.userId,
    action: "ISSUE_REQUEST_REJECT",
    entityType: "IssueRequest",
    entityId: id,
    summary: `Заявка ${updated.number} отклонена`,
    before: { status: prev.status, approvedById: prev.approvedById },
    after: { status: updated.status, approvedById: updated.approvedById }
  });
  await safeNotify({
    userId: updated.requestedById,
    title: "Заявка отклонена",
    message: `Заявка ${updated.number} отклонена. Проверьте детали и при необходимости исправьте черновик.`,
    level: NotificationLevel.WARNING,
    entityType: "IssueRequest",
    entityId: updated.id
  });
  return res.json(updated);
});

issueRequestsRouter.patch("/:id/cancel", requirePermission("issues.write"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  // Причина обязательна — она пишется в audit и рассылается в уведомлениях.
  const parsed = cancelSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "REASON_REQUIRED", details: parsed.error.flatten() });
  }
  const reason = parsed.data.reason.trim();
  const scope = await getRequestDataScope(req);
  const prev = await prisma.issueRequest.findFirst({ where: mergeIssueWhere(scope, { id }) });
  if (!prev) {
    return res.status(404).json({ error: "Issue request not found" });
  }
  if (prev.status === IssueRequestStatus.CANCELLED) {
    return res.json(prev);
  }
  if (prev.status !== IssueRequestStatus.DRAFT && prev.status !== IssueRequestStatus.ON_APPROVAL) {
    return res.status(409).json({ error: `Cancel allowed only from DRAFT or ON_APPROVAL, got ${prev.status}` });
  }
  const updated = await prisma.issueRequest.update({
    where: { id },
    data: { status: IssueRequestStatus.CANCELLED }
  });
  await recordAudit({
    userId: req.user!.userId,
    action: "ISSUE_REQUEST_CANCEL",
    entityType: "IssueRequest",
    entityId: id,
    summary: `Заявка ${updated.number} отменена. Причина: ${reason}`,
    before: { status: prev.status },
    after: { status: updated.status, reason }
  });
  await safeNotify({
    userId: updated.requestedById,
    title: "Заявка отменена",
    message: `Заявка ${updated.number} отменена.\nПричина: ${reason}`,
    level: NotificationLevel.WARNING,
    entityType: "IssueRequest",
    entityId: updated.id,
    eventCode: "ISSUE_CANCELLED"
  });
  await dispatchNotification({
    eventCode: "ISSUE_CANCELLED",
    title: "Заявка на выдачу отменена",
    message: `${updated.number}\nПричина: ${reason}`,
    entityType: "IssueRequest",
    entityId: updated.id,
    excludeUserIds: [req.user!.userId, updated.requestedById]
  }).catch(() => undefined);
  return res.json(updated);
});

// Удаление заявки на выдачу. Требует причину (она пишется в audit + рассылается).
// Без force: блокируем, если заявка уже проведена (ISSUED). С force=true и ADMIN — удаляем в любом случае
// (RESTRICT-связи аккуратно подчищаем; складские движения не откатываются, но запись об удалении остаётся в логе).
issueRequestsRouter.delete("/:id", requirePermission("issues.write"), async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const parsed = deleteIssueSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "REASON_REQUIRED", details: parsed.error.flatten() });
  }
  const reason = parsed.data.reason.trim();
  const wantsForce = Boolean(parsed.data.force);
  const force = wantsForce && req.user?.role === "ADMIN";
  const scope = await getRequestDataScope(req);
  const row = await prisma.issueRequest.findFirst({
    where: mergeIssueWhere(scope, { id }),
    include: { items: true, toolItems: true, operations: { select: { id: true } } }
  });
  if (!row) {
    return res.status(404).json({ error: "Issue request not found" });
  }
  if (row.status === IssueRequestStatus.ISSUED && !force) {
    return res.status(409).json({
      error: "ISSUE_ALREADY_DONE",
      hint: "Заявка уже проведена. Принудительное удаление доступно только администратору с force=true."
    });
  }

  await prisma.$transaction(async (tx) => {
    if (force) {
      // Снять зависимые наряды/движения, относящиеся к этой заявке.
      await tx.transportWaybill.deleteMany({ where: { issueRequestId: id } });
      await tx.stockMovement.deleteMany({ where: { issueRequestId: id } });
      // Операции, родительские для этой заявки, могут содержать собственные движения/items — почистим их.
      const opIds = row.operations.map((o) => o.id);
      if (opIds.length) {
        await tx.stockMovement.deleteMany({ where: { operationId: { in: opIds } } });
        await tx.operationItem.deleteMany({ where: { operationId: { in: opIds } } });
        await tx.operation.deleteMany({ where: { id: { in: opIds } } });
      }
    }
    await tx.issueRequest.delete({ where: { id } });
  });

  await recordAudit({
    userId: req.user!.userId,
    action: "ISSUE_REQUEST_DELETE",
    entityType: "IssueRequest",
    entityId: id,
    summary: `Заявка ${row.number} удалена. Причина: ${reason}${force ? " (force, ADMIN)" : ""}`,
    before: {
      number: row.number,
      status: row.status,
      warehouseId: row.warehouseId,
      itemsCount: row.items.length,
      toolsCount: row.toolItems.length,
      reason
    }
  });
  await safeNotify({
    userId: row.requestedById,
    title: "Заявка удалена",
    message: `Заявка ${row.number} удалена.\nПричина: ${reason}`,
    level: NotificationLevel.WARNING,
    entityType: "IssueRequest",
    entityId: id,
    eventCode: "ISSUE_DELETED"
  });
  await dispatchNotification({
    eventCode: "ISSUE_DELETED",
    title: "Заявка на выдачу удалена",
    message: `${row.number}\nПричина: ${reason}`,
    entityType: "IssueRequest",
    entityId: id,
    excludeUserIds: [req.user!.userId, row.requestedById]
  }).catch(() => undefined);

  return res.json({ ok: true, force });
});

issueRequestsRouter.patch(
  "/:id/issue",
  requirePermission("operations.write"),
  issueUpload.single("signedFile"),
  async (req: AuthedRequest, res) => {
    const id = String(req.params.id);
    const rawBody = (req.body || {}) as Record<string, unknown>;
    const bodyJson: unknown =
      typeof rawBody.payload === "string"
        ? (() => {
            try {
              return JSON.parse(rawBody.payload as string);
            } catch {
              return null;
            }
          })()
        : rawBody;
    if (bodyJson === null) {
      return res.status(400).json({ error: "Некорректный JSON в поле payload" });
    }
    const parsed = issueActionSchema.safeParse(bodyJson);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    const scope = await getRequestDataScope(req);
    const issueRow = await prisma.issueRequest.findFirst({
      where: mergeIssueWhere(scope, { id }),
      include: { items: true, toolItems: { include: { tool: true } } }
    });
    if (!issueRow) {
      return res.status(404).json({ error: "Issue request not found" });
    }
    if (issueRow.status === IssueRequestStatus.ON_APPROVAL) {
      return res.status(409).json({ error: "Issue request is pending approval" });
    }
    if (
      issueRow.status !== IssueRequestStatus.APPROVED &&
      issueRow.status !== IssueRequestStatus.DRAFT
    ) {
      return res.status(409).json({ error: `Wrong status: ${issueRow.status}` });
    }
    const actualRecipientName = parsed.data.actualRecipientName || issueRow.responsibleName || "";
    if (!actualRecipientName.trim()) {
      return res.status(400).json({ error: "actualRecipientName is required" });
    }

    const signedUpload = (req as AuthedRequest & { file?: Express.Multer.File }).file;
    let signedAttachment: { id: string; filePath: string; fileName: string } | null = null;

    if (issueRow.domain === IssueRequestDomain.TOOLS) {
      try {
      const prevStatus = issueRow.status;
      const result = await prisma.$transaction(async (tx) => {
        const toolLines = await tx.issueRequestToolItem.findMany({
          where: { issueRequestId: issueRow.id },
          include: { tool: true }
        });
        if (!toolLines.length) {
          throw new Error("NO_TOOLS");
        }

        const toolIds = toolLines.map((l) => l.toolId);
        const tools = await tx.tool.findMany({ where: { id: { in: toolIds } } });
        const byId = new Map(tools.map((t) => [t.id, t]));

        for (const line of toolLines) {
          const tool = byId.get(line.toolId);
          if (!tool) {
            throw new Error(`TOOL_MISSING:${line.toolId}`);
          }
          if (tool.warehouseId !== issueRow.warehouseId) {
            throw new Error(`TOOL_WRONG_PLACE:${tool.id}`);
          }
          if (tool.section !== issueRow.section) {
            throw new Error(`TOOL_WRONG_SECTION:${tool.id}`);
          }
          if (tool.status !== ToolStatus.IN_STOCK) {
            throw new Error(`TOOL_NOT_AVAILABLE:${tool.id}`);
          }
        }

        const toolEvents: string[] = [];
        for (const line of toolLines) {
          const beforeSnap = byId.get(line.toolId)!;
          await tx.tool.update({
            where: { id: line.toolId },
            data: {
              status: ToolStatus.ISSUED,
              responsible: actualRecipientName.trim()
            }
          });
          const ev = await tx.toolEvent.create({
            data: {
              toolId: line.toolId,
              action: "ISSUE",
              status: ToolStatus.ISSUED,
              actorId: req.user!.userId,
              comment: `Выдача по заявке ${issueRow.number}`
            }
          });
          toolEvents.push(ev.id);
          await recordAudit({
            userId: req.user!.userId,
            action: "TOOL_ISSUE",
            entityType: "Tool",
            entityId: line.toolId,
            summary: `Инструмент ${beforeSnap.name} (инв. ${beforeSnap.inventoryNumber}) — выдан по заявке ${issueRow.number}`,
            before: {
              status: beforeSnap.status,
              responsible: beforeSnap.responsible,
              warehouseId: beforeSnap.warehouseId,
              section: beforeSnap.section
            },
            after: {
              status: ToolStatus.ISSUED,
              responsible: actualRecipientName.trim(),
              toolEventId: ev.id,
              issueRequestId: issueRow.id
            },
            tx
          });
        }

        const updatedIssue = await tx.issueRequest.update({
          where: { id: issueRow.id },
          data: {
            status: IssueRequestStatus.ISSUED,
            actualRecipientName: actualRecipientName.trim()
          }
        });

        return { issue: updatedIssue, toolIds: toolLines.map((l) => l.toolId), toolEvents };
      });

      let document: Awaited<ReturnType<typeof createToolIssueActDocument>> | null = null;
      try {
        document = await createToolIssueActDocument({
          issueId: result.issue.id,
          storekeeperId: req.user!.userId,
          actualRecipientName: actualRecipientName.trim()
        });
      } catch (documentError) {
        console.error("Failed to generate tool issue act", documentError);
      }

      if (signedUpload) {
        try {
          const row = await attachSignedIssueAttachment({
            issueId: result.issue.id,
            operationId: null,
            userId: req.user!.userId,
            file: signedUpload
          });
          signedAttachment = { id: row.id, filePath: row.filePath, fileName: row.fileName };
        } catch (attachErr) {
          console.error("Failed to attach signed issue scan", attachErr);
        }
      }

      await recordAudit({
        userId: req.user!.userId,
        action: "ISSUE_REQUEST_ISSUE",
        entityType: "IssueRequest",
        entityId: id,
        summary: `Выдача инструмента по заявке ${issueRow.number} (единиц: ${result.toolIds.length})`,
        before: {
          domain: IssueRequestDomain.TOOLS,
          status: prevStatus as IssueRequestStatus,
          toolIds: result.toolIds
        },
        after: {
          domain: IssueRequestDomain.TOOLS,
          status: result.issue.status,
          toolEvents: result.toolEvents,
          recipient: actualRecipientName.trim(),
          documentId: document?.id ?? null
        }
      });

      await safeNotify({
        userId: result.issue.requestedById,
        title: "Инструмент выдан по заявке",
        message: `Заявка ${issueRow.number} проведена (инструмент). Получатель: ${actualRecipientName.trim()}.`,
        entityType: "IssueRequest",
        entityId: result.issue.id
      });

      return res.json({
        operation: null,
        issue: result.issue,
        document,
        toolIds: result.toolIds,
        signedAttachment
      });
    } catch (error) {
      if (error instanceof Error && error.message === "NO_TOOLS") {
        return res.status(409).json({ error: "No tools in issue request" });
      }
      if (error instanceof Error && error.message.startsWith("TOOL_MISSING:")) {
        return res.status(409).json({ error: "Tool not found", toolId: error.message.split(":")[1] });
      }
      if (error instanceof Error && error.message.startsWith("TOOL_WRONG_PLACE:")) {
        return res.status(409).json({
          error: "Tool warehouse does not match issue request",
          toolId: error.message.split(":")[1]
        });
      }
      if (error instanceof Error && error.message.startsWith("TOOL_WRONG_SECTION:")) {
        return res.status(409).json({
          error: "Tool section does not match issue request",
          toolId: error.message.split(":")[1]
        });
      }
      if (error instanceof Error && error.message.startsWith("TOOL_NOT_AVAILABLE:")) {
        return res.status(409).json({
          error: "Tool is not available for issue (expect IN_STOCK)",
          toolId: error.message.split(":")[1]
        });
      }
      return res.status(500).json({ error: "Internal server error" });
    }
    }

  try {
    const prevStatus = issueRow.status;
    const result = await prisma.$transaction(async (tx) => {
      for (const item of issueRow.items) {
        const stock = await tx.stock.findUnique({
          where: {
            warehouseId_materialId_section: {
              warehouseId: issueRow.warehouseId,
              materialId: item.materialId,
              section: issueRow.section
            }
          }
        });
        if (!stock || Number(stock.quantity) < Number(item.quantity)) {
          throw new Error(`INSUFFICIENT_STOCK:${item.materialId}`);
        }
      }

      if (
        issueRow.projectId &&
        issueRow.domain !== IssueRequestDomain.WORKWEAR &&
        issueRow.domain !== IssueRequestDomain.TOOLS
      ) {
        const latestLimit = await tx.projectLimit.findFirst({
          where: { projectId: issueRow.projectId },
          include: { items: true },
          orderBy: { version: "desc" }
        });

        if (latestLimit) {
          const map = new Map(latestLimit.items.map((x) => [x.materialId, x]));
          const exceededNow = issueRow.items.some((item) => {
            const lim = map.get(item.materialId);
            if (!lim) return false;
            return Number(lim.issuedQty) + Number(lim.reservedQty) + Number(item.quantity) > Number(lim.plannedQty);
          });
          if (exceededNow && issueRow.status !== IssueRequestStatus.APPROVED) {
            throw new Error("LIMIT_EXCEEDED_NEEDS_APPROVAL");
          }
        }
      }

      const operation = await tx.operation.create({
        data: {
          type: OperationType.EXPENSE,
          warehouseId: issueRow.warehouseId,
          section: issueRow.section,
          projectId: issueRow.projectId ?? undefined,
          documentNumber: issueRow.number,
          status: "POSTED",
          issueRequestId: issueRow.id,
          items: {
            create: issueRow.items.map((item) => ({
              materialId: item.materialId,
              quantity: item.quantity
            }))
          }
        },
        include: { items: true }
      });

      for (const item of issueRow.items) {
        await tx.stock.update({
          where: {
            warehouseId_materialId_section: {
              warehouseId: issueRow.warehouseId,
              materialId: item.materialId,
              section: issueRow.section
            }
          },
          data: { quantity: { decrement: item.quantity } }
        });

        await tx.stockMovement.create({
          data: {
            warehouseId: issueRow.warehouseId,
            materialId: item.materialId,
            quantity: item.quantity,
            direction: StockMovementDirection.OUT,
            sourceDocumentType: "OPERATION",
            sourceDocumentId: operation.id,
            operationId: operation.id,
            issueRequestId: issueRow.id,
            createdById: req.user!.userId
          }
        });

        if (issueRow.projectId) {
          const latestLimit = await tx.projectLimit.findFirst({
            where: { projectId: issueRow.projectId },
            orderBy: { version: "desc" }
          });
          if (latestLimit) {
            await tx.projectLimitItem.updateMany({
              where: { projectLimitId: latestLimit.id, materialId: item.materialId },
              data: { issuedQty: { increment: item.quantity } }
            });
            const updatedLine = await tx.projectLimitItem.findUnique({
              where: {
                projectLimitId_materialId: {
                  projectLimitId: latestLimit.id,
                  materialId: item.materialId
                }
              },
              include: { material: { select: { name: true, unit: true } } }
            });
            if (updatedLine && Number(updatedLine.issuedQty) > Number(updatedLine.plannedQty)) {
              // Шинная рассылка о перерасходе. Делаем «вне» транзакции через void.
              void dispatchNotification({
                eventCode: "LIMIT_OVERRUN",
                title: "Перерасход по лимиту",
                message: `«${updatedLine.material?.name ?? item.materialId}»: выдано ${Number(updatedLine.issuedQty)} > план ${Number(updatedLine.plannedQty)} ${updatedLine.material?.unit ?? ""}`.trim(),
                entityType: "ProjectLimitItem",
                entityId: item.materialId,
                excludeUserIds: [req.user!.userId]
              }).catch(() => undefined);
            }
          }
        }
      }

      const updatedIssue = await tx.issueRequest.update({
        where: { id: issueRow.id },
        data: {
          status: IssueRequestStatus.ISSUED,
          actualRecipientName: actualRecipientName.trim()
        }
      });

      return { operation, issue: updatedIssue };
    });

    // STOCK_LOW: после выдачи проверим, не упал ли остаток ниже универсального порога.
    void (async () => {
      try {
        const threshold = await getLowStockThreshold();
        for (const it of issueRow.items) {
          const s = await prisma.stock.findUnique({
            where: {
              warehouseId_materialId_section: {
                warehouseId: issueRow.warehouseId,
                materialId: it.materialId,
                section: issueRow.section
              }
            },
            include: { material: { select: { name: true, unit: true } } }
          });
          if (!s) continue;
          const available = Number(s.quantity) - Number(s.reserved);
          if (available < 0) {
            await dispatchNotification({
              eventCode: "STOCK_NEGATIVE",
              title: "Остаток в минусе",
              message: `«${s.material?.name ?? it.materialId}»: ${available} ${s.material?.unit ?? ""}`.trim(),
              entityType: "Stock",
              entityId: it.materialId,
              excludeUserIds: [req.user!.userId]
            }).catch(() => undefined);
          } else if (available <= threshold) {
            await dispatchNotification({
              eventCode: "STOCK_LOW",
              title: "Низкий остаток",
              message: `«${s.material?.name ?? it.materialId}»: ${available} ≤ ${threshold} ${s.material?.unit ?? ""}`.trim(),
              entityType: "Stock",
              entityId: it.materialId,
              excludeUserIds: [req.user!.userId]
            }).catch(() => undefined);
          }
        }
      } catch {
        // ignore
      }
    })();
    void dispatchNotification({
      eventCode: "ISSUE_ISSUED",
      title: "Выдача проведена",
      message: `По заявке ${issueRow.number} оформлена выдача`,
      entityType: "IssueRequest",
      entityId: issueRow.id,
      excludeUserIds: [req.user!.userId]
    }).catch(() => undefined);

    const { operation, issue } = result;
    let document: Awaited<ReturnType<typeof createIssueActDocument>> | null = null;
    try {
      document = await createIssueActDocument({
        issueId: issue.id,
        operationId: operation.id,
        storekeeperId: req.user!.userId,
        actualRecipientName: actualRecipientName.trim()
      });
    } catch (documentError) {
      console.error("Failed to generate issue act", documentError);
    }
    if (signedUpload) {
      try {
        const row = await attachSignedIssueAttachment({
          issueId: issue.id,
          operationId: operation.id,
          userId: req.user!.userId,
          file: signedUpload
        });
        signedAttachment = { id: row.id, filePath: row.filePath, fileName: row.fileName };
      } catch (attachErr) {
        console.error("Failed to attach signed issue scan", attachErr);
      }
    }
    await recordAudit({
      userId: req.user!.userId,
      action: "ISSUE_REQUEST_ISSUE",
      entityType: "IssueRequest",
      entityId: id,
      summary: `Выдача по заявке ${issue.number} (позиций: ${operation.items?.length ?? 0})`,
      before: { status: prevStatus as IssueRequestStatus },
      after: {
        status: issue.status,
        operationId: operation.id,
        warehouseId: operation.warehouseId,
        section: operation.section,
        projectId: operation.projectId,
        items:
          operation.items?.map((i) => ({
            materialId: i.materialId,
            quantity: Number(i.quantity)
          })) ?? [],
        documentId: document?.id ?? null
      }
    });
    await safeNotify({
      userId: issue.requestedById,
      title: "Материалы выданы по заявке",
      message: `Заявка ${issue.number} проведена. Операция: ${operation.documentNumber || operation.id}.`,
      entityType: "IssueRequest",
      entityId: issue.id
    });

    return res.json({ operation, issue, document, signedAttachment });
  } catch (error) {
    if (error instanceof Error && error.message === "LIMIT_EXCEEDED_NEEDS_APPROVAL") {
      return res.status(409).json({ error: "Limit exceeded. Send request for approval." });
    }
    if (error instanceof Error && error.message.startsWith("INSUFFICIENT_STOCK:")) {
      return res.status(409).json({ error: "Insufficient stock", materialId: error.message.split(":")[1] });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});
