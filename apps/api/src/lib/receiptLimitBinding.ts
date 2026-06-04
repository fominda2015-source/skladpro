import type { Prisma } from "@prisma/client";
import { findMaterialNodeByLimitPath } from "./receiptLimitSync.js";
import { receiptAcceptedQty } from "./receiptQty.js";
import { prisma } from "./prisma.js";

type Tx = Prisma.TransactionClient;

const normalize = (s: string | null | undefined) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export type ReceiptLimitItemRef = {
  id?: string;
  sourceName: string;
  mappedMaterialId: string | null;
  limitNodeId: string | null;
  limitSectionPath: string | null;
  limitCatalogNameN: string | null;
  limitCatalogNameO: string | null;
  acceptedQty?: unknown;
};

type TreeNode = {
  id: string;
  parentId: string | null;
  nodeType: string;
  title: string;
  materialName: string | null;
  indexLabel?: string | null;
};

type MaterialNode = TreeNode & {
  materialId: string | null;
  plannedQty?: unknown;
};

function nodeMatchesMaterial(
  node: MaterialNode,
  materialId: string | null,
  sourceName: string
): boolean {
  if (materialId && node.materialId && node.materialId === materialId) return true;
  if (
    !materialId &&
    node.materialName &&
    sourceName &&
    normalize(node.materialName) === normalize(sourceName)
  ) {
    return true;
  }
  return false;
}

/** Один узел лимита для позиции заявки: путь M → закреплённый узел → единственное совпадение по имени. */
export function resolvePrimaryReceiptLimitNode(
  allTreeNodes: TreeNode[],
  materialNodes: MaterialNode[],
  item: ReceiptLimitItemRef
): MaterialNode | null {
  if (item.limitNodeId) {
    return materialNodes.find((n) => n.id === item.limitNodeId) ?? null;
  }

  const searchNames = [item.sourceName, item.limitCatalogNameN || "", item.limitCatalogNameO || ""].filter(
    Boolean
  );

  if (item.limitSectionPath?.trim()) {
    const byPath = findMaterialNodeByLimitPath(allTreeNodes, item.limitSectionPath, searchNames);
    if (byPath) return materialNodes.find((n) => n.id === byPath.id) ?? null;
    return null;
  }

  const matches = materialNodes.filter((n) =>
    nodeMatchesMaterial(n, item.mappedMaterialId, item.sourceName)
  );
  if (matches.length === 1) return matches[0]!;
  return null;
}

export async function sumAcceptedQtyOnLimitNode(
  db: Tx | typeof prisma,
  limitNodeId: string,
  excludeReceiptItemId?: string
): Promise<number> {
  const rows = await db.receiptRequestItem.findMany({
    where: {
      limitNodeId,
      ...(excludeReceiptItemId ? { id: { not: excludeReceiptItemId } } : {}),
      receiptRequest: { status: { notIn: ["CANCELLED"] } }
    },
    select: { acceptedQty: true }
  });
  return rows.reduce((sum, r) => sum + receiptAcceptedQty(r.acceptedQty), 0);
}

export type LimitPlanOverageCheck = {
  primaryNodeId: string;
  primaryPath: string;
  plannedQty: number;
  receivedOnNode: number;
  incomingQty: number;
  excessQty: number;
};

export async function checkLimitPlanOverageForAccept(
  db: Tx | typeof prisma,
  templateId: string,
  item: ReceiptLimitItemRef,
  incomingQty: number,
  pathForNode: (nodeId: string) => string
): Promise<LimitPlanOverageCheck | null> {
  const allTree = await db.objectLimitNode.findMany({
    where: { templateId },
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
  const materialNodes = allTree.filter((n) => n.nodeType === "MATERIAL") as MaterialNode[];
  const primary = resolvePrimaryReceiptLimitNode(allTree, materialNodes, item);
  if (!primary) return null;

  const planned = Number(primary.plannedQty ?? 0);
  if (!(planned > 0)) return null;

  const receivedOthers = await sumAcceptedQtyOnLimitNode(db, primary.id, item.id);
  const receivedThis = item.id ? receiptAcceptedQty(item.acceptedQty) : 0;
  const receivedOnNode = receivedOthers + receivedThis;
  const after = receivedOnNode + incomingQty;
  if (after <= planned) return null;

  return {
    primaryNodeId: primary.id,
    primaryPath: pathForNode(primary.id),
    plannedQty: planned,
    receivedOnNode,
    incomingQty,
    excessQty: after - planned
  };
}
