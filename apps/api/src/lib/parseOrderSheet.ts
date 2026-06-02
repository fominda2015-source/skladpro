import xlsx from "xlsx";
import type { ReceiptItemCategory } from "@prisma/client";

export const normCell = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

export const normNameKey = (s: string) =>
  normCell(s)
    .toLowerCase()
    .replace(/["«»]/g, "");

/** Текст внешнего комментария без ссылки (обрезаем с https). */
export function parseExternalComment(raw: string): string {
  const s = normCell(raw);
  const m = s.match(/\bhttps?:\/\//i);
  if (!m || m.index == null) return s;
  return s.slice(0, m.index).trim();
}

export type ParsedOrderItem = {
  name: string;
  unit: string;
  quantity: number;
  namePartC: string;
  namePartD: string;
  namePartE: string;
  limitSectionPath: string | null;
  limitCatalogNameN: string | null;
  limitCatalogNameO: string | null;
  externalComment: string | null;
  category: ReceiptItemCategory | null;
  /** Переименовать узел лимита на имя из O (C/N совпали, O отличается). */
  renameLimitToO: boolean;
  limitDisplayName: string;
  nameAlertNote: string | null;
};

export type ParsedOrderSheet = {
  format: "legacy" | "order_v2";
  items: ParsedOrderItem[];
  orderNumber?: string;
  projectTitle?: string;
};

function mapProductCategory(raw: string): ReceiptItemCategory | null {
  const s = normNameKey(raw);
  if (!s) return null;
  if (s.includes("кабел")) return "CABLE";
  if (s.includes("сиз") || (s.includes("средств") && s.includes("защит"))) return "PPE";
  if (s.includes("кип") || s.includes("контрольно") || s.includes("измерит")) return "KIP";
  if (s.includes("расход") && (s.includes("инструмент") || s.includes("инстр"))) return "TOOL_CONSUMABLE";
  if (s.includes("аккумулятор") || s.includes("аккум") || (s.includes("беспровод") && s.includes("инструмент")))
    return "TOOL_ELECTRIC_CORDLESS";
  if ((s.includes("сетев") || s.includes("сетевой")) && s.includes("инструмент")) return "TOOL_ELECTRIC_CORDED";
  if (s.includes("электр") && s.includes("инструмент")) return "TOOL_ELECTRIC_CORDLESS";
  if (s.includes("ручн") && s.includes("инструмент")) return "TOOL_MANUAL";
  if (s.includes("инструмент") && !s.includes("расход")) return "TOOL_MANUAL";
  if (s.includes("прочее") || s.includes("проч")) return "OTHER";
  if (s.includes("расход")) return "CONSUMABLE";
  if (s.includes("оборуд")) return "EQUIPMENT";
  return null;
}

function buildOriginalName(c: string, d: string, e: string): string {
  const parts = [c, d, e].map(normCell).filter(Boolean);
  return parts.join(" ").trim() || normCell(c);
}

/** Сравнение C/D/E с N и O по правилам заказчика. */
export function analyzeCatalogNames(
  c: string,
  d: string,
  e: string,
  n: string,
  o: string,
  externalCommentRaw: string
): Pick<
  ParsedOrderItem,
  "renameLimitToO" | "limitDisplayName" | "nameAlertNote" | "limitCatalogNameN" | "limitCatalogNameO"
> {
  const orig = buildOriginalName(c, d, e);
  const origKey = normNameKey(orig);
  const cKey = normNameKey(c);
  const nKey = normNameKey(n);
  const oKey = normNameKey(o);
  const dKey = normNameKey(d);
  const eKey = normNameKey(e);

  const nNorm = nKey || origKey;
  const oNorm = oKey || origKey;

  const cdeMatchN =
    (!nKey || nKey === origKey || nKey === cKey) &&
    (!dKey || !nKey || nKey === dKey) &&
    (!eKey || !nKey || nKey === eKey);

  const allSame =
    cdeMatchN &&
    (!oKey || oKey === origKey || oKey === cKey || oKey === nKey) &&
    (!nKey || !oKey || nKey === oKey);

  const renameLimitToO = cdeMatchN && Boolean(oKey) && oKey !== cKey && oKey !== origKey && oKey !== nKey;

  const limitDisplayName = renameLimitToO ? normCell(o) : orig;
  const nameAlertNote = renameLimitToO ? parseExternalComment(externalCommentRaw) || null : null;

  return {
    renameLimitToO: renameLimitToO && !allSame,
    limitDisplayName,
    nameAlertNote: nameAlertNote || null,
    limitCatalogNameN: n ? normCell(n) : null,
    limitCatalogNameO: o ? normCell(o) : null
  };
}

function parseOrderV2(ws: xlsx.WorkSheet): ParsedOrderSheet | null {
  if (!ws["!ref"]) return null;
  const range = xlsx.utils.decode_range(ws["!ref"]);
  const getCell = (r: number, c: number) => normCell(ws[xlsx.utils.encode_cell({ r, c })]?.v);

  let orderNumber: string | undefined;
  let projectTitle: string | undefined;
  for (let r = 0; r <= Math.min(range.e.r, 60); r += 1) {
    for (let c = 0; c <= Math.min(range.e.c, 12); c += 1) {
      const label = getCell(r, c).toLowerCase();
      if (!orderNumber && label.includes("номер заявки")) {
        for (let rr = r; rr <= Math.min(r + 1, range.e.r); rr += 1) {
          for (let cc = c + 1; cc <= Math.min(range.e.c, c + 8); cc += 1) {
            const v = getCell(rr, cc);
            if (/^\d{2,}$/.test(v)) {
              orderNumber = v;
              break;
            }
          }
          if (orderNumber) break;
        }
      }
      if (!projectTitle && label === "проект") {
        for (let rr = r; rr <= Math.min(r + 1, range.e.r); rr += 1) {
          const v = getCell(rr, c) || getCell(rr, c + 1) || getCell(rr + 1, c) || getCell(rr + 1, c + 1);
          if (v && v.toLowerCase() !== "проект") {
            projectTitle = v;
            break;
          }
        }
      }
    }
  }

  let headerRow = -1;
  for (let r = 0; r <= range.e.r; r += 1) {
    const isProductHeader =
      normNameKey(getCell(r, 2)) === "товар" &&
      (getCell(r, 11).toLowerCase().includes("внешн") || getCell(r, 12).toLowerCase().includes("раздел"));
    if (isProductHeader) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) return null;

  const items: ParsedOrderItem[] = [];
  for (let r = headerRow + 1; r <= range.e.r; r += 1) {
    const partC = getCell(r, 2);
    const qtyRaw = getCell(r, 5).replace(",", ".");
    if (!partC) continue;
    const quantity = Math.round(Number(qtyRaw));
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const partD = getCell(r, 3);
    const partE = getCell(r, 4);
    const unit = getCell(r, 6) || "шт";
    const categoryRaw = getCell(r, 7);
    const externalRaw = getCell(r, 11);
    const limitPath = getCell(r, 12) || null;
    const nameN = getCell(r, 13);
    const nameO = getCell(r, 14);

    const nameMeta = analyzeCatalogNames(partC, partD, partE, nameN, nameO, externalRaw);

    items.push({
      name: nameMeta.limitDisplayName,
      unit: unit || "шт",
      quantity,
      namePartC: partC,
      namePartD: partD,
      namePartE: partE,
      limitSectionPath: limitPath,
      limitCatalogNameN: nameMeta.limitCatalogNameN,
      limitCatalogNameO: nameMeta.limitCatalogNameO,
      externalComment: parseExternalComment(externalRaw) || null,
      category: mapProductCategory(categoryRaw),
      renameLimitToO: nameMeta.renameLimitToO,
      limitDisplayName: nameMeta.limitDisplayName,
      nameAlertNote: nameMeta.nameAlertNote
    });
  }

  if (!items.length) return null;
  return { format: "order_v2", items, orderNumber, projectTitle };
}

function parseLegacy(ws: xlsx.WorkSheet): ParsedOrderSheet {
  const range = xlsx.utils.decode_range(ws["!ref"]!);
  const getCell = (r: number, c: number) => normCell(ws[xlsx.utils.encode_cell({ r, c })]?.v);

  let orderNumber: string | undefined;
  let projectTitle: string | undefined;
  for (let r = 0; r <= Math.min(range.e.r, 60); r += 1) {
    for (let c = 0; c <= Math.min(range.e.c, 12); c += 1) {
      const label = getCell(r, c).toLowerCase();
      if (!orderNumber && label.includes("номер заявки")) {
        for (let rr = r; rr <= Math.min(r + 1, range.e.r); rr += 1) {
          for (let cc = c + 1; cc <= Math.min(range.e.c, c + 8); cc += 1) {
            const v = getCell(rr, cc);
            if (/^\d{2,}$/.test(v)) {
              orderNumber = v;
              break;
            }
          }
          if (orderNumber) break;
        }
      }
      if (!projectTitle && label === "проект") {
        for (let rr = r; rr <= Math.min(r + 1, range.e.r); rr += 1) {
          const v = getCell(rr, c) || getCell(rr, c + 1) || getCell(rr + 1, c) || getCell(rr + 1, c + 1);
          if (v && v.toLowerCase() !== "проект") {
            projectTitle = v;
            break;
          }
        }
      }
    }
  }

  let headerRow = -1;
  let colName = -1;
  let colQty = -1;
  let colUnit = -1;
  for (let r = 0; r <= range.e.r; r += 1) {
    let foundName = -1;
    let foundQty = -1;
    let foundUnit = -1;
    for (let c = 0; c <= range.e.c; c += 1) {
      const v = getCell(r, c).toLowerCase();
      if (
        foundName < 0 &&
        (v === "товар" || v === "наименование" || v === "номенклатура" || v.startsWith("товар") || v.startsWith("наимен"))
      ) {
        foundName = c;
      }
      if (foundQty < 0 && (v === "количество" || v === "кол-во" || v.includes("количеств"))) {
        foundQty = c;
      }
      if (foundUnit < 0 && (v.startsWith("ед.") || v === "ед" || v.includes("единиц"))) {
        foundUnit = c;
      }
    }
    if (foundName >= 0 && foundQty >= 0) {
      headerRow = r;
      colName = foundName;
      colQty = foundQty;
      colUnit = foundUnit;
      break;
    }
  }

  const items: ParsedOrderItem[] = [];
  if (headerRow >= 0) {
    for (let r = headerRow + 1; r <= range.e.r; r += 1) {
      const name = getCell(r, colName);
      const qtyRaw = getCell(r, colQty).replace(",", ".");
      const unit = colUnit >= 0 ? getCell(r, colUnit) : "шт";
      if (!name) continue;
      const quantity = Math.round(Number(qtyRaw));
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      items.push({
        name,
        unit: unit || "шт",
        quantity,
        namePartC: name,
        namePartD: "",
        namePartE: "",
        limitSectionPath: null,
        limitCatalogNameN: null,
        limitCatalogNameO: null,
        externalComment: null,
        category: null,
        renameLimitToO: false,
        limitDisplayName: name,
        nameAlertNote: null
      });
    }
  }

  return { format: "legacy", items, orderNumber, projectTitle };
}

export function parseOrderSheet(file: Buffer): ParsedOrderSheet {
  const wb = xlsx.read(file, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { format: "legacy", items: [] };
  const v2 = parseOrderV2(ws);
  if (v2) return v2;
  return parseLegacy(ws);
}
