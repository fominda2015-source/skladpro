import type { ReactNode } from "react";

type ShellProps = {
  children: ReactNode;
  className?: string;
};

/** Обёртка: в узком контейнере — mobileCards или stack через fluid-mobile.css */
export function ResponsiveTableShell({ children, className }: ShellProps) {
  return <div className={`responsiveTable--dual table-fluid${className ? ` ${className}` : ""}`}>{children}</div>;
}

type CardProps = {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
};

export function MobileCard({ children, className, onClick }: CardProps) {
  return (
    <article
      className={`mobileCard${className ? ` ${className}` : ""}`}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {children}
    </article>
  );
}

export function MobileCardField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p>
      <strong>{label}:</strong> {children}
    </p>
  );
}

export function MobileCardActions({ children }: { children: ReactNode }) {
  return <div className="toolbar mobileCardActions">{children}</div>;
}
