import type { ObjectSection } from "@prisma/client";
import { prisma } from "./prisma.js";

const DEFAULT_ORGANIZATION = "Общество с ограниченной ответственностью";
const DEFAULT_DEPARTMENT = "Электромонтажный участок";

const RESPONSIBLE_TITLES: Record<string, string> = {
  CHIEF_WAREHOUSE: "Заведующий складом",
  WAREHOUSE_MANAGER: "Заведующий складом",
  STOREKEEPER: "Кладовщик",
  FOREMAN: "Прораб",
  PROJECT_MANAGER: "Руководитель проекта",
  ACCOUNTING: "Бухгалтер",
  ADMIN: "Администратор"
};

export type TimesheetStaffMember = {
  id: string;
  fullName: string;
  position: string;
  hireDate: string;
};

export type TimesheetContext = {
  organization: string;
  department: string;
  objectName: string;
  sheetLabel: string;
  month: string;
  compileDate: string;
  periodFrom: string;
  periodTo: string;
  periodLabel: string;
  responsibleTitle: string;
  responsibleName: string;
  responsibleFullName: string;
  days: string[];
  staff: TimesheetStaffMember[];
};

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function ymdToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function formatShortName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0]!;
  const surname = parts[0]!;
  const initials = parts
    .slice(1)
    .map((p) => p[0]?.toUpperCase())
    .filter(Boolean)
    .join(".");
  return initials ? `${surname} ${initials}.` : surname;
}

export function resolveReportingPeriod(monthYm: string, now = new Date()) {
  const [y, m] = monthYm.split("-").map(Number);
  if (!y || !m) throw new Error("INVALID_MONTH");

  const monthStart = new Date(y, m - 1, 1, 12, 0, 0, 0);
  const monthEnd = new Date(y, m, 0, 12, 0, 0, 0);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
  const isCurrentMonth = y === now.getFullYear() && m === now.getMonth() + 1;

  const periodFrom = ymd(monthStart);
  const periodTo = ymd(
    isCurrentMonth ? (today < monthStart ? monthStart : today > monthEnd ? monthEnd : today) : monthEnd
  );
  const compileDate = ymd(isCurrentMonth ? today : monthEnd);

  return { compileDate, periodFrom, periodTo };
}

export function listPeriodDays(from: string, to: string): string[] {
  const out: string[] = [];
  const end = ymdToDate(to);
  for (let d = ymdToDate(from); d <= end && out.length < 31; d.setDate(d.getDate() + 1)) {
    out.push(ymd(d));
  }
  return out;
}

function formatPeriodLabel(from: string, to: string): string {
  const start = ymdToDate(from);
  const end = ymdToDate(to);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const fmt = (d: Date) =>
    d.toLocaleDateString("ru-RU", { day: "numeric", month: sameMonth ? undefined : "long" });
  if (from === to) return fmt(start);
  return `${fmt(start)} — ${end.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}`;
}

function monthSheetLabel(monthYm: string): string {
  const [y, m] = monthYm.split("-").map(Number);
  const label = new Date(y, (m || 1) - 1, 1).toLocaleDateString("ru-RU", { month: "long" });
  return `Склад ${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function buildObjectName(warehouse: { name: string; address: string | null }, section: ObjectSection): string {
  const prefix = section === "EOM" ? "ЭОМ" : "СС";
  const base = warehouse.name.trim();
  const address = warehouse.address?.trim();
  if (address && !base.toLowerCase().includes(address.toLowerCase())) {
    return `${prefix}: ${base}, ${address}`;
  }
  return `${prefix}: ${base}`;
}

function resolveResponsibleTitle(roleName: string, positionName: string | null | undefined): string {
  if (positionName?.trim()) return positionName.trim();
  return RESPONSIBLE_TITLES[roleName] || "Ответственный за табельный учёт";
}

export async function listTimesheetStaff(warehouseId: string): Promise<TimesheetStaffMember[]> {
  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { warehouseScopes: { some: { warehouseId } } },
        { warehouseSectionScopes: { some: { warehouseId } } }
      ]
    },
    select: {
      id: true,
      fullName: true,
      createdAt: true,
      position: { select: { name: true } }
    },
    orderBy: { fullName: "asc" }
  });

  return users.map((u) => ({
    id: u.id,
    fullName: u.fullName,
    position: u.position?.name || "",
    hireDate: u.createdAt.toISOString().slice(0, 10)
  }));
}

export async function buildTimesheetContext(opts: {
  warehouseId: string;
  section: ObjectSection;
  month: string;
  userId: string;
  now?: Date;
}): Promise<TimesheetContext> {
  const now = opts.now ?? new Date();
  const [warehouse, user] = await Promise.all([
    prisma.warehouse.findUnique({
      where: { id: opts.warehouseId },
      select: { name: true, address: true }
    }),
    prisma.user.findUnique({
      where: { id: opts.userId },
      select: { fullName: true, role: { select: { name: true } }, position: { select: { name: true } } }
    })
  ]);

  if (!warehouse) throw new Error("WAREHOUSE_NOT_FOUND");
  if (!user) throw new Error("USER_NOT_FOUND");

  const { compileDate, periodFrom, periodTo } = resolveReportingPeriod(opts.month, now);
  const days = listPeriodDays(periodFrom, periodTo);
  const staff = await listTimesheetStaff(opts.warehouseId);
  const responsibleFullName = user.fullName.trim();

  return {
    organization: DEFAULT_ORGANIZATION,
    department: DEFAULT_DEPARTMENT,
    objectName: buildObjectName(warehouse, opts.section),
    sheetLabel: monthSheetLabel(opts.month),
    month: opts.month,
    compileDate,
    periodFrom,
    periodTo,
    periodLabel: formatPeriodLabel(periodFrom, periodTo),
    responsibleTitle: resolveResponsibleTitle(user.role.name, user.position?.name),
    responsibleName: formatShortName(responsibleFullName),
    responsibleFullName,
    days,
    staff
  };
}
