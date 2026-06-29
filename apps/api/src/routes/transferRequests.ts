import { TransferRequestStatus } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import {
  assertWarehouseInScope,
  getRequestDataScope,
  stockWhereFromScope,
  transferRequestWhereFromScope
} from "../lib/dataScope.js";
import { dispatchCriticalNotification } from "../lib/notifications.js";
import { prisma } from "../lib/prisma.js";
import {
  assertCampItemsTransferable,
  assertLinesAvailable,
  assertToolsTransferable,
  completeCampTransfer,
  completeToolTransfer,
  completeTransfer,
  releaseTransferReservations,
  reserveTransferLines
} from "../lib/transferStock.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { materialQtyCoerceSchema } from "../lib/quantity.js";

const lineSchema = z.object({
  materialId: z.string().min(1),
  quantity: materialQtyCoerceSchema,
  limitNodeId: z.string().optional()
});

const createSchema = z
  .object({
    fromWarehouseId: z.string().min(1),
    toWarehouseId: z.string().min(1),
    section: z.enum(["SS", "EOM"]),
    note: z.string().max(4000).optional(),
    lines: z.array(lineSchema).max(200).default([]),
    toolIds: z.array(z.string().min(1)).max(100).default([]),
    campItemIds: z.array(z.string().min(1)).max(100).default([])
  })
  .superRefine((data, ctx) => {
    if (!data.lines.length && !data.toolIds.length && !data.campItemIds.length) {
      ctx.addIssue({
        code: "custom",
        message: "Добавьте материалы, инструменты или элементы городка",
        path: ["lines"]
      });
    }
  });

const patchSchema = z.object({
  status: z.nativeEnum(TransferRequestStatus),
  note: z.string().max(4000).optional()
});

export const transferRequestsRouter = Router();
transferRequestsRouter.use(requireAuth);
transferRequestsRouter.use(requirePermission("waybills.read"));

function userHasWarehouse(scope: Awaited<ReturnType<typeof getRequestDataScope>>, warehouseId: string) {
  if (scope.unrestricted && !scope.warehouseIds?.length) return true;
  return scope.warehouseIds?.includes(warehouseId) ?? false;
}

function formatLinesList(
  lines: Array<{ quantity: unknown; material?: { name: string; unit: string } | null }>
) {
  return lines
    .map((ln) => `• ${ln.material?.name ?? "—"} — ${Number(ln.quantity)} ${ln.material?.unit ?? ""}`.trim())
    .join("\n");
}

function serialize(tr: {
  id: string;
  seq: number;
  fromWarehouseId: string;
  toWarehouseId: string;
  section: string;
  requestedById: string;
  approvedById: string | null;
  receivedById: string | null;
  status: TransferRequestStatus;
  note: string | null;
  approvedAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  fromWarehouse?: { id: string; name: string };
  toWarehouse?: { id: string; name: string };
  requestedBy?: { id: string; fullName: string };
  lines?: Array<{
    materialId: string;
    quantity: unknown;
    limitNodeId?: string | null;
    material?: { id: string; name: string; unit: string };
  }>;
  toolLines?: Array<{
    toolId: string;
    tool?: { id: string; name: string; inventoryNumber: string };
  }>;
  campLines?: Array<{
    campItemId: string;
    campItem?: { id: string; name: string; inventoryNumber?: string | null };
  }>;
  documentCount?: number;
}) {
  return {
    id: tr.id,
    number: `ПЕР-${tr.seq}`,
    fromWarehouseId: tr.fromWarehouseId,
    toWarehouseId: tr.toWarehouseId,
    fromWarehouseName: tr.fromWarehouse?.name ?? null,
    toWarehouseName: tr.toWarehouse?.name ?? null,
    section: tr.section,
    requestedById: tr.requestedById,
    requesterName: tr.requestedBy?.fullName ?? null,
    approvedById: tr.approvedById,
    receivedById: tr.receivedById,
    status: tr.status,
    note: tr.note,
    approvedAt: tr.approvedAt?.toISOString() ?? null,
    receivedAt: tr.receivedAt?.toISOString() ?? null,
    createdAt: tr.createdAt.toISOString(),
    updatedAt: tr.updatedAt.toISOString(),
    documentCount: tr.documentCount ?? 0,
    lines: (tr.lines ?? []).map((ln) => ({
      materialId: ln.materialId,
      quantity: Number(ln.quantity),
      limitNodeId: ln.limitNodeId ?? null,
      materialName: ln.material?.name ?? "",
      unit: ln.material?.unit ?? ""
    })),
    tools: (tr.toolLines ?? []).map((ln) => ({
      toolId: ln.toolId,
      name: ln.tool?.name ?? "",
      inventoryNumber: ln.tool?.inventoryNumber ?? ""
    })),
    campItems: (tr.campLines ?? []).map((ln) => ({
      campItemId: ln.campItemId,
      name: ln.campItem?.name ?? "",
      inventoryNumber: ln.campItem?.inventoryNumber ?? null
    }))
  };
}

