import type { ObjectLimitNode, Prisma } from "@prisma/client";
import { indexTemplateMaterials, pathKeyForMaterialNode } from "./limitImportDiff.js";

type Tx = Prisma.TransactionClient;

type TreeNode = Pick<
  ObjectLimitNode,
  "id" | "parentId" | "nodeType" | "title" | "materialName" | "unit" | "plannedQty" | "issuedQty" | "materialId"
>;

/** После импорта нового лимита перепривязывает приходные заявки, уже связанные с лимитом. */
export async function rebindLinkedReceiptRequestsToTemplate(
  tx: Tx,
  params: {
    warehouseId: string;
    section: "SS" | "EOM";
    newTemplateId: string;
    nextNodes: TreeNode[];
  }
): Promise<{ requests: number; itemsRemapped: number }> {
  const nextIndex = indexTemplateMaterials(params.nextNodes);
  const requests = await tx.receiptRequest.findMany({
    where: {
      warehouseId: params.warehouseId,
      section: params.section,
      objectLimitTemplateId: { not: null }
    },
    include: { items: true }
  });

  const nodesByTemplateId = new Map<string, TreeNode[]>();

  let itemsRemapped = 0;
  for (const req of requests) {
    await tx.receiptRequest.update({
      where: { id: req.id },
      data: {
        objectLimitTemplateId: params.newTemplateId,
        fromLimit: true
      }
    });

    for (const item of req.items) {
      if (!item.limitNodeId) continue;
      const oldNode = await tx.objectLimitNode.findUnique({ where: { id: item.limitNodeId } });
      if (!oldNode || oldNode.nodeType !== "MATERIAL") continue;

      let oldTemplateNodes = nodesByTemplateId.get(oldNode.templateId);
      if (!oldTemplateNodes) {
        oldTemplateNodes = await tx.objectLimitNode.findMany({
          where: { templateId: oldNode.templateId }
        });
        nodesByTemplateId.set(oldNode.templateId, oldTemplateNodes);
      }
      const oldById = new Map(oldTemplateNodes.map((n) => [n.id, n]));
      const pathKey = pathKeyForMaterialNode(oldNode, oldById);
      const nextEntry = nextIndex.get(pathKey);
      if (!nextEntry) continue;
      if (nextEntry.nodeId === item.limitNodeId) continue;
      await tx.receiptRequestItem.update({
        where: { id: item.id },
        data: { limitNodeId: nextEntry.nodeId }
      });
      itemsRemapped += 1;
    }
  }

  return { requests: requests.length, itemsRemapped };
}
