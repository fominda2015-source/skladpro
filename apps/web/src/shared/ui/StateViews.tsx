import type { ReactNode } from "react";

export function LoadingState({ text = "Загрузка..." }: { text?: string }) {
  return <p className="muted">{text}</p>;
}

export function EmptyState({
  title = "Нет данных",
  hint
}: {
  title?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="card">
      <p className="muted">
        <strong>{title}</strong>
      </p>
      {hint ? <p className="muted">{hint}</p> : null}
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
