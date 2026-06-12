import { backfillIssueResponsibleNames } from "../lib/issueResponsibleBackfill.js";
import { prisma } from "../lib/prisma.js";

async function main() {
  const stats = await backfillIssueResponsibleNames();
  console.log("[backfill:issue-responsible] done", stats);
}

main()
  .catch((error) => {
    console.error("[backfill:issue-responsible] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
