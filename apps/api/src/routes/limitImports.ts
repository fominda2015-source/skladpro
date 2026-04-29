import multer from "multer";
import { Router } from "express";
import xlsx from "xlsx";
import { z } from "zod";
import { assertWarehouseInScope, getRequestDataScope } from "../lib/dataScope.js";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const importQuerySchema = z.object({
  warehouseId: z.string().min(1),
  section: z.enum(["SS", "EOM"]),
  title: z.string().min(2).max(200).optional()
});

type FlatNode = {
  level: number;
  title: string;
  nodeType: "GROUP" | "MATERIAL";
  indexLabel?: string;
  materialName?: string;
  unit?: string;
  plannedQty?: number;
};

function parseLimitSheet(file: Buffer): FlatNode[] {
  const wb = xlsx.read(file, { type: "buffer", cellStyles: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json<Array<string | number | null>>(ws, {
    header: 1,
    raw: false,
    blankrows: false
  });
  const out: FlatNode[] = [];
  let activeTop = "";
  for (const row of rows) {
    const idx = String(row[0] ?? "").trim();
    const name = String(row[1] ?? "").trim();
    const unit = String(row[2] ?? "").trim();
    const qtyRaw = String(row[3] ?? "").replace(",", ".").trim();
    const qty = Number(qtyRaw);
    if (!name) continue;
    if (idx && !Number.isNaN(Number(idx)) && unit === "" && Number.isNaN(qty)) {
      activeTop = idx;
      out.push({ level: 0, title: name, indexLabel: idx, nodeType: "GROUP" });
      continue;
    }
    if (unit === "" && Number.isNaN(qty)) {
      out.push({ level: activeTop ? 1 : 0, title: name, indexLabel: activeTop || undefined, nodeType: "GROUP" });
      continue;
    }
    out.push({
      level: activeTop ? 2 : 1,
      title: name,
      nodeType: "MATERIAL",
      materialName: name,
      unit: unit || undefined,
      plannedQty: Number.isFinite(qty) ? qty : undefined
    });
  }
  return out;
}

export const limitImportsRouter = Router();
limitImportsRouter.use(requireAuth);
limitImportsRouter.use(requirePermission("limits.read"));

limitImportsRouter.post(
  "/upload",
  requirePermission("limits.write"),
  upload.single("file"),
  async (req: AuthedRequest, res) => {
    const parsed = importQuerySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "file is required" });
    }
    const scope = await getRequestDataScope(req);
    try {
      assertWarehouseInScope(scope, parsed.data.warehouseId);
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 403) return res.status(403).json({ error: err.message });
      throw e;
    }
    const nodes = parseLimitSheet(req.file.buffer);
    const title = parsed.data.title?.trim() || `Лимиты ${new Date().toLocaleDateString("ru-RU")}`;
    const created = await prisma.$transaction(async (tx) => {
      const tpl = await tx.objectLimitTemplate.create({
        data: {
          warehouseId: parsed.data.warehouseId,
          section: parsed.data.section,
          title,
          sourceFileName: req.file!.originalname,
          createdById: req.user!.userId
        }
      });
      const parentByLevel = new Map<number, string>();
      for (let i = 0; i < nodes.length; i += 1) {
        const n = nodes[i];
        const row = await tx.objectLimitNode.create({
          data: {
            templateId: tpl.id,
            parentId: n.level > 0 ? parentByLevel.get(n.level - 1) || null : null,
            orderNo: i,
            nodeType: n.nodeType,
            indexLabel: n.indexLabel,
            title: n.title,
            materialName: n.materialName,
            unit: n.unit,
            plannedQty: n.plannedQty
          }
        });
        parentByLevel.set(n.level, row.id);
      }
      return tpl;
    });
    return res.status(201).json({ id: created.id, nodes: nodes.length });
  }
);

limitImportsRouter.get("/", async (req: AuthedRequest, res) => {
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
  const rows = await prisma.objectLimitTemplate.findMany({
    where: {
      ...(warehouseId ? { warehouseId } : {}),
      ...(section ? { section } : {})
    },
    include: {
      nodes: {
        orderBy: { orderNo: "asc" }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 20
  });
  return res.json(rows);
});
