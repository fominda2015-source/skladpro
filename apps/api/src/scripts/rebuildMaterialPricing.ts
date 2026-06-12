import { getDataRebuildJob } from "../lib/dataJobs/catalog.js";
import { runDataJob } from "../lib/dataJobs/runner.js";
import { prisma } from "../lib/prisma.js";

const jobId = process.argv[2];
const force = process.argv.includes("--force");

async function main() {
  if (jobId) {
    const job = getDataRebuildJob(jobId);
    if (!job) {
      console.error(`[rebuild] unknown job: ${jobId}`);
      process.exitCode = 1;
      return;
    }
    const result = await runDataJob(jobId, { force, source: "cli" });
    console.log("[rebuild]", result);
    if (result.status === "FAIL") process.exitCode = 1;
    return;
  }

  const result = await runDataJob("rebuild.pricing", { force: true, source: "cli" });
  console.log("[rebuild-pricing]", result);
  if (result.status === "FAIL") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[rebuild] failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