transferRequestsRouter.get("/peer-inventory", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const toWarehouseId = typeof req.query.toWarehouseId === "string" ? req.query.toWarehouseId : "";
  const sectionParam = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionParam === "SS" || sectionParam === "EOM" ? sectionParam : "SS";

  if (!toWarehouseId) {
    return res.status(400).json({ error: "toWarehouseId required" });
  }

  try {
    assertWarehouseInScope(scope, toWarehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }

  // Остатки «чужих» объектов для заявки — все активные склады, кроме получателя.
  // Не сужаем до activeWarehouse в scope: иначе при выбранном объекте в шапке peerIds пустой.
  const peerWarehouses = await prisma.warehouse.findMany({
    where: { isActive: true, id: { not: toWarehouseId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" }
  });
  const peerIds = peerWarehouses.map((w) => w.id);
  if (!peerIds.length) return res.json({ section, toWarehouseId, warehouses: [] });

  const [stocks, toolGroups, campGroups, peerTools, peerCampItems, limitNodes] = await Promise.all([
    prisma.stock.findMany({
      where: {
        warehouseId: { in: peerIds },
        section,
        quantity: { gt: 0 }
      },
      include: { material: true, warehouse: { select: { id: true, name: true } } },
      orderBy: [{ warehouse: { name: "asc" } }, { material: { name: "asc" } }]
    }),
    prisma.tool.groupBy({
      by: ["warehouseId", "status"],
      where: { warehouseId: { in: peerIds }, section },
      _count: { _all: true }
    }),
    prisma.campItem.groupBy({
      by: ["warehouseId"],
      where: { warehouseId: { in: peerIds }, section },
      _count: { _all: true }
    }),
    prisma.tool.findMany({
      where: { warehouseId: { in: peerIds }, section, status: "IN_STOCK" },
      select: {
        id: true,
        name: true,
        inventoryNumber: true,
        warehouseId: true,
        category: { select: { name: true } }
      },
      orderBy: { name: "asc" }
    }),
    prisma.campItem.findMany({
      where: {
        warehouseId: { in: peerIds },
        section,
        status: { not: "WRITTEN_OFF" }
      },
      select: {
        id: true,
        name: true,
        inventoryNumber: true,
        warehouseId: true,
        category: true,
        location: true
      },
      orderBy: { name: "asc" }
    }),
    prisma.objectLimitNode.findMany({
      where: {
        nodeType: "MATERIAL",
        materialId: { not: null },
        template: { warehouseId: { in: peerIds }, section }
      },
      select: { id: true, materialId: true, template: { select: { warehouseId: true } } }
    })
  ]);

  const limitByWhMat = new Map<string, string>();
  for (const n of limitNodes) {
    if (!n.materialId) continue;
    limitByWhMat.set(`${n.template.warehouseId}:${n.materialId}`, n.id);
  }

  const toolsByWh = new Map<string, { total: number; inStock: number; issued: number; inRepair: number }>();
  for (const g of toolGroups) {
    const wh = g.warehouseId ?? "";
    if (!wh) continue;
    const cur = toolsByWh.get(wh) ?? { total: 0, inStock: 0, issued: 0, inRepair: 0 };
    const c = g._count._all;
    cur.total += c;
    if (g.status === "IN_STOCK") cur.inStock += c;
    if (g.status === "ISSUED") cur.issued += c;
    if (g.status === "IN_REPAIR") cur.inRepair += c;
    toolsByWh.set(wh, cur);
  }

  const campByWh = Object.fromEntries(campGroups.map((g) => [g.warehouseId, g._count._all]));

  const stocksByWh = new Map<string, typeof stocks>();
  for (const s of stocks) {
    const list = stocksByWh.get(s.warehouseId) ?? [];
    list.push(s);
    stocksByWh.set(s.warehouseId, list);
  }

  const toolsByWhList = new Map<string, typeof peerTools>();
  for (const t of peerTools) {
    const wh = t.warehouseId ?? "";
    if (!wh) continue;
    const list = toolsByWhList.get(wh) ?? [];
    list.push(t);
    toolsByWhList.set(wh, list);
  }
  const campByWhList = new Map<string, typeof peerCampItems>();
  for (const c of peerCampItems) {
    const wh = c.warehouseId ?? "";
    if (!wh) continue;
    const list = campByWhList.get(wh) ?? [];
    list.push(c);
    campByWhList.set(wh, list);
  }

  const warehousesPayload = peerWarehouses.map((w) => {
    const rows = stocksByWh.get(w.id) ?? [];
    return {
      warehouseId: w.id,
      warehouseName: w.name,
      stocks: rows.map((s) => {
        const qty = Number(s.quantity);
        const reserved = Number(s.reserved);
        const materialId = s.materialId;
        return {
          materialId,
          materialName: s.material.name,
          unit: s.material.unit,
          kind: s.material.kind,
          quantity: qty,
          reserved,
          available: Math.max(0, qty - reserved),
          limitNodeId: limitByWhMat.get(`${w.id}:${materialId}`) ?? null
        };
      }),
      tools: toolsByWh.get(w.id) ?? { total: 0, inStock: 0, issued: 0, inRepair: 0 },
      campItems: campByWh[w.id] ?? 0,
      toolList: (toolsByWhList.get(w.id) ?? []).map((t) => ({
        toolId: t.id,
        name: t.name,
        inventoryNumber: t.inventoryNumber,
        categoryName: t.category?.name ?? null
      })),
      campList: (campByWhList.get(w.id) ?? []).map((c) => ({
        campItemId: c.id,
        name: c.name,
        inventoryNumber: c.inventoryNumber,
        category: c.category,
        location: c.location
      }))
    };
  });

  return res.json({ section, toWarehouseId, warehouses: warehousesPayload });
});

/** Остатки текущего объекта (для подвкладки «Отправить»). */
transferRequestsRouter.get("/own-inventory", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const fromWarehouseId = typeof req.query.fromWarehouseId === "string" ? req.query.fromWarehouseId : "";
  const sectionParam = typeof req.query.section === "string" ? req.query.section.toUpperCase() : "";
  const section = sectionParam === "SS" || sectionParam === "EOM" ? sectionParam : "SS";

  if (!fromWarehouseId) {
    return res.status(400).json({ error: "fromWarehouseId required" });
  }

  try {
    assertWarehouseInScope(scope, fromWarehouseId);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    throw e;
  }

  const warehouse = await prisma.warehouse.findUnique({
    where: { id: fromWarehouseId },
    select: { id: true, name: true }
  });
  if (!warehouse) return res.status(404).json({ error: "Warehouse not found" });

  const [stocks, limitNodes, ownTools, ownCampItems] = await Promise.all([
    prisma.stock.findMany({
      where: {
        AND: [
          stockWhereFromScope(scope),
          { warehouseId: fromWarehouseId, section, quantity: { gt: 0 } }
        ]
      },
      include: { material: true },
      orderBy: { material: { name: "asc" } }
    }),
    prisma.objectLimitNode.findMany({
      where: {
        nodeType: "MATERIAL",
        materialId: { not: null },
        template: { warehouseId: fromWarehouseId, section }
      },
      select: { id: true, materialId: true }
    }),
    prisma.tool.findMany({
      where: { warehouseId: fromWarehouseId, section, status: "IN_STOCK" },
      select: { id: true, name: true, inventoryNumber: true, category: { select: { name: true } } },
      orderBy: { name: "asc" }
    }),
    prisma.campItem.findMany({
      where: { warehouseId: fromWarehouseId, section, status: { not: "WRITTEN_OFF" } },
      select: { id: true, name: true, inventoryNumber: true, category: true, location: true },
      orderBy: { name: "asc" }
    })
  ]);

  const limitByMat = new Map(limitNodes.map((n) => [n.materialId!, n.id]));

  return res.json({
    section,
    fromWarehouseId,
    warehouseName: warehouse.name,
    stocks: stocks.map((s) => {
      const qty = Number(s.quantity);
      const reserved = Number(s.reserved);
      return {
        materialId: s.materialId,
        materialName: s.material.name,
        unit: s.material.unit,
        kind: s.material.kind,
        quantity: qty,
        reserved,
        available: Math.max(0, qty - reserved),
        limitNodeId: limitByMat.get(s.materialId) ?? null
      };
    }),
    tools: ownTools.map((t) => ({
      toolId: t.id,
      name: t.name,
      inventoryNumber: t.inventoryNumber,
      categoryName: t.category?.name ?? null
    })),
    campItems: ownCampItems.map((c) => ({
      campItemId: c.id,
      name: c.name,
      inventoryNumber: c.inventoryNumber,
      category: c.category,
      location: c.location
    }))
  });
});

transferRequestsRouter.get("/", async (req: AuthedRequest, res) => {
  const scope = await getRequestDataScope(req);
  const where = transferRequestWhereFromScope(scope, req.user!.userId);
  const rows = await prisma.transferRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 300,
    include: {
      fromWarehouse: true,
      toWarehouse: true,
      requestedBy: { select: { id: true, fullName: true } },
      lines: { include: { material: true } },
      toolLines: { include: { tool: { select: { id: true, name: true, inventoryNumber: true } } } },
      campLines: { include: { campItem: { select: { id: true, name: true, inventoryNumber: true } } } }
    }
  });

  const ids = rows.map((r) => r.id);
  const docCounts =
    ids.length > 0
      ? await prisma.documentFile.groupBy({
          by: ["entityId"],
          where: { entityType: "transferrequest", entityId: { in: ids }, isDeleted: false },
          _count: { _all: true }
        })
      : [];
  const docById = Object.fromEntries(docCounts.map((d) => [d.entityId, d._count._all]));

  return res.json(rows.map((r) => serialize({ ...r, documentCount: docById[r.id] ?? 0 })));
});

