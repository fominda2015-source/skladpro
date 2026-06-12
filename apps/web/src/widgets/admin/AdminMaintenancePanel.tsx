import { useCallback, useEffect, useMemo, useState } from "react";
import { ResultBanner } from "../../shared/ui/StateViews";

export type AdminDataJob = {
  id: string;
  title: string;
  description: string;
  category: string;
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

export type AdminDataJobRun = {
  id: string;
  jobId: string;
  jobTitle: string;
  deployVersion: string | null;
  status: string;
  summary: string | null;
  error: string | null;
  forced: boolean;
  startedAt: string;
  finishedAt: string | null;
  triggeredByName: string | null;
};

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
};

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU");
}

function statusTone(status: string): "ok" | "error" | "neutral" | "warn" {
  if (status === "OK") return "ok";
  if (status === "FAIL") return "error";
  if (status === "RUNNING") return "warn";
  return "neutral";
}

function parseSummary(summary: string | null) {
  if (!summary) return null;
  try {
    return JSON.stringify(JSON.parse(summary), null, 2);
  } catch {
    return summary;
  }
}

export function AdminMaintenancePanel({ token, apiUrl, fetchWithSession }: Props) {
  const [jobs, setJobs] = useState<AdminDataJob[]>([]);
  const [runs, setRuns] = useState<AdminDataJobRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runningBatch, setRunningBatch] = useState(false);
  const [forceByJob, setForceByJob] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "success" | "error">("neutral");
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [jobsRes, runsRes] = await Promise.all([
        fetchWithSession(`${apiUrl}/api/admin/data-jobs`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetchWithSession(`${apiUrl}/api/admin/data-jobs/runs?take=50`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      if (jobsRes.ok) setJobs((await jobsRes.json()) as AdminDataJob[]);
      if (runsRes.ok) setRuns((await runsRes.json()) as AdminDataJobRun[]);
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl, fetchWithSession]);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(() => jobs.filter((j) => j.pendingDeploy).length, [jobs]);

  const groupedJobs = useMemo(() => {
    const map = new Map<string, AdminDataJob[]>();
    for (const job of jobs) {
      const arr = map.get(job.categoryLabel) || [];
      arr.push(job);
      map.set(job.categoryLabel, arr);
    }
    return [...map.entries()];
  }, [jobs]);

  async function runJob(jobId: string) {
    if (!token) return;
    setRunningId(jobId);
    setMessage("");
    try {
      const res = await fetchWithSession(`${apiUrl}/api/admin/data-jobs/${encodeURIComponent(jobId)}/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ force: Boolean(forceByJob[jobId]) })
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; summary?: string };
      if (!res.ok) {
        setMessage(typeof body.error === "string" ? body.error : `Ошибка ${res.status}`);
        setMessageTone("error");
        return;
      }
      setMessage(`Задача выполнена: ${jobId}`);
      setMessageTone("success");
      await load();
    } finally {
      setRunningId(null);
    }
  }

  async function runPending() {
    if (!token) return;
    setRunningBatch(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${apiUrl}/api/admin/data-jobs/run-pending`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      const body = (await res.json().catch(() => ({}))) as { count?: number; error?: string };
      if (!res.ok) {
        setMessage(typeof body.error === "string" ? body.error : "Не удалось выполнить пакет");
        setMessageTone("error");
        return;
      }
      setMessage(`Выполнено ожидающих задач: ${body.count ?? 0}`);
      setMessageTone("success");
      await load();
    } finally {
      setRunningBatch(false);
    }
  }

  return (
    <div className="adminMaintenance">
      <div className="card adminInsetCard">
        <h4>Обслуживание БД</h4>
        <p className="muted">
          Переформирование данных после изменений правил. Каждый запуск пишется в журнал. Задачи с меткой
          «ожидает деплоя» выполняются автоматически при обновлении сервера; здесь можно запустить вручную
          или принудительно пересчитать заново.
        </p>
        <div className="toolbar adminMaintenanceToolbar">
          <button type="button" className="ghostBtn" disabled={loading} onClick={() => void load()}>
            ↻ Обновить
          </button>
          <button
            type="button"
            className="primaryBtn"
            disabled={runningBatch || pendingCount === 0}
            onClick={() => void runPending()}
          >
            {runningBatch ? "Выполняется…" : `Выполнить все ожидающие (${pendingCount})`}
          </button>
        </div>
        {message ? <ResultBanner text={message} tone={messageTone} /> : null}
      </div>

      {loading && !jobs.length ? <p className="muted">Загрузка задач…</p> : null}

      {groupedJobs.map(([categoryLabel, categoryJobs]) => (
        <section key={categoryLabel} className="adminMaintenanceGroup card adminInsetCard">
          <h4 className="adminMaintenanceGroupTitle">{categoryLabel}</h4>
          <div className="adminMaintenanceJobList">
            {categoryJobs.map((job) => {
              const busy = runningId === job.id;
              const last = job.lastRun;
              return (
                <article key={job.id} className="adminMaintenanceJob">
                  <div className="adminMaintenanceJobHead">
                    <div>
                      <strong>{job.title}</strong>
                      <p className="muted adminMaintenanceJobDesc">{job.description}</p>
                      <p className="muted adminMaintenanceJobMeta">
                        ID: <code>{job.id}</code>
                        {job.deployVersion ? (
                          <>
                            {" "}
                            · версия деплоя: <code>{job.deployVersion}</code>
                          </>
                        ) : null}
                        {job.pendingDeploy ? <span className="adminMaintenanceBadge">ожидает деплоя</span> : null}
                      </p>
                    </div>
                    <div className="adminMaintenanceJobActions">
                      <label className="adminMaintenanceForce">
                        <input
                          type="checkbox"
                          checked={Boolean(forceByJob[job.id])}
                          onChange={(e) =>
                            setForceByJob((prev) => ({ ...prev, [job.id]: e.target.checked }))
                          }
                        />
                        Принудительно
                      </label>
                      <button
                        type="button"
                        className="primaryBtn"
                        disabled={busy || runningBatch}
                        onClick={() => void runJob(job.id)}
                      >
                        {busy ? "…" : "Выполнить"}
                      </button>
                    </div>
                  </div>
                  {last ? (
                    <p className={`adminMaintenanceLastRun adminMaintenanceLastRun--${statusTone(last.status)}`}>
                      Последний запуск: {formatWhen(last.startedAt)} · {last.status}
                      {last.forced ? " · принудительно" : ""}
                      {last.triggeredByName ? ` · ${last.triggeredByName}` : ""}
                      {last.error ? ` · ${last.error}` : ""}
                    </p>
                  ) : (
                    <p className="muted adminMaintenanceLastRun">Ещё не выполнялась</p>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <section className="card adminInsetCard adminMaintenanceLog">
        <div className="adminMaintenanceLogHead">
          <h4>Журнал запусков</h4>
          <span className="muted">{runs.length} записей</span>
        </div>
        {!runs.length ? (
          <p className="muted">Запусков пока нет.</p>
        ) : (
          <div className="plainList adminMaintenanceRunList">
            {runs.map((run) => {
              const open = expandedRunId === run.id;
              const details = parseSummary(run.summary);
              return (
                <div key={run.id} className="adminMaintenanceRunRow">
                  <button
                    type="button"
                    className="adminMaintenanceRunHead"
                    onClick={() => setExpandedRunId(open ? null : run.id)}
                  >
                    <span className="adminMaintenanceRunChevron">{open ? "▾" : "▸"}</span>
                    <span className={`adminMaintenanceRunStatus adminMaintenanceRunStatus--${statusTone(run.status)}`}>
                      {run.status}
                    </span>
                    <strong>{run.jobTitle}</strong>
                    <span className="muted">{formatWhen(run.startedAt)}</span>
                    {run.forced ? <span className="adminMaintenanceBadge">force</span> : null}
                  </button>
                  {open ? (
                    <div className="adminMaintenanceRunBody">
                      {run.error ? <p className="error">{run.error}</p> : null}
                      {details ? (
                        <pre className="adminMaintenanceRunPre">{details}</pre>
                      ) : (
                        <p className="muted">Без деталей</p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
