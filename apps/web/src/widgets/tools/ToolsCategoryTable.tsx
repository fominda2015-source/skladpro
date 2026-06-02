import { StatusBadge } from "../../shared/ui/StatusBadge";
import { MobileCard, MobileCardActions, MobileCardField, ResponsiveTableShell } from "../layout/MobileCardParts";

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
};

type Props = {
  cards: ToolGroupCardRow[];
  onOpen: (card: ToolGroupCardRow) => void;
};

export function ToolsCategoryTable({ cards, onOpen }: Props) {
  return (
    <ResponsiveTableShell>
    <div className="erpTableWrap" style={{ marginTop: 8 }}>
      <table className="erpTable desktopTable">
        <thead>
          <tr>
            <th>Категория / группа</th>
            <th style={{ width: 100 }}>Тип</th>
            <th style={{ width: 72 }}>Всего</th>
            <th style={{ width: 96 }}>На складе</th>
            <th style={{ width: 80 }}>Выдано</th>
            <th style={{ width: 96 }}>В ремонте</th>
            <th style={{ width: 100 }} />
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr
              key={card.key}
              className="rowHighlight"
              style={{ cursor: "pointer" }}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(card);
                }
              }}
              onClick={() => onOpen(card)}
            >
              <td>
                <strong>
                  {card.icon ? `${card.icon} ` : ""}
                  {card.label}
                </strong>
              </td>
              <td>
                <StatusBadge tone={card.type === "CATEGORY" ? "doc" : "neutral"}>
                  {card.type === "CATEGORY" ? "Категория" : "По названию"}
                </StatusBadge>
              </td>
              <td>{card.count}</td>
              <td>{card.inStock}</td>
              <td>{card.issued}</td>
              <td>{card.inRepair || "—"}</td>
              <td>
                <button
                  type="button"
                  className="ghostBtn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(card);
                  }}
                >
                  Открыть →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <div className="mobileCards">
      {cards.map((card) => (
        <MobileCard key={`m-${card.key}`} onClick={() => onOpen(card)}>
          <h4>
            {card.icon ? `${card.icon} ` : ""}
            {card.label}
          </h4>
          <MobileCardField label="Тип">
            <StatusBadge tone={card.type === "CATEGORY" ? "doc" : "neutral"}>
              {card.type === "CATEGORY" ? "Категория" : "По названию"}
            </StatusBadge>
          </MobileCardField>
          <MobileCardField label="Всего">{card.count}</MobileCardField>
          <MobileCardField label="На складе">{card.inStock}</MobileCardField>
          <MobileCardField label="Выдано">{card.issued}</MobileCardField>
          <MobileCardActions>
            <button type="button" className="ghostBtn" onClick={() => onOpen(card)}>Открыть →</button>
          </MobileCardActions>
        </MobileCard>
      ))}
    </div>
    </ResponsiveTableShell>
  );
}
