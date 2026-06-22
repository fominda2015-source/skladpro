import { useCallback, useEffect, useMemo, useState } from "react";
import { ALL_OBJECTS_ID } from "../../app/constants";
import { EmptyState, LoadingState, ResultBanner } from "../../shared/ui/StateViews";
import { PageHero } from "../ui/PageHero";
import { ResponsiveTableShell } from "../layout/MobileCardParts";

export type TimesheetEmployeeRow = {
  id: string;
  fullName: string;
  position: string;
  hireDate: string;
  marks: Record<string, string>;
};

type TimesheetContext = {
  organization: string;
  department: string;
  objectName: string;
  sheetLabel: string;
  month: string;
  compileDate: string;
  periodFrom: string;
  periodTo: string;
  periodLabel: string;
  responsibleTitle: string;
  responsibleName: string;
  responsibleFullName: string;
  days: string[];
  staff: Array<{
    id: string;
    fullName: string;
    position: string;
    hireDate: string;
  }>;
};

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: typeof fetch;
  warehouseId: string;
  section: "SS" | "EOM";
  warehouseName: string;
};

function newRow(partial?: Partial<TimesheetEmployeeRow>): TimesheetEmployeeRow {
  return {
    id: partial?.id || `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fullName: partial?.fullName || "",
    position: partial?.position || "",
    hireDate: partial?.hireDate || "",
    marks: partial?.marks || {}
  };
}

function isWeekend(iso: string): boolean {
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(y, (m || 1) - 1, d || 1).getDay();
  return day === 0 || day === 6;
}

function weekdayShort(iso: string): string {
  const names = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const [y, m, d] = iso.split("-").map(Number);
  return names[new Date(y, (m || 1) - 1, d || 1).getDay()] ?? "";
}

function formatDayLabel(iso: string): string {
  const [, , d] = iso.split("-");
  return String(Number(d));
}

function formatRuDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString("ru-RU");
}

function defaultWorkMark(iso: string): string {
  return isWeekend(iso) ? "н" : "8";
}

function buildEmployeesFromContext(ctx: TimesheetContext): TimesheetEmployeeRow[] {
  return ctx.staff.map((u) =>
    newRow({
      id: u.id,
      fullName: u.fullName,
      position: u.position,
      hireDate: u.hireDate,
      marks: Object.fromEntries(ctx.days.map((iso) => [iso, defaultWorkMark(iso)]))
    })
  );
}

function parseFilenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return star[1];
    }
  }
  const plain = header.match(/filename="([^"]+)"/i);
  return plain?.[1] ?? null;
}

export function TimesheetTab({ token, apiUrl, fetchWithSession, warehouseId, section, warehouseName }: Props) {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"ok" | "err">("ok");
  const [exportBusy, setExportBusy] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [context, setContext] = useState<TimesheetContext | null>(null);
  const [organization, setOrganization] = useState("");
  const [department, setDepartment] = useState("");
  const [objectName, setObjectName] = useState("");
  const [employees, setEmployees] = useState<TimesheetEmployeeRow[]>([]);

  const days = context?.days ?? [];

  const loadContext = useCallback(async () => {
    if (!token || !warehouseId || warehouseId === ALL_OBJECTS_ID) {
      setContext(null);
      setEmployees([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const params = new URLSearchParams({ warehouseId, section, month });
      const res = await fetchWithSession(`${apiUrl}/api/timesheet/context?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TimesheetContext;
      setContext(data);
      setOrganization(data.organization);
      setDepartment(data.department);
      setObjectName(data.objectName);
      setEmployees(buildEmployeesFromContext(data));
    } catch (e) {
      setMessage(`Не удалось подготовить табель: ${String(e)}`);
      setMessageTone("err");
      setContext(null);
      setEmployees([]);
    } finally {
      setLoading(false);
    }
  }, [token, warehouseId, section, month, apiUrl, fetchWithSession]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const updateEmployee = useCallback((id: string, patch: Partial<TimesheetEmployeeRow>) => {
    setEmployees((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const updateMark = useCallback((id: string, iso: string, value: string) => {
    setEmployees((prev) =>
      prev.map((row) =>
        row.id === id ? { ...row, marks: { ...row.marks, [iso]: value } } : row
      )
    );
  }, []);

  const fillWeekdays = useCallback(() => {
    setEmployees((prev) =>
      prev.map((row) => {
        const marks = { ...row.marks };
        for (const iso of days) {
          marks[iso] = defaultWorkMark(iso);
        }
        return { ...row, marks };
      })
    );
  }, [days]);

  const exportTimesheet = useCallback(async () => {
    if (!token || !warehouseId || warehouseId === ALL_OBJECTS_ID || !context) return;
    const validEmployees = employees.filter((e) => e.fullName.trim());
    if (!validEmployees.length) {
      setMessage("Нет сотрудников для выгрузки");
      setMessageTone("err");
      return;
    }

    setExportBusy(true);
    setMessage("");
    try {
      const res = await fetchWithSession(`${apiUrl}/api/timesheet/export`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          warehouseId,
          section,
          month: context.month,
          organization: organization.trim(),
          department: department.trim(),
          objectName: objectName.trim(),
          employees: validEmployees.map((e) => ({
            fullName: e.fullName.trim(),
            position: e.position.trim() || undefined,
            hireDate: e.hireDate || undefined,
            marks: e.marks
          }))
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        parseFilenameFromDisposition(res.headers.get("Content-Disposition")) ||
        `Табель ${context.month}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage("Табель сформирован и скачан");
      setMessageTone("ok");
    } catch (e) {
      setMessage(`Не удалось сформировать табель: ${String(e)}`);
      setMessageTone("err");
    } finally {
      setExportBusy(false);
    }
  }, [token, warehouseId, context, employees, organization, department, objectName, section, apiUrl, fetchWithSession]);

  const periodSummary = useMemo(() => {
    if (!context) return "";
    return `${formatRuDate(context.periodFrom)} — ${formatRuDate(context.periodTo)}`;
  }, [context]);

  if (!warehouseId || warehouseId === ALL_OBJECTS_ID) {
    return (
      <EmptyState title="Выберите объект" hint="Табель формируется для конкретного объекта склада" />
    );
  }

  if (loading) {
    return <LoadingState text="Подготовка табеля…" />;
  }

  return (
    <div className="timesheetTab">
      <PageHero
        icon="▤"
        title="Табель"
        subtitle={`Формирование табеля учёта рабочего времени · ${section}`}
        stats={[
          { label: "Сотрудников", value: employees.length },
          { label: "Дней в периоде", value: days.length },
          { label: "Объект", value: warehouseName || "—" }
        ]}
      />

      {message ? (
        <ResultBanner text={message} tone={messageTone === "ok" ? "success" : "error"} />
      ) : null}

      <div className="timesheetLayout">
        <section className="timesheetPanel">
          <h3 className="timesheetPanelTitle">Реквизиты табеля</h3>
          <div className="timesheetFormGrid">
            <label>
              <span>Организация</span>
              <input value={organization} onChange={(e) => setOrganization(e.target.value)} />
            </label>
            <label>
              <span>Структурное подразделение</span>
              <input value={department} onChange={(e) => setDepartment(e.target.value)} />
            </label>
            <label className="timesheetFormGrid--wide">
              <span>Объект</span>
              <input value={objectName} onChange={(e) => setObjectName(e.target.value)} />
            </label>
            <label>
              <span>Отчётный месяц</span>
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
          </div>
        </section>

        <section className="timesheetPanel timesheetAutoCard">
          <h3 className="timesheetPanelTitle">Заполняется автоматически</h3>
          <dl className="timesheetAutoList">
            <div>
              <dt>Дата составления</dt>
              <dd>{context ? formatRuDate(context.compileDate) : "—"}</dd>
            </div>
            <div>
              <dt>Отчётный период</dt>
              <dd>{periodSummary || "—"}</dd>
            </div>
            <div>
              <dt>Ответственный за табельный учёт</dt>
              <dd>
                {context ? (
                  <>
                    <strong>{context.responsibleFullName}</strong>
                    <span className="timesheetAutoMeta">
                      {context.responsibleTitle} · подпись: {context.responsibleName}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>Лист Excel</dt>
              <dd>{context?.sheetLabel || "—"}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="timesheetPanel timesheetPanel--actions">
        <div className="timesheetActions">
          <button type="button" className="btn secondary" onClick={() => void loadContext()}>
            Обновить данные
          </button>
          <button type="button" className="btn secondary" onClick={() => setEmployees((prev) => [...prev, newRow()])}>
            Добавить строку
          </button>
          <button type="button" className="btn secondary" disabled={!employees.length} onClick={fillWeekdays}>
            Заполнить будни: 8, выходные: н
          </button>
          <button type="button" className="btn primary" disabled={exportBusy || !employees.length} onClick={() => void exportTimesheet()}>
            {exportBusy ? "Формирование…" : "Скачать Excel"}
          </button>
        </div>
        <p className="timesheetHint">
          Сотрудники, даты и ответственный подставляются из системы. Отметки: число часов (8), <code>н</code> — неявка,
          <code>ОТ</code>, <code>Б</code>, <code>ДО</code>, <code>П</code>.
        </p>
      </section>

      {!employees.length ? (
        <EmptyState
          title="Сотрудники не найдены"
          hint="Назначьте пользователей на объект или добавьте строки вручную"
        />
      ) : (
        <div className="timesheetTableCard">
          <ResponsiveTableShell className="timesheetTableWrap">
            <table className="timesheetTable">
              <thead>
                <tr>
                  <th className="timesheetSticky timesheetNumCol">№</th>
                  <th className="timesheetSticky timesheetNameCol">Фамилия И.О.</th>
                  <th className="timesheetSticky timesheetPosCol">Должность</th>
                  <th className="timesheetSticky timesheetDateCol">Дата приёма</th>
                  {days.map((iso) => (
                    <th
                      key={iso}
                      className={["timesheetDayCol", isWeekend(iso) ? "timesheetDayCol--weekend" : ""]
                        .filter(Boolean)
                        .join(" ")}
                      title={iso}
                    >
                      <span className="timesheetDayNum">{formatDayLabel(iso)}</span>
                      <span className="timesheetDayWd">{weekdayShort(iso)}</span>
                    </th>
                  ))}
                  <th className="timesheetSticky timesheetOpsCol" />
                </tr>
              </thead>
              <tbody>
                {employees.map((row, idx) => (
                  <tr key={row.id}>
                    <td className="timesheetSticky timesheetNumCol">{idx + 1}</td>
                    <td className="timesheetSticky timesheetNameCol">
                      <input
                        className="timesheetCellInput"
                        value={row.fullName}
                        onChange={(e) => updateEmployee(row.id, { fullName: e.target.value })}
                        placeholder="Фамилия Имя Отчество"
                      />
                    </td>
                    <td className="timesheetSticky timesheetPosCol">
                      <input
                        className="timesheetCellInput"
                        value={row.position}
                        onChange={(e) => updateEmployee(row.id, { position: e.target.value })}
                      />
                    </td>
                    <td className="timesheetSticky timesheetDateCol">
                      <input
                        className="timesheetCellInput"
                        type="date"
                        value={row.hireDate}
                        onChange={(e) => updateEmployee(row.id, { hireDate: e.target.value })}
                      />
                    </td>
                    {days.map((iso) => (
                      <td key={iso} className={isWeekend(iso) ? "timesheetDayCol--weekend" : ""}>
                        <input
                          className="timesheetMarkInput"
                          value={row.marks[iso] ?? ""}
                          onChange={(e) => updateMark(row.id, iso, e.target.value)}
                          placeholder="8"
                        />
                      </td>
                    ))}
                    <td className="timesheetSticky timesheetOpsCol">
                      <button
                        type="button"
                        className="btn ghost small"
                        onClick={() => setEmployees((prev) => prev.filter((e) => e.id !== row.id))}
                      >
                        Удалить
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTableShell>
        </div>
      )}
    </div>
  );
}
