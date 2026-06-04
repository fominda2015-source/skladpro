import type { ReactNode } from "react";

type StatItem = {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "warn" | "bad" | "ok";
  onClick?: () => void;
  title?: string;
};

type Props = {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  stats?: StatItem[];
  actions?: ReactNode;
  context?: ReactNode;
  variant?: "default" | "compact";
};

export function PageHero({ icon, title, subtitle, stats, actions, context, variant = "default" }: Props) {
  return (
    <section className={`pageHero pageHero--toolbar ${variant}`}>
      <div className="pageHeroTitleBlock">
        {icon ? <span className="pageHeroIcon" aria-hidden>{icon}</span> : null}
        <div className="pageHeroTitleText">
          <h2 className="pageHeroTitle">{title}</h2>
          {subtitle ? <p className="pageHeroSub muted">{subtitle}</p> : null}
        </div>
      </div>
      {stats && stats.length ? (
        <div className="pageHeroStats">
          {stats.map((s, i) => {
            const tone = s.tone || "neutral";
            const interactive = typeof s.onClick === "function";
            const Tag = interactive ? "button" : ("div" as const);
            return (
              <Tag
                key={i}
                type={interactive ? "button" : undefined}
                className={`pageHeroStat tone-${tone} ${interactive ? "interactive" : ""}`}
                onClick={interactive ? s.onClick : undefined}
                title={s.title}
              >
                <span className="pageHeroStatLabel">{s.label}</span>
                <span className="pageHeroStatValue">{s.value}</span>
              </Tag>
            );
          })}
        </div>
      ) : null}
      {actions ? <div className="pageHeroActions">{actions}</div> : null}
      {context ? <div className="pageHeroContext">{context}</div> : null}
    </section>
  );
}

type FilterStripProps = {
  children: ReactNode;
  search?: ReactNode;
  actions?: ReactNode;
};

export function FilterStrip({ children, search, actions }: FilterStripProps) {
  return (
    <section className="filterStrip">
      {search ? <div className="filterStripSearch">{search}</div> : null}
      <div className="filterStripFilters">{children}</div>
      {actions ? <div className="filterStripActions">{actions}</div> : null}
    </section>
  );
}
