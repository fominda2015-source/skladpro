import type { ObjectSection } from "@prisma/client";
import { prisma } from "./prisma.js";
import { formatShortName } from "./timesheetContext.js";

export type WorkOrderRow = {
  place: string;
  workAssigned: string;
  peoplePlan?: number | string | null;
  peopleFact?: number | string | null;
  workDone?: string;
  status?: string;
  volumePlan?: string;
  volumeFact?: string;
  note?: string;
};

export type DailyAttendanceRow = {
  position: string;
  normQty: number;
  presentQty: number;
  nameReason: string;
};

export type DailyAttendanceBlock = {
  title: string;
  organization: string;
  rows: DailyAttendanceRow[];
};

export function parseIsoDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function formatRuDateDot(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

export function sectionLabel(section: ObjectSection): string {
  return section === "EOM" ? "ЭОМ" : "СС";
}

export function buildWorkOrderObjectTitle(
  warehouse: { name: string; address: string | null },
  section: ObjectSection
): string {
  const sec = sectionLabel(section);
  const base = warehouse.name.trim();
  const address = warehouse.address?.trim();
  const location = address && !base.toLowerCase().includes(address.toLowerCase()) ? `${base}, ${address}` : base;
  return `Наряд-задание по объекту ${location} (${sec})`;
}

export function buildDailyAttendanceObjectTitle(
  warehouse: { name: string; address: string | null },
  section: ObjectSection
): string {
  const sec = sectionLabel(section);
  const base = warehouse.name.trim();
  const address = warehouse.address?.trim();
  const suffix = address ? `${base}. ${address}` : base;
  return `${sec} Расстановка по объекту: ${suffix}`;
}

export function emptyDailyAttendanceRow(): DailyAttendanceRow {
  return { position: "", normQty: 1, presentQty: 0, nameReason: "" };
}

export function defaultDailyAttendanceBlocks(section: ObjectSection): DailyAttendanceBlock[] {
  const limits = dailyAttendanceRowLimits(section);
  const titles =
    section === "EOM"
      ? [
          { title: "ИТР", organization: "" },
          { title: "ПНР", organization: "" }
        ]
      : [
          { title: "ИТР", organization: "" },
          { title: "Почасовая оплата", organization: "" }
        ];
  return titles.map((block, i) => ({
    ...block,
    rows: Array.from({ length: limits[i] ?? 3 }, () => emptyDailyAttendanceRow())
  }));
}

/** Дополняет блоки до числа строк шаблона (отдельная ячейка на каждую позицию). */
export function normalizeDailyAttendanceBlocks(
  section: ObjectSection,
  blocks: DailyAttendanceBlock[]
): DailyAttendanceBlock[] {
  const defaults = defaultDailyAttendanceBlocks(section);
  const limits = dailyAttendanceRowLimits(section);
  return defaults.map((def, i) => {
    const src = blocks[i];
    const limit = limits[i] ?? def.rows.length;
    const rows = [...(src?.rows ?? [])];
    while (rows.length < limit) rows.push(emptyDailyAttendanceRow());
    return {
      title: src?.title?.trim() || def.title,
      organization: src?.organization ?? "",
      rows: rows.slice(0, limit)
    };
  });
}

export function dailyAttendanceRowLimits(section: ObjectSection): number[] {
  return section === "EOM" ? [3, 9] : [3, 4];
}

export async function loadFieldDocWarehouse(warehouseId: string) {
  const warehouse = await prisma.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, name: true, address: true }
  });
  if (!warehouse) throw Object.assign(new Error("Объект не найден"), { status: 404 });
  return warehouse;
}

export async function loadUserShortName(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true }
  });
  if (!user) return "";
  return formatShortName(user.fullName);
}

export function parseWorkOrderRows(raw: unknown): WorkOrderRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = r as Record<string, unknown>;
    return {
      place: String(o.place ?? ""),
      workAssigned: String(o.workAssigned ?? ""),
      peoplePlan:
        o.peoplePlan != null && o.peoplePlan !== ""
          ? (typeof o.peoplePlan === "number" || typeof o.peoplePlan === "string" ? o.peoplePlan : String(o.peoplePlan))
          : null,
      peopleFact:
        o.peopleFact != null && o.peopleFact !== ""
          ? (typeof o.peopleFact === "number" || typeof o.peopleFact === "string" ? o.peopleFact : String(o.peopleFact))
          : null,
      workDone: String(o.workDone ?? ""),
      status: String(o.status ?? ""),
      volumePlan: String(o.volumePlan ?? ""),
      volumeFact: String(o.volumeFact ?? ""),
      note: String(o.note ?? "")
    };
  });
}

export function parseDailyAttendanceBlocks(raw: unknown): DailyAttendanceBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => {
    const block = b as Record<string, unknown>;
    const rowsRaw = Array.isArray(block.rows) ? block.rows : [];
    return {
      title: String(block.title ?? ""),
      organization: String(block.organization ?? ""),
      rows: rowsRaw.map((r) => {
        const row = r as Record<string, unknown>;
        return {
          position: String(row.position ?? ""),
          normQty: Number(row.normQty) || 0,
          presentQty: Number(row.presentQty) || 0,
          nameReason: String(row.nameReason ?? "")
        };
      })
    };
  });
}

export function safeFilePart(name: string): string {
  return name.replace(/[\\/:?*[\]]/g, " ").trim().slice(0, 80) || "объект";
}
