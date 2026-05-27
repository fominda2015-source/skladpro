type WarehouseOption = { id: string; name: string };

type Props = {
  value: string;
  onChange: (warehouseId: string) => void;
  warehouses: WarehouseOption[];
  sectionLabel?: string;
};

/** Фильтр объекта на вкладке при режиме «Все объекты» в шапке. */
export function TabObjectFilter(props: Props) {
  const { value, onChange, warehouses, sectionLabel } = props;
  return (
    <div className="tabObjectFilter card" style={{ marginBottom: 12, padding: "10px 14px" }}>
      <label style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, margin: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Объект на вкладке</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ minWidth: 200, flex: "1 1 180px", maxWidth: 420 }}
          aria-label="Фильтр по объекту"
        >
          <option value="">Все доступные объекты</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {sectionLabel ? <span className="muted" style={{ fontSize: 13 }}>{sectionLabel}</span> : null}
      </label>
    </div>
  );
}
