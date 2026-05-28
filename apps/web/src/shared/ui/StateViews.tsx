import type { ReactNode } from "react";

export function LoadingState({ text = "Загрузка..." }: { text?: string }) {
  return <p className="muted">{text}</p>;
}

export function EmptyState({
  title = "Нет данных",
  hint,
  icon = "📭",
  action
}: {
  title?: string;
  hint?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="emptyState">
      {icon ? <span className="emptyStateIcon" aria-hidden>{icon}</span> : null}
      <p className="emptyStateTitle">{title}</p>
      {hint ? <p className="emptyStateDesc">{hint}</p> : null}
      {action ? <div className="emptyStateAction">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ text }: { text: string }) {
  return <p className="error">{text}</p>;
}

export function ResultBanner({
  text,
  tone = "neutral"
}: {
  text: string;
  tone?: "neutral" | "success" | "error" | "conflict";
}) {
  const cls =
    tone === "success" ? "ok" : tone === "error" ? "error" : tone === "conflict" ? "warnText" : "muted";
  return <p className={cls}>{text}</p>;
}
