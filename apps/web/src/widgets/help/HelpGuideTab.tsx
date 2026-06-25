import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHero } from "../ui/PageHero";
import { HELP_GUIDE_SECTIONS } from "./helpGuideSections";
import "./helpGuide.css";

export function HelpGuideTab() {
  const [activeId, setActiveId] = useState(HELP_GUIDE_SECTIONS[0]!.id);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const tocRef = useRef<HTMLElement | null>(null);
  const scrollingRef = useRef(false);

  const scrollToSection = useCallback((id: string) => {
    const el = sectionRefs.current[id];
    if (!el) return;
    scrollingRef.current = true;
    setActiveId(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      scrollingRef.current = false;
    }, 600);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollingRef.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => (b.intersectionRatio ?? 0) - (a.intersectionRatio ?? 0));
        const top = visible[0];
        if (top?.target?.id) {
          setActiveId(top.target.id);
        }
      },
      { rootMargin: "-12% 0px -55% 0px", threshold: [0, 0.15, 0.4, 0.7] }
    );

    for (const section of HELP_GUIDE_SECTIONS) {
      const el = sectionRefs.current[section.id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const btn = tocRef.current?.querySelector(`[data-help-id="${activeId}"]`);
    btn?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId]);

  const sectionCount = HELP_GUIDE_SECTIONS.length;

  const quickLinks = useMemo(
    () => [
      { id: "receipts", label: "Приёмка" },
      { id: "warehouse", label: "Склад" },
      { id: "issues", label: "Выдача" },
      { id: "limits", label: "Лимиты" },
      { id: "tips", label: "Ошибки" }
    ],
    []
  );

  return (
    <div className="helpGuide">
      <PageHero
        icon="📖"
        title="Инструкция пользователя"
        subtitle="Полное руководство по SkladPro: от лимитов и заявок до склада, выдач и городка"
        stats={[
          { label: "Разделов", value: sectionCount },
          { label: "Версия", value: "2026" }
        ]}
        actions={
          <div className="helpGuideQuickActions">
            {quickLinks.map((link) => (
              <button key={link.id} type="button" className="ghostBtn helpGuideQuickBtn" onClick={() => scrollToSection(link.id)}>
                {link.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="helpGuideLayout">
        <nav className="helpGuideToc card" aria-label="Содержание инструкции" ref={tocRef}>
          <p className="helpGuideTocTitle">Содержание</p>
          <ol className="helpGuideTocList">
            {HELP_GUIDE_SECTIONS.map((section, index) => (
              <li key={section.id}>
                <button
                  type="button"
                  data-help-id={section.id}
                  className={`helpGuideTocBtn${activeId === section.id ? " active" : ""}`}
                  onClick={() => scrollToSection(section.id)}
                >
                  <span className="helpGuideTocIcon" aria-hidden>
                    {section.icon}
                  </span>
                  <span className="helpGuideTocText">
                    <span className="helpGuideTocNum">{index + 1}.</span> {section.title}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <div className="helpGuideMain">
          {HELP_GUIDE_SECTIONS.map((section, index) => (
            <article
              key={section.id}
              id={section.id}
              ref={(el) => {
                sectionRefs.current[section.id] = el;
              }}
              className="helpGuideSection card"
            >
              <header className="helpGuideSectionHead">
                <span className="helpGuideSectionIcon" aria-hidden>
                  {section.icon}
                </span>
                <div>
                  <p className="helpGuideSectionKicker">
                    Раздел {index + 1} из {sectionCount}
                  </p>
                  <h3 className="helpGuideSectionTitle">{section.title}</h3>
                  <p className="helpGuideSectionSummary muted">{section.summary}</p>
                </div>
              </header>
              <div className="helpGuideSectionBody">{section.content}</div>
            </article>
          ))}

          <footer className="helpGuideFooter card">
            <h3 className="helpGuideFooterTitle">Нужна помощь?</h3>
            <p className="muted">
              Если инструкция не ответила на вопрос — создайте обращение во вкладке <strong>Обратная связь</strong> или
              напишите администратору системы. После обновления программы обновите страницу сочетанием{" "}
              <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>.
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
