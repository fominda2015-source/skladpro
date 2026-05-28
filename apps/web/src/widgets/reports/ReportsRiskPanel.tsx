type Props = {
  limitsOver: number;
  calibrationOverdue: number;
  receiptOpen: number;
  waybillsOpen: number;
  onOpenLimits?: () => void;
  onOpenVerifications?: () => void;
  onOpenReceipts?: () => void;
  onOpenWaybills?: () => void;
  onOpenDocuments?: () => void;
};

export function ReportsRiskPanel({
  limitsOver,
  calibrationOverdue,
  receiptOpen,
  waybillsOpen,
  onOpenLimits,
  onOpenVerifications,
  onOpenReceipts,
  onOpenWaybills,
  onOpenDocuments
}: Props) {
  const items = [
    {
      id: "lim",
      label: "Перерасход лимитов",
      value: limitsOver,
      tone: limitsOver > 0 ? ("bad" as const) : ("ok" as const),
      onClick: onOpenLimits
    },
    {
      id: "cal",
      label: "Просроченные поверки",
      value: calibrationOverdue,
      tone: calibrationOverdue > 0 ? ("bad" as const) : ("ok" as const),
      onClick: onOpenVerifications
    },
    {
      id: "rcp",
      label: "Приёмки в работе",
      value: receiptOpen,
      tone: receiptOpen > 0 ? ("warn" as const) : ("neutral" as const),
      onClick: onOpenReceipts
    },
    {
      id: "wb",
      label: "Открытые ТН",
      value: waybillsOpen,
      tone: waybillsOpen > 0 ? ("warn" as const) : ("neutral" as const),
      onClick: onOpenWaybills
    }
  ];

  return (
    <section className="homePanel" style={{ marginTop: 12 }}>
      <div className="homePanelHead">
        <h3>Блок рисков</h3>
        {onOpenDocuments ? (
          <button type="button" className="ghostBtn" onClick={onOpenDocuments}>
            Документы
          </button>
        ) : null}
      </div>
      <div className="pageHeroStats">
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`pageHeroStat tone-${it.tone} ${it.onClick ? "interactive" : ""}`}
            onClick={it.onClick}
            disabled={!it.onClick}
          >
            <span className="pageHeroStatLabel">{it.label}</span>
            <span className="pageHeroStatValue">{it.value}</span>
          </button>
        ))}
      </div>
      <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
        Нажмите на показатель, чтобы перейти к разделу.
      </p>
    </section>
  );
}
