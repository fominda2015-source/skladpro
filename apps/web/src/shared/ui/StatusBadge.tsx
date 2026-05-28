import type { ReactNode } from "react";

type Tone = "ok" | "warn" | "bad" | "doc" | "neutral";

export function StatusBadge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`erpStatus erpStatus--${tone}`}>{children}</span>;
}

export function objectRiskStatus(obj: {
  limitsSs: { overCount: number; percent: number; hasTemplate: boolean };
  limitsEom: { overCount: number; percent: number; hasTemplate: boolean };
  receiptOpen: number;
}): Tone {
  const over = obj.limitsSs.overCount + obj.limitsEom.overCount;
  if (over > 0) return "bad";
  if (obj.receiptOpen > 0) return "warn";
  const maxPct = Math.max(
    obj.limitsSs.hasTemplate ? obj.limitsSs.percent : 0,
    obj.limitsEom.hasTemplate ? obj.limitsEom.percent : 0
  );
  if (maxPct >= 100) return "ok";
  if (maxPct >= 80) return "warn";
  return "neutral";
}

export function objectRiskLabel(tone: Tone) {
  return (
    {
      bad: "Перерасход",
      warn: "Внимание",
      ok: "В норме",
      doc: "Документы",
      neutral: "—"
    } as const
  )[tone];
}
