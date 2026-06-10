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
  writtenOff: number;
};

type Props = {
  cards: ToolGroupCardRow[];
  onOpen: (card: ToolGroupCardRow) => void;
};

function normalizeCard(card: ToolGroupCardRow): ToolGroupCardRow {
  return {
    ...card,
    count: Number(card.count) || 0,
    inStock: Number(card.inStock) || 0,
    issued: Number(card.issued) || 0,
    inRepair: Number(card.inRepair) || 0,
    writtenOff: Number(card.writtenOff) || 0
  };
}

export function ToolsCategoryTable({ cards, onOpen }: Props) {
  const rows = cards.map(normalizeCard);

  return (
    <ResponsiveTableShell>
      <div className="erpTableWrap toolNameGroupTableWrap">
        <table className="erpTable desktopTable toolNameGroupTable">
          <thead>
            <tr>
              <th>Наименование</th>
              <th className="toolNameGroupNumCol">Всего</th>
              <th className="toolNameGroupNumCol">На складе</th>
              <th className="toolNameGroupNumCol">Выдано</th>
              <th className="toolNameGroupNumCol">Списано</th>
              <th className="toolNameGroupActionCol" />
            </tr>
          </thead>
          <tbody>
            {rows.map((card) => (
              <tr
                key={card.key}
                className="rowHighlight toolNameGroupTableRow"
                tabIndex={0}
                style={{ cursor: "pointer" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(card);
                  }
                }}
                onClick={() => onOpen(card)}
              >
                <td className="toolNameGroupNameCell">
                  <span className="toolNameGroupNameText">
                    {card.icon ? `${card.icon} ` : ""}
                    {card.label}
                  </span>
                </td>
                <td className="toolNameGroupNumCell">{card.count}</td>
                <td className="toolNameGroupNumCell toolNameGroupNumCell--ok">{card.inStock}</td>
                <td className="toolNameGroupNumCell toolNameGroupNumCell--warn">{card.issued}</td>
                <td className="toolNameGroupNumCell toolNameGroupNumCell--bad">{card.writtenOff}</td>
                <td className="toolNameGroupActionCell">
                  <span className="toolNameGroupOpenLink">Открыть →</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mobileCards">
        {rows.map((card) => (
          <MobileCard key={`m-${card.key}`} onClick={() => onOpen(card)}>
            <h4>
              {card.icon ? `${card.icon} ` : ""}
              {card.label}
            </h4>
            <div className="toolNameGroupMobileMetrics">
              <MobileCardField label="Всего">{card.count}</MobileCardField>
              <MobileCardField label="На складе">{card.inStock}</MobileCardField>
              <MobileCardField label="Выдано">{card.issued}</MobileCardField>
              <MobileCardField label="Списано">{card.writtenOff}</MobileCardField>
            </div>
            <MobileCardActions>
              <button type="button" className="ghostBtn" onClick={() => onOpen(card)}>
                Открыть →
              </button>
            </MobileCardActions>
          </MobileCard>
        ))}
      </div>
    </ResponsiveTableShell>
  );
}
