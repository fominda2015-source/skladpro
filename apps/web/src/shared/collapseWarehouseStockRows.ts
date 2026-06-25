import { normalizeMaterialNameKey } from "./materialFactNames";

export type CollapsibleStockRow = {
  id: string;
  warehouseId: string;
  materialId: string;
  materialName: string;
  materialUnit: string;
  quantity: number;
  reserved: number;
  available: number;
  isLow: boolean;
  stockAmount?: number | null;
  unitCost?: number | null;
  storageRoom?: string | null;
  storageCell?: string | null;
  /** Карточки, сведённые в одну строку склада (разные узлы лимита). */
  collapsedMaterialIds?: string[];
  collapsedStockIds?: string[];
};

function collapseKey(row: CollapsibleStockRow): string {
  return [
    row.warehouseId,
    normalizeMaterialNameKey(row.materialName),
    (row.materialUnit || "шт").trim().toLowerCase()
  ].join("\0");
}

/** Одна строка склада на точное название + ед. изм.; остатки суммируются. */
export function collapseWarehouseStockRowsByName<T extends CollapsibleStockRow>(rows: T[]): T[] {
  const map = new Map<string, T>();
  for (const row of rows) {
    const key = collapseKey(row);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        ...row,
        collapsedMaterialIds: [row.materialId],
        collapsedStockIds: [row.id]
      } as T);
      continue;
    }
    prev.quantity = Number(prev.quantity) + Number(row.quantity);
    prev.reserved = Number(prev.reserved) + Number(row.reserved);
    prev.available = Number(prev.available) + Number(row.available);
    prev.isLow = Number(prev.available) <= 0;
    if (row.stockAmount != null) {
      prev.stockAmount = Number(prev.stockAmount ?? 0) + Number(row.stockAmount);
    }
    const prevIds = prev.collapsedMaterialIds ?? [prev.materialId];
    const prevStockIds = prev.collapsedStockIds ?? [prev.id];
    if (!prevIds.includes(row.materialId)) prevIds.push(row.materialId);
    if (!prevStockIds.includes(row.id)) prevStockIds.push(row.id);
    prev.collapsedMaterialIds = prevIds;
    prev.collapsedStockIds = prevStockIds;
    if (!prev.storageRoom && row.storageRoom) prev.storageRoom = row.storageRoom;
    if (!prev.storageCell && row.storageCell) prev.storageCell = row.storageCell;
  }
  return [...map.values()].sort((a, b) =>
    a.materialName.localeCompare(b.materialName, "ru", { sensitivity: "base" })
  );
}
