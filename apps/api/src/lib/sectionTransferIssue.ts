import { ObjectSection, StockCondition, StockMovementDirection, type Prisma } from "@prisma/client";
import { resolveLimitConsumptionQty } from "./materialLimitBindings.js";

type IssueItemRow = {
  materialId: string;
  quantity: unknown;
  limitNodeId?: string | null;
  material?: { name: string; unit?: string | null } | null;
};

type SectionTransferIssue = {
  id: string;
  warehouseId: string;
  section: ObjectSection;
  stockSection: ObjectSection | null;
};

function qtyOf(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normName(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

async function upsertStockIncrement(
  tx: Prisma.TransactionClient,
  warehouseId: string,
  materialId: string,
  section: ObjectSection,
  delta: number
) {
  const key = {
    warehouseId_materialId_section_condition: {
      warehouseId,
      materialId,
      section,
      condition: StockCondition.NEW
    }
  } as const;
  const row = await tx.stock.findUnique({ where: key });
  if (row) {
    await tx.stock.update({ where: key, data: { quantity: { increment: delta } } });
    return;
  }
  await tx.stock.create({
    data: {
      warehouseId,
      materialId,
      section,
      condition: StockCondition.NEW,
      quantity: delta,
      reserved: 0
    }
  });
}

/** Снимает «красную» выдачу в лимитах подразделения-получателя при обратной передаче (совпадение названия 1:1). */
export async function releaseSectionTransferLimitByMaterialName(
  tx: Prisma.TransactionClient,
  warehouseId: string,
  limitSection: ObjectSection,
  materialName: string,
  qty: number
): Promise<number> {
  const nameKey = normName(materialName);
  if (!nameKey || qty <= 1e-9) return 0;

  const templates = await tx.objectLimitTemplate.findMany({
    where: { warehouseId, section: limitSection },
    select: { id: true }
  });
  if (!templates.length) return 0;

  const nodes = await tx.objectLimitNode.findMany({
    where: {
      templateId: { in: templates.map((t) => t.id) },
      nodeType: "MATERIAL",
      issuedQty: { gt: 0 }
    },
    include: { material: { select: { name: true } } },
    orderBy: { orderNo: "asc" }
  });

  let remaining = qty;
  let released = 0;
  for (const node of nodes) {
    if (remaining <= 1e-9) break;
    const nodeName = normName(node.materialName || node.material?.name || "");
    if (nodeName !== nameKey) continue;
    const outstanding = Number(node.issuedQty);
    if (outstanding <= 0) continue;
    const dec = Math.min(remaining, outstanding);
    await tx.objectLimitNode.update({
      where: { id: node.id },
      data: { issuedQty: { decrement: dec } }
    });
    released += dec;
    remaining -= dec;
  }
  return released;
}

async function incrementSectionLimitIssued(
  tx: Prisma.TransactionClient,
  issue: SectionTransferIssue,
  item: IssueItemRow,
  qty: number
) {
  if (qty <= 1e-9) return;
  if (item.limitNodeId) {
    const limitQty = await resolveLimitConsumptionQty(
      tx,
      issue.warehouseId,
      issue.section,
      item.materialId,
      item.limitNodeId,
      qty
    );
    await tx.objectLimitNode.update({
      where: { id: item.limitNodeId },
      data: { issuedQty: { increment: limitQty } }
    });
    return;
  }
  const templates = await tx.objectLimitTemplate.findMany({
    where: { warehouseId: issue.warehouseId, section: issue.section },
    select: { id: true }
  });
  if (!templates.length) return;
  const nodes = await tx.objectLimitNode.findMany({
    where: {
      templateId: { in: templates.map((t) => t.id) },
      nodeType: "MATERIAL",
      materialId: item.materialId
    },
    take: 1
  });
  if (nodes[0]) {
    await tx.objectLimitNode.update({
      where: { id: nodes[0].id },
      data: { issuedQty: { increment: qty } }
    });
  }
}

/**
 * Межподразделенческая выдача: списание с section, приход на stockSection.
 * Лимиты источника: +issuedQty (красный перерасход).
 * Обратная передача: −issuedQty в лимитах stockSection по точному названию материала.
 */
export async function applySectionTransferStockAndLimits(
  tx: Prisma.TransactionClient,
  issue: SectionTransferIssue,
  item: IssueItemRow,
  operationId: string,
  actorUserId: string
) {
  const dest = issue.stockSection;
  if (!dest || dest === issue.section) return;

  const qty = qtyOf(item.quantity);
  if (qty <= 0) return;

  const materialName = item.material?.name || "";

  await tx.stock.update({
    where: {
      warehouseId_materialId_section_condition: {
        warehouseId: issue.warehouseId,
        materialId: item.materialId,
        section: issue.section,
        condition: StockCondition.NEW
      }
    },
    data: { quantity: { decrement: qty } }
  });

  await upsertStockIncrement(tx, issue.warehouseId, item.materialId, dest, qty);

  const returned = materialName
    ? await releaseSectionTransferLimitByMaterialName(tx, issue.warehouseId, dest, materialName, qty)
    : 0;
  const outboundQty = Math.max(0, qty - returned);
  if (outboundQty > 0) {
    await incrementSectionLimitIssued(tx, issue, item, outboundQty);
  }

  await tx.stockMovement.create({
    data: {
      warehouseId: issue.warehouseId,
      materialId: item.materialId,
      quantity: qty,
      direction: StockMovementDirection.OUT,
      sourceDocumentType: "SECTION_TRANSFER",
      sourceDocumentId: issue.id,
      operationId,
      issueRequestId: issue.id,
      note: `Передача ${issue.section} → ${dest}`,
      createdById: actorUserId
    }
  });
  await tx.stockMovement.create({
    data: {
      warehouseId: issue.warehouseId,
      materialId: item.materialId,
      quantity: qty,
      direction: StockMovementDirection.IN,
      sourceDocumentType: "SECTION_TRANSFER",
      sourceDocumentId: issue.id,
      operationId,
      issueRequestId: issue.id,
      note: `Передача ${issue.section} → ${dest}`,
      createdById: actorUserId
    }
  });
}

export function stockSectionForIssue(issue: { section: ObjectSection; stockSection?: ObjectSection | null }) {
  return issue.stockSection && issue.stockSection !== issue.section ? issue.stockSection : null;
}

export function sourceStockSection(issue: { section: ObjectSection }) {
  return issue.section;
}
