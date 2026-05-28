import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

/** Обёртка вкладки по макету ТЗ: hero → KPI → фильтры → контент */
export function TabShell({ children, className = "" }: Props) {
  return <div className={`tabShell ${className}`.trim()}>{children}</div>;
}

type ToolbarProps = {
  primary?: ReactNode;
  secondary?: ReactNode;
};

export function TabToolbar({ primary, secondary }: ToolbarProps) {
  return (
    <div className="tabToolbar">
      {primary ? <div className="tabToolbarPrimary">{primary}</div> : null}
      {secondary ? <div className="tabToolbarSecondary">{secondary}</div> : null}
    </div>
  );
}
