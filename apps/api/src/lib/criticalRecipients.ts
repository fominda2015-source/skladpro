import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

export const CRITICAL_RECIPIENTS_KEY = "criticalNotificationRecipients";
export const ASSISTANT_BOT_EMAIL = "assistant@skladpro.local";

export async function getCriticalRecipientUserIds(): Promise<string[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: CRITICAL_RECIPIENTS_KEY } });
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

export async function setCriticalRecipientUserIds(ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids.filter((x) => typeof x === "string" && x.length > 0))];
  await prisma.appSetting.upsert({
    where: { key: CRITICAL_RECIPIENTS_KEY },
    create: { key: CRITICAL_RECIPIENTS_KEY, value: JSON.stringify(unique) },
    update: { value: JSON.stringify(unique) }
  });
  return unique;
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
