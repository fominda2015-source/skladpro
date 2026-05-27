import { useCallback, useEffect, useState, type ReactNode } from "react";

const STORAGE_KEY = "homeSections.v1";

type StoredMap = Record<string, boolean>;

function readStored(): StoredMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StoredMap) : {};
  } catch {
    return {};
  }
}

function writeStored(next: StoredMap) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota errors
  }
}

export function useCollapsibleState(key: string, defaultOpen: boolean): [boolean, (next?: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => {
    const stored = readStored();
    return key in stored ? Boolean(stored[key]) : defaultOpen;
  });

  const toggle = useCallback(
    (next?: boolean) => {
      setOpen((prev) => {
        const value = typeof next === "boolean" ? next : !prev;
        const cur = readStored();
        cur[key] = value;
        writeStored(cur);
        return value;
      });
    },
    [key]
  );

  useEffect(() => {
    const stored = readStored();
    if (key in stored) {
      const v = Boolean(stored[key]);
      setOpen((prev) => (prev === v ? prev : v));
    }
  }, [key]);

  return [open, toggle];
}

type Props = {
  storageKey: string;
  title: string;
  hint?: string;
  count?: number | string;
  countTone?: "neutral" | "warn" | "bad" | "ok";
  defaultOpen?: boolean;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
};

export function CollapsibleSection({
  storageKey,
  title,
  hint,
  count,
  countTone = "neutral",
  defaultOpen = true,
  actions,
  className,
  bodyClassName,
  children
}: Props) {
  const [open, toggle] = useCollapsibleState(storageKey, defaultOpen);

  return (
    <section className={`collapsibleSection ${className || ""} ${open ? "open" : "closed"}`}>
      <header className="collapsibleHead">
        <button
          type="button"
          className="collapsibleToggle"
          onClick={() => toggle()}
          aria-expanded={open}
          aria-controls={`collapsible-${storageKey}`}
        >
          <span className={`chevron ${open ? "down" : "right"}`} aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span className="collapsibleTitle">{title}</span>
          {typeof count !== "undefined" && count !== null && String(count) !== "" ? (
            <span className={`collapsibleCount tone-${countTone}`}>{count}</span>
          ) : null}
          {hint ? <span className="collapsibleHint muted">{hint}</span> : null}
        </button>
        {actions ? <div className="collapsibleActions">{actions}</div> : null}
      </header>
      {open ? (
        <div id={`collapsible-${storageKey}`} className={`collapsibleBody ${bodyClassName || ""}`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
