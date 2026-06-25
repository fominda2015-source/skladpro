import { prisma } from "./prisma.js";

async function receiptNumberTaken(warehouseId: string, number: string): Promise<boolean> {
  const row = await prisma.receiptRequest.findFirst({
    where: { warehouseId, number },
    select: { id: true }
  });
  return Boolean(row);
}

/**
 * Номер заявки на объекте — из Excel (поле «Номер заявки») или имени файла.
 * При коллизии: 150423-2, 150423-3 …
 */
export async function allocateReceiptRequestNumber(
  warehouseId: string,
  orderNumberFromSheet?: string | null
): Promise<{ number: string; externalOrderNumber: string | null }> {
  const ext = orderNumberFromSheet?.trim() || null;
  if (!ext) {
    throw new Error("ORDER_NUMBER_REQUIRED");
  }

  if (!(await receiptNumberTaken(warehouseId, ext))) {
    return { number: ext, externalOrderNumber: ext };
  }
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${ext}-${suffix}`;
    if (!(await receiptNumberTaken(warehouseId, candidate))) {
      return { number: candidate, externalOrderNumber: ext };
    }
  }
  throw new Error("Не удалось выделить уникальный номер заявки");
}
