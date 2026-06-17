import { NavWipIcon } from "./NavWipIcon";

type Props = {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  canDashboard: boolean;
  canReadStocks: boolean;
  canReadLimits: boolean;
  canMaterialReport: boolean;
  canReadProductivity: boolean;
  canReadTools: boolean;
  canReadIssues: boolean;
  canReadOperations: boolean;
  canReadWaybills: boolean;
  canReadDocuments: boolean;
  canWriteCatalog: boolean;
  canReadIntegrations: boolean;
  canReadNotifications: boolean;
  canReadAudit: boolean;
  canManageUsers: boolean;
  unreadNotificationCount: number;
  chatUnreadTotal: number;
};

type NavItemProps = {
  tab: string;
  activeTab: string;
  icon: string;
  label: string;
  onSelect: (tab: string) => void;
  badge?: number;
  wip?: boolean;
};

function SidebarNavItem({ tab, activeTab, icon, label, onSelect, badge, wip }: NavItemProps) {
  return (
    <button
      type="button"
      className={`navBtn${activeTab === tab ? " active" : ""}${wip ? " navBtn--wip" : ""}`}
      onClick={() => onSelect(tab)}
    >
      <span className="navIcon" aria-hidden>
        {icon}
      </span>
      <span className="navBtnLabel">{label}</span>
      {wip ? <NavWipIcon /> : null}
      {typeof badge === "number" && badge > 0 ? (
        <span className="navUnreadBadge">{badge > 99 ? "99+" : badge}</span>
      ) : null}
    </button>
  );
}

export function SidebarNav(props: Props) {
  const {
    activeTab,
    onSelectTab,
    canDashboard,
    canReadStocks,
    canReadLimits,
    canMaterialReport,
    canReadProductivity,
    canReadTools,
    canReadIssues,
    canReadOperations,
    canReadWaybills,
    canReadDocuments,
    canWriteCatalog,
    canReadIntegrations,
    canReadNotifications,
    canReadAudit,
    canManageUsers,
    unreadNotificationCount,
    chatUnreadTotal
  } = props;

  return (
    <>
      {canDashboard ? (
        <SidebarNavItem tab="stocks" activeTab={activeTab} icon="⌂" label="Главная" onSelect={onSelectTab} />
      ) : null}
      {canReadStocks ? (
        <SidebarNavItem tab="warehouse" activeTab={activeTab} icon="▤" label="Склад" onSelect={onSelectTab} />
      ) : null}
      {canReadLimits ? (
        <SidebarNavItem tab="limits" activeTab={activeTab} icon="⚑" label="Лимиты" onSelect={onSelectTab} />
      ) : null}
      {canMaterialReport ? (
        <SidebarNavItem
          tab="materialReport"
          activeTab={activeTab}
          icon="▪"
          label="Материальный отчёт"
          onSelect={onSelectTab}
        />
      ) : null}
      {canReadProductivity ? (
        <SidebarNavItem tab="productivity" activeTab={activeTab} icon="▦" label="Выработка" onSelect={onSelectTab} />
      ) : null}
      <SidebarNavItem tab="camp" activeTab={activeTab} icon="▣" label="Городок" onSelect={onSelectTab} />
      {canReadTools ? (
        <SidebarNavItem tab="tools" activeTab={activeTab} icon="⚒" label="Инструменты/СИЗ" onSelect={onSelectTab} />
      ) : null}
      <SidebarNavItem tab="acts" activeTab={activeTab} icon="▣" label="Акты" onSelect={onSelectTab} />

      {canReadIssues || canReadOperations || canReadWaybills || canReadDocuments ? (
        <p className="navSectionTitle">Заявки и выдача</p>
      ) : null}
      {canReadIssues ? (
        <SidebarNavItem tab="issues" activeTab={activeTab} icon="⇄" label="Выдачи" onSelect={onSelectTab} />
      ) : null}
      {canReadOperations ? (
        <SidebarNavItem tab="operations" activeTab={activeTab} icon="↙" label="Приходы" onSelect={onSelectTab} />
      ) : null}
      {canReadIssues ? (
        <SidebarNavItem tab="approvals" activeTab={activeTab} icon="☑" label="Заявки" onSelect={onSelectTab} />
      ) : null}
      {canReadWaybills ? (
        <SidebarNavItem tab="waybills" activeTab={activeTab} icon="↔" label="Перемещения" onSelect={onSelectTab} />
      ) : null}
      {canReadDocuments ? (
        <SidebarNavItem tab="documents" activeTab={activeTab} icon="▣" label="Документы" onSelect={onSelectTab} />
      ) : null}

      <p className="navSectionTitle">Прочее</p>
      {canReadNotifications ? (
        <SidebarNavItem
          tab="notifications"
          activeTab={activeTab}
          icon="🔔"
          label="Уведомления"
          onSelect={onSelectTab}
          badge={unreadNotificationCount}
        />
      ) : null}
      <SidebarNavItem
        tab="chat"
        activeTab={activeTab}
        icon="💬"
        label="Чат"
        onSelect={onSelectTab}
        badge={chatUnreadTotal}
      />
      {canReadTools ? (
        <SidebarNavItem tab="qr" activeTab={activeTab} icon="⌁" label="QR-сканер" onSelect={onSelectTab} />
      ) : null}
      {canReadAudit ? (
        <SidebarNavItem tab="audit" activeTab={activeTab} icon="◉" label="Логи действий" onSelect={onSelectTab} />
      ) : null}
      <SidebarNavItem tab="feedback" activeTab={activeTab} icon="🛠" label="Обратная связь" onSelect={onSelectTab} />

      <p className="navSectionTitle navSectionTitle--wip">В разработке</p>
      <SidebarNavItem tab="reports" activeTab={activeTab} icon="📄" label="Сводка по объекту" onSelect={onSelectTab} wip />
      {(canReadStocks || canWriteCatalog) ? (
        <SidebarNavItem tab="catalog" activeTab={activeTab} icon="▣" label="Справочники" onSelect={onSelectTab} wip />
      ) : null}
      {canReadIntegrations ? (
        <SidebarNavItem tab="integrations" activeTab={activeTab} icon="⎘" label="Интеграции" onSelect={onSelectTab} wip />
      ) : null}

      {canManageUsers ? (
        <>
          <p className="navSectionTitle">Администрирование</p>
          <SidebarNavItem tab="admin" activeTab={activeTab} icon="⚙" label="Доступы" onSelect={onSelectTab} />
        </>
      ) : null}
    </>
  );
}
