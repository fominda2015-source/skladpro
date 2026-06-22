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

export function pickAllowedSection(
  allowed: ObjectSection[] | null,
  preferred: ObjectSection | null | undefined
): ObjectSection {
  if (allowed === null) return preferred || "SS";
  if (!allowed.length) return preferred || "SS";
  if (preferred && allowed.includes(preferred)) return preferred;
  return allowed[0];
}

export async function loadObjectMembers(warehouseId: string): Promise<ObjectMemberInput[]> {
  const [warehouseUsers, sectionRows] = await Promise.all([
    prisma.userWarehouseScope.findMany({ where: { warehouseId }, select: { userId: true } }),
    prisma.userWarehouseSectionScope.findMany({
      where: { warehouseId },
      select: { userId: true, section: true }
    })
  ]);
  const userIds = Array.from(new Set(warehouseUsers.map((r) => r.userId)));
  const sectionUsers = { SS: [] as string[], EOM: [] as string[] };
  for (const row of sectionRows) {
    sectionUsers[row.section].push(row.userId);
  }
  return membersFromObjectScopes(userIds, sectionUsers);
}

/** Привязка к проектам может добавить склад, но не снимает участие в объектах. */
export async function syncUserProjectScopes(userId: string, projectIds: string[]) {
  const linkedWarehouses = projectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: {
          warehouseId: true,
          warehouseLinks: { select: { warehouseId: true }, take: 1 }
        }
      })
    : [];
  const warehouseIds = Array.from(
    new Set(
      linkedWarehouses
        .map((x) => x.warehouseId || x.warehouseLinks[0]?.warehouseId || null)
        .filter((x): x is string => Boolean(x))
    )
  );

  await prisma.$transaction(async (tx) => {
    await tx.userProjectScope.deleteMany({ where: { userId } });
    if (projectIds.length) {
      await tx.userProjectScope.createMany({
        data: projectIds.map((projectId) => ({ userId, projectId })),
        skipDuplicates: true
      });
    }
    if (warehouseIds.length) {
      await tx.userWarehouseScope.createMany({
        data: warehouseIds.map((warehouseId) => ({ userId, warehouseId })),
        skipDuplicates: true
      });
    }
  });
}

export async function repairOrphanedSectionScopes(): Promise<{ repaired: number }> {
  const sectionRows = await prisma.userWarehouseSectionScope.findMany({
    select: { userId: true, warehouseId: true }
  });
  let repaired = 0;
  for (const row of sectionRows) {
    const exists = await prisma.userWarehouseScope.findFirst({
      where: { userId: row.userId, warehouseId: row.warehouseId }
    });
    if (!exists) {
      await prisma.userWarehouseScope.create({
        data: { userId: row.userId, warehouseId: row.warehouseId }
      });
      repaired += 1;
    }
  }
  return { repaired };
}

export type UserObjectAccess = {
  id: string;
  name: string;
  address: string | null;
  allowedSections: ObjectSection[] | null;
};

export async function listUserObjectAccess(
  userId: string,
  permissions: string[],
  warehouses: Array<{ id: string; name: string; address: string | null }>
): Promise<UserObjectAccess[]> {
  const result: UserObjectAccess[] = [];
  for (const warehouse of warehouses) {
    const allowedSections = await getAllowedSectionsForWarehouse(userId, warehouse.id, permissions);
    result.push({
      id: warehouse.id,
      name: warehouse.name,
      address: warehouse.address,
      allowedSections
    });
  }
  return result;
}
