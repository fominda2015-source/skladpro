export type ReceiptItemSearchSource = {
  sourceName: string;
  factLabel?: string | null;
  mappedMaterial?: { name: string } | null;
  limitSectionPath?: string | null;
  limitCatalogNameN?: string | null;
  limitCatalogNameO?: string | null;
  externalComment?: string | null;
  storagePlace?: string | null;
};

export function receiptItemMatchesSearch(it: ReceiptItemSearchSource, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    it.sourceName,
    it.mappedMaterial?.name,
    it.factLabel,
    it.limitSectionPath,
    it.limitCatalogNameN,
    it.limitCatalogNameO,
    it.externalComment,
    it.storagePlace
  ]
    .filter((x): x is string => Boolean(x && String(x).trim()))
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}
