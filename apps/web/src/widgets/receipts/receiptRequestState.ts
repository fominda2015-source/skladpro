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
  writeReceiptAcceptDrafts(warehouseId, section, {});
  writeReceiptExpandedIds(warehouseId, section, {});
}
