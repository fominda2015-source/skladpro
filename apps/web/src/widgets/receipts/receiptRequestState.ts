import { parseMaterialQty } from "../../shared/quantity";
import type { ReceiptItemCategory } from "./receiptLabels";

export type ReceiptRequestItemLike = {
  id: string;
  quantity: string | number;
  acceptedQty?: string | number | null;
  [key: string]: unknown;
};

export type ReceiptRequestRowLike = {
  id: string;
  status: string;
  items: ReceiptRequestItemLike[];
  [key: string]: unknown;
};

export function normalizeReceiptRequestItem<T extends ReceiptRequestItemLike>(it: T): T {
  return {
    ...it,
    quantity: parseMaterialQty(it.quantity),
    acceptedQty: parseMaterialQty(it.acceptedQty)
  };
}

export function normalizeReceiptRequestRow<T extends ReceiptRequestRowLike>(row: T): T {
  const items = row.items.map((it) => normalizeReceiptRequestItem(it));
  return { ...row, items } as T;
}

const DRAFTS_KEY = "sklad:receiptAcceptDrafts";
const EXPANDED_KEY = "sklad:receiptExpanded";
const ACCEPTED_HINTS_KEY = "sklad:receiptAcceptedHints";

function scopeKey(warehouseId: string, section: string) {
  return `${warehouseId}:${section}`;
}

export type ReceiptAcceptDraft = {
  newName: string;
  newUnit: string;
  qty: string;
  limitNodeId?: string;
  category?: ReceiptItemCategory | "";
  unitPrice?: string;
  storagePlace?: string;
};

