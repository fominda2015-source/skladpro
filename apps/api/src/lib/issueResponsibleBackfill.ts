import { prisma } from "./prisma.js";

const BATCH_SIZE = 200;

function extractResponsibleName(note: string | null | undefined): string | null {
  if (!note) return null;
  const match = note.match(/(?:^|\|)\s*Ответственный:\s*([^|]+)/i);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

export async function backfillIssueResponsibleNames() {
  let totalScanned = 0;
  let totalUpdated = 0;
  let cursorId: string | undefined;

  while (true) {
    const rows = await prisma.issueRequest.findMany({
      where: {
        responsibleName: null,
        note: { contains: "Ответственный:" }
      },
      select: { id: true, note: true },
      orderBy: { id: "asc" },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: BATCH_SIZE
    });

    if (!rows.length) break;

    totalScanned += rows.length;
    cursorId = rows[rows.length - 1]!.id;

    const updates = rows
      .map((row: { id: string; note: string | null }) => ({
        id: row.id,
        responsibleName: extractResponsibleName(row.note)
      }))
      .filter((row): row is { id: string; responsibleName: string } => Boolean(row.responsibleName));

    if (updates.length) {
      await prisma.$transaction(
        updates.map((row: { id: string; responsibleName: string }) =>
          prisma.issueRequest.update({
            where: { id: row.id },
            data: { responsibleName: row.responsibleName! }
          })
        )
      );
      totalUpdated += updates.length;
    }
  }

  return { totalScanned, totalUpdated };
}
