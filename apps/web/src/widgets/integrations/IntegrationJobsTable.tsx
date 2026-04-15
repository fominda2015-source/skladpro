import { DataTable } from "../../shared/ui/DataTable";

export type IntegrationJobRow = {
  id: string;
  kind: string;
  status: "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";
  payload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export function IntegrationJobsTable({
  jobs,
  statusClass,
  onRun
}: {
  jobs: IntegrationJobRow[];
  statusClass: (status: string) => string;
  onRun: (id: string) => void;
}) {
  return (
    <DataTable headers={["Дата", "Тип", "Статус", "Ошибка", "Действия"]}>
      {jobs.map((job) => (
        <tr key={job.id}>
          <td>{new Date(job.createdAt).toLocaleString()}</td>
          <td>{job.kind}</td>
          <td>
            <span className={`badge ${statusClass(job.status)}`}>{job.status}</span>
          </td>
          <td>{job.error || "—"}</td>
          <td>
            <button type="button" onClick={() => onRun(job.id)} disabled={job.status === "RUNNING"}>
              Запустить
            </button>
          </td>
        </tr>
      ))}
    </DataTable>
  );
}
