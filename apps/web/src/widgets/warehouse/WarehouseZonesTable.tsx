import { useMemo } from "react";
import { StatusBadge } from "../../shared/ui/StatusBadge";
import { MobileCard, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";

export type ZoneStockRow = {
  storageRoom?: string | null;
  storageCell?: string | null;
  materialName: string;
  quantity: number;
  unit: string;
};

type ZoneAgg = {
  key: string;
  room: string;
  cell: string;
  lines: number;
  totalQty: number;
  fillPct: number;
};

type Props = {
  rows: ZoneStockRow[];
  maxCapacityPerCell?: number;
};

export function WarehouseZonesTable({ rows, maxCapacityPerCell = 100 }: Props) {
  const zones = useMemo(() => {
    const map = new Map<string, ZoneAgg>();
    for (const r of rows) {
      const room = (r.storageRoom || "Без комнаты").trim() || "Без комнаты";
      const cell = (r.storageCell || "—").trim() || "—";
      const key = `${room}::${cell}`;
      const cur = map.get(key) || { key, room, cell, lines: 0, totalQty: 0, fillPct: 0 };
      cur.lines += 1;
      cur.totalQty += Number(r.quantity) || 0;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((z) => ({
        ...z,
        fillPct: Math.min(100, Math.round((z.totalQty / maxCapacityPerCell) * 100))
      }))
      .sort((a, b) => b.fillPct - a.fillPct || b.lines - a.lines);
  }, [rows, maxCapacityPerCell]);

  const totals = useMemo(() => {
    const occupied = zones.filter((z) => z.lines > 0).length;
    return { zones: zones.length, occupied, lines: rows.length };
  }, [zones, rows.length]);

  if (!rows.length) {
    return (
      <section className="homePanel" style={{ marginTop: 12 }}>
        <div className="homePanelHead">
          <h3>Зоны хранения</h3>
        </div>
        <p className="muted">Укажите комнату и ячейку в карточках остатков — здесь появится карта заполненности.</p>
      </section>
    );
  }

  return (
    <section className="homePanel" style={{ marginTop: 12 }}>
      <div className="homePanelHead">
        <h3>Зоны хранения</h3>
        <span className="muted" style={{ fontSize: 12 }}>
          {totals.occupied} занято · {totals.lines} позиций
        </span>
      </div>
      <ResponsiveTableShell>
      <div className="erpTableWrap">
        <table className="erpTable desktopTable">
          <thead>
            <tr>
              <th>Комната</th>
              <th>Ячейка</th>
              <th>Позиций</th>
              <th>Кол-во</th>
              <th>Заполненность</th>
            </tr>
          </thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.key} className={z.fillPct >= 90 ? "rowRisk" : z.fillPct >= 100 ? "rowBad" : undefined}>
                <td>
                  <strong>{z.room}</strong>
                </td>
                <td>{z.cell}</td>
                <td>{z.lines}</td>
                <td>{z.totalQty.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}</td>
                <td>
                  <StatusBadge tone={z.fillPct >= 100 ? "bad" : z.fillPct >= 75 ? "warn" : "ok"}>
                    {z.fillPct}%
                  </StatusBadge>
                  <div className="progressWrap" style={{ width: 80, marginTop: 4 }}>
                    <div className="progressBar" style={{ width: `${z.fillPct}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mobileCards">
        {zones.map((z) => (
          <MobileCard key={`m-${z.key}`}>
            <h4>{z.room}</h4>
            <MobileCardField label="Ячейка">{z.cell}</MobileCardField>
            <MobileCardField label="Позиций">{z.lines}</MobileCardField>
            <MobileCardField label="Кол-во">{z.totalQty.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}</MobileCardField>
            <MobileCardField label="Заполненность">
              <StatusBadge tone={z.fillPct >= 100 ? "bad" : z.fillPct >= 75 ? "warn" : "ok"}>{z.fillPct}%</StatusBadge>
            </MobileCardField>
          </MobileCard>
        ))}
      </div>
      </ResponsiveTableShell>
    </section>
  );
}
