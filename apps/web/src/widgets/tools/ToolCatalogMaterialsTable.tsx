import type { ToolCatalogMaterialRow } from "./toolCatalog";

type Props = {
  rows: ToolCatalogMaterialRow[];
  loading?: boolean;
};

export function ToolCatalogMaterialsTable({ rows, loading }: Props) {
  if (loading) return <p className="muted">Загрузка...</p>;
  if (!rows.length) return <p className="muted">Позиции не найдены.</p>;
  return (
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
  );
}
