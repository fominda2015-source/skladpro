import { useState } from "react";
import {
  CATALOG_MATERIAL_SECTIONS,
  catalogMaterialSectionLabel,
  type CatalogMaterialSection,
  type ToolCatalogMaterialRow
} from "./toolCatalog";
import { MobileCard, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";

type Props = {
  rows: ToolCatalogMaterialRow[];
  loading?: boolean;
  canWrite?: boolean;
  currentSection?: CatalogMaterialSection | null;
  busyMaterialId?: string | null;
  onChangeSection?: (materialId: string, section: CatalogMaterialSection | null) => void | Promise<void>;
};

export function ToolCatalogMaterialsTable({
  rows,
  loading,
  canWrite,
  currentSection,
  busyMaterialId,
  onChangeSection
}: Props) {
  const [moveDraft, setMoveDraft] = useState<Record<string, CatalogMaterialSection>>({});

  if (loading) return <p className="muted">Загрузка...</p>;
  if (!rows.length) return <p className="muted">Позиции не найдены.</p>;

  const moveTargets = CATALOG_MATERIAL_SECTIONS.filter((s) => s.value !== currentSection);

  return (
    <ResponsiveTableShell>
      {canWrite ? (
        <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>
          Ошибочно попали в раздел? Уберите на склад или перенесите в другой раздел каталога. Остатки на складе
          сохраняются.
        </p>
      ) : null}
      <div className="erpTableWrap" style={{ marginTop: 8 }}>
        <table className="erpTable desktopTable">
          <thead>
            <tr>
              <th>Наименование</th>
              <th style={{ width: 72 }}>Ед.</th>
              <th>Объект</th>
              <th style={{ width: 88 }}>Раздел</th>
              <th style={{ width: 96 }}>Новые</th>
              <th style={{ width: 110 }}>Использованные</th>
              {canWrite ? <th style={{ width: 220 }}>Действия</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const busy = busyMaterialId === r.materialId;
              const draftTarget = moveDraft[r.materialId] ?? moveTargets[0]?.value ?? "PPE";
              return (
                <tr key={`${r.warehouseId}-${r.materialId}-${r.section}`}>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td>{r.unit}</td>
                  <td>{r.warehouseName}</td>
                  <td>{r.section}</td>
                  <td>{r.qtyNew}</td>
                  <td>{r.qtyUsed > 0 ? r.qtyUsed : "—"}</td>
                  {canWrite ? (
                    <td>
                      <div className="erpCellActions" style={{ flexWrap: "wrap", gap: 6 }}>
                        <button
                          type="button"
                          className="ghostBtn"
                          style={{ fontSize: 12, padding: "4px 8px" }}
                          disabled={busy || !onChangeSection}
                          onClick={() => void onChangeSection?.(r.materialId, null)}
                        >
                          {busy ? "…" : "Убрать"}
                        </button>
                        {moveTargets.length > 0 ? (
                          <>
                            <select
                              value={draftTarget}
                              disabled={busy}
                              style={{ fontSize: 12, maxWidth: 120 }}
                              onChange={(e) =>
                                setMoveDraft((prev) => ({
                                  ...prev,
                                  [r.materialId]: e.target.value as CatalogMaterialSection
                                }))
                              }
                            >
                              {moveTargets.map((s) => (
                                <option key={`mv-${s.value}`} value={s.value}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="ghostBtn"
                              style={{ fontSize: 12, padding: "4px 8px" }}
                              disabled={busy || !onChangeSection}
                              onClick={() => void onChangeSection?.(r.materialId, draftTarget)}
                            >
                              Перенести
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mobileCards">
        {rows.map((r) => {
          const busy = busyMaterialId === r.materialId;
          const draftTarget = moveDraft[r.materialId] ?? moveTargets[0]?.value ?? "PPE";
          return (
            <MobileCard key={`m-${r.warehouseId}-${r.materialId}-${r.section}`}>
              <h4>{r.name}</h4>
              <MobileCardField label="Объект">{r.warehouseName}</MobileCardField>
              <MobileCardField label="Раздел">{r.section}</MobileCardField>
              <MobileCardField label="Ед.">{r.unit}</MobileCardField>
              <MobileCardField label="Новые">{r.qtyNew}</MobileCardField>
              <MobileCardField label="Использ.">{r.qtyUsed > 0 ? r.qtyUsed : "—"}</MobileCardField>
              {canWrite ? (
                <div className="erpCellActions" style={{ marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="ghostBtn"
                    disabled={busy || !onChangeSection}
                    onClick={() => void onChangeSection?.(r.materialId, null)}
                  >
                    Убрать из {catalogMaterialSectionLabel(currentSection)}
                  </button>
                  {moveTargets.length > 0 ? (
                    <>
                      <select
                        value={draftTarget}
                        disabled={busy}
                        onChange={(e) =>
                          setMoveDraft((prev) => ({
                            ...prev,
                            [r.materialId]: e.target.value as CatalogMaterialSection
                          }))
                        }
                      >
                        {moveTargets.map((s) => (
                          <option key={`mmv-${s.value}`} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="ghostBtn"
                        disabled={busy || !onChangeSection}
                        onClick={() => void onChangeSection?.(r.materialId, draftTarget)}
                      >
                        Перенести
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </MobileCard>
          );
        })}
      </div>
    </ResponsiveTableShell>
  );
}
