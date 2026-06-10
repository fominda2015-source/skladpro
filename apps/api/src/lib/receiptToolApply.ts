import { ToolStatus, type ObjectSection, type Prisma, type ReceiptItemCategory } from "@prisma/client";
import {
  ensureDefaultToolCategories,
  receiptCategoryToToolSection,
  toolSectionToCategorySlugs
} from "./toolCatalog.js";

export function isToolInventoryReceiptCategory(cat: ReceiptItemCategory | null | undefined): boolean {
  if (!cat) return false;
  return (
    cat === "TOOL_MANUAL" ||
    cat === "TOOL_ELECTRIC_CORDLESS" ||
    cat === "TOOL_ELECTRIC_CORDED" ||
    cat === "PPE"
  );
}

/** Категория прихода ведёт в каталог инструментов/СИЗ (учётные единицы Tool). */
export function isToolCatalogReceiptCategory(cat: ReceiptItemCategory | null | undefined): boolean {
  return receiptCategoryToToolSection(cat) != null;
}

/** Категория прихода — складская позиция каталога (расходники, КИП…), не учётная единица Tool. */
export function isToolCatalogMaterialReceiptCategory(cat: ReceiptItemCategory | null | undefined): boolean {
  if (!cat || isToolInventoryReceiptCategory(cat)) return false;
  return receiptCategoryToToolSection(cat) != null;
}

function buildToolQrCode(inventoryNumber: string): string {
  return `TOOL:${inventoryNumber}`;
}

export async function resolveToolCategoryIdFromReceipt(
  tx: Prisma.TransactionClient,
  cat: ReceiptItemCategory | null | undefined
): Promise<string | null> {
  const section = receiptCategoryToToolSection(cat);
  if (!section) return null;
  const slugs = toolSectionToCategorySlugs(section);
  if (!slugs.length) return null;

  const findBySlugs = async () => {
    for (const slug of slugs) {
      const row = await tx.toolCategory.findFirst({ where: { slug } });
      if (row) return row.id;
    }
    return null;
  };

  let id = await findBySlugs();
  if (!id) {
    await ensureDefaultToolCategories();
    id = await findBySlugs();
  }
  return id;
}

async function nextInventoryNumber(
  tx: Prisma.TransactionClient,
  receiptNumber: string,
  itemId: string,
  index: number
): Promise<string> {
  const base = receiptNumber.replace(/[^\w.-]+/g, "").slice(0, 24) || "RC";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix =
      attempt === 0
        ? `${itemId.slice(-6)}-${String(index + 1).padStart(2, "0")}`
        : `${itemId.slice(-4)}-${Date.now().toString(36)}-${attempt}`;
    const candidate = `RC-${base}-${suffix}`.slice(0, 80);
    const exists = await tx.tool.findUnique({
      where: { inventoryNumber: candidate },
      select: { id: true }
    });
    if (!exists) return candidate;
  }
  return `RC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Создаёт учётные единицы инструмента (Tool) по категории прихода — не складские остатки. */
export async function createToolsFromReceiptAccept(
  tx: Prisma.TransactionClient,
  opts: {
    receiptNumber: string;
    itemId: string;
    name: string;
    categoryId: string;
    warehouseId: string;
    section: ObjectSection;
    qty: number;
    userId: string;
    storagePlace?: string | null;
  }
): Promise<number> {
  const count = Math.max(1, Math.round(opts.qty));
  const noteParts = [`Принято по заявке ${opts.receiptNumber}`];
  if (opts.storagePlace?.trim()) noteParts.push(`Место: ${opts.storagePlace.trim()}`);
  const note = noteParts.join(". ");

  for (let i = 0; i < count; i += 1) {
    const inventoryNumber = await nextInventoryNumber(tx, opts.receiptNumber, opts.itemId, i);
    const displayName = count > 1 ? `${opts.name.trim()} (${i + 1}/${count})` : opts.name.trim();
    const created = await tx.tool.create({
      data: {
        name: displayName,
        inventoryNumber,
        qrCode: buildToolQrCode(inventoryNumber),
        status: ToolStatus.IN_STOCK,
        warehouseId: opts.warehouseId,
        section: opts.section,
        categoryId: opts.categoryId,
        note,
        kitComplete: true,
        kitMissingNote: null
      }
    });
    await tx.toolEvent.create({
      data: {
        toolId: created.id,
        action: "CREATE",
        status: ToolStatus.IN_STOCK,
        comment: note,
        actorId: opts.userId
      }
    });
  }
  return count;
}