export function readReceiptAcceptDrafts(
  warehouseId: string,
  section: string
): Record<string, Record<string, ReceiptAcceptDraft>> {
  try {
    const raw = sessionStorage.getItem(DRAFTS_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as Record<string, Record<string, Record<string, ReceiptAcceptDraft>>>;
    return all[scopeKey(warehouseId, section)] || {};
  } catch {
    return {};
  }
}

export function writeReceiptAcceptDrafts(
  warehouseId: string,
  section: string,
  drafts: Record<string, Record<string, ReceiptAcceptDraft>>
) {
  try {
    const raw = sessionStorage.getItem(DRAFTS_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Record<string, Record<string, ReceiptAcceptDraft>>>) : {};
    const key = scopeKey(warehouseId, section);
    if (!Object.keys(drafts).length) {
      delete all[key];
    } else {
      all[key] = drafts;
    }
    if (Object.keys(all).length) {
      sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
    } else {
      sessionStorage.removeItem(DRAFTS_KEY);
    }
  } catch {
    // ignore quota / private mode
  }
}

export function readReceiptExpandedIds(warehouseId: string, section: string): Record<string, boolean> {
  try {
    const raw = sessionStorage.getItem(EXPANDED_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as Record<string, Record<string, boolean>>;
    return all[scopeKey(warehouseId, section)] || {};
  } catch {
    return {};
  }
}

export function writeReceiptExpandedIds(
  warehouseId: string,
  section: string,
  expanded: Record<string, boolean>
) {
  try {
    const raw = sessionStorage.getItem(EXPANDED_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, Record<string, boolean>>) : {};
    const key = scopeKey(warehouseId, section);
    const cleaned = Object.fromEntries(Object.entries(expanded).filter(([, v]) => v));
    if (!Object.keys(cleaned).length) {
      delete all[key];
    } else {
      all[key] = cleaned;
    }
    if (Object.keys(all).length) {
      sessionStorage.setItem(EXPANDED_KEY, JSON.stringify(all));
    } else {
      sessionStorage.removeItem(EXPANDED_KEY);
    }
  } catch {
    // ignore
  }
}

function mergeAcceptedHintMaps(
  base: Record<string, Record<string, number>>,
  incoming: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const merged: Record<string, Record<string, number>> = { ...base };
  for (const [receiptId, items] of Object.entries(incoming)) {
    const prevItems = { ...(merged[receiptId] || {}) };
    for (const [itemId, qty] of Object.entries(items)) {
      const nextQty = parseMaterialQty(qty);
      if (nextQty <= 0) continue;
      prevItems[itemId] = Math.max(prevItems[itemId] ?? 0, nextQty);
    }
    if (Object.keys(prevItems).length) {
      merged[receiptId] = prevItems;
    } else {
      delete merged[receiptId];
    }
  }
  return merged;
}

export function readReceiptAcceptedHints(
  warehouseId: string,
  section: string
): Record<string, Record<string, number>> {
  try {
    const raw = sessionStorage.getItem(ACCEPTED_HINTS_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as Record<string, Record<string, Record<string, number>>>;
    return all[scopeKey(warehouseId, section)] || {};
  } catch {
    return {};
  }
}

function replaceReceiptAcceptedHintsScope(
  warehouseId: string,
  section: string,
  hints: Record<string, Record<string, number>>
) {
  try {
    const raw = sessionStorage.getItem(ACCEPTED_HINTS_KEY);
    const all = raw
      ? (JSON.parse(raw) as Record<string, Record<string, Record<string, number>>>)
      : {};
    const key = scopeKey(warehouseId, section);
    if (!Object.keys(hints).length) {
      delete all[key];
    } else {
      all[key] = hints;
    }
    if (Object.keys(all).length) {
      sessionStorage.setItem(ACCEPTED_HINTS_KEY, JSON.stringify(all));
    } else {
      sessionStorage.removeItem(ACCEPTED_HINTS_KEY);
    }
  } catch {
    // ignore quota / private mode
  }
}

export function writeReceiptAcceptedHints(
  warehouseId: string,
  section: string,
  hints: Record<string, Record<string, number>>
) {
  const existing = readReceiptAcceptedHints(warehouseId, section);
  replaceReceiptAcceptedHintsScope(
    warehouseId,
    section,
    mergeAcceptedHintMaps(existing, hints)
  );
}

export function buildAcceptedHintsFromRows(
  rows: ReceiptRequestRowLike[]
): Record<string, Record<string, number>> {
  const hints: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    for (const it of row.items) {
      const accepted = parseMaterialQty(it.acceptedQty);
      if (accepted <= 0) continue;
      if (!hints[row.id]) hints[row.id] = {};
      hints[row.id][it.id] = Math.max(hints[row.id][it.id] ?? 0, accepted);
    }
  }
  return hints;
}

export function applyAcceptedHintsToRows<T extends ReceiptRequestRowLike>(
  rows: T[],
  hints: Record<string, Record<string, number>>
): T[] {
  if (!Object.keys(hints).length) return rows;
  return rows.map((row) => {
    const rowHints = hints[row.id];
    if (!rowHints) return row;
    let changed = false;
    const items = row.items.map((it) => {
      const hint = rowHints[it.id];
      if (!hint) return it;
      const apiQty = parseMaterialQty(it.acceptedQty);
      const acc = Math.max(apiQty, hint);
      if (acc === apiQty) return it;
      changed = true;
      return { ...it, acceptedQty: acc };
    });
    return changed ? ({ ...row, items } as T) : row;
  });
}

export function clearReceiptWorkspaceSession(warehouseId: string, section: string, receiptId?: string) {
  const drafts = readReceiptAcceptDrafts(warehouseId, section);
  const expanded = readReceiptExpandedIds(warehouseId, section);
  if (receiptId) {
    delete drafts[receiptId];
    delete expanded[receiptId];
    writeReceiptAcceptDrafts(warehouseId, section, drafts);
    writeReceiptExpandedIds(warehouseId, section, expanded);
    return;
  }
  const hints = readReceiptAcceptedHints(warehouseId, section);
  writeReceiptAcceptDrafts(warehouseId, section, {});
  writeReceiptExpandedIds(warehouseId, section, {});
  replaceReceiptAcceptedHintsScope(warehouseId, section, {});
}
