import { prisma } from "../lib/prisma.js";

const BATCH_SIZE = 200;

function extractResponsibleName(note: string | null | undefined): string | null {
  if (!note) return null;
  const match = note.match(/(?:^|\|)\s*Ответственный:\s*([^|]+)/i);
  const value = match?.[1]?.trim();
  return value ? value : null;
}

async function main() {
  let totalScanned = 0;
  let totalUpdated = 0;
  let cursorId: string | undefined;

  while (true) {
    const rows = await prisma.issueRequest.findMany({
      where: {
        responsibleName: null,
        note: {
          contains: "Ответственный:"
        }
      },
      select: {
        id: true,
        note: true
      },
      orderBy: {
        id: "asc"
      },
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: BATCH_SIZE
    });

    if (!rows.length) break;

    totalScanned += rows.length;
    cursorId = rows[rows.length - 1].id;

    const updates = rows
      .map((row) => ({ id: row.id, responsibleName: extractResponsibleName(row.note) }))
      .filter((row) => row.responsibleName);

    if (updates.length) {
      await prisma.$transaction(
        updates.map((row) =>
          prisma.issueRequest.update({
            where: { id: row.id },
            data: { responsibleName: row.responsibleName! }
          })
        )
      );
      totalUpdated += updates.length;
    }

    console.log(
      `[backfill:issue-responsible] scanned=${totalScanned} updated=${totalUpdated} lastId=${cursorId}`
    );
  }

  console.log(
    `[backfill:issue-responsible] done scanned=${totalScanned} updated=${totalUpdated}`
  );
}

main()
  .catch((error) => {
    console.error("[backfill:issue-responsible] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
