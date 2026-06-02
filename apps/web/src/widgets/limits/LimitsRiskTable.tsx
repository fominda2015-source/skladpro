import { useMemo } from "react";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import {
  buildLimitMaterialRows,
  computeLimitRiskStats,
  type LimitMaterialRiskRow,
  type LimitRiskTemplate
} from "./limitsRiskUtils";
import { MobileCard, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";

type Props = {
  templates: LimitRiskTemplate[];
  issuedTotalsByMaterialId: Map<string, number>;
  limitSupplyByMaterialId: Record<string, { arrivedQty?: number }>;
  showOnlyRisk: boolean;
  onShowOnlyRiskChange: (value: boolean) => void;
  onOpenMaterial?: (materialId: string) => void;
};

function riskTone(risk: LimitMaterialRiskRow["risk"]) {
  if (risk === "over") return "bad" as const;
  if (risk === "near") return "warn" as const;
  if (risk === "ok") return "ok" as const;
  return "neutral" as const;
}

function riskLabel(risk: LimitMaterialRiskRow["risk"]) {
  return (
    {
      over: "Перерасход",
      near: "Риск",
      ok: "В норме",
      empty: "Без плана"
    } as const
  )[risk];
}

function rowClass(risk: LimitMaterialRiskRow["risk"]) {
  if (risk === "over") return "rowBad";
  if (risk === "near") return "rowRisk";
  return "";
}

export function LimitsRiskTable({
  templates,
  issuedTotalsByMaterialId,
  limitSupplyByMaterialId,
  showOnlyRisk,
  onShowOnlyRiskChange,
  onOpenMaterial
}: Props) {
  const allRows = useMemo(
    () => buildLimitMaterialRows(templates, issuedTotalsByMaterialId, limitSupplyByMaterialId),
    [templates, issuedTotalsByMaterialId, limitSupplyByMaterialId]
  );
  const stats = useMemo(() => computeLimitRiskStats(allRows), [allRows]);
  const rows = useMemo(
    () => (showOnlyRisk ? allRows.filter((r) => r.risk === "over" || r.risk === "near") : allRows),
    [allRows, showOnlyRisk]
  );

  if (!allRows.length) return null;

  return (
    <section className="homePanel limitsRiskPanel" style={{ marginTop: 12 }}>
      <div className="homePanelHead">
        <h3>Сводка по материалам</h3>
        <label style={{ display: "flex", alignItems: "center", gap: 6, margin: 0, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={showOnlyRisk}
            onChange={(e) => onShowOnlyRiskChange(e.target.checked)}
          />
          Только риск и перерасход
        </label>
      </div>

      <div className="pageHeroStats" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className={`pageHeroStat tone-neutral ${!showOnlyRisk ? "interactive" : ""}`}
          onClick={() => onShowOnlyRiskChange(false)}
          title="Показать все позиции"
        >
          <span className="pageHeroStatLabel">Всего</span>
          <span className="pageHeroStatValue">{stats.total}</span>
        </button>
        <button
          type="button"
          className="pageHeroStat tone-bad interactive"
          onClick={() => onShowOnlyRiskChange(true)}
          title="Фильтр: перерасход"
        >
          <span className="pageHeroStatLabel">Перерасход</span>
          <span className="pageHeroStatValue">{stats.over}</span>
        </button>
        <button
          type="button"
          className="pageHeroStat tone-warn interactive"
          onClick={() => onShowOnlyRiskChange(true)}
          title="Фильтр: ≥90% лимита"
        >
          <span className="pageHeroStatLabel">Риск (≥90%)</span>
          <span className="pageHeroStatValue">{stats.near}</span>
        </button>
        <button
          type="button"
          className="pageHeroStat tone-ok interactive"
          onClick={() => onShowOnlyRiskChange(false)}
        >
          <span className="pageHeroStatLabel">В норме</span>
          <span className="pageHeroStatValue">{stats.ok}</span>
        </button>
      </div>

      <ResponsiveTableShell>
      <div className="erpTableWrap">
        <table className="erpTable desktopTable">
          <thead>
            <tr>
              <th>Материал</th>
              <th>Раздел</th>
              <th style={{ width: 88 }}>План</th>
              <th style={{ width: 88 }}>Выдано</th>
              <th style={{ width: 72 }}>%</th>
              <th style={{ width: 88 }}>Остаток</th>
              <th style={{ width: 110 }}>Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.templateId}-${r.nodeId}`} className={rowClass(r.risk)}>
                <td>
                  {r.materialId && onOpenMaterial ? (
                    <button
                      type="button"
                      className="ghostBtn"
                      style={{ textAlign: "left", fontWeight: 600, height: "auto", padding: "2px 0" }}
                      onClick={() => onOpenMaterial(r.materialId!)}
                    >
                      {r.name}
                    </button>
                  ) : (
                    <strong>{r.name}</strong>
                  )}
                  {r.path ? (
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {r.path}
                    </div>
                  ) : null}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {templates.length > 1 ? r.templateTitle : r.path || "—"}
                </td>
                <td>
                  {r.planned > 0 ? `${r.planned.toLocaleString("ru-RU")} ${r.unit}` : "—"}
                </td>
                <td>
                  {r.issued.toLocaleString("ru-RU")} {r.unit}
                </td>
                <td>{r.planned > 0 ? `${r.percent}%` : "—"}</td>
                <td>
                  {r.planned > 0 ? (
                    <span style={r.remaining < 0 ? { color: "#b91c1c", fontWeight: 600 } : undefined}>
                      {r.remaining.toLocaleString("ru-RU")} {r.unit}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td>
                  <StatusBadge tone={riskTone(r.risk)}>{riskLabel(r.risk)}</StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mobileCards">
        {rows.map((r) => (
          <MobileCard key={`m-${r.templateId}-${r.nodeId}`}>
            <h4>{r.name}</h4>
            {r.path ? <p className="muted" style={{ margin: 0, fontSize: 11 }}>{r.path}</p> : null}
            <MobileCardField label="План">{r.planned > 0 ? `${r.planned.toLocaleString("ru-RU")} ${r.unit}` : "—"}</MobileCardField>
            <MobileCardField label="Выдано">{r.issued.toLocaleString("ru-RU")} {r.unit}</MobileCardField>
            <MobileCardField label="%">{r.planned > 0 ? `${r.percent}%` : "—"}</MobileCardField>
            <MobileCardField label="Статус">
              <StatusBadge tone={riskTone(r.risk)}>{riskLabel(r.risk)}</StatusBadge>
            </MobileCardField>
          </MobileCard>
        ))}
      </div>
      </ResponsiveTableShell>
      {showOnlyRisk && !rows.length ? (
        <p className="muted" style={{ margin: "10px 0 0" }}>
          Нет позиций с перерасходом или риском ≥90%.
        </p>
      ) : null}
      <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
        Ниже — дерево шаблона для детальной правки и импорта. Сортировка: сначала перерасход, затем риск.
      </p>
    </section>
  );
}
