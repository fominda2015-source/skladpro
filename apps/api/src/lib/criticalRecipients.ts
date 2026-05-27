import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

export const CRITICAL_RECIPIENTS_KEY = "criticalNotificationRecipients";
export const ASSISTANT_BOT_EMAIL = "assistant@skladpro.local";

type RecipientsByWarehouse = Record<string, string[]>;

function parseRecipientsMap(raw: string | null | undefined): RecipientsByWarehouse {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return {};
    if (parsed && typeof parsed === "object") {
      const out: RecipientsByWarehouse = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          out[k] = v.filter((x): x is string => typeof x === "string" && x.length > 0);
        }
      }
      return out;
    }
  } catch {
    // ignore
  }
  return {};
}

async function loadRecipientsMap(): Promise<RecipientsByWarehouse> {
  const row = await prisma.appSetting.findUnique({ where: { key: CRITICAL_RECIPIENTS_KEY } });
  return parseRecipientsMap(row?.value);
}

async function saveRecipientsMap(map: RecipientsByWarehouse): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: CRITICAL_RECIPIENTS_KEY },
    create: { key: CRITICAL_RECIPIENTS_KEY, value: JSON.stringify(map) },
    update: { value: JSON.stringify(map) }
  });
}

export async function getCriticalRecipientUserIds(warehouseId: string): Promise<string[]> {
  if (!warehouseId) return [];
  const map = await loadRecipientsMap();
  return map[warehouseId] || [];
}

export async function setCriticalRecipientUserIds(
  warehouseId: string,
  ids: string[]
): Promise<string[]> {
  const map = await loadRecipientsMap();
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x.length > 0))];
  map[warehouseId] = unique;
  await saveRecipientsMap(map);
  return unique;
}

/** Пользователи с доступом к объекту (склад / проект объекта). */
export async function listUsersOnWarehouse(warehouseId: string) {
  return prisma.user.findMany({
    where: {
      status: "ACTIVE",
      email: { not: ASSISTANT_BOT_EMAIL },
      OR: [
        { warehouseScopes: { some: { warehouseId } } },
        { warehouseSectionScopes: { some: { warehouseId } } },
        {
          projectScopes: {
            some: {
              project: {
                OR: [{ warehouseId }, { warehouseLinks: { some: { warehouseId } } }]
              }
            }
          }
        }
      ]
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: { select: { name: true } },
      position: { select: { name: true } }
    },
    orderBy: { fullName: "asc" }
  });
}

/** Системный пользователь «Помощник» — дублирует критические уведомления в личный чат. */
export async function ensureAssistantBotUserId(): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { email: ASSISTANT_BOT_EMAIL } });
  if (existing) return existing.id;

  const role =
    (await prisma.role.findFirst({ where: { name: "ADMIN" } })) ||
    (await prisma.role.findFirst({ orderBy: { name: "asc" } }));
  if (!role) throw new Error("No roles in database — run seed first");

  const passwordHash = await bcrypt.hash(`bot-${Date.now()}`, 10);
  const created = await prisma.user.create({
    data: {
      email: ASSISTANT_BOT_EMAIL,
      passwordHash,
      fullName: "Помощник",
      status: "ACTIVE",
      roleId: role.id
    }
  });
  return created.id;
}
