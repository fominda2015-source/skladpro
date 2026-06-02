import type { ToolCatalogMaterialRow } from "./toolCatalog";
import { MobileCard, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";

type Props = {
  rows: ToolCatalogMaterialRow[];
  loading?: boolean;
};

export function ToolCatalogMaterialsTable({ rows, loading }: Props) {
  if (loading) return <p className="muted">Загрузка...</p>;
  if (!rows.length) return <p className="muted">Позиции не найдены.</p>;
  return (
    <ResponsiveTableShell>
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
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.warehouseId}-${r.materialId}-${r.section}`}>
              <td>
                <strong>{r.name}</strong>
              </td>
              <td>{r.unit}</td>
              <td>{r.warehouseName}</td>
              <td>{r.section}</td>
              <td>{r.qtyNew}</td>
              <td>{r.qtyUsed > 0 ? r.qtyUsed : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="mobileCards">
      {rows.map((r) => (
        <MobileCard key={`m-${r.warehouseId}-${r.materialId}-${r.section}`}>
          <h4>{r.name}</h4>
          <MobileCardField label="Объект">{r.warehouseName}</MobileCardField>
          <MobileCardField label="Раздел">{r.section}</MobileCardField>
          <MobileCardField label="Ед.">{r.unit}</MobileCardField>
          <MobileCardField label="Новые">{r.qtyNew}</MobileCardField>
          <MobileCardField label="Использ.">{r.qtyUsed > 0 ? r.qtyUsed : "—"}</MobileCardField>
        </MobileCard>
      ))}
    </div>
    </ResponsiveTableShell>
  );
}
