export type ToolGroupCardRow = {
  key: string;
  label: string;
  type: "CATEGORY" | "NAME";
  categoryId: string | null;
  icon: string | null;
  count: number;
  inStock: number;
  issued: number;
  inRepair: number;
  writtenOff: number;
};

type Props = {
  cards: ToolGroupCardRow[];
  onOpen: (card: ToolGroupCardRow) => void;
};

function metricChip(label: string, value: number, tone?: "ok" | "warn" | "bad" | "neutral") {
  const toneClass =
    tone === "ok"
      ? "toolNameGroupMetric--ok"
      : tone === "warn"
        ? "toolNameGroupMetric--warn"
        : tone === "bad"
          ? "toolNameGroupMetric--bad"
          : "";
  return (
    <span className={`toolNameGroupMetric ${toneClass}`.trim()}>
      <span className="toolNameGroupMetricLabel">{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

export function ToolsCategoryTable({ cards, onOpen }: Props) {
  return (
    <div className="toolNameGroupList">
      {cards.map((card) => (
        <button
          key={card.key}
          type="button"
          className="toolNameGroupRow"
          onClick={() => onOpen(card)}
        >
          <span className="toolNameGroupRowChevron" aria-hidden>
            ▸
          </span>
          <span className="toolNameGroupRowMain">
            <strong className="toolNameGroupRowTitle">
              {card.icon ? `${card.icon} ` : ""}
              {card.label}
            </strong>
            <span className="toolNameGroupRowMetrics">
              {metricChip("всего", card.count)}
              {metricChip("на складе", card.inStock, "ok")}
              {metricChip("выдано", card.issued, card.issued > 0 ? "warn" : "neutral")}
              {metricChip("списано", card.writtenOff, card.writtenOff > 0 ? "bad" : "neutral")}
            </span>
          </span>
          <span className="toolNameGroupRowAction muted">Открыть</span>
        </button>
      ))}
    </div>
  );
}
