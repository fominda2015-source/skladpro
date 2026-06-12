import { runPendingDeployJobs } from "../lib/dataJobs/runner.js";
import { prisma } from "../lib/prisma.js";

async function main() {
  const results = await runPendingDeployJobs();
  console.log(`[data-migrate] finished runs=${results.length}`);
  for (const r of results) {
    console.log(`[data-migrate] ${r.jobId} ${r.status} ${r.summary ?? r.error ?? ""}`);
  }
  if (results.some((r) => r.status === "FAIL")) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[data-migrate] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
