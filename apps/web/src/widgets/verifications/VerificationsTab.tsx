import { useCallback, useEffect, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../shared/ui/StateViews";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { FilterStrip, PageHero } from "../ui/PageHero";
import { TabShell } from "../layout/TabShell";

export type VerificationToolRow = {
  id: string;
  name: string;
  inventoryNumber: string;
  status: string;
  calibrationDueAt?: string | null;
  warehouse?: { id: string; name: string } | null;
};

type Props = {
  token: string | null;
  apiUrl: string;
  section: "SS" | "EOM";
  warehouseId: string;
  warehouses: Array<{ id: string; name: string }>;
  fetchWithSession: typeof fetch;
  onOpenTool: (id: string) => void;
  statusLabel: (s: string) => string;
  statusTone: (s: string) => "ok" | "warn" | "bad" | "neutral";
  safeName: (n: string) => string;
};

function calibrationTone(due: string | null | undefined): "ok" | "warn" | "bad" | "neutral" {
  if (!due) return "neutral";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "neutral";
  const now = new Date();
  if (d < now) return "bad";
  const in30 = new Date(now);
  in30.setDate(in30.getDate() + 30);
  if (d <= in30) return "warn";
  return "ok";
}

function calibrationLabel(due: string | null | undefined) {
  if (!due) return "Не указана";
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return "—";
  const tone = calibrationTone(due);
  if (tone === "bad") return `Просрочена · ${d.toLocaleDateString("ru-RU")}`;
  if (tone === "warn") return `Скоро · ${d.toLocaleDateString("ru-RU")}`;
  return d.toLocaleDateString("ru-RU");
}

export function VerificationsTab({
  token,
  apiUrl,
  section,
  warehouseId,
  warehouses,
  fetchWithSession,
  onOpenTool,
  statusLabel,
  statusTone,
  safeName
}: Props) {
  const [filter, setFilter] = useState<"" | "overdue" | "soon" | "unset">("overdue");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<VerificationToolRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      page: "1",
      pageSize: "150",
      section,
      sort: "inventory"
    });
    if (warehouseId) params.set("warehouseId", warehouseId);
    if (filter) params.set("calibration", filter);
    if (search.trim()) params.set("q", search.trim());
    try {
      const res = await fetchWithSession(`${apiUrl}/api/tools?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setError("Не удалось загрузить реестр поверок");
        setRows([]);
        return;
      }
      const data = (await res.json()) as { items: VerificationToolRow[] };
      setRows(data.items || []);
    } catch {
      setError("Ошибка сети");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token, apiUrl, section, warehouseId, filter, search, fetchWithSession]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = {
    overdue: rows.filter((r) => calibrationTone(r.calibrationDueAt) === "bad").length,
    soon: rows.filter((r) => calibrationTone(r.calibrationDueAt) === "warn").length,
    unset: rows.filter((r) => !r.calibrationDueAt).length
  };

  return (
    <TabShell>
      <PageHero
        icon="◷"
        title="Поверки"
        subtitle="Сроки поверки измерительного инструмента"
        stats={[
          { label: "В выборке", value: rows.length },
          { label: "Просрочено", value: stats.overdue, tone: stats.overdue > 0 ? "bad" : "ok" },
          { label: "≤30 дней", value: stats.soon, tone: stats.soon > 0 ? "warn" : "neutral" }
        ]}
        actions={
          <button type="button" className="ghostBtn" onClick={() => void load()}>
            ↻ Обновить
          </button>
        }
      />

      <FilterStrip
        search={
          <input
            placeholder="Поиск по названию, инв. №…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void load()}
          />
        }
      >
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Фильтр">
          <option value="">Все с датой</option>
          <option value="overdue">Просроченные</option>
          <option value="soon">Скоро (30 дней)</option>
          <option value="unset">Без даты поверки</option>
        </select>
        <select value={warehouseId} onChange={() => undefined} disabled aria-label="Объект в шапке">
          <option value="">
            {warehouseId ? safeName(warehouses.find((w) => w.id === warehouseId)?.name || "") : "Все объекты"}
          </option>
        </select>
      </FilterStrip>

      {loading && <LoadingState text="Загрузка…" />}
      {error && <ErrorState text={error} />}
      {!loading && !error && !rows.length && (
        <EmptyState
          title="Нет записей"
          hint="Смените фильтр или укажите дату поверки в карточке инструмента."
        />
      )}
      {!loading && !error && rows.length > 0 && (
        <div className="erpTableWrap">
          <table className="erpTable desktopTable">
            <thead>
              <tr>
                <th>Инструмент</th>
                <th>Инв. №</th>
                <th>Объект</th>
                <th>Статус</th>
                <th>Поверка до</th>
                <th style={{ width: 100 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ct = calibrationTone(r.calibrationDueAt);
                return (
                  <tr
                    key={r.id}
                    className={ct === "bad" ? "rowBad" : ct === "warn" ? "rowRisk" : undefined}
                    style={{ cursor: "pointer" }}
                    onClick={() => onOpenTool(r.id)}
                  >
                    <td>
                      <strong>{safeName(r.name)}</strong>
                    </td>
                    <td className="muted">{r.inventoryNumber}</td>
                    <td className="muted">{r.warehouse?.name ? safeName(r.warehouse.name) : "—"}</td>
                    <td>
                      <StatusBadge tone={statusTone(r.status)}>{statusLabel(r.status)}</StatusBadge>
                    </td>
                    <td>
                      <StatusBadge tone={ct}>{calibrationLabel(r.calibrationDueAt)}</StatusBadge>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ghostBtn" onClick={() => onOpenTool(r.id)}>
                        Карточка
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </TabShell>
  );
}