transferRequestsRouter.post("/", requirePermission("waybills.write"), async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }
  if (parsed.data.fromWarehouseId === parsed.data.toWarehouseId) {
    return res.status(400).json({ error: "SAME_WAREHOUSE" });
  }

  try {
    const scope = await getRequestDataScope(req);
    const { fromWarehouseId, toWarehouseId } = parsed.data;
    const canFrom = (() => {
      try {
        assertWarehouseInScope(scope, fromWarehouseId);
        return true;
      } catch {
        return false;
      }
    })();
    const canTo = (() => {
      try {
        assertWarehouseInScope(scope, toWarehouseId);
        return true;
      } catch {
        return false;
      }
    })();
    if (!canFrom && !canTo) {
      return res.status(403).json({ error: "FORBIDDEN_WAREHOUSE" });
    }

    const materialIds = [...new Set(parsed.data.lines.map((l) => l.materialId))];
    if (materialIds.length) {
      const mats = await prisma.material.findMany({ where: { id: { in: materialIds } }, select: { id: true } });
      if (mats.length !== materialIds.length) {
        return res.status(400).json({ error: "UNKNOWN_MATERIAL" });
      }
    }

    const toolIds = [...new Set(parsed.data.toolIds)];
    const campItemIds = [...new Set(parsed.data.campItemIds)];

    if (parsed.data.lines.length) {
      await assertLinesAvailable({
        id: "draft",
        fromWarehouseId: parsed.data.fromWarehouseId,
        toWarehouseId: parsed.data.toWarehouseId,
        section: parsed.data.section,
        lines: parsed.data.lines
      });
    }
    await assertToolsTransferable(parsed.data.fromWarehouseId, parsed.data.section, toolIds);
    await assertCampItemsTransferable(parsed.data.fromWarehouseId, parsed.data.section, campItemIds);

    const row = await prisma.transferRequest.create({
      data: {
        fromWarehouseId: parsed.data.fromWarehouseId,
        toWarehouseId: parsed.data.toWarehouseId,
        section: parsed.data.section,
        requestedById: req.user!.userId,
        note: parsed.data.note?.trim() || undefined,
        ...(parsed.data.lines.length
          ? {
              lines: {
                create: parsed.data.lines.map((l) => ({
                  materialId: l.materialId,
                  quantity: l.quantity,
                  limitNodeId: l.limitNodeId || undefined
                }))
              }
            }
          : {}),
        ...(toolIds.length ? { toolLines: { create: toolIds.map((toolId) => ({ toolId })) } } : {}),
        ...(campItemIds.length
          ? { campLines: { create: campItemIds.map((campItemId) => ({ campItemId })) } }
          : {})
      },
      include: {
        fromWarehouse: true,
        toWarehouse: true,
        requestedBy: { select: { id: true, fullName: true } },
        lines: { include: { material: true } },
        toolLines: { include: { tool: { select: { id: true, name: true, inventoryNumber: true } } } },
        campLines: { include: { campItem: { select: { id: true, name: true, inventoryNumber: true } } } }
      }
    });

    const linesText = [
      formatLinesList(row.lines),
      row.toolLines?.length
        ? row.toolLines.map((ln) => `• ${ln.tool?.name ?? "—"} (инв. ${ln.tool?.inventoryNumber ?? "—"})`).join("\n")
        : "",
      row.campLines?.length
        ? row.campLines.map((ln) => `• ${ln.campItem?.name ?? "—"}`).join("\n")
        : ""
    ]
      .filter(Boolean)
      .join("\n");
    const msg = `${row.requestedBy?.fullName ?? "Пользователь"} запросил перемещение ${serialize(row).number}:\n${row.fromWarehouse.name} → ${row.toWarehouse.name} (${row.section})\n\n${linesText}${row.note ? `\n\nКомментарий: ${row.note}` : ""}`;

    await dispatchCriticalNotification({
      eventCode: "TRANSFER_REQUESTED",
      warehouseId: parsed.data.fromWarehouseId,
      title: "Заявка на перемещение",
      message: msg,
      entityType: "transferrequest",
      entityId: row.id,
      excludeUserIds: [req.user!.userId]
    });

    return res.status(201).json(serialize({ ...row, documentCount: 0 }));
  } catch (error) {
    const err = error as Error & { status?: number };
    if (err.status === 403) return res.status(403).json({ error: err.message });
    if (String(err.message).startsWith("INSUFFICIENT") || String(err.message).startsWith("NO_STOCK")) {
      return res.status(409).json({ error: "Недостаточно доступного остатка на складе-отправителе" });
    }
    if (
      String(err.message).startsWith("TOOL_") ||
      String(err.message).startsWith("CAMP_") ||
      String(err.message).startsWith("UNKNOWN_TOOL") ||
      String(err.message).startsWith("UNKNOWN_CAMP")
    ) {
      return res.status(409).json({ error: "Позиция недоступна для перемещения" });
    }
    throw error;
  }
});

