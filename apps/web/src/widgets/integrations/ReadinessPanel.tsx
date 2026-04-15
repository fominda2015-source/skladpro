import { DataTable } from "../../shared/ui/DataTable";

export type ReadinessResponse = {
  ok: boolean;
  checks: Record<string, boolean>;
  counts?: Record<string, number>;
  countsByCheck?: Record<string, number>;
};

export function ReadinessPanel({ readiness }: { readiness: ReadinessResponse }) {
  return (
    <div className="card">
      <h3>Готовность перед полным тест-прогоном</h3>
      <p className="muted">
        Статус:{" "}
        <strong className={readiness.ok ? "ok" : "bad"}>
          {readiness.ok ? "ГОТОВО" : "НЕ ПОЛНОСТЬЮ ГОТОВО"}
        </strong>
      </p>
      <DataTable headers={["Проверка", "Результат", "Количество"]}>
        {Object.entries(readiness.checks).map(([key, passed]) => (
          <tr key={key}>
            <td>{key}</td>
            <td>{passed ? "OK" : "MISSING"}</td>
            <td>{readiness.countsByCheck?.[key] ?? "—"}</td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
