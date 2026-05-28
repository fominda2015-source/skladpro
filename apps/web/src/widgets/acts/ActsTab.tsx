import { ACT_TEMPLATES, actDownloadUrl } from "./actsManifest";
import { PageHero } from "../ui/PageHero";

const publicBase = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");

export function ActsTab() {
  return (
    <div className="actsTab">
      <PageHero
        variant="compact"
        icon="📋"
        title="Акты"
        subtitle="Готовые шаблоны Excel для скачивания и заполнения на объекте"
      />

      <p className="muted actsTabLead">
        Файлы хранятся в системе и доступны без привязки к объекту. Скачайте нужный акт, заполните и приложите к
        документам или заявке.
      </p>

      <ul className="actsList">
        {ACT_TEMPLATES.map((act) => {
          const href = actDownloadUrl(act.fileName, publicBase);
          return (
            <li key={act.id} className="actsListItem">
              <div className="actsListMain">
                <span className="actsListIcon" aria-hidden>
                  📄
                </span>
                <div className="actsListText">
                  <strong>{act.label}</strong>
                  {act.description ? <span className="muted actsListDesc">{act.description}</span> : null}
                  <span className="muted actsListFile">{act.fileName}</span>
                </div>
              </div>
              <a className="primaryBtn actsDownloadBtn" href={href} download={act.fileName}>
                Скачать
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
