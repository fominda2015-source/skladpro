import { prisma } from "../prisma.js";
import { DATA_JOB_CATEGORY_LABELS, DATA_REBUILD_JOBS, getDataRebuildJob } from "./catalog.js";
import type { DataJobRunStats, DataRebuildJob } from "./types.js";

export type DataJobListItem = {
  id: string;
  title: string;
  description: string;
  category: DataRebuildJob["category"];
  categoryLabel: string;
  deployVersion: string | null;
  pendingDeploy: boolean;
  lastRun: {
    id: string;
    status: string;
    summary: string | null;
    error: string | null;
    forced: boolean;
    deployVersion: string | null;
    startedAt: string;
    finishedAt: string | null;
    triggeredByName: string | null;
  } | null;
};

export type RunDataJobResult = {
  runId: string;
  jobId: string;
  status: "OK" | "FAIL";
  summary: string | null;
  error: string | null;
  stats: DataJobRunStats | null;
};

function formatSummary(stats: DataJobRunStats): string {
  return JSON.stringify(stats);
}

async function hasSuccessfulDeployRun(job: DataRebuildJob): Promise<boolean> {
  if (!job.deployVersion) return true;
  const row = await prisma.dataJobRun.findFirst({
    where: { jobId: job.id, deployVersion: job.deployVersion, status: "OK" },
    select: { id: true }
  });
  return Boolean(row);
}

export async function listDataJobs(): Promise<DataJobListItem[]> {
  const lastRuns = await prisma.dataJobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 200,
    include: {
      triggeredBy: { select: { fullName: true, email: true } }
    }
  });

  const lastByJob = new Map<string, (typeof lastRuns)[number]>();
  for (const run of lastRuns) {
    if (!lastByJob.has(run.jobId)) lastByJob.set(run.jobId, run);
  }

  return Promise.all(
    DATA_REBUILD_JOBS.map(async (job) => {
      const last = lastByJob.get(job.id);
      const pendingDeploy = Boolean(job.deployVersion) && !(await hasSuccessfulDeployRun(job));
      return {
        id: job.id,
        title: job.title,
        description: job.description,
        category: job.category,
        categoryLabel: DATA_JOB_CATEGORY_LABELS[job.category],
        deployVersion: job.deployVersion ?? null,
        pendingDeploy,
        lastRun: last
          ? {
              id: last.id,
              status: last.status,
              summary: last.summary,
              error: last.error,
              forced: last.forced,
              deployVersion: last.deployVersion,
              startedAt: last.startedAt.toISOString(),
              finishedAt: last.finishedAt?.toISOString() ?? null,
              triggeredByName: last.triggeredBy?.fullName || last.triggeredBy?.email || null
            }
          : null
      };
    })
  );
}

export async function runDataJob(
  jobId: string,
  opts: { force?: boolean; triggeredById?: string; source?: "admin" | "deploy" | "cli" } = {}
): Promise<RunDataJobResult> {
  const job = getDataRebuildJob(jobId);
  if (!job) {
    throw Object.assign(new Error("Задача не найдена"), { status: 404 });
  }

  if (!opts.force && job.deployVersion) {
    const done = await hasSuccessfulDeployRun(job);
    if (done) {
      if (opts.source === "deploy") {
        return {
          runId: "",
          jobId,
          status: "OK",
          summary: "already_applied",
          error: null,
          stats: null
        };
      }
      if (opts.source === "admin") {
        throw Object.assign(new Error("Задача уже выполнена. Отметьте «Принудительно» для повторного запуска."), {
          status: 409
        });
      }
    }
  }

  const runRow = await prisma.dataJobRun.create({
    data: {
      jobId: job.id,
      deployVersion: job.deployVersion ?? null,
      status: "RUNNING",
      forced: Boolean(opts.force),
      triggeredById: opts.triggeredById ?? null
    }
  });

  try {
    const stats = await job.run();
    const summary = formatSummary(stats);
    await prisma.dataJobRun.update({
      where: { id: runRow.id },
      data: { status: "OK", summary, finishedAt: new Date() }
    });

    // Совместимость со старым журналом деплоя
    if (job.deployVersion) {
      const legacyId = `${job.id}@${job.deployVersion}`;
      await prisma.dataMigration.upsert({
        where: { id: legacyId },
        create: { id: legacyId, summary: summary.slice(0, 4000) },
        update: { summary: summary.slice(0, 4000), appliedAt: new Date() }
      });
    }

    return {
      runId: runRow.id,
      jobId: job.id,
      status: "OK",
      summary,
      error: null,
      stats
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.dataJobRun.update({
      where: { id: runRow.id },
      data: { status: "FAIL", error: message.slice(0, 4000), finishedAt: new Date() }
    });
    return {
      runId: runRow.id,
      jobId: job.id,
      status: "FAIL",
      summary: null,
      error: message,
      stats: null
    };
  }
}

export async function runPendingDeployJobs(): Promise<RunDataJobResult[]> {
  const pending = DATA_REBUILD_JOBS.filter((j) => j.deployVersion);
  const results: RunDataJobResult[] = [];
  for (const job of pending) {
    if (await hasSuccessfulDeployRun(job)) continue;
    results.push(await runDataJob(job.id, { source: "deploy" }));
  }
  return results;
}

export async function listDataJobRuns(take = 50) {
  const rows = await prisma.dataJobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: Math.min(200, Math.max(1, take)),
    include: {
      triggeredBy: { select: { fullName: true, email: true } }
    }
  });
  return rows.map((r) => ({
    id: r.id,
    jobId: r.jobId,
    jobTitle: getDataRebuildJob(r.jobId)?.title ?? r.jobId,
    deployVersion: r.deployVersion,
    status: r.status,
    summary: r.summary,
    error: r.error,
    forced: r.forced,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    triggeredByName: r.triggeredBy?.fullName || r.triggeredBy?.email || null
  }));
}
