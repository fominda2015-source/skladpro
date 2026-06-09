import type { HubCardDef } from "./toolCatalog";

type CardStats = { count?: number; inStock?: number; issued?: number; qty?: number };

type Props = {
  cards: HubCardDef[];
  stats?: Partial<Record<string, CardStats>>;
  onSelect: (id: HubCardDef["id"]) => void;
};

export function ToolsHubNav({ cards, stats, onSelect }: Props) {
  return (
    <div className="toolsHubGrid" role="navigation" aria-label="Разделы инструментов">
      {cards.map((card) => {
        const st = stats?.[card.id];
        const sub =
          st?.inStock != null
            ? `Всего ${st.count ?? 0} · на складе ${st.inStock}${st.issued != null ? ` · выдано ${st.issued}` : ""}`
            : st?.qty != null
              ? `${st.count ?? 0} поз. · ${st.qty} ед.`
              : card.hint;
        return (
          <button
            key={card.id}
            type="button"
            className="toolsHubCard"
            onClick={() => onSelect(card.id)}
          >
            <span className="toolsHubCardIcon" aria-hidden>
              {card.icon}
            </span>
            <span className="toolsHubCardLabel">{card.label}</span>
            {sub ? <span className="toolsHubCardHint muted">{sub}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
