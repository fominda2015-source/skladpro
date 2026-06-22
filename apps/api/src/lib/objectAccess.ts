import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export type ObjectSection = "SS" | "EOM";

export type ObjectMemberInput = {
  userId: string;
  /** null или оба раздела — без ограничения (доступны СС и ЭОМ) */
  sections: ObjectSection[] | null;
};

/** Для каждого объекта: нет section scope → оба раздела; иначе только указанные. */
export function resolveAllowedSectionPairs(
  warehouseIds: string[],
  sectionRows: Array<{ warehouseId: string; section: ObjectSection }>
): Array<{ warehouseId: string; section: ObjectSection }> {
  const pairs: Array<{ warehouseId: string; section: ObjectSection }> = [];
  for (const warehouseId of warehouseIds) {
    const restricted = sectionRows.filter((s) => s.warehouseId === warehouseId);
    if (!restricted.length) {
      pairs.push({ warehouseId, section: "SS" }, { warehouseId, section: "EOM" });
      continue;
    }
    const seen = new Set<ObjectSection>();
    for (const row of restricted) {
      if (seen.has(row.section)) continue;
      seen.add(row.section);
      pairs.push({ warehouseId, section: row.section });
    }
  }
  return pairs;
}

export function membersFromObjectScopes(
  userIds: string[],
  sectionUsers: { SS: string[]; EOM: string[] }
): ObjectMemberInput[] {
  return userIds.map((userId) => {
    const ss = sectionUsers.SS.includes(userId);
    const eom = sectionUsers.EOM.includes(userId);
    if (!ss && !eom) return { userId, sections: null };
    if (ss && eom) return { userId, sections: null };
    if (ss) return { userId, sections: ["SS"] };
    return { userId, sections: ["EOM"] };
  });
}

/** null — оба раздела; [] — нет доступа к объекту. */
export async function getAllowedSectionsForWarehouse(
  userId: string,
  warehouseId: string,
  permissions: string[]
): Promise<ObjectSection[] | null> {
  if (permissions.includes("*")) {
    return null;
  }
  const wh = await prisma.userWarehouseScope.findFirst({ where: { userId, warehouseId } });
  if (!wh) return [];

  const sectionRows = await prisma.userWarehouseSectionScope.findMany({
    where: { userId, warehouseId },
    select: { section: true }
  });
  if (!sectionRows.length) return null;
  return sectionRows.map((s) => s.section);
}

export function assertSectionAllowedForWarehouse(
  allowed: ObjectSection[] | null,
  section: ObjectSection
) {
  if (allowed === null) return;
  if (!allowed.length) {
    const err = new Error("FORBIDDEN_WAREHOUSE") as Error & { status: number };
    err.status = 403;
    throw err;
  }
  if (!allowed.includes(section)) {
    const err = new Error("FORBIDDEN_SECTION") as Error & { status: number };
    err.status = 403;
    throw err;
  }
}

export async function syncObjectMembers(
  tx: Prisma.TransactionClient,
  warehouseId: string,
  members: ObjectMemberInput[]
) {
  const userIds = members.map((m) => m.userId);

  await tx.userWarehouseScope.deleteMany({
    where: {
      warehouseId,
      ...(userIds.length ? { userId: { notIn: userIds } } : {})
    }
  });

  if (userIds.length) {
    await tx.userWarehouseScope.createMany({
      data: userIds.map((userId) => ({ userId, warehouseId })),
      skipDuplicates: true
    });
  }

  await tx.userWarehouseSectionScope.deleteMany({ where: { warehouseId } });

  for (const member of members) {
    const sections = member.sections;
    if (!sections?.length || sections.length >= 2) {
      continue;
    }
    for (const section of sections) {
      await tx.userWarehouseSectionScope.create({
        data: { userId: member.userId, warehouseId, section }
      });
    }
  }
}

export async function ensureWarehouseMembers(
  warehouseId: string,
  members: ObjectMemberInput[]
) {
  await prisma.$transaction((tx) => syncObjectMembers(tx, warehouseId, members));
}