transferRequestsRouter.patch("/:id", requirePermission("waybills.write"), async (req: AuthedRequest, res) => {
  const transferId = typeof req.params.id === "string" ? req.params.id : req.params.id?.[0];
  if (!transferId) return res.status(400).json({ error: "BAD_ID" });

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
  }

  const scope = await getRequestDataScope(req);
  const vis = transferRequestWhereFromScope(scope, req.user!.userId);

  const existing = await prisma.transferRequest.findFirst({
    where: { AND: [{ id: transferId }, vis] },
    include: {
      fromWarehouse: true,
      toWarehouse: true,
      requestedBy: { select: { id: true, fullName: true } },
      lines: { include: { material: true } },
      toolLines: true,
      campLines: true
    }
  });
  if (!existing) return res.status(404).json({ error: "NOT_FOUND" });

  const next = parsed.data.status;
  const uid = req.user!.userId;
  let allowed = false;

  if (
    next === TransferRequestStatus.CANCELLED &&
    existing.status === TransferRequestStatus.NEW &&
    existing.requestedById === uid
  ) {
    allowed = true;
  } else if (existing.status === TransferRequestStatus.NEW && next === TransferRequestStatus.APPROVED) {
    allowed = userHasWarehouse(scope, existing.fromWarehouseId);
  } else if (existing.status === TransferRequestStatus.NEW && next === TransferRequestStatus.REJECTED) {
    allowed = userHasWarehouse(scope, existing.fromWarehouseId);
  } else if (existing.status === TransferRequestStatus.APPROVED && next === TransferRequestStatus.DONE) {
    allowed = userHasWarehouse(scope, existing.toWarehouseId);
  }

  if (!allowed) return res.status(403).json({ error: "FORBIDDEN_STATUS" });

  try {
    const row = await prisma.$transaction(async (tx) => {
      if (next === TransferRequestStatus.APPROVED) {
        if (existing.lines.length) {
          await reserveTransferLines(tx, existing);
        }
        return tx.transferRequest.update({
          where: { id: existing.id },
          data: {
            status: next,
            approvedById: uid,
            approvedAt: new Date(),
            ...(parsed.data.note !== undefined ? { note: parsed.data.note.trim() || null } : {})
          },
          include: {
            fromWarehouse: true,
            toWarehouse: true,
            requestedBy: { select: { id: true, fullName: true } },
            lines: { include: { material: true } }
          }
        });
      }

      if (
        next === TransferRequestStatus.REJECTED ||
        (next === TransferRequestStatus.CANCELLED && existing.status === TransferRequestStatus.APPROVED)
      ) {
        if (existing.status === TransferRequestStatus.APPROVED) {
          await releaseTransferReservations(tx, existing);
        }
        return tx.transferRequest.update({
          where: { id: existing.id },
          data: {
            status: next === TransferRequestStatus.CANCELLED ? TransferRequestStatus.CANCELLED : next,
            ...(parsed.data.note !== undefined ? { note: parsed.data.note.trim() || null } : {})
          },
          include: {
            fromWarehouse: true,
            toWarehouse: true,
            requestedBy: { select: { id: true, fullName: true } },
            lines: { include: { material: true } }
          }
        });
      }

      if (next === TransferRequestStatus.DONE) {
        const docCount = await tx.documentFile.count({
          where: { entityType: "transferrequest", entityId: existing.id, isDeleted: false }
        });
        if (docCount < 1) {
          throw new Error("ACT_REQUIRED");
        }
        if (existing.lines.length) {
          await completeTransfer(tx, existing, uid);
        }
        const toolIds = existing.toolLines.map((l) => l.toolId);
        const campItemIds = existing.campLines.map((l) => l.campItemId);
        if (toolIds.length) {
          await completeToolTransfer(tx, existing, toolIds, uid);
        }
        if (campItemIds.length) {
          await completeCampTransfer(tx, existing, campItemIds, uid);
        }
        return tx.transferRequest.update({
          where: { id: existing.id },
          data: {
            status: next,
            receivedById: uid,
            receivedAt: new Date(),
            ...(parsed.data.note !== undefined ? { note: parsed.data.note.trim() || null } : {})
          },
          include: {
            fromWarehouse: true,
            toWarehouse: true,
            requestedBy: { select: { id: true, fullName: true } },
            lines: { include: { material: true } }
          }
        });
      }

      return tx.transferRequest.update({
        where: { id: existing.id },
        data: {
          status: next,
          ...(parsed.data.note !== undefined ? { note: parsed.data.note.trim() || null } : {})
        },
        include: {
          fromWarehouse: true,
          toWarehouse: true,
          requestedBy: { select: { id: true, fullName: true } },
          lines: { include: { material: true } }
        }
      });
    });

    const ser = serialize(row);
    const notifyMsg = `Статус ${ser.number}: ${transferRequestStatusRu(next)}`;
    if (row.requestedById !== uid) {
      await dispatchCriticalNotification({
        eventCode: "TRANSFER_REQUESTED",
        warehouseId: row.toWarehouseId,
        title: "Заявка на перемещение",
        message: notifyMsg,
        entityType: "transferrequest",
        entityId: row.id,
        forceRecipients: [row.requestedById]
      }).catch(() => undefined);
    }

    const docCount = await prisma.documentFile.count({
      where: { entityType: "transferrequest", entityId: row.id, isDeleted: false }
    });

    return res.json(serialize({ ...row, documentCount: docCount }));
  } catch (error) {
    if (String(error).includes("ACT_REQUIRED")) {
      return res.status(400).json({ error: "Прикрепите акт перемещения перед приёмом" });
    }
    const err = error as Error;
    if (String(err.message).startsWith("INSUFFICIENT")) {
      return res.status(409).json({ error: "Недостаточно остатка для завершения перемещения" });
    }
    throw error;
  }
});

function transferRequestStatusRu(status: TransferRequestStatus) {
  const map: Record<TransferRequestStatus, string> = {
    NEW: "Новая",
    APPROVED: "Согласована (зарезервировано)",
    REJECTED: "Отклонена",
    DONE: "Принята",
    CANCELLED: "Отменена"
  };
  return map[status] ?? status;
}
