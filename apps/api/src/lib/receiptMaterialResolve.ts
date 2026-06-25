import type { ReceiptItemCategory } from "@prisma/client";
import { analyzeCatalogNames, normNameKey } from "./parseOrderSheet.js";

export type ReceiptCatalogItem = {
  sourceName: string;
  namePartD?: string | null;
  namePartE?: string | null;
  limitCatalogNameN?: string | null;
  limitCatalogNameO?: string | null;
  externalComment?: string | null;
};

export function receiptCatalogMeta(item: ReceiptCatalogItem) {
  return analyzeCatalogNames(
    item.sourceName,
    item.namePartD || "",
    item.namePartE || "",
    item.limitCatalogNameN || "",
    item.limitCatalogNameO || "",
    item.externalComment || ""
  );
}

/** Имя карточки склада: при переименовании в лимите (O) — только O, не N/C из заявки. */
export function canonicalReceiptMaterialName(item: ReceiptCatalogItem): string {
  const meta = receiptCatalogMeta(item);
  if (meta.renameLimitToO && meta.limitDisplayName.trim()) {
    return meta.limitDisplayName.trim();
  }
  const o = (item.limitCatalogNameO || "").trim();
  if (o) return o;
  return meta.limitDisplayName.trim() || item.sourceName.trim();
}

export function catalogArticleToken(name: string | null | undefined): string | null {
  const m = String(name || "").match(/\b\d{4,}\b/);
  return m ? m[0]! : null;
}

export function materialNamesEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const ak = normNameKey(a || "");
  const bk = normNameKey(b || "");
  if (!ak || !bk) return false;
  if (ak === bk) return true;
  const skuA = catalogArticleToken(a);
  const skuB = catalogArticleToken(b);
  if (skuA && skuB && skuA === skuB) return true;
  if (ak.length > 10 && bk.length > 10 && (ak.includes(bk) || bk.includes(ak))) return true;
  return false;
}

export function mappedMaterialMatchesCatalog(
  mappedName: string | null | undefined,
  item: ReceiptCatalogItem
): boolean {
  const canon = canonicalReceiptMaterialName(item);
  if (!mappedName?.trim() || !canon) return false;
  return materialNamesEquivalent(mappedName, canon);
}

export type ReceiptMaterialLookupItem = ReceiptCatalogItem & {
  sourceUnit: string;
  mappedMaterialId?: string | null;
  limitNodeId?: string | null;
  category?: ReceiptItemCategory | null;
};
