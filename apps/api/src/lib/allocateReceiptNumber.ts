import { prisma } from "./prisma.js";

function parseOrdSeq(number: string): number | null {
  const m = number.match(/^ORD-0*(\d+)(?:-\d+)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

async function receiptNumberTaken(warehouseId: string, number: string): Promise<boolean> {
  const row = await prisma.receiptRequest.findFirst({
    where: { warehouseId, number },
    select: { id: true }
  });
  return Boolean(row);
}

/**
 * Уникальный номер заявки на объекте. Номер из Excel — в externalOrderNumber (может повторяться).
 */
export async function allocateReceiptRequestNumber(
  warehouseId: string,
  orderNumberFromSheet?: string | null
): Promise<{ number: string; externalOrderNumber: string | null }> {
  const ext = orderNumberFromSheet?.trim() || null;

  if (ext) {
    const base = `ORD-${ext}`;
    if (!(await receiptNumberTaken(warehouseId, base))) {
      return { number: base, externalOrderNumber: ext };
    }
    for (let suffix = 2; suffix < 10_000; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!(await receiptNumberTaken(warehouseId, candidate))) {
        return { number: candidate, externalOrderNumber: ext };
      }
    }
    throw new Error("Не удалось выделить уникальный номер заявки");
  }

  const rows = await prisma.receiptRequest.findMany({
    where: { warehouseId },
    select: { number: true }
  });
  let maxSeq = 0;
  for (const r of rows) {
    const seq = parseOrdSeq(r.number);
    if (seq != null) maxSeq = Math.max(maxSeq, seq);
  }

  for (let seq = maxSeq + 1; seq < maxSeq + 10_000; seq += 1) {
    for (const candidate of [`ORD-${String(seq).padStart(5, "0")}`, `ORD-${seq}`]) {
      if (!(await receiptNumberTaken(warehouseId, candidate))) {
        return { number: candidate, externalOrderNumber: null };
      }
    }
  }

  throw new Error("Не удалось выделить уникальный номер заявки");
}
