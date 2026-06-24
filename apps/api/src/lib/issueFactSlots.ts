import type { ObjectSection } from "@prisma/client";
import { prisma } from "./prisma.js";

export type FactIssueSlotRow = {
  factLabel: string;
  factUnit: string;
  materialId: string;
  materialName: string;
  limitNodeId: string | null;
  limitSectionPath: string | null;
  acceptedQty: number;
  issuedQty: number;
  remainingQty: number;
};

function slotKey(materialId: string, limitNodeId: string | null, factLabel: string, factUnit: string) {
  return `${materialId}|${limitNodeId ?? ""}|${factLabel.trim().toLowerCase()}|${factUnit.trim().toLowerCase()}`;
}

export async function computeFactIssueSlots(opts: {
  warehouseId: string;
  section: ObjectSection;
}): Promise<FactIssueSlotRow[]> {
  const receiptItems = await prisma.receiptRequestItem.findMany({
    where: {
      mappedMaterialId: { not: null },
      acceptedQty: { gt: 0 },
      receiptRequest: {
        warehouseId: opts.warehouseId,
        section: opts.section,
        status: { in: ["RECEIVED", "IN_PROGRESS"] }
      }
    },
    select: {
      factLabel: true,
      factUnit: true,
      sourceUnit: true,
      acceptedQty: true,
      limitNodeId: true,
      limitSectionPath: true,
      mappedMaterialId: true,
      sourceName: true,
      mappedMaterial: { select: { id: true, name: true, unit: true } }
    }
  });

  const accepted = new Map<
    string,
    {
      factLabel: string;
      factUnit: string;
      materialId: string;
      materialName: string;
      limitNodeId: string | null;
      limitSectionPath: string | null;
      acceptedQty: number;
    }
  >();

  for (const it of receiptItems) {
    const materialId = it.mappedMaterialId!;
    const canon = (it.mappedMaterial?.name || it.sourceName).trim();
    const factName = (it.factLabel || "").trim();
    const displayFact = factName || canon;
    const factUnit = (it.factUnit || "").trim() || it.sourceUnit || it.mappedMaterial?.unit || "шт";
    const qty = Number(it.acceptedQty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const key = slotKey(materialId, it.limitNodeId, displayFact, factUnit);
    const prev = accepted.get(key);
    if (prev) {
      prev.acceptedQty += qty;
    } else {
      accepted.set(key, {
        factLabel: displayFact,
        factUnit,
        materialId,
        materialName: it.mappedMaterial?.name || it.sourceName,
        limitNodeId: it.limitNodeId,
        limitSectionPath: it.limitSectionPath,
        acceptedQty: qty
      });
    }
  }

  const issueItems = await prisma.issueRequestItem.findMany({
    where: {
      limitNodeId: { not: null },
      issueRequest: {
        warehouseId: opts.warehouseId,
        section: opts.section,
        status: "ISSUED"
      }
    },
    select: {
      materialId: true,
      limitNodeId: true,
      factLabel: true,
      quantity: true,
      returnedQty: true,
      material: { select: { name: true, unit: true } }
    }
  });

  const issued = new Map<string, number>();
  for (const it of issueItems) {
    const factLabel = (it.factLabel || it.material.name).trim();
    const factUnit = it.material.unit;
    const net = Number(it.quantity) - Number(it.returnedQty || 0);
    if (net <= 0) continue;
    const key = slotKey(it.materialId, it.limitNodeId, factLabel, factUnit);
    issued.set(key, (issued.get(key) || 0) + net);
  }

  const rows: FactIssueSlotRow[] = [];
  for (const [key, slot] of accepted) {
    const issuedQty = issued.get(key) || 0;
    const remainingQty = Math.max(0, slot.acceptedQty - issuedQty);
    rows.push({
      factLabel: slot.factLabel,
      factUnit: slot.factUnit,
      materialId: slot.materialId,
      materialName: slot.materialName,
      limitNodeId: slot.limitNodeId,
      limitSectionPath: slot.limitSectionPath,
      acceptedQty: slot.acceptedQty,
      issuedQty,
      remainingQty
    });
  }

  return rows.sort((a, b) =>
    a.factLabel.localeCompare(b.factLabel, "ru", { sensitivity: "base" })
  );
}

export async function assertFactSlotIssueCapacity(opts: {
  warehouseId: string;
  section: ObjectSection;
  materialId: string;
  limitNodeId: string | null;
  factLabel: string | null;
  quantity: number;
  materialName?: string;
  materialUnit?: string;
}): Promise<string | undefined> {
  if (!opts.limitNodeId) return undefined;
  const slots = await computeFactIssueSlots({
    warehouseId: opts.warehouseId,
    section: opts.section
  });
  const factLabel = (opts.factLabel || opts.materialName || "").trim();
  const factUnit = opts.materialUnit || "шт";
  const key = slotKey(opts.materialId, opts.limitNodeId, factLabel, factUnit);
  const slot = slots.find(
    (s) => slotKey(s.materialId, s.limitNodeId, s.factLabel, s.factUnit) === key
  );
  if (!slot) {
    return `По выбранному узлу лимита нет принятого количества для «${factLabel}».`;
  }
  if (opts.quantity > slot.remainingQty + 1e-9) {
    const path = slot.limitSectionPath?.trim() || "узел лимита";
    return `Нельзя выдать больше ${slot.remainingQty} ${factUnit} из «${path}» (принято ${slot.acceptedQty}, уже выдано ${slot.issuedQty}).`;
  }
  return undefined;
}
