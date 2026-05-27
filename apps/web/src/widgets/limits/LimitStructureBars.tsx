type Props = {
  plan: number;
  issued: number;
  /** Приход по заявкам / операциям (колонка «Приход»). */
  arrived: number;
  compact?: boolean;
};

function fmtQty(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("ru-RU", { maximumFractionDigits: 3 }) : "0";
}

function fmtPct(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function LimitStructBar(props: {
  fillPct: number;
  label: string;
  tone: "issued" | "issued-done" | "over" | "arrived";
  title: string;
  compact?: boolean;
}) {
  const { fillPct, label, tone, title, compact } = props;
  const width = Math.max(0, Math.min(100, fillPct));
  return (
    <div className={`limitStructBar${compact ? " limitStructBarCompact" : ""}`} title={title}>
      <div className="limitStructBarTrack">
        <div className={`limitStructBarFill tone-${tone}`} style={{ width: `${width}%` }} />
        <span className="limitStructBarLabel">{label}</span>
      </div>
    </div>
  );
}

/** Три полоски лимита: выдача → перерасход (если есть) → приход по заявке. */
export function LimitStructureBars({ plan, issued, arrived, compact }: Props) {
  if (!(plan > 0)) {
    return <span className="muted">—</span>;
  }

  const base = plan;
  const issuedPctRaw = (issued / base) * 100;
  const issuedFill = Math.min(100, issuedPctRaw);
  const issuedDone = issued >= base;
  const over = Math.max(0, issued - base);
  const overPct = over > 0 ? (over / base) * 100 : 0;
  const arrivedPct = Math.min(100, (arrived / base) * 100);

  return (
    <div className="limitStructBars">
      <LimitStructBar
        tone={issuedDone ? "issued-done" : "issued"}
        fillPct={issuedFill}
        label={`${fmtQty(issued)}/${fmtQty(base)} ${fmtPct(issuedPctRaw)}%`}
        title={`Выдано: ${fmtQty(issued)} из ${fmtQty(base)} (${fmtPct(issuedPctRaw)}%)`}
        compact={compact}
      />
      {over > 0 ? (
        <LimitStructBar
          tone="over"
          fillPct={Math.min(100, overPct)}
          label={`${fmtQty(over)}/${fmtQty(base)} ${fmtPct(overPct)}%`}
          title={`Перерасход: ${fmtQty(over)} сверх плана (${fmtPct(overPct)}%)`}
          compact={compact}
        />
      ) : null}
      <LimitStructBar
        tone="arrived"
        fillPct={arrivedPct}
        label={`${fmtQty(arrived)}/${fmtQty(base)} ${fmtPct((arrived / base) * 100)}%`}
        title={`Приехало по заявке: ${fmtQty(arrived)} из ${fmtQty(base)}`}
        compact={compact}
      />
    </div>
  );
}
