import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import "./App.css";
import jsQR from "jsqr";
import { API_URL, ISSUE_FILTER_KEY, LIST_VIEW_KEY, STOCK_VIEW_KEY, TOKEN_KEY, resolvePublicFileUrl } from "./app/constants";
import { EmptyState, ErrorState, LoadingState, ResultBanner } from "./shared/ui/StateViews";
import {
  IntegrationJobsTable,
  type IntegrationJobRow
} from "./widgets/integrations/IntegrationJobsTable";
import { NotificationsTable, type NotificationRow } from "./widgets/integrations/NotificationsTable";
import { NotificationsTabBlock } from "./widgets/notifications/NotificationsTabBlock";
import { PeriodExportButton } from "./widgets/exports/PeriodExportButton";
import { ReadinessPanel, type ReadinessResponse } from "./widgets/integrations/ReadinessPanel";

/** Recharts 3 Tooltip: value типизируется как ValueType | undefined — параметр unknown безопасен для strict TS. */
function warehouseReportTooltipQty(value: unknown): [string, string] {
  const n = typeof value === "number" ? value : Number(value);
  return [Number.isFinite(n) ? n.toFixed(3) : "—", "Кол-во"];
}

function warehouseReportTooltipCount(value: unknown): [number, string] {
  const n = typeof value === "number" ? value : Number(value);
  return [Number.isFinite(n) ? n : 0, "Операций"];
}

function warehouseReportTooltipPct(value: unknown): [string, string] {
  const n = typeof value === "number" ? value : Number(value);
  return [Number.isFinite(n) ? `${n}%` : "—", "Загрузка"];
}

const WAYBILL_DRIVER_PLACEHOLDER = "Иванов И.И.";
const WAYBILL_SENDER_PLACEHOLDER = "СкладПро";

/** Если фото недоступно — инициал вместо битой картинки. */
function UserAvatarChip(props: {
  avatarUrl?: string | null;
  fullName: string;
  imageClassName: string;
  fallbackClassName?: string;
  imageAlt?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const resolved = resolvePublicFileUrl(props.avatarUrl);
  const initial = props.fullName.trim().slice(0, 1).toUpperCase() || "?";
  if (!resolved || imgFailed) {
    return <span className={props.fallbackClassName ?? props.imageClassName}>{initial}</span>;
  }
  return (
    <img
      src={resolved}
      alt={props.imageAlt ?? ""}
      className={props.imageClassName}
      onError={() => setImgFailed(true)}
    />
  );
}

type LoginResponse = {
  token: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    avatarUrl?: string | null;
    position?: string | null;
    role: string;
    permissions: string[];
    activeWarehouseId?: string | null;
    activeSection?: "SS" | "EOM";
    requireObjectSelection?: boolean;
    availableObjects?: Array<{ id: string; name: string; address?: string | null }>;
  };
};
type StockRow = {
  id: string;
  warehouseId: string;
  warehouseName: string;
  section: "SS" | "EOM";
  materialId: string;
  materialName: string;
  materialSku: string | null;
  materialUnit: string;
  materialKind?: "MATERIAL" | "CONSUMABLE" | "WORKWEAR";
  unitPrice?: number | null;
  quantity: number;
  reserved: number;
  storageRoom?: string | null;
  storageCell?: string | null;
  available: number;
  isLow: boolean;
  updatedAt: string;
};
type StockMovementRow = {
  id: string;
  warehouseId: string;
  materialId: string;
  quantity: string;
  direction: "IN" | "OUT";
  sourceDocumentType: string;
  sourceDocumentId: string | null;
  operationId: string | null;
  issueRequestId: string | null;
  createdAt: string;
  warehouse?: { id: string; name: string };
  material?: { id: string; name: string; unit: string };
  operation?: { id: string; type: string; documentNumber: string | null };
  issueRequest?: { id: string; number: string };
};
type IssuedSummaryRow = {
  materialId: string;
  issuedQty: number;
};
type LimitSupplyMetricRow = {
  materialId: string;
  arrivedQty: number;
  issuedQty: number;
  onOrderQty: number;
  stockQty: number;
};
type MaterialReportHolderRow = {
  holderUserId: string;
  holderName: string;
  lines: Array<{ materialId: string; name: string; unit: string; quantity: number }>;
};
type MaterialWriteoffHistoryApiRow = {
  id: string;
  createdAt: string;
  quantity: number;
  comment?: string | null;
  holderName: string;
  actorName: string;
  materialName: string;
  materialUnit: string;
  documentFileId?: string | null;
  documentPath?: string | null;
  documentFileName?: string | null;
};
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue?: string }>>;
};
type WindowWithBarcodeDetector = Window & {
  BarcodeDetector?: BarcodeDetectorCtor;
};
type MeResponse = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  position?: string | null;
  role: string;
  permissions: string[];
  activeWarehouseId?: string | null;
  activeSection?: "SS" | "EOM";
  requireObjectSelection?: boolean;
  availableObjects?: Array<{ id: string; name: string; address?: string | null }>;
};
type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  role: string;
  position?: string | null;
  status: "ACTIVE" | "BLOCKED";
  permissions: string[];
  customPermissions?: string[];
  warehouseScopeIds?: string[];
  projectScopeIds?: string[];
  sectionScopes?: Array<{ warehouseId: string; section: string }>;
};
type AdminRole = { id: string; name: string; permissions: string[] };
type Position = { id: string; name: string };
type AdminObject = {
  id: string;
  name: string;
  address?: string | null;
  userIds: string[];
  sectionUsers?: { SS: string[]; EOM: string[] };
};
type Warehouse = { id: string; name: string; address?: string | null; isActive: boolean };
type Material = {
  id: string;
  name: string;
  sku?: string | null;
  unit: string;
  kind?: "MATERIAL" | "CONSUMABLE" | "WORKWEAR";
  unitPrice?: number | null;
  category?: string | null;
  mergedIntoId?: string | null;
};
type IssueBasisType = "PROJECT_WORK" | "INTERNAL_NEED" | "EMERGENCY" | "OTHER";
type IssueFlowType = "REQUEST" | "DIRECT_ISSUE";
type IssueStatus = "DRAFT" | "ON_APPROVAL" | "APPROVED" | "REJECTED" | "ISSUED" | "CANCELLED";
type IssueRequestDomainApi = "MATERIALS" | "TOOLS" | "CONSUMABLES" | "WORKWEAR";

function userObjectBindingKind(u: Pick<AdminUser, "warehouseScopeIds" | "projectScopeIds">): "free" | "projects" | "objects" {
  const wh = u.warehouseScopeIds?.length ?? 0;
  const pj = u.projectScopeIds?.length ?? 0;
  if (wh > 0) return "objects";
  if (pj > 0) return "projects";
  return "free";
}
function effectiveIssueDomain(row: {
  domain?: IssueRequestDomainApi;
  items?: unknown[] | null;
  toolItems?: unknown[] | null;
}): IssueRequestDomainApi {
  if (row.domain === "TOOLS") return "TOOLS";
  if (row.domain === "MATERIALS") return "MATERIALS";
  if (row.domain === "CONSUMABLES") return "CONSUMABLES";
  if (row.domain === "WORKWEAR") return "WORKWEAR";
  if (row.toolItems && row.toolItems.length > 0) return "TOOLS";
  return "MATERIALS";
}
type IssueRequest = {
  id: string;
  number: string;
  status: IssueStatus;
  domain?: IssueRequestDomainApi;
  /** Текст «Раздел» в акте: раздел/подраздел лимита */
  limitReleasePath?: string | null;
  flowType?: "REQUEST" | "DIRECT_ISSUE";
  warehouseId: string;
  section?: "SS" | "EOM";
  projectId?: string | null;
  requestedById: string;
  responsibleName?: string | null;
  actualRecipientName?: string | null;
  note?: string | null;
  basisType?: string;
  basisRef?: string | null;
  createdAt: string;
  items?: Array<{
    id: string;
    materialId: string;
    quantity: string | number;
    factLabel?: string | null;
    material?: { name: string; sku?: string | null };
  }>;
  toolItems?: Array<{
    id: string;
    toolId: string;
    tool?: { id: string; name: string; inventoryNumber: string; status?: string };
  }>;
  warehouse?: { name: string };
  project?: { id: string; name: string; code?: string | null } | null;
  requestedBy?: { fullName: string };
  approvedBy?: { fullName: string } | null;
};
type IssuePickCartLine = {
  pickKey: string;
  materialId: string;
  factLabel: string | null;
  canonName: string;
  unit: string;
  sku: string | null;
  available: number;
  acceptedQty?: number;
};
const HOME_ISSUE_CHART_FILL: Record<IssueStatus, string> = {
  DRAFT: "#94a3b8",
  ON_APPROVAL: "#f97316",
  APPROVED: "#22c55e",
  REJECTED: "#ef4444",
  ISSUED: "#3b82f6",
  CANCELLED: "#cbd5e1"
};
const HOME_ISSUE_CHART_LABEL: Record<IssueStatus, string> = {
  DRAFT: "Черновик",
  ON_APPROVAL: "На рассмотрении",
  APPROVED: "Одобрено",
  REJECTED: "Отклонено",
  ISSUED: "Выдано",
  CANCELLED: "Отменено"
};
/** Верхние столбцы «день»: градиенты для столбца i. */
const HOME_TODAY_COLUMN_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
  ["#38bdf8", "#1d4ed8"],
  ["#c084fc", "#6d28d9"],
  ["#34d399", "#047857"],
  ["#fbbf24", "#d97706"]
];
const HOME_ATTENTION_BAR_FILLS = ["#ea580c", "#ca8a04", "#e11d48", "#0284c7", "#6366f1", "#14b8a6", "#8b5cf6", "#dc2626", "#ea580c"] as const;
type OperationRow = {
  id: string;
  type: "INCOME" | "EXPENSE";
  section?: "SS" | "EOM";
  documentNumber?: string | null;
  operationDate?: string;
};
type IssueLine = {
  id: string;
  materialId: string;
  quantity: number;
};
type QrResult =
  | { kind: "tool"; tool: ToolItem };
type ToolStatus = "IN_STOCK" | "ISSUED" | "IN_REPAIR" | "DAMAGED" | "LOST" | "WRITTEN_OFF" | "DISPUTED";
type ToolItem = {
  id: string;
  name: string;
  inventoryNumber: string;
  serialNumber?: string | null;
  qrCode: string;
  status: ToolStatus;
  section?: "SS" | "EOM";
  warehouseId?: string | null;
  warehouse?: { id: string; name: string } | null;
  responsible?: string | null;
  note?: string | null;
  createdAt: string;
};
type ToolWarehouseSummaryRow = {
  warehouseId: string | null;
  warehouseName: string;
  count: number;
  inStock: number;
  issued: number;
};
type ToolEvent = {
  id: string;
  toolId: string;
  action: string;
  status: ToolStatus;
  comment?: string | null;
  createdAt: string;
};
type ToolActionKind = "ISSUE" | "RETURN" | "SEND_TO_REPAIR" | "MARK_DAMAGED" | "MARK_LOST" | "MARK_DISPUTED" | "WRITE_OFF";
type WaybillStatus = "DRAFT" | "FORMED" | "SHIPPED" | "RECEIVED" | "CLOSED";
type Waybill = {
  id: string;
  number: string;
  status: WaybillStatus;
  fromWarehouseId?: string | null;
  toLocation: string;
  sender?: string | null;
  recipient?: string | null;
  vehicle?: string | null;
  driverName?: string | null;
  route?: string | null;
  createdAt: string;
};
type WaybillEvent = {
  id: string;
  status: WaybillStatus;
  comment?: string | null;
  createdAt: string;
};
type PagedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};
type ListPageSize = 20 | 50 | 100;
type Project = { id: string; name: string; code?: string | null; warehouseId?: string | null; section?: "SS" | "EOM" };

type WarehouseSnapshotReport = {
  generatedAt: string;
  warehouse: { id: string; name: string; address: string | null; isActive: boolean };
  counts: {
    stockLines: number;
    totalStockQty: number;
    issuesTotal: number;
    issuesByStatus: Record<string, number>;
    operationsLast30d: { income: number; expense: number };
    waybillsOpen: number;
    tools: number;
    campItems: number;
    receiptRequests: { total: number; byStatus: Record<string, number> };
    limitTemplates: number;
    linkedProjects: number;
  };
  stocksBySection: Array<{ section: string; lines: number; quantity: number }>;
  topMaterials: Array<{ materialId: string; name: string; unit: string; quantity: number; ss: number; eom: number }>;
  projectLimits: Array<{
    projectId: string;
    projectName: string;
    projectCode: string | null;
    limitId: string;
    limitName: string;
    version: number;
    items: Array<{
      materialId: string;
      materialName: string;
      unit: string;
      planned: number;
      issued: number;
      reserved: number;
      onStock: number;
      usagePercent: number;
      remainingPlan: number;
    }>;
  }>;
  limitUsageTop: Array<{ name: string; issued: number; planned: number; percent: number; projectName: string }>;
};
type ChatUser = { id: string; fullName: string; avatarUrl?: string | null; role: string; position?: string | null };
type ChatAttachment = { id: string; fileName: string; mimeType?: string | null; dataUrl: string };
type ChatMessage = { id: string; text: string; createdAt: string; senderId: string; sender: { id: string; fullName: string }; attachments: ChatAttachment[] };
type FeedbackTicketListItem = {
  id: string;
  number: string;
  subject: string;
  status: string;
  authorId: string;
  authorName: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};
type FeedbackTicketDetailView = {
  id: string;
  number: string;
  subject: string;
  status: string;
  authorId: string;
  authorName: string;
  messages: ChatMessage[];
};
type AnnouncementBoardRow = {
  id: string;
  title: string;
  body: string;
  isPinned: boolean;
  expiresAt: string | null;
  createdAt: string;
  author?: { id: string; fullName: string } | null;
};
type TransferRequestApiRow = {
  id: string;
  number: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  fromWarehouseName: string | null;
  toWarehouseName: string | null;
  section: string;
  requestedById: string;
  requesterName: string | null;
  status: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  lines: Array<{ materialId: string; quantity: number; materialName: string; unit: string }>;
};
type Conversation = {
  id: string;
  kind: "DM" | "FEEDBACK";
  participants: Array<{ user: ChatUser }>;
  messages: ChatMessage[];
};
type DocumentFile = {
  id: string;
  groupId: string;
  version: number;
  entityType: string;
  entityId: string;
  type: string;
  fileName: string;
  filePath: string;
  mimeType?: string | null;
  size?: number | null;
  checksumSha256?: string | null;
  replacedById?: string | null;
  isDeleted?: boolean;
  createdAt: string;
  /** Если список открыт по сущности и файл попал сюда только через DocumentLink */
  matchedLinkId?: string | null;
};

type DashboardSummary = {
  role: string;
  generatedAt: string;
  warehouse: {
    receiptsToday: number;
    issuesOperationsToday: number;
    issuesRequestsIssuedToday: number;
    transfersToday: number;
    pendingApprovals: number;
    lowStockLines: number;
    staleOpenIssues: number;
    toolsInRepair: number;
    waybillsOpen: number;
    failedIntegrations24h: number;
    unreadNotifications: number;
    errorNotifications24h: number;
  };
  project: { projectsCount: number; overspendLimitLines: number };
  object?: {
    warehouseId: string | null;
    warehouseName: string | null;
    receiptRequestsOpen: number;
    campItemsCount: number;
    projectsCount: number;
    limitsCount: number;
    materialsInLimits: number;
    plannedQty: number;
    issuedQty: number;
    usagePercent: number;
  };
  admin?: { activeUsers: number; auditEvents24h: number };
};

type AuditLogRow = {
  id: string;
  userId: string;
  action: string;
  actionLabel?: string;
  entityType: string;
  entityLabel?: string;
  entityId: string;
  summary?: string | null;
  beforeData: unknown;
  afterData: unknown;
  createdAt: string;
  user?: { id?: string; email: string; fullName: string };
  reverted?: boolean;
  revertedAt?: string | null;
  revertedBy?: { id?: string; email?: string; fullName?: string } | null;
  revertable?: boolean;
};
type AuditMetaResponse = {
  users: Array<{ id: string; fullName: string; email: string }>;
  entityTypes: Array<{ entityType: string; label: string; count: number }>;
};
type ResultTone = "neutral" | "success" | "error" | "conflict";
type LimitImportNode = {
  id: string;
  parentId?: string | null;
  nodeType: "GROUP" | "MATERIAL";
  title: string;
  materialId?: string | null;
  materialName?: string | null;
  unit?: string | null;
  plannedQty?: string | number | null;
  issuedQty?: string | number | null;
  orderNo: number;
};
type LimitImportTemplate = {
  id: string;
  warehouseId: string;
  section: "SS" | "EOM";
  title: string;
  sourceFileName?: string | null;
  nodes: LimitImportNode[];
  createdAt: string;
};
type ReceiptRequestItem = {
  id: string;
  sourceName: string;
  sourceUnit?: string | null;
  quantity: string | number;
  mappedMaterialId?: string | null;
  acceptedQty?: string | number | null;
  mappedMaterial?: { id: string; name: string; unit: string } | null;
};
type ReceiptRequestRow = {
  id: string;
  number: string;
  warehouseId: string;
  section: "SS" | "EOM";
  status: "NEW" | "IN_PROGRESS" | "RECEIVED" | "CANCELLED";
  sourceFileName?: string | null;
  items: ReceiptRequestItem[];
  createdAt: string;
  fromLimit?: boolean;
  objectLimitTemplateId?: string | null;
  limitTemplate?: { id: string; title: string } | null;
  detectedOrderNumber?: string | null;
  detectedProjectTitle?: string | null;
};
type MaterialMappingRow = {
  id: string;
  sourceName: string;
  sourceUnit?: string | null;
  targetMaterialId: string;
  targetMaterial?: { id: string; name: string; unit: string; sku?: string | null };
};
type CampItemCategory = "CONTAINER" | "EQUIPMENT" | "CABIN" | "TOOL" | "OTHER";
type CampItemStatus = "IN_USE" | "STORAGE" | "REPAIR" | "WRITTEN_OFF";
type CampItemFile = {
  id: string;
  fileName: string;
  filePath: string;
  size?: number | null;
  mimeType?: string | null;
  type?: string | null;
  createdAt: string;
};
type CampItemRow = {
  id: string;
  name: string;
  category: CampItemCategory;
  inventoryNumber?: string | null;
  serialNumber?: string | null;
  manufacturer?: string | null;
  location?: string | null;
  description?: string | null;
  warehouseId?: string | null;
  section: "SS" | "EOM";
  status: CampItemStatus;
  acquiredAt?: string | null;
  createdAt: string;
  updatedAt: string;
  warehouse?: { id: string; name: string } | null;
  createdBy?: { id: string; fullName: string } | null;
  photos: CampItemFile[];
  documents: CampItemFile[];
};
function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [authError, setAuthError] = useState("");
  /** Сообщение на экране входа после протухшего JWT / 401 от API. */
  const [sessionExpiredHint, setSessionExpiredHint] = useState("");
  const [availableObjects, setAvailableObjects] = useState<Array<{ id: string; name: string; address?: string | null }>>([]);
  const [activeObjectId, setActiveObjectId] = useState("");
  const [mustPickObject, setMustPickObject] = useState(false);
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [q, setQ] = useState("");
  const [objectSectionFilter, setObjectSectionFilter] = useState<"SS" | "EOM">("SS");
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [stocksError, setStocksError] = useState("");
  const [stockMovements, setStockMovements] = useState<StockMovementRow[]>([]);
  const [stockMovementsLoading, setStockMovementsLoading] = useState(false);
  const [stockMovementsError, setStockMovementsError] = useState("");
  const [expandedStockRowId, setExpandedStockRowId] = useState("");
  const [showAttachedMaterials, setShowAttachedMaterials] = useState(false);
  const [stockFilterWarehouseId, setStockFilterWarehouseId] = useState("");
  const [stockOnlyAvailable, setStockOnlyAvailable] = useState(false);
  const [stockOnlyLow, setStockOnlyLow] = useState(false);
  const [stockOnlyWithFactNames, setStockOnlyWithFactNames] = useState(false);
  /** Вкладка вида номенклатуры на экране «Склад». */
  const [stockShelfKindTab, setStockShelfKindTab] = useState<"ALL" | "MATERIAL" | "CONSUMABLE" | "WORKWEAR">("ALL");
  const [manualStockWarehouseOverride, setManualStockWarehouseOverride] = useState("");
  const [manualStockName, setManualStockName] = useState("");
  const [manualStockQty, setManualStockQty] = useState("1");
  const [manualStockUnit, setManualStockUnit] = useState("шт");
  const [manualStockBusy, setManualStockBusy] = useState(false);
  const [manualStockMessage, setManualStockMessage] = useState("");
  const [manualStockKind, setManualStockKind] = useState<"MATERIAL" | "CONSUMABLE" | "WORKWEAR">("MATERIAL");
  const [manualStockUnitPrice, setManualStockUnitPrice] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [qrScanning, setQrScanning] = useState(false);
  const [qrScanError, setQrScanError] = useState("");
  const [qrStream, setQrStream] = useState<MediaStream | null>(null);
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);
  const qrDetectTimerRef = useRef<number | null>(null);
  const [activeTab, setActiveTab] = useState<
    | "stocks"
    | "warehouse"
    | "admin"
    | "password"
    | "catalog"
    | "operations"
    | "issues"
    | "limits"
    | "approvals"
    | "documents"
    | "qr"
    | "tools"
    | "waybills"
    | "camp"
    | "audit"
    | "integrations"
    | "notifications"
    | "settings"
    | "profile"
    | "chat"
    | "feedback"
    | "materialReport"
    | "reports"
  >("stocks");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [adminObjects, setAdminObjects] = useState<AdminObject[]>([]);
  const [newObjectName, setNewObjectName] = useState("");
  const [newObjectAddress, setNewObjectAddress] = useState("");
  const [newObjectUserIds, setNewObjectUserIds] = useState<string[]>([]);
  const [selectedObjectSection, setSelectedObjectSection] = useState<"SS" | "EOM">("SS");
  const [bindObjectSectionUserIds, setBindObjectSectionUserIds] = useState<string[]>([]);
  const [objectQuickUserIds, setObjectQuickUserIds] = useState<Record<string, string>>({});
  const [positions, setPositions] = useState<Position[]>([]);
  const [newPositionName, setNewPositionName] = useState("");
  const [newUserPositionId, setNewUserPositionId] = useState("");
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [newUserPermissions, setNewUserPermissions] = useState<string[]>([]);
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRoleName, setSelectedRoleName] = useState("VIEWER");
  const [selectedStatus, setSelectedStatus] = useState<"ACTIVE" | "BLOCKED">("ACTIVE");
  const [newPassword, setNewPassword] = useState("");
  const [adminMessage, setAdminMessage] = useState("");
  const [adminWorkspaceTab, setAdminWorkspaceTab] = useState<"users" | "objects">("users");
  const [adminUserFilter, setAdminUserFilter] = useState("");
  const [expandedAdminObjectId, setExpandedAdminObjectId] = useState("");
  const [selectedWarehouseScopes, setSelectedWarehouseScopes] = useState<string[]>([]);
  const [selectedProjectScopes, setSelectedProjectScopes] = useState<string[]>([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserFullName, setNewUserFullName] = useState("");
  const [newUserRoleName, setNewUserRoleName] = useState("VIEWER");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserWarehouseScopes, setNewUserWarehouseScopes] = useState<string[]>([]);
  const [newUserProjectScopes, setNewUserProjectScopes] = useState<string[]>([]);
  const [passCurrent, setPassCurrent] = useState("");
  const [passNext, setPassNext] = useState("");
  const [passMessage, setPassMessage] = useState("");
  const [profileFullName, setProfileFullName] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [opsMessage, setOpsMessage] = useState("");
  const [warehouseName, setWarehouseName] = useState("Главный склад");
  const [warehouseAddress, setWarehouseAddress] = useState("Москва");
  const [opWarehouseId, setOpWarehouseId] = useState("");
  const [dashboardWarehouseId, setDashboardWarehouseId] = useState("");
  // Legacy-состояния прямого прихода удалены — приёмка идёт через заявки.
  const [issues, setIssues] = useState<IssueRequest[]>([]);
  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [issuesMessage, setIssuesMessage] = useState("");
  const [issuesTone, setIssuesTone] = useState<ResultTone>("neutral");
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState("");
  const [issuesSort] = useState<"created_desc" | "status" | "number">("created_desc");
  const [issueFlowFilter] = useState<IssueFlowType | "">("DIRECT_ISSUE");
  const [issuesPage, setIssuesPage] = useState(1);
  const [issuesPageSize, setIssuesPageSize] = useState<ListPageSize>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LIST_VIEW_KEY) || "{}") as { issuesPageSize?: ListPageSize };
      return saved.issuesPageSize && [20, 50, 100].includes(saved.issuesPageSize) ? saved.issuesPageSize : 20;
    } catch {
      return 20;
    }
  });
  const [issuesTotal, setIssuesTotal] = useState(0);
  const [issueStatusFilter, setIssueStatusFilter] = useState<"" | IssueStatus>(() => {
    const saved = localStorage.getItem(ISSUE_FILTER_KEY);
    return (saved as "" | IssueStatus) || "";
  });
  const [issueSearch, setIssueSearch] = useState("");
  const [issueBasisFilter] = useState<"" | IssueBasisType>("");
  const [issueNote, setIssueNote] = useState("");
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [issueWarehouseId, setIssueWarehouseId] = useState("");
  const [issueMaterialId, setIssueMaterialId] = useState("");
  const [issueResponsible, setIssueResponsible] = useState("");
  const [issueActualRecipient, setIssueActualRecipient] = useState("");
  const [issueMaterialSearch, setIssueMaterialSearch] = useState("");
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueLines, setIssueLines] = useState<IssueLine[]>([]);
  const [issuePickCart, setIssuePickCart] = useState<IssuePickCartLine[]>([]);
  const [issuePickQtyByKey, setIssuePickQtyByKey] = useState<Record<string, number>>({});
  const [issueIssuesDomain, setIssueIssuesDomain] = useState<IssueRequestDomainApi>(() => {
    try {
      const saved = localStorage.getItem("skladpro_issue_domain");
      if (
        saved === "TOOLS" ||
        saved === "MATERIALS" ||
        saved === "CONSUMABLES" ||
        saved === "WORKWEAR"
      ) {
        return saved;
      }
      return "MATERIALS";
    } catch {
      return "MATERIALS";
    }
  });
  const [issueToolSearch, setIssueToolSearch] = useState("");
  const [issueToolPickIds, setIssueToolPickIds] = useState<string[]>([]);
  const [issueToolCatalog, setIssueToolCatalog] = useState<ToolItem[]>([]);
  const [issueToolCatalogLoading, setIssueToolCatalogLoading] = useState(false);
  const [operationsSubTab, setOperationsSubTab] = useState<"materialReceipts" | "toolReceipt">("materialReceipts");
  const [approvalQueueTab, setApprovalQueueTab] = useState<IssueRequestDomainApi>("MATERIALS");
  const [approvalQueue, setApprovalQueue] = useState<IssueRequest[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [limitsMessage, setLimitsMessage] = useState("");
  const [limitImportFile, setLimitImportFile] = useState<File | null>(null);
  const [limitTemplates, setLimitTemplates] = useState<LimitImportTemplate[]>([]);
  const [limitTemplatesLoading, setLimitTemplatesLoading] = useState(false);
  const [limitIssuedTotals, setLimitIssuedTotals] = useState<Record<string, number>>({});
  const [limitSupplyByMaterialId, setLimitSupplyByMaterialId] = useState<
    Record<string, Pick<LimitSupplyMetricRow, "arrivedQty" | "issuedQty" | "onOrderQty" | "stockQty">>
  >({});
  const [limitEditMode, setLimitEditMode] = useState(false);
  const [expandedLimitNodes, setExpandedLimitNodes] = useState<Record<string, boolean>>({});
  // Локальные «черновики» правки строк лимита: ключ — id узла шаблона.
  const [limitNodeDrafts, setLimitNodeDrafts] = useState<
    Record<string, { title?: string; unit?: string; plannedQty?: string }>
  >({});
  const [limitTemplateTitleDrafts, setLimitTemplateTitleDrafts] = useState<Record<string, string>>({});
  const [materialBalances, setMaterialBalances] = useState<MaterialReportHolderRow[]>([]);
  const [materialBalancesLoading, setMaterialBalancesLoading] = useState(false);
  const [materialWriteoffHistory, setMaterialWriteoffHistory] = useState<MaterialWriteoffHistoryApiRow[]>([]);
  const [materialReportMessage, setMaterialReportMessage] = useState("");
  const [materialWriteoffModal, setMaterialWriteoffModal] = useState<
    null | { holderUserId: string; materialId: string; name: string; unit: string; maxQty: number }
  >(null);
  const [materialWriteoffQty, setMaterialWriteoffQty] = useState("");
  const [materialWriteoffComment, setMaterialWriteoffComment] = useState("");
  const [materialWriteoffFile, setMaterialWriteoffFile] = useState<File | null>(null);
  const [materialWriteoffBusy, setMaterialWriteoffBusy] = useState(false);
  const [receiptRequestFile, setReceiptRequestFile] = useState<File | null>(null);
  const [receiptRequests, setReceiptRequests] = useState<ReceiptRequestRow[]>([]);
  // Модалка «Заявка из лимита?» после загрузки Excel.
  const [limitPromptRequest, setLimitPromptRequest] = useState<ReceiptRequestRow | null>(null);
  const [limitPromptTemplateId, setLimitPromptTemplateId] = useState<string>("");
  // Черновики приёмки: на заявку → на позицию → {newName, newUnit, qty}.
  type AcceptanceDraftItem = { newName: string; newUnit: string; qty: string; limitNodeId?: string };
  const [acceptanceDrafts, setAcceptanceDrafts] = useState<Record<string, Record<string, AcceptanceDraftItem>>>({});
  // Подсказки по узлам шаблона лимита для каждой заявки/позиции (для «куда пихаем»).
  type LimitNodeSuggestion = {
    id: string;
    title: string;
    indexLabel?: string | null;
    path: string;
    plannedQty: number | null;
    issuedQty: number;
    unit?: string | null;
  };
  type LimitSuggestionsPayload = {
    hasTemplate?: boolean;
    items: Array<{ itemId: string; currentLimitNodeId: string | null; suggestions: LimitNodeSuggestion[] }>;
  };
  const [limitSuggestions, setLimitSuggestions] = useState<Record<string, LimitSuggestionsPayload>>({});
  const [acceptanceScans, setAcceptanceScans] = useState<Record<string, File | null>>({});
  const [acceptanceDocNumbers, setAcceptanceDocNumbers] = useState<Record<string, string>>({});
  const [acceptanceSubmitting, setAcceptanceSubmitting] = useState<Record<string, boolean>>({});
  const [expandedReceiptIds, setExpandedReceiptIds] = useState<Record<string, boolean>>({});
  // Модалка «приложить документы» перед самым приёмом.
  const [pendingAcceptanceRequestId, setPendingAcceptanceRequestId] = useState<string | null>(null);
  const [pendingAcceptanceFiles, setPendingAcceptanceFiles] = useState<File[]>([]);
  /** Ручной приход на склад — форма только в модалке. */
  const [manualStockModalOpen, setManualStockModalOpen] = useState(false);
  /** ФИО получателя при выдаче заявки (вместо window.prompt). */
  const [issueRecipientModal, setIssueRecipientModal] = useState<null | {
    issueId: string;
    opts?: { fromApprovals?: boolean; closeDrawer?: boolean };
    fallback: string;
    domain: "TOOLS" | "WORKWEAR" | "OTHER";
  }>(null);
  const [issueRecipientDraft, setIssueRecipientDraft] = useState("");
  const [issueRecipientSignedFile, setIssueRecipientSignedFile] = useState<File | null>(null);
  const [directIssueSignedFile, setDirectIssueSignedFile] = useState<File | null>(null);
  const [materialMappings, setMaterialMappings] = useState<MaterialMappingRow[]>([]);
  // Городок: список + UI-состояния.
  const [campItems, setCampItems] = useState<CampItemRow[]>([]);
  const [campMessage, setCampMessage] = useState("");
  const [campSearch, setCampSearch] = useState("");
  const [campCategoryFilter, setCampCategoryFilter] = useState<"" | CampItemCategory>("");
  const [campStatusFilter, setCampStatusFilter] = useState<"" | CampItemStatus>("");
  const [campSelected, setCampSelected] = useState<CampItemRow | null>(null);
  const [campShowAddForm, setCampShowAddForm] = useState(false);
  const [campCreateName, setCampCreateName] = useState("");
  const [campCreateCategory, setCampCreateCategory] = useState<CampItemCategory>("CONTAINER");
  const [campCreateInv, setCampCreateInv] = useState("");
  const [campCreateSerial, setCampCreateSerial] = useState("");
  const [campCreateManufacturer, setCampCreateManufacturer] = useState("");
  const [campCreateLocation, setCampCreateLocation] = useState("");
  const [campCreateDescription, setCampCreateDescription] = useState("");
  const [campCreateStatus, setCampCreateStatus] = useState<CampItemStatus>("IN_USE");
  const [campCreateFiles, setCampCreateFiles] = useState<File[]>([]);
  const [campCreating, setCampCreating] = useState(false);
  const [campDetailFiles, setCampDetailFiles] = useState<File[]>([]);
  const [campDetailUploading, setCampDetailUploading] = useState(false);
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [documentsMessage] = useState("");
  const [docSearchQuery, setDocSearchQuery] = useState("");
  const [docEntityType, setDocEntityType] = useState<"" | "operation" | "issue" | "receipt">("");
  const [docEntityId, setDocEntityId] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [docPreviewUrl, setDocPreviewUrl] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [showStockSku, setShowStockSku] = useState(() => {
    const saved = localStorage.getItem(STOCK_VIEW_KEY);
    if (!saved) return true;
    try {
      return Boolean(JSON.parse(saved).showStockSku);
    } catch {
      return true;
    }
  });
  const [showStockReserve, setShowStockReserve] = useState(() => {
    const saved = localStorage.getItem(STOCK_VIEW_KEY);
    if (!saved) return true;
    try {
      return Boolean(JSON.parse(saved).showStockReserve);
    } catch {
      return true;
    }
  });
  const [showStockPrice, setShowStockPrice] = useState(() => {
    const saved = localStorage.getItem(STOCK_VIEW_KEY);
    if (!saved) return true;
    try {
      return Boolean(JSON.parse(saved).showStockPrice ?? true);
    } catch {
      return true;
    }
  });
  const [qrCode, setQrCode] = useState("");
  const [qrResult, setQrResult] = useState<QrResult | null>(null);
  const [qrMessage, setQrMessage] = useState("");
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [toolsMessage, setToolsMessage] = useState("");
  const [toolsTone, setToolsTone] = useState<ResultTone>("neutral");
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolsError, setToolsError] = useState("");
  const [toolsSort, setToolsSort] = useState<"created_desc" | "inventory" | "status">("created_desc");
  const [toolsPage, setToolsPage] = useState(1);
  const [toolsPageSize, setToolsPageSize] = useState<ListPageSize>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LIST_VIEW_KEY) || "{}") as { toolsPageSize?: ListPageSize };
      return saved.toolsPageSize && [20, 50, 100].includes(saved.toolsPageSize) ? saved.toolsPageSize : 20;
    } catch {
      return 20;
    }
  });
  const [toolsTotal, setToolsTotal] = useState(0);
  const [toolWarehouseSummary, setToolWarehouseSummary] = useState<ToolWarehouseSummaryRow[]>([]);
  const [toolListWarehouseId, setToolListWarehouseId] = useState("");
  const [toolManualModalOpen, setToolManualModalOpen] = useState(false);
  const [toolDetailModalId, setToolDetailModalId] = useState<string | null>(null);
  const [toolDetailRecord, setToolDetailRecord] = useState<ToolItem | null>(null);
  const [loginFieldsReadonly, setLoginFieldsReadonly] = useState(true);
  const [toolName, setToolName] = useState("");
  const [toolInventoryNumber, setToolInventoryNumber] = useState(`INV-${Date.now()}`);
  const [toolSerialNumber, setToolSerialNumber] = useState("");
  const [toolWarehouseId, setToolWarehouseId] = useState("");
  const [toolResponsible, setToolResponsible] = useState("");
  const [toolCategoryDraft, setToolCategoryDraft] = useState<string>("");
  const [toolReceiptNote, setToolReceiptNote] = useState("");
  const [toolSearch, setToolSearch] = useState("");
  const [toolStatusFilter, setToolStatusFilter] = useState<"" | ToolStatus>("");
  // Карточный режим инструментов: сначала видим карточки категорий, потом проваливаемся внутрь.
  type ToolCategoryRow = { id: string; name: string; icon?: string | null; order: number };
  type ToolGroupCard = {
    key: string;
    label: string;
    type: "CATEGORY" | "NAME";
    categoryId: string | null;
    icon: string | null;
    count: number;
    inStock: number;
    issued: number;
    inRepair: number;
  };
  const [toolCategories, setToolCategories] = useState<ToolCategoryRow[]>([]);
  const [toolGroupCards, setToolGroupCards] = useState<ToolGroupCard[]>([]);
  const [toolGroupCardsLoading, setToolGroupCardsLoading] = useState(false);
  const [toolDrilledCard, setToolDrilledCard] = useState<ToolGroupCard | null>(null);
  const [toolCategoryAdminOpen, setToolCategoryAdminOpen] = useState(false);
  const [toolCategoryDraftName, setToolCategoryDraftName] = useState("");
  const [toolCategoryEdit, setToolCategoryEdit] = useState<Record<string, { name: string; icon: string; order: string }>>({});
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const [toolQrPreview, setToolQrPreview] = useState<{ toolId: string; dataUrl: string; qrCode: string } | null>(null);
  const [toolEvents, setToolEvents] = useState<ToolEvent[]>([]);
  const [selectedToolForEvents, setSelectedToolForEvents] = useState<string>("");
  const [toolAction, setToolAction] = useState<{ toolId: string; action: ToolActionKind } | null>(null);
  const [toolActionResponsible, setToolActionResponsible] = useState("");
  const [toolActionComment, setToolActionComment] = useState("");
  const [toolActionPhoto, setToolActionPhoto] = useState<File | null>(null);
  const [waybills, setWaybills] = useState<Waybill[]>([]);
  const [waybillsMessage, setWaybillsMessage] = useState("");
  const [waybillsTone, setWaybillsTone] = useState<ResultTone>("neutral");
  const [waybillsLoading, setWaybillsLoading] = useState(false);
  const [waybillsError, setWaybillsError] = useState("");
  const [waybillsSort, setWaybillsSort] = useState<"created_desc" | "number" | "status">("created_desc");
  const [waybillsPage, setWaybillsPage] = useState(1);
  const [waybillsPageSize, setWaybillsPageSize] = useState<ListPageSize>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LIST_VIEW_KEY) || "{}") as { waybillsPageSize?: ListPageSize };
      return saved.waybillsPageSize && [20, 50, 100].includes(saved.waybillsPageSize) ? saved.waybillsPageSize : 20;
    } catch {
      return 20;
    }
  });
  const [waybillsTotal, setWaybillsTotal] = useState(0);
  const [waybillStatusFilter, setWaybillStatusFilter] = useState<"" | WaybillStatus>("");
  const [waybillFromWarehouseId, setWaybillFromWarehouseId] = useState("");
  const [waybillToLocation, setWaybillToLocation] = useState("Объект 1");
  const [waybillSender, setWaybillSender] = useState(WAYBILL_SENDER_PLACEHOLDER);
  const [waybillRecipient, setWaybillRecipient] = useState("ООО Подрядчик");
  const [waybillVehicle, setWaybillVehicle] = useState("ГАЗель");
  const [waybillDriver, setWaybillDriver] = useState(WAYBILL_DRIVER_PLACEHOLDER);
  const [waybillMaterialId, setWaybillMaterialId] = useState("");
  const [waybillQty, setWaybillQty] = useState(1);
  const [selectedWaybillId, setSelectedWaybillId] = useState("");
  const [peerSummaries, setPeerSummaries] = useState<
    Array<{ warehouseId: string; warehouseName: string; stockLines: number; totalQty: number }>
  >([]);
  const [transferRequests, setTransferRequests] = useState<TransferRequestApiRow[]>([]);
  const [transferReqFromWarehouseId, setTransferReqFromWarehouseId] = useState("");
  const [transferReqToWarehouseId, setTransferReqToWarehouseId] = useState("");
  const [transferReqMaterialId, setTransferReqMaterialId] = useState("");
  const [transferReqQty, setTransferReqQty] = useState(1);
  const [transferReqNote, setTransferReqNote] = useState("");
  const [transferReqSaving, setTransferReqSaving] = useState(false);
  const [waybillEvents, setWaybillEvents] = useState<WaybillEvent[]>([]);
  const [drawerMode, setDrawerMode] = useState<"" | "issue" | "waybill" | "adminUser">("");
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [auditLogs, setAuditLogs] = useState<AuditLogRow[]>([]);
  const [auditMessage, setAuditMessage] = useState("");
  const [auditMeta, setAuditMeta] = useState<AuditMetaResponse>({ users: [], entityTypes: [] });
  const [auditFilterUserId, setAuditFilterUserId] = useState("");
  const [auditFilterEntityType, setAuditFilterEntityType] = useState("");
  const [auditFilterEntityId, setAuditFilterEntityId] = useState("");
  const [auditFilterQuery, setAuditFilterQuery] = useState("");
  const [auditFilterFrom, setAuditFilterFrom] = useState("");
  const [auditFilterTo, setAuditFilterTo] = useState("");
  const [auditShowReverted, setAuditShowReverted] = useState(false);
  const [auditReverting, setAuditReverting] = useState<Record<string, boolean>>({});
  const [integrationJobs, setIntegrationJobs] = useState<IntegrationJobRow[]>([]);
  const [integrationKind, setIntegrationKind] = useState("erp-sync");
  const [integrationPayload, setIntegrationPayload] = useState("{\"batch\":1}");
  const [integrationMessage, setIntegrationMessage] = useState("");
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [chatUsers, setChatUsers] = useState<ChatUser[]>([]);
  const [chatConversations, setChatConversations] = useState<Conversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatAttachment, setChatAttachment] = useState<File | null>(null);
  const [chatError, setChatError] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatWidgetOpen, setChatWidgetOpen] = useState(false);
  const [chatWidgetUserId, setChatWidgetUserId] = useState("");
  const [chatSearch, setChatSearch] = useState("");
  const [chatViewedAt, setChatViewedAt] = useState<Record<string, string>>({});
  const [feedbackTickets, setFeedbackTickets] = useState<FeedbackTicketListItem[]>([]);
  const [feedbackSelectedId, setFeedbackSelectedId] = useState<string>("");
  const [feedbackTicketDetail, setFeedbackTicketDetail] = useState<FeedbackTicketDetailView | null>(null);
  const [feedbackComposerMode, setFeedbackComposerMode] = useState<"thread" | "new">("thread");
  const [feedbackNewSubject, setFeedbackNewSubject] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackAttachment, setFeedbackAttachment] = useState<File | null>(null);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackListLoading, setFeedbackListLoading] = useState(false);
  const [feedbackDetailLoading, setFeedbackDetailLoading] = useState(false);
  const [announcements, setAnnouncements] = useState<AnnouncementBoardRow[]>([]);
  const [announcementsLoading, setAnnouncementsLoading] = useState(false);
  const [announcementComposeOpen, setAnnouncementComposeOpen] = useState(false);
  const [announcementTitleDraft, setAnnouncementTitleDraft] = useState("");
  const [announcementBodyDraft, setAnnouncementBodyDraft] = useState("");
  const [reportsMessage, setReportsMessage] = useState("");
  const [warehouseSnapshot, setWarehouseSnapshot] = useState<WarehouseSnapshotReport | null>(null);
  const [reportsSnapshotLoading, setReportsSnapshotLoading] = useState(false);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const feedbackFileInputRef = useRef<HTMLInputElement | null>(null);
  const feedbackMessagesRef = useRef<HTMLDivElement | null>(null);

  const hasPermission = (permission: string) =>
    Boolean(
      me?.permissions?.includes("*") ||
        me?.permissions?.includes(permission) ||
        (permission === "limits.edit" && Boolean(me?.permissions?.includes("limits.write"))) ||
        (permission === "limits.write" && Boolean(me?.permissions?.includes("limits.edit")))
    );
  const sidebarAccessOptions: Array<{ id: string; label: string; permissions: string[] }> = [
    { id: "stocks", label: "Главная", permissions: ["dashboard.read"] },
    { id: "warehouse", label: "Склад", permissions: ["stocks.read"] },
    { id: "operations", label: "Приходы", permissions: ["operations.read", "operations.write"] },
    { id: "issues", label: "Выдачи", permissions: ["issues.read", "issues.write"] },
    { id: "approvals", label: "Заявки", permissions: ["issues.approve"] },
    { id: "waybills", label: "Перемещения", permissions: ["waybills.read", "waybills.write"] },
    { id: "documents", label: "Документы", permissions: ["documents.read", "documents.write", "documents.upload"] },
    { id: "limits", label: "Лимиты", permissions: ["limits.read", "limits.edit", "limits.write"] },
    { id: "materialReport", label: "Материальный отчёт", permissions: ["materialReport.read", "materialReport.write"] },
    { id: "catalog", label: "Справочники", permissions: ["warehouses.read", "materials.read", "materials.write"] },
    { id: "tools", label: "Инструменты", permissions: ["tools.read", "tools.write"] },
    { id: "qr", label: "QR", permissions: ["tools.read"] },
    { id: "integrations", label: "Интеграции", permissions: ["integrations.read", "integrations.write", "notifications.read"] },
    { id: "notifications", label: "Уведомления", permissions: ["notifications.read"] },
    { id: "audit", label: "Логи", permissions: ["audit.read"] },
    { id: "admin", label: "Доступы", permissions: ["admin.users.manage"] }
  ];
  const roleLabel = (role: string) =>
    ({
      ADMIN: "Системный администратор",
      WAREHOUSE_MANAGER: "Кладовщик",
      CHIEF_WAREHOUSE: "Главный по складу/объекту",
      STOREKEEPER: "Кладовщик участка",
      FOREMAN: "Прораб",
      PROJECT_MANAGER: "Руководитель проекта",
      ACCOUNTING: "Бухгалтерия",
      MANAGEMENT: "Руководство",
      VIEWER: "Наблюдатель"
    })[role] ?? role;
  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error("file_read_error"));
      reader.readAsDataURL(file);
    });
  const statusLabel = (status: "ACTIVE" | "BLOCKED") => (status === "ACTIVE" ? "Активен" : "Заблокирован");
  const issueStatusLabel = (status: string) =>
    ({
      DRAFT: "Черновик",
      ON_APPROVAL: "На рассмотрении",
      APPROVED: "Одобрено",
      REJECTED: "Отклонено",
      ISSUED: "Выдано",
      CANCELLED: "Отменено"
    })[status] ?? status;
  const waybillStatusLabel = (status: string) =>
    ({
      DRAFT: "Черновик",
      FORMED: "Сформирована",
      SHIPPED: "В пути",
      RECEIVED: "Получена",
      CLOSED: "Закрыта"
    })[status] ?? status;
  const toolStatusLabel = (status: string) =>
    ({
      IN_STOCK: "На складе",
      ISSUED: "Выдан",
      IN_REPAIR: "В ремонте",
      DAMAGED: "Поврежден",
      LOST: "Утерян",
      WRITTEN_OFF: "Списан",
      DISPUTED: "Спор"
    })[status] ?? status;
  const toolActionLabel = (action: string) =>
    ({
      ISSUE: "Выдача",
      RETURN: "Возврат",
      SEND_TO_REPAIR: "Передача в ремонт",
      MARK_DAMAGED: "Пометка повреждения",
      MARK_LOST: "Пометка утери",
      MARK_DISPUTED: "Спор",
      WRITE_OFF: "Списание"
    })[action] ?? action;
  const issueActionLabel = (action: "send-for-approval" | "approve" | "reject" | "cancel" | "issue") =>
    ({
      "send-for-approval": "Отправить в заявки",
      approve: "Одобрить",
      reject: "Отклонить",
      cancel: "Отменить",
      issue: "Выдать"
    })[action];
  const issueProcessStep = (status: string) =>
    ({
      DRAFT: "Черновик заявки",
      ON_APPROVAL: "Рассмотрение заявки",
      APPROVED: "Готова к выдаче",
      ISSUED: "Завершено",
      REJECTED: "Отклонена",
      CANCELLED: "Отменена"
    })[status] ?? status;
  const waybillProcessStep = (status: string) =>
    ({
      DRAFT: "Черновик ТН",
      FORMED: "Сформирована",
      SHIPPED: "В пути",
      RECEIVED: "Получена",
      CLOSED: "Закрыта"
    })[status] ?? status;
  const feedbackTicketStatusLabel = (status: string) =>
    ({
      OPEN: "Открыто",
      IN_PROGRESS: "В работе",
      WAITING_REPLY: "Ожидает ответа",
      RESOLVED: "Решено",
      CLOSED: "Закрыто"
    })[status] ?? status;
  const transferRequestStatusLabel = (status: string) =>
    ({
      NEW: "Новая",
      APPROVED: "Согласовано",
      REJECTED: "Отказано",
      DONE: "Выполнено",
      CANCELLED: "Отменено автором"
    })[status] ?? status;
  const dmByUserId = useMemo(() => {
    const map = new Map<string, Conversation>();
    for (const conv of chatConversations) {
      if (conv.kind !== "DM") continue;
      const peer = conv.participants.find((p) => p.user.id !== me?.id)?.user;
      if (peer) map.set(peer.id, conv);
    }
    return map;
  }, [chatConversations, me?.id]);
  const filteredChatUsers = useMemo(() => {
    const qv = chatSearch.trim().toLowerCase();
    const rows = qv
      ? chatUsers.filter((u) => `${u.fullName} ${u.position || ""} ${roleLabel(u.role)}`.toLowerCase().includes(qv))
      : chatUsers;
    return rows.sort((a, b) => {
      const aConv = dmByUserId.get(a.id);
      const bConv = dmByUserId.get(b.id);
      const aLast = aConv?.messages?.[0]?.createdAt || "";
      const bLast = bConv?.messages?.[0]?.createdAt || "";
      return bLast.localeCompare(aLast);
    });
  }, [chatUsers, chatSearch, dmByUserId]);
  const chatRecent = useMemo(
    () =>
      chatConversations
        .filter((c) => c.kind === "DM")
        .map((c) => {
          const peer = c.participants.find((p) => p.user.id !== me?.id)?.user;
          return { conversation: c, peer, last: c.messages?.[0] };
        })
        .filter((x) => Boolean(x.peer))
        .sort((a, b) => (b.last?.createdAt || "").localeCompare(a.last?.createdAt || "")),
    [chatConversations, me?.id]
  );
  const chatUnreadTotal = useMemo(
    () =>
      chatRecent.reduce((acc, row) => {
        if (!row.last || !row.conversation.id) return acc;
        const isUnread =
          row.last.senderId !== me?.id &&
          new Date(row.last.createdAt) > new Date(chatViewedAt[row.conversation.id] || 0);
        return acc + (isUnread ? 1 : 0);
      }, 0),
    [chatRecent, me?.id, chatViewedAt]
  );
  const chatQuickReplies = useMemo(
    () => ["Принято", "Проверю и отпишусь", "Готово", "Нужны уточнения", "Сделаю сегодня"],
    []
  );
  const feedbackQuickReplies = useMemo(
    () => ["Проблема повторяется", "Добавил скриншот", "Нужно срочно", "Подтвердите получение", "Спасибо, вопрос решен"],
    []
  );
  const groupedChatMessages = useMemo(() => {
    const rows: Array<{ type: "date"; label: string } | { type: "message"; item: ChatMessage }> = [];
    let prevDateKey = "";
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    for (const item of chatMessages) {
      const dt = new Date(item.createdAt);
      const dateKey = dt.toDateString();
      if (dateKey !== prevDateKey) {
        let label = dt.toLocaleDateString();
        if (dt.toDateString() === now.toDateString()) label = "Сегодня";
        if (dt.toDateString() === yesterday.toDateString()) label = "Вчера";
        rows.push({ type: "date", label });
        prevDateKey = dateKey;
      }
      rows.push({ type: "message", item });
    }
    return rows;
  }, [chatMessages]);
  const movementSlicesByStockKey = useMemo(() => {
    const map = new Map<string, StockMovementRow[]>();
    for (const m of stockMovements) {
      const key = `${m.warehouseId}::${m.materialId}`;
      const arr = map.get(key) || [];
      arr.push(m);
      map.set(key, arr);
    }
    return map;
  }, [stockMovements]);

  const issuedTotalsByMaterialId = useMemo(() => new Map(Object.entries(limitIssuedTotals)), [limitIssuedTotals]);

  const limitMaterialCandidates = useMemo(() => {
    const out: Array<{
      nodeId: string;
      materialId: string | null;
      materialName: string;
      unit: string;
    }> = [];

    for (const tpl of limitTemplates) {
      for (const n of tpl.nodes) {
        if (n.nodeType !== "MATERIAL") continue;
        const materialName = String(n.materialName ?? n.title ?? "").trim();
        if (!materialName) continue;
        out.push({
          nodeId: n.id,
          materialId: (n.materialId ?? null) as string | null,
          materialName,
          unit: String(n.unit ?? "шт")
        });
      }
    }

    return out;
  }, [limitTemplates]);

  const limitMaterialIdSet = useMemo(
    () => new Set(limitMaterialCandidates.filter((c) => !!c.materialId).map((c) => c.materialId as string)),
    [limitMaterialCandidates]
  );

  const limitMaterialNameSet = useMemo(() => {
    const normalize = (v: string) => v.trim().toLowerCase();
    return new Set(limitMaterialCandidates.map((c) => normalize(c.materialName)).filter(Boolean));
  }, [limitMaterialCandidates]);

  const limitFilterEnabled = limitTemplates.length > 0 && (limitMaterialIdSet.size > 0 || limitMaterialNameSet.size > 0);

  const warehouseVisibleRows = useMemo(() => {
    if (!limitFilterEnabled) return stocks;

    const normalize = (v: string) => v.trim().toLowerCase();
    const isLimitRow = (row: StockRow) =>
      limitMaterialIdSet.has(row.materialId) || limitMaterialNameSet.has(normalize(row.materialName));

    return showAttachedMaterials ? stocks : stocks.filter(isLimitRow);
  }, [
    limitFilterEnabled,
    stocks,
    showAttachedMaterials,
    limitMaterialIdSet,
    limitMaterialNameSet
  ]);

  const materialMappingsByTargetId = useMemo(() => {
    const map = new Map<string, MaterialMappingRow[]>();
    for (const row of materialMappings) {
      const arr = map.get(row.targetMaterialId) || [];
      arr.push(row);
      map.set(row.targetMaterialId, arr);
    }
    return map;
  }, [materialMappings]);

  // Сколько чего пришло по каждому «фактическому названию», сгруппировано по
  // материалу-таргету. Заполняется из acceptedQty по позициям заявок.
  const acceptedBySourceByTargetId = useMemo(() => {
    const map = new Map<
      string,
      Map<string, { sourceName: string; sourceUnit: string; quantity: number }>
    >();
    for (const r of receiptRequests) {
      for (const it of r.items) {
        if (!it.mappedMaterialId) continue;
        const accepted = Number(it.acceptedQty || 0);
        if (!Number.isFinite(accepted) || accepted <= 0) continue;
        const key = `${it.sourceName}|${it.sourceUnit || ""}`;
        const bucket = map.get(it.mappedMaterialId) || new Map();
        const prev = bucket.get(key);
        if (prev) {
          prev.quantity += accepted;
        } else {
          bucket.set(key, {
            sourceName: it.sourceName,
            sourceUnit: it.sourceUnit || "",
            quantity: accepted
          });
        }
        map.set(it.mappedMaterialId, bucket);
      }
    }
    return map;
  }, [receiptRequests]);

  const warehouseDisplayRows = useMemo(() => {
    let rows = warehouseVisibleRows;
    if (stockShelfKindTab !== "ALL") {
      rows = rows.filter((r) => (r.materialKind ?? "MATERIAL") === stockShelfKindTab);
    }
    if (stockFilterWarehouseId) {
      rows = rows.filter((r) => r.warehouseId === stockFilterWarehouseId);
    }
    if (stockOnlyAvailable) {
      rows = rows.filter((r) => Number(r.available) > 0);
    }
    if (stockOnlyLow) {
      rows = rows.filter((r) => r.isLow);
    }
    if (stockOnlyWithFactNames) {
      rows = rows.filter(
        (r) =>
          (materialMappingsByTargetId.get(r.materialId)?.length ?? 0) > 0 ||
          (acceptedBySourceByTargetId.get(r.materialId)?.size ?? 0) > 0
      );
    }
    return rows;
  }, [
    warehouseVisibleRows,
    stockShelfKindTab,
    stockFilterWarehouseId,
    stockOnlyAvailable,
    stockOnlyLow,
    stockOnlyWithFactNames,
    materialMappingsByTargetId,
    acceptedBySourceByTargetId
  ]);

  const stockWarehouseIdsInView = useMemo(() => [...new Set(stocks.map((s) => s.warehouseId))], [stocks]);

  const issueFacingRows = useMemo((): IssuePickCartLine[] => {
    const out: IssuePickCartLine[] = [];
    if (!activeObjectId) return out;
    for (const s of stocks) {
      if (s.warehouseId !== activeObjectId || !(Number(s.available) > 0)) continue;
      const mk = (s.materialKind ?? "MATERIAL") as "MATERIAL" | "CONSUMABLE" | "WORKWEAR";
      if (issueIssuesDomain === "MATERIALS" && mk !== "MATERIAL") continue;
      if (issueIssuesDomain === "CONSUMABLES" && mk !== "CONSUMABLE") continue;
      if (issueIssuesDomain === "WORKWEAR" && mk !== "WORKWEAR") continue;
      const mid = s.materialId;
      const bucket = acceptedBySourceByTargetId.get(mid);
      const maps = materialMappingsByTargetId.get(mid) ?? [];
      const consumedUk = new Set<string>();
      const av = Number(s.available);
      const pushRow = (partial: Omit<IssuePickCartLine, "pickKey"> & { pickKey: string }) => {
        out.push(partial);
      };

      if (bucket?.size) {
        for (const v of bucket.values()) {
          const uk = `${v.sourceName}|${v.sourceUnit || ""}`;
          consumedUk.add(uk);
          pushRow({
            pickKey: `${mid}::a:${encodeURIComponent(uk)}`,
            materialId: mid,
            factLabel: v.sourceName,
            canonName: s.materialName,
            unit: v.sourceUnit || s.materialUnit,
            sku: s.materialSku,
            available: av,
            acceptedQty: v.quantity
          });
        }
      }
      for (const m of maps) {
        const uk = `${m.sourceName}|${m.sourceUnit || ""}`;
        if (consumedUk.has(uk)) continue;
        consumedUk.add(uk);
        pushRow({
          pickKey: `${mid}::m:${m.id}`,
          materialId: mid,
          factLabel: m.sourceName,
          canonName: s.materialName,
          unit: m.sourceUnit || s.materialUnit,
          sku: s.materialSku,
          available: av
        });
      }
      if (consumedUk.size === 0) {
        pushRow({
          pickKey: `${mid}::nom`,
          materialId: mid,
          factLabel: null,
          canonName: s.materialName,
          unit: s.materialUnit,
          sku: s.materialSku,
          available: av
        });
      }
    }
    return out.sort((a, b) =>
      (a.factLabel || a.canonName).localeCompare(b.factLabel || b.canonName, "ru", { sensitivity: "base" })
    );
  }, [stocks, activeObjectId, issueIssuesDomain, acceptedBySourceByTargetId, materialMappingsByTargetId]);

  const issueFacingRowsFiltered = useMemo(() => {
    const qLower = issueMaterialSearch.trim().toLowerCase();
    if (!qLower) return issueFacingRows;
    return issueFacingRows.filter((r) => {
      const hay = `${r.factLabel || ""} ${r.canonName} ${r.sku || ""} ${r.unit}`.toLowerCase();
      return hay.includes(qLower);
    });
  }, [issueFacingRows, issueMaterialSearch]);

  const stockOptionsForIssue = useMemo(
    () =>
      stocks
        .filter((s) => s.warehouseId === issueWarehouseId && s.available > 0)
        .map((s) => ({ materialId: s.materialId, label: `${s.materialName} · доступно ${s.available} ${s.materialUnit}` })),
    [stocks, issueWarehouseId]
  );

  const toggleIssuePickRow = useCallback((row: IssuePickCartLine) => {
    setIssuePickCart((prev) => {
      const exists = prev.some((p) => p.pickKey === row.pickKey);
      if (exists) {
        setIssuePickQtyByKey((qty) => {
          const next = { ...qty };
          delete next[row.pickKey];
          return next;
        });
        return prev.filter((p) => p.pickKey !== row.pickKey);
      }
      setIssuePickQtyByKey((qty) => ({ ...qty, [row.pickKey]: qty[row.pickKey] ?? 1 }));
      return [...prev, row];
    });
  }, []);

  const homeIssueStatusSummary = useMemo(() => {
    const order: IssueStatus[] = ["DRAFT", "ON_APPROVAL", "APPROVED", "ISSUED", "REJECTED", "CANCELLED"];
    const counts: Partial<Record<IssueStatus, number>> = {};
    for (const i of issues) {
      counts[i.status] = (counts[i.status] ?? 0) + 1;
    }
    const total = Math.max(1, issues.length);
    return order
      .filter((s) => (counts[s] ?? 0) > 0)
      .map((s) => ({ status: s, count: counts[s]!, pct: ((counts[s] ?? 0) / total) * 100 }));
  }, [issues]);

  const homeIssuePieChartData = useMemo(
    () =>
      homeIssueStatusSummary.map((s) => ({
        name: HOME_ISSUE_CHART_LABEL[s.status],
        value: s.count,
        status: s.status,
        fill: HOME_ISSUE_CHART_FILL[s.status]
      })),
    [homeIssueStatusSummary]
  );

  const homeTodayOpsBarRows = useMemo(() => {
    if (!dashboard) return [];
    const w = dashboard.warehouse;
    return [
      {
        label: "Приходы (операции)",
        hint: "Проведено сегодня (UTC)",
        value: w.receiptsToday
      },
      {
        label: "Расходы (операции)",
        hint: "",
        value: w.issuesOperationsToday
      },
      {
        label: "Выдачи заявок",
        hint: "Статус «Выдано» сегодня",
        value: w.issuesRequestsIssuedToday
      },
      {
        label: "Трансферы",
        hint: "Тип перемещение",
        value: w.transfersToday
      }
    ];
  }, [dashboard]);

  /** Все ключевые ряды показателей контроля (включая нули — для узнаваемости масштаба). */
  const homeAttentionBarsFull = useMemo(() => {
    if (!dashboard) return [];
    const w = dashboard.warehouse;
    const rows = [
      { label: "На согласовании", value: w.pendingApprovals },
      { label: "Долго ≥7 дн.", value: w.staleOpenIssues },
      { label: "Остаток <5 ед.", value: w.lowStockLines },
      { label: "ТТН открыты", value: w.waybillsOpen },
      { label: "Инстр. ремонт", value: w.toolsInRepair }
    ];
    rows.push(
      { label: "Уведомления", value: w.unreadNotifications },
      { label: "Алерты 24ч", value: w.errorNotifications24h },
      { label: "Интеграции 24ч", value: w.failedIntegrations24h }
    );
    return rows;
  }, [dashboard]);

  const homeLimitRingData = useMemo(() => {
    if (!dashboard) return [{ name: "rest", value: 100, fill: "#eef2ff" }];
    const u = Math.max(0, Math.min(100, dashboard.object?.usagePercent ?? 0));
    const fill = u >= 92 ? "#ef4444" : u >= 75 ? "#f59e0b" : "#4f46e5";
    return [
      { name: "prog", value: u, fill },
      { name: "rest", value: Math.max(0, 100 - u), fill: "#e8edf6" }
    ];
  }, [dashboard]);

  const safeName = (value?: string | null) => {
    if (!value) return "Без названия";
    return /\?{3,}/.test(value) ? "Без названия" : value;
  };
  const chatTimeLabel = (iso?: string) => {
    if (!iso) return "";
    const date = new Date(iso);
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString();
  };
  const reportChartPalette = ["#5b8def", "#3cb88d", "#e8b44c", "#e76b8a", "#9b82e8", "#5ec5cf", "#94a3b8"];
  const reportsIssuePieRows = useMemo(() => {
    if (!warehouseSnapshot) return [];
    return Object.entries(warehouseSnapshot.counts.issuesByStatus).map(([status, value]) => ({
      name: issueStatusLabel(status),
      value
    }));
  }, [warehouseSnapshot]);
  const reportsReceiptPieRows = useMemo(() => {
    if (!warehouseSnapshot) return [];
    const labels: Record<string, string> = {
      NEW: "Новая",
      IN_PROGRESS: "В работе",
      RECEIVED: "Получена",
      CANCELLED: "Отменено"
    };
    return Object.entries(warehouseSnapshot.counts.receiptRequests.byStatus).map(([status, value]) => ({
      name: labels[status] ?? status,
      value
    }));
  }, [warehouseSnapshot]);
  const reportsStockSectionRows = useMemo(() => {
    if (!warehouseSnapshot) return [];
    return warehouseSnapshot.stocksBySection.map((r) => ({
      name: r.section === "SS" ? "СС" : r.section === "EOM" ? "ЭОМ" : r.section,
      quantity: Number(r.quantity) || 0,
      lines: r.lines
    }));
  }, [warehouseSnapshot]);
  const reportsTopMaterialsRows = useMemo(() => {
    if (!warehouseSnapshot) return [];
    return warehouseSnapshot.topMaterials.slice(0, 14).map((m) => ({
      name: m.name.length > 36 ? `${m.name.slice(0, 34)}…` : m.name,
      quantity: Number(m.quantity) || 0
    }));
  }, [warehouseSnapshot]);
  const reportsLimitUsageRows = useMemo(() => {
    if (!warehouseSnapshot) return [];
    return warehouseSnapshot.limitUsageTop.map((r) => ({
      label: r.name.length > 44 ? `${r.name.slice(0, 42)}…` : r.name,
      project: r.projectName,
      percent: r.percent,
      issued: r.issued,
      planned: r.planned
    }));
  }, [warehouseSnapshot]);
  const reportsOpsBars = useMemo(() => {
    if (!warehouseSnapshot) return [];
    const { income, expense } = warehouseSnapshot.counts.operationsLast30d;
    return [
      { name: "Приход", count: income },
      { name: "Расход", count: expense }
    ];
  }, [warehouseSnapshot]);
  const tabTitleMap: Record<string, string> = {
    stocks: "Главная",
    warehouse: "Склад",
    catalog: "Справочники",
    audit: "Аудит действий",
    operations: "Приходы",
    issues: "Заявки на выдачу",
    limits: "Лимиты проекта",
    approvals: "Заявки",
    materialReport: "Материальный отчёт",
    documents: "Документы",
    waybills: "Транспортные накладные",
    qr: "QR-сканирование",
    tools: "Инструменты",
    integrations: "Интеграции и уведомления",
    notifications: "Уведомления",
    chat: "Личные сообщения",
    feedback: "Обратная связь",
    reports: "Сводка по объекту",
    profile: "Мой профиль",
    settings: "Настройки интерфейса",
    admin: "Управление доступами",
    password: "Смена пароля"
  };
  const tabSectionMap: Record<string, string> = {
    stocks: "Операции",
    warehouse: "Операции",
    operations: "Операции",
    issues: "Операции",
    approvals: "Операции",
    waybills: "Операции",
    documents: "Контроль",
    limits: "Контроль",
    materialReport: "Контроль",
    chat: "Контроль",
    feedback: "Контроль",
    reports: "Контроль",
    audit: "Контроль",
    catalog: "Сервис",
    tools: "Сервис",
    qr: "Сервис",
    integrations: "Сервис",
    notifications: "Контроль",
    admin: "Администрирование",
    profile: "Аккаунт",
    settings: "Аккаунт",
    password: "Аккаунт"
  };
  const currentTitle = tabTitleMap[activeTab] ?? "СкладПро";
  const currentSection = tabSectionMap[activeTab] ?? "Раздел";

  const isAuthed = useMemo(() => Boolean(token), [token]);
  const canManageUsers = useMemo(() => hasPermission("admin.users.manage"), [me]);
  const canWriteCatalog = useMemo(() => Boolean(hasPermission("warehouses.write") || hasPermission("materials.write")), [me]);
  const canWriteOperations = useMemo(() => hasPermission("operations.write"), [me]);
  const canWriteLimits = useMemo(
    () => hasPermission("limits.edit") || hasPermission("limits.write"),
    [me]
  );
  const canReadAudit = useMemo(
    () => hasPermission("audit.read"),
    [me]
  );
  const canRevertAudit = useMemo(
    () => Boolean(me?.role === "ADMIN" || me?.permissions?.includes("audit.revert")),
    [me]
  );
  const canDashboard = useMemo(
    () =>
      Boolean(
        hasPermission("dashboard.read") ||
          hasPermission("stocks.read")
      ),
    [me]
  );
  const canReadStocks = useMemo(() => hasPermission("stocks.read"), [me]);
  const canReadIssues = useMemo(() => hasPermission("issues.read"), [me]);
  const canReadOperations = useMemo(() => hasPermission("operations.read"), [me]);
  const canReadLimits = useMemo(() => hasPermission("limits.read"), [me]);
  const canMaterialReport = useMemo(() => hasPermission("materialReport.read"), [me]);
  const canMaterialWriteoff = useMemo(() => hasPermission("materialReport.write"), [me]);
  const canReadDocuments = useMemo(() => hasPermission("documents.read"), [me]);
  const canReadTools = useMemo(() => hasPermission("tools.read"), [me]);
  const canReadWaybills = useMemo(() => hasPermission("waybills.read"), [me]);
  const canWriteWaybills = useMemo(() => hasPermission("waybills.write"), [me]);
  const canReadIntegrations = useMemo(() => hasPermission("integrations.read"), [me]);
  const canReadNotifications = useMemo(() => hasPermission("notifications.read"), [me]);
  const canManageFeedback = useMemo(() => hasPermission("feedback.manage"), [me]);
  const canWriteAnnouncements = useMemo(() => hasPermission("announcements.write"), [me]);
  const isStorekeeperMode = useMemo(() => me?.role === "STOREKEEPER", [me]);

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );
  const purgeAuthClear = useCallback((reason?: "session-expired") => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setStocks([]);
    setStockMovements([]);
    setIntegrationJobs([]);
    setNotifications([]);
    setUsers([]);
    setRoles([]);
    setMe(null);
    setAvailableObjects([]);
    setActiveObjectId("");
    setMustPickObject(false);
    setSessionExpiredHint(
      reason === "session-expired" ? "Сессия истекла или доступ отозван. Войдите снова." : ""
    );
    if (reason === "session-expired") {
      setAuthError("");
    }
  }, []);

  const fetchWithSession = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlString =
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : input.href;

      const nextInit: RequestInit = init ? { ...init } : {};
      const headers = new Headers(init?.headers ?? undefined);
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
      nextInit.headers = headers;

      const res = await fetch(input, nextInit);

      if (res.status === 401 && token && !urlString.includes("/api/auth/login")) {
        purgeAuthClear("session-expired");
      }

      return res;
    },
    [token, purgeAuthClear]
  );

  const onLogout = useCallback(() => {
    purgeAuthClear();
  }, [purgeAuthClear]);

  async function loadStockMovements() {
    if (!token) {
      return;
    }
    setStockMovementsLoading(true);
    setStockMovementsError("");
    try {
      const res = await fetchWithSession(`${API_URL}/api/stock-movements?take=150`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      setStockMovements((await res.json()) as StockMovementRow[]);
    } catch (e) {
      setStockMovements([]);
      setStockMovementsError(String(e));
    } finally {
      setStockMovementsLoading(false);
    }
  }

  async function loadStocks(search = "") {
    if (!token) {
      return;
    }

    setLoadingStocks(true);
    setStocksError("");
    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      params.set("section", objectSectionFilter);
      const query = params.toString() ? `?${params.toString()}` : "";
      const res = await fetchWithSession(`${API_URL}/api/stocks${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as StockRow[];
      setStocks(data);
    } catch (err) {
      setStocksError(`Не удалось загрузить остатки: ${String(err)}`);
    } finally {
      setLoadingStocks(false);
    }
  }

  async function loadMe() {
    if (!token) {
      return;
    }
    const res = await fetchWithSession(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      return;
    }
    const data = (await res.json()) as MeResponse;
    setMe(data);
    setProfileFullName(data.fullName);
    if (Array.isArray(data.availableObjects)) {
      setAvailableObjects(data.availableObjects);
    }
    if (data.activeWarehouseId) {
      setActiveObjectId(data.activeWarehouseId);
    }
    if (data.activeSection) {
      setObjectSectionFilter(data.activeSection);
    }
    setMustPickObject(Boolean(data.requireObjectSelection));
  }

  async function updateAuthContext(next: { warehouseId: string; section: "SS" | "EOM" }) {
    if (!token) return false;
    const res = await fetchWithSession(`${API_URL}/api/auth/context`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(next)
    });
    if (!res.ok) return false;
    setActiveObjectId(next.warehouseId);
    setObjectSectionFilter(next.section);
    setMustPickObject(false);
    return true;
  }

  function setSection(next: "SS" | "EOM") {
    setObjectSectionFilter(next);
    if (!activeObjectId || !token) return;
    void updateAuthContext({ warehouseId: activeObjectId, section: next });
  }

  async function uploadProfileAvatar(file: File) {
    if (!token) return;
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetchWithSession(`${API_URL}/api/auth/me/avatar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: fd
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(typeof body.error === "string" ? body.error : "Не удалось загрузить аватар");
    }
    const data = (await res.json()) as MeResponse;
    setMe(data);
    setProfileFullName(data.fullName);
  }

  async function updateProfile(next: { fullName?: string; avatarUrl?: string | null }) {
    if (!token) return;
    const res = await fetchWithSession(`${API_URL}/api/auth/me/profile`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(next)
    });
    if (!res.ok) {
      throw new Error("Не удалось обновить профиль");
    }
    const data = (await res.json()) as MeResponse;
    setMe(data);
    setProfileFullName(data.fullName);
  }

  async function loadDashboardSummary() {
    if (!token || !canDashboard) {
      return;
    }
    setDashboardError("");
    try {
      const query = dashboardWarehouseId ? `?warehouseId=${encodeURIComponent(dashboardWarehouseId)}` : "";
      const r = await fetchWithSession(`${API_URL}/api/dashboard/summary${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      setDashboard((await r.json()) as DashboardSummary);
    } catch (e) {
      setDashboard(null);
      setDashboardError(String(e));
    }
  }

  async function loadAuditLogs() {
    if (!token || !canReadAudit) {
      return;
    }
    setAuditMessage("");
    const parts: string[] = ["take=300"];
    if (auditFilterUserId) parts.push(`userId=${encodeURIComponent(auditFilterUserId)}`);
    if (auditFilterEntityType) parts.push(`entityType=${encodeURIComponent(auditFilterEntityType)}`);
    if (auditFilterEntityId.trim()) parts.push(`entityId=${encodeURIComponent(auditFilterEntityId.trim())}`);
    if (auditFilterQuery.trim()) parts.push(`q=${encodeURIComponent(auditFilterQuery.trim())}`);
    if (auditFilterFrom) parts.push(`dateFrom=${encodeURIComponent(new Date(auditFilterFrom).toISOString())}`);
    if (auditFilterTo) parts.push(`dateTo=${encodeURIComponent(new Date(auditFilterTo).toISOString())}`);
    if (auditShowReverted) parts.push("showReverted=1");
    const r = await fetchWithSession(`${API_URL}/api/audit?${parts.join("&")}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (r.ok) {
      setAuditLogs((await r.json()) as AuditLogRow[]);
    } else {
      setAuditMessage(`Не удалось загрузить логи: HTTP ${r.status}`);
    }
  }

  async function loadAuditMeta() {
    if (!token || !canReadAudit) return;
    const r = await fetchWithSession(`${API_URL}/api/audit/meta`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (r.ok) {
      setAuditMeta((await r.json()) as AuditMetaResponse);
    }
  }

  async function revertAuditLog(id: string) {
    if (!token) return;
    if (!window.confirm("Отменить это действие? Изменения будут откачены.")) return;
    setAuditReverting((prev) => ({ ...prev, [id]: true }));
    try {
      const r = await fetchWithSession(`${API_URL}/api/audit/${id}/revert`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) {
        let detail = "";
        try {
          const body = await r.json();
          detail = typeof body?.error === "string" ? body.error : "";
        } catch {
          // ignore
        }
        setAuditMessage(detail || `Не удалось отменить действие (HTTP ${r.status})`);
        return;
      }
      setAuditMessage("Действие отменено");
      await loadAuditLogs();
    } finally {
      setAuditReverting((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  async function loadIntegrationJobs() {
    if (!token) return;
    const r = await fetchWithSession(`${API_URL}/api/integrations/jobs`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) {
      setIntegrationMessage(`Не удалось загрузить интеграции: HTTP ${r.status}`);
      return;
    }
    setIntegrationJobs((await r.json()) as IntegrationJobRow[]);
  }

  async function createIntegrationJob() {
    if (!token) return;
    let payloadObj: Record<string, unknown> | undefined;
    try {
      payloadObj = integrationPayload.trim() ? (JSON.parse(integrationPayload) as Record<string, unknown>) : undefined;
    } catch {
      setIntegrationMessage("Payload должен быть валидным JSON");
      return;
    }
    const r = await fetchWithSession(`${API_URL}/api/integrations/jobs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ kind: integrationKind.trim(), payload: payloadObj })
    });
    if (!r.ok) {
      setIntegrationMessage(`Не удалось создать задачу: HTTP ${r.status}`);
      return;
    }
    setIntegrationMessage("Задача интеграции создана");
    await loadIntegrationJobs();
  }

  async function runIntegrationJob(id: string) {
    if (!token) return;
    const r = await fetchWithSession(`${API_URL}/api/integrations/jobs/${encodeURIComponent(id)}/run`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) {
      setIntegrationMessage(`Не удалось запустить задачу: HTTP ${r.status}`);
      return;
    }
    setIntegrationMessage("Задача выполнена");
    await loadIntegrationJobs();
    await loadNotifications();
  }

  async function loadNotifications() {
    if (!token) return;
    const r = await fetchWithSession(`${API_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setNotifications((await r.json()) as NotificationRow[]);
  }

  async function markNotificationsRead(ids: string[]) {
    if (!token || !ids.length) return;
    await fetchWithSession(`${API_URL}/api/notifications/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
    await loadNotifications();
  }

  function openNotificationLinkedEntity(notification: NotificationRow) {
    if (!notification.entityType || !notification.entityId) return;
    const entityType = notification.entityType.toLowerCase();
    if (entityType === "issuerequest" || entityType === "issue") {
      setIssueStatusFilter("");
      setSelectedIssueId(notification.entityId);
      setDrawerMode("issue");
      setActiveTab("issues");
      return;
    }
    if (entityType === "transportwaybill" || entityType === "waybill") {
      setWaybillStatusFilter("");
      setSelectedWaybillId(notification.entityId);
      setDrawerMode("waybill");
      setActiveTab("waybills");
      return;
    }
    if (entityType === "receiptrequest") {
      setActiveTab("approvals");
      return;
    }
    if (entityType === "integrationjob") {
      setActiveTab("integrations");
      return;
    }
    if (entityType === "toolevent" || entityType === "tool") {
      setActiveTab("tools");
      return;
    }
    if (entityType === "feedbackticket") {
      setFeedbackSelectedId(notification.entityId);
      setFeedbackComposerMode("thread");
      setActiveTab("feedback");
      return;
    }
    if (entityType === "transferrequest") {
      setActiveTab("waybills");
      return;
    }
    setActiveTab("integrations");
  }

  async function loadReadiness() {
    if (!token) return;
    const r = await fetchWithSession(`${API_URL}/api/contracts/readiness`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) {
      setIntegrationMessage(`Не удалось получить readiness: HTTP ${r.status}`);
      return;
    }
    setReadiness((await r.json()) as ReadinessResponse);
  }

  async function loadChatUsers() {
    if (!token) return;
    const res = await fetchWithSession(`${API_URL}/api/chat/users`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    setChatUsers((await res.json()) as ChatUser[]);
  }

  async function loadConversations() {
    if (!token) return;
    const res = await fetchWithSession(`${API_URL}/api/chat/conversations`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const rows = (await res.json()) as Conversation[];
    setChatConversations(rows);
    if (rows.length && !selectedConversationId) setSelectedConversationId(rows[0].id);
  }

  async function startDmConversation(userId: string): Promise<string | undefined> {
    if (!token) return;
    setChatError("");
    const res = await fetchWithSession(`${API_URL}/api/chat/conversations/dm`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    });
    if (!res.ok) {
      setChatError("Не удалось создать диалог");
      return;
    }
    const row = (await res.json()) as { id: string };
    setSelectedConversationId(row.id);
    await loadConversationMessages(row.id);
    await loadConversations();
    return row.id;
  }

  async function loadConversationMessages(
    conversationId: string,
    opts?: { silent?: boolean; touchViewedAt?: boolean }
  ) {
    if (!token || !conversationId) return;
    const silent = Boolean(opts?.silent);
    /** При фоновом poll не поднимать «просмотрено» — не дёргаем счётчики и списки впустую. */
    const touchViewedAt = opts?.touchViewedAt ?? !silent;
    setChatError("");
    if (!silent) {
      setChatLoading(true);
    }
    const res = await fetchWithSession(`${API_URL}/api/chat/conversations/${conversationId}/messages`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setChatError("Не удалось загрузить сообщения");
      if (!silent) {
        setChatLoading(false);
      }
      return;
    }
    const next = (await res.json()) as ChatMessage[];
    setChatMessages((prev) =>
      silent &&
      prev.length === next.length &&
      prev.every((m, i) => {
        const o = next[i];
        return o && m.id === o.id && m.text === o.text && m.createdAt === o.createdAt;
      })
        ? prev
        : next
    );
    if (touchViewedAt) {
      setChatViewedAt((prev) => ({ ...prev, [conversationId]: new Date().toISOString() }));
    }
    if (!silent) {
      setChatLoading(false);
    }
  }

  async function sendConversationMessage() {
    if (!token || !selectedConversationId || !chatText.trim()) return;
    setChatError("");
    const attachments = chatAttachment
      ? [{ fileName: chatAttachment.name, mimeType: chatAttachment.type, dataUrl: await fileToDataUrl(chatAttachment) }]
      : [];
    const res = await fetchWithSession(`${API_URL}/api/chat/conversations/${selectedConversationId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: chatText.trim(), attachments })
    });
    if (!res.ok) {
      setChatError("Не удалось отправить сообщение");
      return;
    }
    setChatText("");
    setChatAttachment(null);
    await loadConversationMessages(selectedConversationId, { silent: true, touchViewedAt: true });
    await loadConversations();
  }

  async function loadFeedbackTickets() {
    if (!token) return;
    setFeedbackListLoading(true);
    setFeedbackError("");
    const res = await fetchWithSession(`${API_URL}/api/feedback/tickets`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      setFeedbackError("Не удалось загрузить обращения");
      setFeedbackListLoading(false);
      return;
    }
    setFeedbackTickets((await res.json()) as FeedbackTicketListItem[]);
    setFeedbackListLoading(false);
  }

  async function loadFeedbackTicketDetail(ticketId: string) {
    if (!token || !ticketId) return;
    setFeedbackDetailLoading(true);
    setFeedbackError("");
    const res = await fetchWithSession(`${API_URL}/api/feedback/tickets/${ticketId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setFeedbackError("Не удалось загрузить тред обращения");
      setFeedbackDetailLoading(false);
      return;
    }
    const d = (await res.json()) as FeedbackTicketDetailView;
    setFeedbackTicketDetail({
      id: d.id,
      number: d.number,
      subject: d.subject,
      status: d.status,
      authorId: d.authorId,
      authorName: d.authorName,
      messages: d.messages ?? []
    });
    setFeedbackDetailLoading(false);
  }

  async function submitNewFeedbackTicket() {
    if (!token || !feedbackText.trim()) return;
    setFeedbackError("");
    const attachments = feedbackAttachment
      ? [
          {
            fileName: feedbackAttachment.name,
            mimeType: feedbackAttachment.type || undefined,
            dataUrl: await fileToDataUrl(feedbackAttachment)
          }
        ]
      : [];
    const res = await fetchWithSession(`${API_URL}/api/feedback/tickets`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subject: feedbackNewSubject.trim(), text: feedbackText.trim(), attachments })
    });
    const body = (await res.json()) as { id?: string; error?: string };
    if (!res.ok) {
      setFeedbackError(typeof body.error === "string" ? body.error : "Не удалось создать обращение");
      return;
    }
    setFeedbackComposerMode("thread");
    setFeedbackNewSubject("");
    setFeedbackText("");
    setFeedbackAttachment(null);
    await loadFeedbackTickets();
    if (body.id) {
      setFeedbackSelectedId(body.id);
      await loadFeedbackTicketDetail(body.id);
    }
  }

  async function sendFeedbackTicketReply() {
    if (!token || !feedbackSelectedId || !feedbackText.trim()) return;
    setFeedbackError("");
    const attachments = feedbackAttachment
      ? [
          {
            fileName: feedbackAttachment.name,
            mimeType: feedbackAttachment.type || undefined,
            dataUrl: await fileToDataUrl(feedbackAttachment)
          }
        ]
      : [];
    const res = await fetchWithSession(`${API_URL}/api/feedback/tickets/${feedbackSelectedId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: feedbackText.trim(), attachments })
    });
    if (!res.ok) {
      setFeedbackError("Не удалось отправить сообщение");
      return;
    }
    setFeedbackText("");
    setFeedbackAttachment(null);
    await Promise.all([loadFeedbackTickets(), loadFeedbackTicketDetail(feedbackSelectedId)]);
  }

  async function updateFeedbackTicketStatus(ticketId: string, status: string) {
    if (!token) return;
    setFeedbackError("");
    const res = await fetchWithSession(`${API_URL}/api/feedback/tickets/${ticketId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      setFeedbackError("Не удалось обновить статус");
      return;
    }
    await Promise.all([loadFeedbackTickets(), loadFeedbackTicketDetail(ticketId)]);
  }

  async function loadAnnouncementsBoard() {
    if (!token) return;
    setAnnouncementsLoading(true);
    const res = await fetchWithSession(`${API_URL}/api/announcements`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setAnnouncements((await res.json()) as AnnouncementBoardRow[]);
    setAnnouncementsLoading(false);
  }

  async function publishAnnouncementDraft() {
    if (!token || !announcementTitleDraft.trim() || !announcementBodyDraft.trim()) return;
    const res = await fetchWithSession(`${API_URL}/api/announcements`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: announcementTitleDraft.trim(), body: announcementBodyDraft.trim(), isPinned: false })
    });
    if (!res.ok) return;
    setAnnouncementTitleDraft("");
    setAnnouncementBodyDraft("");
    setAnnouncementComposeOpen(false);
    await loadAnnouncementsBoard();
  }

  async function loadTransferRequestsList() {
    if (!token) return;
    const res = await fetchWithSession(`${API_URL}/api/transfer-requests`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) setTransferRequests((await res.json()) as TransferRequestApiRow[]);
  }

  async function loadPeerWarehouseSummaries() {
    if (!token || !activeObjectId) {
      setPeerSummaries([]);
      return;
    }
    const sec = objectSectionFilter === "EOM" ? "EOM" : "SS";
    const res = await fetchWithSession(
      `${API_URL}/api/stocks/peer-summaries?excludeWarehouseId=${encodeURIComponent(activeObjectId)}&section=${sec}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.ok) setPeerSummaries(await res.json());
  }

  async function submitWarehouseTransferRequest() {
    if (!token || transferReqSaving) return;
    if (transferReqFromWarehouseId === transferReqToWarehouseId) {
      return;
    }
    if (!transferReqMaterialId || transferReqQty <= 0) return;
    setTransferReqSaving(true);
    try {
      const section = objectSectionFilter === "EOM" ? "EOM" : "SS";
      const res = await fetchWithSession(`${API_URL}/api/transfer-requests`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          fromWarehouseId: transferReqFromWarehouseId,
          toWarehouseId: transferReqToWarehouseId,
          section,
          lines: [{ materialId: transferReqMaterialId, quantity: transferReqQty }],
          note: transferReqNote.trim() || undefined
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setWaybillsMessage(typeof err.error === "string" ? err.error : `Ошибка создания заявки (${res.status})`);
        setWaybillsTone("error");
        return;
      }
      setWaybillsMessage("Заявка на перемещение создана");
      setWaybillsTone("success");
      await Promise.all([loadTransferRequestsList(), loadPeerWarehouseSummaries()]);
    } finally {
      setTransferReqSaving(false);
    }
  }

  async function patchWarehouseTransferStatus(transferId: string, status: string) {
    if (!token) return;
    const res = await fetchWithSession(`${API_URL}/api/transfer-requests/${transferId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    if (!res.ok) return;
    await loadTransferRequestsList();
  }

  async function syncObjectUsers(objectId: string, userIds: string[]) {
    if (!token) return false;
    const res = await fetchWithSession(`${API_URL}/api/admin/objects/${objectId}/users`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userIds })
    });
    if (!res.ok) return false;
    await loadAdminData();
    return true;
  }

  async function syncObjectSectionUsers(objectId: string, section: "SS" | "EOM", userIds: string[]) {
    if (!token) return false;
    const res = await fetchWithSession(`${API_URL}/api/admin/objects/${objectId}/sections/${section}/users`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userIds })
    });
    if (!res.ok) return false;
    await loadAdminData();
    return true;
  }

  async function loadAdminData(): Promise<AdminUser[] | undefined> {
    if (!token || !canManageUsers) {
      return undefined;
    }
    const [usersRes, rolesRes, positionsRes, objectsRes] = await Promise.all([
      fetchWithSession(`${API_URL}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
      fetchWithSession(`${API_URL}/api/admin/roles`, { headers: { Authorization: `Bearer ${token}` } }),
      fetchWithSession(`${API_URL}/api/admin/positions`, { headers: { Authorization: `Bearer ${token}` } }),
      fetchWithSession(`${API_URL}/api/admin/objects`, { headers: { Authorization: `Bearer ${token}` } })
    ]);
    if (!usersRes.ok || !rolesRes.ok || !positionsRes.ok || !objectsRes.ok) {
      throw new Error("Не удалось загрузить админ-данные");
    }
    const usersData = (await usersRes.json()) as AdminUser[];
    const rolesData = (await rolesRes.json()) as AdminRole[];
    const positionsData = (await positionsRes.json()) as Position[];
    const objectsData = (await objectsRes.json()) as AdminObject[];
    setUsers(usersData);
    setRoles(rolesData);
    setPositions(positionsData);
    setAdminObjects(objectsData);
    if (usersData.length && !selectedUserId) {
      setSelectedUserId(usersData[0].id);
      setSelectedRoleName(usersData[0].role);
      setSelectedStatus(usersData[0].status);
      setSelectedPermissions(usersData[0].customPermissions || usersData[0].permissions || []);
      const pos = positionsData.find((p) => p.name === usersData[0].position);
      setSelectedPositionId(pos?.id || "");
    }
    return usersData;
  }

  async function loadCatalogData() {
    if (!token) {
      return;
    }
    const [wRes, mRes] = await Promise.all([
      fetchWithSession(`${API_URL}/api/warehouses`, { headers: { Authorization: `Bearer ${token}` } }),
      fetchWithSession(`${API_URL}/api/materials?expandMerged=1`, { headers: { Authorization: `Bearer ${token}` } })
    ]);
    if (!wRes.ok || !mRes.ok) {
      throw new Error("Не удалось загрузить справочники");
    }
    const warehousesData = (await wRes.json()) as Warehouse[];
    const materialsData = (await mRes.json()) as Material[];
    setWarehouses(warehousesData);
    setMaterials(materialsData);
    if (warehousesData.length && !opWarehouseId) {
      setOpWarehouseId(warehousesData[0].id);
    }
    if (warehousesData.length && !issueWarehouseId) {
      setIssueWarehouseId(warehousesData[0].id);
    }
    if (materialsData.length && !issueMaterialId) {
      setIssueMaterialId(materialsData[0].id);
    }
  }

  async function loadProjects() {
    if (!token) return;
    const res = await fetchWithSession(`${API_URL}/api/projects`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = (await res.json()) as Project[];
    setProjects(data);
  }

  async function loadWarehouseSummarySnapshot() {
    if (!token || !activeObjectId) return;
    setReportsSnapshotLoading(true);
    setReportsMessage("");
    try {
      const res = await fetchWithSession(
        `${API_URL}/api/reports/warehouse/${encodeURIComponent(activeObjectId)}/snapshot`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setWarehouseSnapshot(null);
        setReportsMessage(typeof err.error === "string" ? err.error : "Не удалось загрузить сводку");
        return;
      }
      const data = (await res.json()) as WarehouseSnapshotReport;
      setWarehouseSnapshot(data);
    } finally {
      setReportsSnapshotLoading(false);
    }
  }

  async function loadLimitTemplates() {
    if (!token || !activeObjectId) return;
    setLimitTemplatesLoading(true);
    const params = new URLSearchParams({
      warehouseId: activeObjectId,
      section: objectSectionFilter
    });
    try {
      const [templatesRes, issuedRes, supplyRes] = await Promise.all([
        fetchWithSession(`${API_URL}/api/limit-imports?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetchWithSession(`${API_URL}/api/stock-movements/issued-summary?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetchWithSession(`${API_URL}/api/stock-movements/supply-metrics?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);
      if (!templatesRes.ok) {
        throw new Error(`HTTP ${templatesRes.status}`);
      }
      if (!issuedRes.ok) {
        throw new Error(`ISSUED_HTTP ${issuedRes.status}`);
      }
      setLimitTemplates((await templatesRes.json()) as LimitImportTemplate[]);
      const issuedRows = (await issuedRes.json()) as IssuedSummaryRow[];
      setLimitIssuedTotals(Object.fromEntries(issuedRows.map((x) => [x.materialId, Number(x.issuedQty) || 0])));
      const supplyRows: LimitSupplyMetricRow[] = supplyRes.ok ? await supplyRes.json() : [];
      const nextSupply: Record<string, Pick<LimitSupplyMetricRow, "arrivedQty" | "issuedQty" | "onOrderQty" | "stockQty">> =
        {};
      for (const r of supplyRows) {
        nextSupply[r.materialId] = {
          arrivedQty: Number(r.arrivedQty) || 0,
          issuedQty: Number(r.issuedQty) || 0,
          onOrderQty: Number(r.onOrderQty) || 0,
          stockQty: Number(r.stockQty) || 0
        };
      }
      setLimitSupplyByMaterialId(nextSupply);
    } catch (e) {
      setLimitTemplates([]);
      setLimitIssuedTotals({});
      setLimitSupplyByMaterialId({});
      setLimitsMessage(`Не удалось загрузить лимиты: ${String(e)}`);
    } finally {
      setLimitTemplatesLoading(false);
    }
  }

  async function loadMaterialReportData() {
    if (!token || !activeObjectId) return;
    setMaterialBalancesLoading(true);
    setMaterialReportMessage("");
    const params = new URLSearchParams({
      warehouseId: activeObjectId,
      section: objectSectionFilter
    });
    try {
      const [balRes, histRes] = await Promise.all([
        fetchWithSession(`${API_URL}/api/material-report/balances?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetchWithSession(`${API_URL}/api/material-report/writeoffs/history?${params}&take=100`, {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      let balancesPayload: MaterialReportHolderRow[] = [];
      let historyPayload: MaterialWriteoffHistoryApiRow[] = [];
      let errText = "";

      if (!balRes.ok) {
        const err = await balRes.json().catch(() => ({}));
        errText =
          typeof (err as { error?: unknown }).error === "string"
            ? (err as { error: string }).error
            : `Ошибка загрузки остатков (${balRes.status})`;
      } else {
        balancesPayload = (await balRes.json()) as MaterialReportHolderRow[];
      }

      if (!histRes.ok) {
        const err = await histRes.json().catch(() => ({}));
        const histMsg =
          typeof (err as { error?: unknown }).error === "string"
            ? (err as { error: string }).error
            : `Ошибка загрузки истории (${histRes.status})`;
        errText = errText ? `${errText} · ${histMsg}` : histMsg;
      } else {
        historyPayload = (await histRes.json()) as MaterialWriteoffHistoryApiRow[];
      }

      setMaterialBalances(balancesPayload);
      setMaterialWriteoffHistory(historyPayload);
      if (errText) setMaterialReportMessage(errText);
    } catch (e) {
      setMaterialBalances([]);
      setMaterialWriteoffHistory([]);
      setMaterialReportMessage(`Не удалось загрузить материальный отчёт: ${String(e)}`);
    } finally {
      setMaterialBalancesLoading(false);
    }
  }

  async function submitMaterialWriteoff() {
    if (!token || !activeObjectId || !materialWriteoffModal || !canMaterialWriteoff) return;
    const qty = Number(String(materialWriteoffQty).trim().replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) {
      setMaterialReportMessage("Укажите положительное количество списания.");
      return;
    }
    if (qty > materialWriteoffModal.maxQty + 1e-6) {
      setMaterialReportMessage(`Не больше остатка у ответственного: ${materialWriteoffModal.maxQty}`);
      return;
    }
    setMaterialWriteoffBusy(true);
    setMaterialReportMessage("");
    const form = new FormData();
    const payload: Record<string, unknown> = {
      warehouseId: activeObjectId,
      section: objectSectionFilter,
      holderUserId: materialWriteoffModal.holderUserId,
      materialId: materialWriteoffModal.materialId,
      quantity: qty
    };
    const c = materialWriteoffComment.trim();
    if (c) payload.comment = c;
    form.append("payload", JSON.stringify(payload));
    if (materialWriteoffFile) form.append("file", materialWriteoffFile);
    try {
      const res = await fetchWithSession(`${API_URL}/api/material-report/writeoffs`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: unknown; balance?: unknown };
        const apiErr = typeof err.error === "string" ? err.error : "";
        const balance =
          typeof err.balance === "number" && Number.isFinite(err.balance) ? err.balance : null;
        const msg =
          apiErr ||
          (res.status === 409 && balance !== null
            ? `Недостаточно остатка (доступно ${balance})`
            : `Списание не выполнено (${res.status})`);
        setMaterialReportMessage(msg);
        return;
      }
      setMaterialWriteoffModal(null);
      setMaterialWriteoffQty("");
      setMaterialWriteoffComment("");
      setMaterialWriteoffFile(null);
      await loadMaterialReportData();
    } catch (e) {
      setMaterialReportMessage(`Ошибка сети: ${String(e)}`);
    } finally {
      setMaterialWriteoffBusy(false);
    }
  }

  async function uploadLimitTemplate() {
    if (!token || !activeObjectId || !limitImportFile) return;
    if (!canWriteLimits) {
      setLimitsMessage("Недостаточно прав для импорта лимитов");
      return;
    }
    const form = new FormData();
    form.append("file", limitImportFile);
    form.append("warehouseId", activeObjectId);
    form.append("section", objectSectionFilter);
    const res = await fetchWithSession(`${API_URL}/api/limit-imports/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    if (!res.ok) {
      setLimitsMessage("Не удалось загрузить лимиты из Excel");
      return;
    }
    setLimitsMessage("Лимиты загружены из Excel");
    setLimitImportFile(null);
    setExpandedLimitNodes({});
    await loadLimitTemplates();
  }

  async function patchLimitTemplateTitle(templateId: string, title: string): Promise<boolean> {
    if (!token) return false;
    const trimmed = title.trim();
    if (!trimmed) {
      setLimitsMessage("Введите название шаблона лимитов");
      return false;
    }
    const res = await fetchWithSession(`${API_URL}/api/limit-imports/${templateId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed })
    });
    if (!res.ok) {
      setLimitsMessage("Не удалось сохранить название шаблона лимитов");
      return false;
    }
    setLimitsMessage("Шаблон лимитов обновлён");
    setLimitTemplateTitleDrafts((prev) => {
      if (!(templateId in prev)) return prev;
      const next = { ...prev };
      delete next[templateId];
      return next;
    });
    await loadLimitTemplates();
    return true;
  }

  async function deleteLimitTemplate(templateId: string) {
    if (!token) return;
    if (!window.confirm("Удалить этот импорт лимитов целиком (все разделы и материалы)?")) return;
    const res = await fetchWithSession(`${API_URL}/api/limit-imports/${templateId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setLimitsMessage("Не удалось удалить шаблон лимитов");
      return;
    }
    setLimitsMessage("Шаблон лимитов удалён");
    await loadLimitTemplates();
  }

  async function createLimitImportNode(
    templateId: string,
    body: {
      parentId?: string | null;
      nodeType: "GROUP" | "MATERIAL";
      title: string;
      materialName?: string | null;
      unit?: string | null;
      plannedQty?: number | null;
    }
  ) {
    if (!token) return;
    const res = await fetchWithSession(`${API_URL}/api/limit-imports/${templateId}/nodes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      setLimitsMessage("Не удалось добавить строку в дерево лимитов");
      return;
    }
    setLimitsMessage("Строка добавлена");
    await loadLimitTemplates();
  }

  async function patchLimitImportNode(
    nodeId: string,
    body: Record<string, unknown>
  ): Promise<boolean> {
    if (!token) return false;
    const res = await fetchWithSession(`${API_URL}/api/limit-imports/nodes/${nodeId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      setLimitsMessage("Не удалось сохранить изменения в лимите");
      return false;
    }
    setLimitsMessage("Изменения сохранены");
    setLimitNodeDrafts((prev) => {
      if (!prev[nodeId]) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
    await loadLimitTemplates();
    return true;
  }

  async function deleteLimitImportNode(nodeId: string) {
    if (!token) return;
    if (!window.confirm("Удалить эту строку? Дочерние элементы тоже будут удалены.")) return;
    const res = await fetchWithSession(`${API_URL}/api/limit-imports/nodes/${nodeId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setLimitsMessage("Не удалось удалить строку лимита");
      return;
    }
    setLimitsMessage("Строка удалена");
    setLimitNodeDrafts((prev) => {
      if (!prev[nodeId]) return prev;
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
    await loadLimitTemplates();
  }

  async function loadReceiptRequests() {
    if (!token || !activeObjectId) return;
    const params = new URLSearchParams({
      warehouseId: activeObjectId,
      section: objectSectionFilter
    });
    const res = await fetchWithSession(`${API_URL}/api/receipt-requests?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    setReceiptRequests((await res.json()) as ReceiptRequestRow[]);
  }

  async function loadMaterialMappings() {
    if (!token || !activeObjectId) return;
    const params = new URLSearchParams({
      warehouseId: activeObjectId,
      section: objectSectionFilter
    });
    const res = await fetchWithSession(`${API_URL}/api/material-mappings?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    setMaterialMappings((await res.json()) as MaterialMappingRow[]);
  }

  async function uploadReceiptRequest() {
    if (!token || !activeObjectId || !receiptRequestFile) return;
    const form = new FormData();
    form.append("file", receiptRequestFile);
    form.append("warehouseId", activeObjectId);
    form.append("section", objectSectionFilter);
    const res = await fetchWithSession(`${API_URL}/api/receipt-requests/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    if (!res.ok) {
      let serverMsg = "";
      try {
        const body = await res.json();
        serverMsg = typeof body?.error === "string" ? body.error : "";
      } catch {
        // ignore
      }
      setOpsMessage(serverMsg || "Не удалось загрузить заявку из Excel");
      return;
    }
    const created = (await res.json()) as ReceiptRequestRow;
    setOpsMessage(`Заявка ${created.number} загружена (${created.items?.length || 0} поз.)`);
    setReceiptRequestFile(null);
    setLimitPromptTemplateId("");
    setLimitPromptRequest(created);
    setExpandedReceiptIds((prev) => ({ ...prev, [created.id]: true }));
    await loadReceiptRequests();
  }

  async function attachReceiptRequestToLimit(requestId: string, templateId: string | null): Promise<boolean> {
    if (!token) return false;
    const res = await fetchWithSession(`${API_URL}/api/receipt-requests/${requestId}/limit`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fromLimit: Boolean(templateId), objectLimitTemplateId: templateId })
    });
    if (!res.ok) {
      let serverMsg = "";
      try {
        const body = await res.json();
        serverMsg = typeof body?.error === "string" ? body.error : "";
      } catch {
        // ignore
      }
      setOpsMessage(serverMsg || "Не удалось привязать заявку к лимиту");
      return false;
    }
    setOpsMessage(templateId ? "Заявка привязана к лимиту" : "Заявка отвязана от лимита");
    setLimitSuggestions((prev) => {
      const next = { ...prev };
      delete next[requestId];
      return next;
    });
    await loadReceiptRequests();
    return true;
  }

  async function loadLimitSuggestions(receiptRequestId: string) {
    if (!token) return;
    try {
      const r = await fetchWithSession(
        `${API_URL}/api/receipt-requests/${encodeURIComponent(receiptRequestId)}/limit-suggestions`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!r.ok) return;
      const data = (await r.json()) as LimitSuggestionsPayload;
      setLimitSuggestions((prev) => ({ ...prev, [receiptRequestId]: data }));
      // Авто-предзаполнение: если по позиции ровно один подходящий узел и пользователь
      // не выбрал свой — сразу проставляем его как выбор по умолчанию.
      setAcceptanceDrafts((prev) => {
        const itemDrafts = { ...(prev[receiptRequestId] || {}) };
        let changed = false;
        for (const itemInfo of data.items) {
          if (itemInfo.suggestions.length === 1 && !itemDrafts[itemInfo.itemId]?.limitNodeId) {
            const cur = itemDrafts[itemInfo.itemId] || { newName: "", newUnit: "", qty: "" };
            itemDrafts[itemInfo.itemId] = { ...cur, limitNodeId: itemInfo.suggestions[0].id };
            changed = true;
          } else if (itemInfo.currentLimitNodeId && !itemDrafts[itemInfo.itemId]?.limitNodeId) {
            const cur = itemDrafts[itemInfo.itemId] || { newName: "", newUnit: "", qty: "" };
            itemDrafts[itemInfo.itemId] = { ...cur, limitNodeId: itemInfo.currentLimitNodeId };
            changed = true;
          }
        }
        return changed ? { ...prev, [receiptRequestId]: itemDrafts } : prev;
      });
    } catch {
      // ignore network errors — подсказки опциональны
    }
  }

  async function submitReceiptAcceptance(row: ReceiptRequestRow, extraFiles: File[] = []): Promise<boolean> {
    if (!token) return false;
    const drafts = acceptanceDrafts[row.id] || {};
    const mappings: Array<{
      itemId: string;
      materialId?: string;
      newMaterialName?: string;
      newMaterialUnit?: string;
      acceptedQty: number;
      limitNodeId?: string | null;
    }> = [];
    for (const it of row.items) {
      const draft = drafts[it.id];
      const qtyRaw = (draft?.qty ?? "").toString().replace(",", ".").trim();
      if (!qtyRaw) continue;
      const qty = Number(qtyRaw);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const remaining = Number(it.quantity) - Number(it.acceptedQty || 0);
      if (qty - remaining > 1e-6) {
        setOpsMessage(`По «${it.sourceName}» осталось принять ${remaining}, передали ${qty}`);
        return false;
      }
      const explicitName = (draft?.newName ?? "").trim();
      const explicitUnit = (draft?.newUnit ?? "").trim();
      const finalName = explicitName || it.sourceName;
      mappings.push({
        itemId: it.id,
        newMaterialName: finalName,
        newMaterialUnit: explicitUnit || it.sourceUnit || "шт",
        acceptedQty: qty,
        limitNodeId: draft?.limitNodeId || null
      });
    }
    if (!mappings.length) {
      setOpsMessage("Поставьте галочки на тех позициях, которые сейчас принимаются");
      return false;
    }
    const form = new FormData();
    form.append(
      "payload",
      JSON.stringify({
        itemMappings: mappings,
        documentNumber: acceptanceDocNumbers[row.id] || undefined
      })
    );
    const filesToSend: File[] = [];
    const legacyScan = acceptanceScans[row.id];
    if (legacyScan) filesToSend.push(legacyScan);
    for (const f of extraFiles) filesToSend.push(f);
    for (const f of filesToSend) form.append("scan", f);
    setAcceptanceSubmitting((prev) => ({ ...prev, [row.id]: true }));
    try {
      const res = await fetchWithSession(`${API_URL}/api/receipt-requests/${row.id}/accept`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      if (!res.ok) {
        let serverMsg = "";
        try {
          const body = await res.json();
          serverMsg = typeof body?.error === "string" ? body.error : "";
        } catch {
          // ignore
        }
        setOpsMessage(serverMsg || "Не удалось провести приёмку");
        return false;
      }
      setOpsMessage(
        `Приёмка по заявке ${row.number} проведена${filesToSend.length ? ` · приложено документов: ${filesToSend.length}` : ""}`
      );
      setAcceptanceDrafts((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setAcceptanceScans((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setAcceptanceDocNumbers((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setLimitSuggestions((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      await loadReceiptRequests();
      await loadMaterialMappings();
      await loadStocks(q);
      await loadOperations();
      return true;
    } finally {
      setAcceptanceSubmitting((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
    }
  }

  async function loadIssues() {
    if (!token) return;
    setIssuesError("");
    setIssuesLoading(true);
    try {
      const params = new URLSearchParams();
      if (issueStatusFilter) params.set("status", issueStatusFilter);
      if (issueBasisFilter) params.set("basisType", issueBasisFilter);
      if (activeTab === "issues" && issueFlowFilter) params.set("flowType", issueFlowFilter);
      params.set("section", objectSectionFilter);
      if (activeTab === "issues") {
        params.set("domain", issueIssuesDomain);
      }
      if (issueSearch.trim()) params.set("q", issueSearch.trim());
      params.set("sort", issuesSort);
      params.set("page", String(issuesPage));
      params.set("pageSize", String(issuesPageSize));
      const qs = params.toString();
      const query = qs ? `?${qs}` : "";
      const res = await fetchWithSession(`${API_URL}/api/issues${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as PagedResponse<IssueRequest> | IssueRequest[];
      const items = Array.isArray(payload) ? payload : payload.items;
      setIssues(items);
      setIssuesTotal(Array.isArray(payload) ? items.length : payload.total);
      if (items.length && !selectedIssueId) {
        setSelectedIssueId(items[0].id);
      }
    } catch (e) {
      setIssuesError(`Не удалось загрузить заявки: ${String(e)}`);
    } finally {
      setIssuesLoading(false);
    }
  }

  async function executeIssueAction(
    issueId: string,
    action: "send-for-approval" | "approve" | "reject" | "cancel" | "issue",
    opts?: {
      fromApprovals?: boolean;
      closeDrawer?: boolean;
      actualRecipientName?: string;
      signedFile?: File | null;
    }
  ): Promise<boolean> {
    if (!token) return false;
    const actionText = issueActionLabel(action).toLowerCase();
    let actualRecipientName = opts?.actualRecipientName?.trim();
    if (action === "issue" && !actualRecipientName) {
      const issue = issues.find((x) => x.id === issueId) || approvalQueue.find((x) => x.id === issueId) || selectedIssue;
      const fallback = issue?.actualRecipientName || issue?.responsibleName || "";
      const dom = issue ? effectiveIssueDomain(issue) : "MATERIALS";
      const modalDom: "TOOLS" | "WORKWEAR" | "OTHER" =
        dom === "TOOLS" ? "TOOLS" : dom === "WORKWEAR" ? "WORKWEAR" : "OTHER";
      setIssueRecipientDraft(fallback.trim());
      setIssueRecipientSignedFile(null);
      setIssueRecipientModal({
        issueId,
        opts,
        fallback: fallback.trim(),
        domain: modalDom
      });
      return false;
    }
    const skipIssueConfirm = action === "issue" && Boolean(actualRecipientName);
    if (!skipIssueConfirm) {
      const ok = window.confirm(`Подтвердить действие: ${actionText}?`);
      if (!ok) return false;
    }
    const signed = opts?.signedFile ?? undefined;
    const useMultipart = Boolean(action === "issue" && signed);
    const res = await fetchWithSession(`${API_URL}/api/issues/${issueId}/${action}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(action === "issue" && !useMultipart ? { "Content-Type": "application/json" } : {})
      },
      ...(action === "issue"
        ? useMultipart
          ? (() => {
              const fd = new FormData();
              fd.append("payload", JSON.stringify({ actualRecipientName }));
              fd.append("signedFile", signed!);
              return { body: fd };
            })()
          : { body: JSON.stringify({ actualRecipientName }) }
        : {})
    });
    if (!res.ok) {
      setIssuesMessage(`Не удалось выполнить действие: ${issueActionLabel(action)}`);
      setIssuesTone(res.status === 409 ? "conflict" : "error");
      return false;
    }
    if (opts?.closeDrawer) setDrawerMode("");
    setIssuesMessage(`Готово: ${issueActionLabel(action)}`);
    setIssuesTone("success");
    await loadIssues();
    if (opts?.fromApprovals) {
      await loadApprovalQueue();
    }
    if (action === "issue") {
      await loadStocks(q);
      void loadTools().catch(() => undefined);
      setIssueRecipientSignedFile(null);
    }
    return true;
  }

  function openUploadedDocument(filePath?: string | null, fileName?: string | null) {
    if (!filePath) return;
    const url = `${API_URL}/${filePath.replace(/^\/+/, "")}`;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    if (fileName) a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function performDirectIssue(opts?: { openDocument?: boolean }) {
    if (!token) return;
    if (issueSubmitting) return;
    if (!activeObjectId) {
      setIssuesMessage("Выберите объект в верхнем меню");
      setIssuesTone("error");
      return;
    }
    const responsibleName = issueResponsible.trim();
    const actualRecipientName = (issueActualRecipient.trim() || responsibleName).trim();
    if (!responsibleName) {
      setIssuesMessage("Укажите ответственное лицо");
      setIssuesTone("error");
      return;
    }
    if (!actualRecipientName) {
      setIssuesMessage("Укажите фактического получателя");
      setIssuesTone("error");
      return;
    }
    const lines = issuePickCart
      .map((row) => ({
        materialId: row.materialId,
        quantity: Number(issuePickQtyByKey[row.pickKey] ?? 1),
        factLabel: row.factLabel?.trim() ? row.factLabel.trim() : undefined
      }))
      .filter((line) => line.materialId && line.quantity > 0);
    if (!lines.length) {
      setIssuesMessage("Добавьте хотя бы один материал в список выдачи");
      setIssuesTone("error");
      return;
    }
    const qtySumByMaterial = new Map<string, number>();
    for (const line of lines) {
      qtySumByMaterial.set(line.materialId, (qtySumByMaterial.get(line.materialId) || 0) + line.quantity);
    }
    for (const [materialId, sumQty] of qtySumByMaterial) {
      const stockRow = stocks.find((s) => s.materialId === materialId && s.warehouseId === activeObjectId);
      if (!stockRow) continue;
      if (sumQty > stockRow.available) {
        const label =
          issuePickCart.find((c) => c.materialId === materialId && c.factLabel)?.factLabel || stockRow.materialName;
        setIssuesMessage(`Недостаточно остатка по «${label}» (итого по номенклатуре превышает доступно)`);
        setIssuesTone("error");
        return;
      }
    }
    setIssueSubmitting(true);
    setIssuesMessage("");
    try {
      const createRes = await fetchWithSession(`${API_URL}/api/issues`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId: activeObjectId,
          section: objectSectionFilter,
          note: issueNote.trim() || undefined,
          responsibleName,
          flowType: "DIRECT_ISSUE",
          basisType: "OTHER",
          domain: issueIssuesDomain === "TOOLS" ? undefined : issueIssuesDomain,
          items: lines
        })
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        setIssuesMessage(typeof err.error === "string" ? err.error : "Не удалось создать выдачу");
        setIssuesTone(createRes.status === 409 ? "conflict" : "error");
        return;
      }
      const created = (await createRes.json()) as { id: string; number: string };
      let issueRes: Response;
      if (directIssueSignedFile) {
        const fd = new FormData();
        fd.append("payload", JSON.stringify({ actualRecipientName }));
        fd.append("signedFile", directIssueSignedFile);
        issueRes = await fetchWithSession(`${API_URL}/api/issues/${created.id}/issue`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });
      } else {
        issueRes = await fetchWithSession(`${API_URL}/api/issues/${created.id}/issue`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ actualRecipientName })
        });
      }
      if (!issueRes.ok) {
        const err = await issueRes.json().catch(() => ({}));
        setIssuesMessage(
          typeof err.error === "string"
            ? `Выдача создана ${created.number}, но не проведена: ${err.error}`
            : `Выдача ${created.number} не проведена`
        );
        setIssuesTone("conflict");
        await loadIssues();
        return;
      }
      const issuePayload = (await issueRes.json()) as {
        document?: { id?: string; fileName?: string; filePath?: string } | null;
      };
      if (opts?.openDocument && issuePayload.document?.filePath) {
        openUploadedDocument(issuePayload.document.filePath, issuePayload.document.fileName);
      }
      setIssuesMessage(`Выдача ${created.number} проведена. Акт сформирован автоматически.`);
      setIssuesTone("success");
      setIssuePickCart([]);
      setIssuePickQtyByKey({});
      setIssueMaterialSearch("");
      setIssueNote("");
      setDirectIssueSignedFile(null);
      await loadIssues();
      await loadStocks(q);
      await loadStockMovements();
    } catch (e) {
      setIssuesMessage(`Ошибка выдачи: ${String(e)}`);
      setIssuesTone("error");
    } finally {
      setIssueSubmitting(false);
    }
  }

  async function performDirectToolIssue(opts?: { openDocument?: boolean }) {
    if (!token) return;
    if (issueSubmitting) return;
    if (!activeObjectId) {
      setIssuesMessage("Выберите объект в верхнем меню");
      setIssuesTone("error");
      return;
    }
    const responsibleName = issueResponsible.trim();
    const actualRecipientName = (issueActualRecipient.trim() || responsibleName).trim();
    if (!responsibleName) {
      setIssuesMessage("Укажите ответственное лицо");
      setIssuesTone("error");
      return;
    }
    if (!actualRecipientName) {
      setIssuesMessage("Укажите фактического получателя");
      setIssuesTone("error");
      return;
    }
    if (!issueToolPickIds.length) {
      setIssuesMessage("Выберите хотя бы один инструмент в списке");
      setIssuesTone("error");
      return;
    }
    setIssueSubmitting(true);
    setIssuesMessage("");
    try {
      const createRes = await fetchWithSession(`${API_URL}/api/issues`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId: activeObjectId,
          section: objectSectionFilter,
          note: issueNote.trim() || undefined,
          responsibleName,
          flowType: "DIRECT_ISSUE",
          basisType: "OTHER",
          toolItems: issueToolPickIds.map((toolId) => ({ toolId }))
        })
      });
      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({}));
        const det = typeof (err as { details?: unknown }).details === "object" ? JSON.stringify((err as { details?: unknown }).details) : "";
        setIssuesMessage(
          typeof (err as { error?: string }).error === "string"
            ? `${(err as { error: string }).error}${det ? ` ${det}` : ""}`
            : "Не удалось создать заявку на инструмент"
        );
        setIssuesTone(createRes.status === 409 ? "conflict" : "error");
        return;
      }
      const created = (await createRes.json()) as { id: string; number: string };
      let issueRes: Response;
      if (directIssueSignedFile) {
        const fd = new FormData();
        fd.append("payload", JSON.stringify({ actualRecipientName }));
        fd.append("signedFile", directIssueSignedFile);
        issueRes = await fetchWithSession(`${API_URL}/api/issues/${created.id}/issue`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}` },
          body: fd
        });
      } else {
        issueRes = await fetchWithSession(`${API_URL}/api/issues/${created.id}/issue`, {
          method: "PATCH",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ actualRecipientName })
        });
      }
      if (!issueRes.ok) {
        const err = await issueRes.json().catch(() => ({}));
        setIssuesMessage(
          typeof err.error === "string"
            ? `Заявка ${created.number} создана, но выдача не проведена: ${err.error}`
            : `Заявка ${created.number}: выдача не проведена`
        );
        setIssuesTone("conflict");
        await loadIssues();
        return;
      }
      const issuePayload = (await issueRes.json()) as {
        document?: { id?: string; fileName?: string; filePath?: string } | null;
      };
      if (opts?.openDocument && issuePayload.document?.filePath) {
        openUploadedDocument(issuePayload.document.filePath, issuePayload.document.fileName);
      }
      setIssuesMessage(`Инструмент по заявке ${created.number} выдан. Акт сформирован автоматически.`);
      setIssuesTone("success");
      setIssueToolPickIds([]);
      setIssueToolSearch("");
      setIssueNote("");
      setDirectIssueSignedFile(null);
      await loadIssues();
      void loadTools().catch(() => undefined);
    } catch (e) {
      setIssuesMessage(`Ошибка выдачи инструмента: ${String(e)}`);
      setIssuesTone("error");
    } finally {
      setIssueSubmitting(false);
    }
  }

  async function executeWaybillStatus(
    waybillId: string,
    status: WaybillStatus,
    comment: string
  ) {
    if (!token) return;
    const ok = window.confirm(`Подтвердить перевод ТН в статус "${waybillStatusLabel(status)}"?`);
    if (!ok) return;
    const res = await fetchWithSession(`${API_URL}/api/waybills/${waybillId}/status`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ status, comment })
    });
    if (!res.ok) {
      setWaybillsMessage(`Не удалось обновить статус: ${waybillStatusLabel(status)}`);
      setWaybillsTone(res.status === 409 ? "conflict" : "error");
      return;
    }
    setWaybillsMessage(`Статус обновлен: ${waybillStatusLabel(status)}`);
    setWaybillsTone("success");
    await loadWaybills();
    if (selectedWaybillId === waybillId) {
      await loadWaybillEvents(waybillId);
    }
  }

  async function loadApprovalQueue() {
    if (!token) return;
    const params = new URLSearchParams();
    params.set("status", "ON_APPROVAL");
    params.set("section", objectSectionFilter);
    params.set("domain", approvalQueueTab);
    const res = await fetchWithSession(`${API_URL}/api/issues?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const payload = (await res.json()) as PagedResponse<IssueRequest> | IssueRequest[];
    setApprovalQueue(Array.isArray(payload) ? payload : payload.items);
  }

  async function loadOperations() {
    if (!token) return;
    const res = await fetchWithSession(`${API_URL}/api/operations?section=${encodeURIComponent(objectSectionFilter)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    setOperations((await res.json()) as OperationRow[]);
  }

  // Прямой приход/возврат через ручную форму удалены —
  // материал теперь принимается только через заявки (см. submitReceiptAcceptance).

  async function loadTools() {
    if (!token) return;
    setToolsError("");
    setToolsLoading(true);
    try {
      const queryParts = [
        toolSearch ? `q=${encodeURIComponent(toolSearch)}` : "",
        toolStatusFilter ? `status=${encodeURIComponent(toolStatusFilter)}` : "",
        `section=${encodeURIComponent(objectSectionFilter)}`,
        toolListWarehouseId ? `warehouseId=${encodeURIComponent(toolListWarehouseId)}` : "",
        toolDrilledCard?.type === "CATEGORY" && toolDrilledCard.categoryId
          ? `categoryId=${encodeURIComponent(toolDrilledCard.categoryId)}`
          : "",
        toolDrilledCard?.type === "NAME"
          ? `nameGroup=${encodeURIComponent(toolDrilledCard.label)}`
          : "",
        `sort=${encodeURIComponent(toolsSort)}`,
        `page=${encodeURIComponent(String(toolsPage))}`,
        `pageSize=${encodeURIComponent(String(toolsPageSize))}`
      ].filter(Boolean);
      const query = queryParts.length ? `?${queryParts.join("&")}` : "";
      const res = await fetchWithSession(`${API_URL}/api/tools${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as PagedResponse<ToolItem> | ToolItem[];
      const items = Array.isArray(payload) ? payload : payload.items;
      setTools(items);
      setToolsTotal(Array.isArray(payload) ? items.length : payload.total);
    } catch (e) {
      setToolsError(`Не удалось загрузить инструменты: ${String(e)}`);
    } finally {
      setToolsLoading(false);
    }
  }

  async function loadToolCategories() {
    if (!token) return;
    try {
      const r = await fetchWithSession(`${API_URL}/api/tools/categories`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) return;
      setToolCategories(((await r.json()) as ToolCategoryRow[]) || []);
    } catch {
      // ignore
    }
  }

  async function loadToolGroupCards() {
    if (!token) return;
    setToolGroupCardsLoading(true);
    try {
      const parts = [
        `section=${encodeURIComponent(objectSectionFilter)}`,
        toolListWarehouseId ? `warehouseId=${encodeURIComponent(toolListWarehouseId)}` : ""
      ].filter(Boolean);
      const query = parts.length ? `?${parts.join("&")}` : "";
      const r = await fetchWithSession(`${API_URL}/api/tools/by-category${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!r.ok) return;
      setToolGroupCards(((await r.json()) as ToolGroupCard[]) || []);
    } catch {
      setToolGroupCards([]);
    } finally {
      setToolGroupCardsLoading(false);
    }
  }

  async function createToolCategory(name: string) {
    if (!token) return false;
    const value = name.trim();
    if (!value) return false;
    const r = await fetchWithSession(`${API_URL}/api/tools/categories`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: value })
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setToolsMessage(typeof body?.error === "string" ? body.error : "Не удалось создать категорию");
      setToolsTone("error");
      return false;
    }
    await loadToolCategories();
    await loadToolGroupCards();
    return true;
  }

  async function updateToolCategory(id: string, patch: { name?: string; icon?: string | null; order?: number }) {
    if (!token) return false;
    const r = await fetchWithSession(`${API_URL}/api/tools/categories/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setToolsMessage(typeof body?.error === "string" ? body.error : "Не удалось обновить категорию");
      setToolsTone("error");
      return false;
    }
    await loadToolCategories();
    await loadToolGroupCards();
    return true;
  }

  async function deleteToolCategory(id: string) {
    if (!token) return false;
    const r = await fetchWithSession(`${API_URL}/api/tools/categories/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      setToolsMessage(typeof body?.error === "string" ? body.error : "Не удалось удалить категорию");
      setToolsTone("error");
      return false;
    }
    await loadToolCategories();
    await loadToolGroupCards();
    return true;
  }

  async function loadToolWarehouseSummary() {
    if (!token) return;
    try {
      const res = await fetchWithSession(`${API_URL}/api/tools/summary/by-warehouse`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setToolWarehouseSummary(((await res.json()) as ToolWarehouseSummaryRow[]) || []);
    } catch {
      setToolWarehouseSummary([]);
    }
  }

  async function loadToolEvents(toolId: string) {
    if (!token || !toolId) return;
    const res = await fetchWithSession(`${API_URL}/api/tools/${toolId}/events`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    setToolEvents((await res.json()) as ToolEvent[]);
  }

  async function loadWaybills() {
    if (!token) return;
    setWaybillsError("");
    setWaybillsLoading(true);
    try {
      const params = new URLSearchParams();
      if (waybillStatusFilter) params.set("status", waybillStatusFilter);
      params.set("sort", waybillsSort);
      params.set("page", String(waybillsPage));
      params.set("pageSize", String(waybillsPageSize));
      const qs = params.toString();
      const query = qs ? `?${qs}` : "";
      const res = await fetchWithSession(`${API_URL}/api/waybills${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as PagedResponse<Waybill> | Waybill[];
      const items = Array.isArray(payload) ? payload : payload.items;
      setWaybills(items);
      setWaybillsTotal(Array.isArray(payload) ? items.length : payload.total);
      if (items.length && !selectedWaybillId) {
        setSelectedWaybillId(items[0].id);
      }
    } catch (e) {
      setWaybillsError(`Не удалось загрузить ТН: ${String(e)}`);
    } finally {
      setWaybillsLoading(false);
    }
  }

  async function loadWaybillEvents(waybillId: string) {
    if (!token || !waybillId) return;
    const res = await fetchWithSession(`${API_URL}/api/waybills/${waybillId}/events`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    setWaybillEvents((await res.json()) as WaybillEvent[]);
  }

  async function openWaybillPdf(waybillId: string, waybillNumber: string) {
    if (!token) {
      setWaybillsMessage("Нет токена авторизации. Перелогинься.");
      setWaybillsTone("error");
      return;
    }
    const res = await fetchWithSession(`${API_URL}/api/waybills/${waybillId}/pdf`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setWaybillsMessage("Не удалось открыть PDF");
      setWaybillsTone("error");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${waybillNumber}.pdf`;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.click();
    URL.revokeObjectURL(url);
    setWaybillsMessage("Открываю PDF...");
    setWaybillsTone("neutral");
  }

  async function doToolAction(
    toolId: string,
    action: ToolActionKind,
    opts?: { responsible?: string; comment?: string; photo?: File | null }
  ): Promise<boolean> {
    if (!token) return false;
    const responsible = opts?.responsible?.trim() || undefined;
    const comment = opts?.comment?.trim() || undefined;
    if (action === "ISSUE" && !responsible) {
      setToolsMessage("Выдача отменена: ответственное лицо обязательно");
      setToolsTone("conflict");
      return false;
    }
    const res = await fetchWithSession(`${API_URL}/api/tools/${toolId}/action`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, responsible, comment })
    });
    if (!res.ok) {
      setToolsMessage("Не удалось изменить статус инструмента");
      setToolsTone(res.status === 409 ? "conflict" : "error");
      return false;
    }
    setToolsTone("success");
    if (opts?.photo) {
      const formData = new FormData();
      formData.append("entityType", "tool");
      formData.append("entityId", toolId);
      formData.append("type", "photo");
      formData.append("file", opts.photo);
      await fetchWithSession(`${API_URL}/api/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
    }
    await loadTools();
    await loadToolEvents(toolId);
    await loadToolWarehouseSummary();
    return true;
  }

  function openToolActionDialog(toolId: string, action: ToolActionKind) {
    const selected = tools.find((t) => t.id === toolId);
    setToolAction({ toolId, action });
    setToolActionResponsible(selected?.responsible || "");
    setToolActionComment("");
    setToolActionPhoto(null);
  }

  async function submitToolActionDialog() {
    if (!toolAction || !token) return;
    const tid = toolAction.toolId;
    const ok = await doToolAction(tid, toolAction.action, {
      responsible: toolActionResponsible,
      comment: toolActionComment,
      photo: toolActionPhoto
    });
    if (!ok) return;
    setToolAction(null);
    if (toolDetailModalId === tid) {
      const res = await fetchWithSession(`${API_URL}/api/tools/${tid}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setToolDetailRecord((await res.json()) as ToolItem);
      }
    }
  }

  async function loadDocuments() {
    if (!token) return;
    const parts = [
      docEntityType && docEntityId ? `entityType=${encodeURIComponent(docEntityType)}` : "",
      docEntityType && docEntityId ? `entityId=${encodeURIComponent(docEntityId)}` : "",
      docTypeFilter ? `type=${encodeURIComponent(docTypeFilter)}` : ""
    ].filter(Boolean);
    const query = parts.length ? `?${parts.join("&")}` : "";
    const res = await fetchWithSession(`${API_URL}/api/documents${query}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = (await res.json()) as DocumentFile[];
    setDocuments(data);
    if (data.length && !selectedDocumentId) {
      setSelectedDocumentId(data[0].id);
      setDocPreviewUrl(`${API_URL}/${data[0].filePath}`);
    }
  }

  function openDocumentsForEntity(entityType: "issue" | "operation" | "receipt", entityId: string) {
    setDocEntityType(entityType);
    setDocEntityId(entityId);
    setSelectedDocumentId("");
    setDocPreviewUrl("");
    setActiveTab("documents");
  }

  async function loadCampItems() {
    if (!token) return;
    const parts: string[] = [];
    if (objectSectionFilter) parts.push(`section=${encodeURIComponent(objectSectionFilter)}`);
    if (activeObjectId) parts.push(`warehouseId=${encodeURIComponent(activeObjectId)}`);
    if (campCategoryFilter) parts.push(`category=${encodeURIComponent(campCategoryFilter)}`);
    if (campStatusFilter) parts.push(`status=${encodeURIComponent(campStatusFilter)}`);
    if (campSearch.trim()) parts.push(`q=${encodeURIComponent(campSearch.trim())}`);
    const query = parts.length ? `?${parts.join("&")}` : "";
    try {
      const res = await fetchWithSession(`${API_URL}/api/camp-items${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        let detail = "";
        try {
          const body = await res.json();
          detail = typeof body?.error === "string" ? `: ${body.error}` : "";
        } catch {
          // ignore
        }
        setCampItems([]);
        setCampMessage(
          res.status === 404
            ? "API «Городок» ещё не задеплоен. Сделайте `docker compose build api && docker compose up -d api`."
            : res.status === 500
            ? "Ошибка сервера. Возможно, не накатилась миграция CampItem. Запустите `docker compose exec api npm run prisma:migrate:deploy`." +
              detail
            : `Не удалось загрузить городок (HTTP ${res.status})${detail}`
        );
        return;
      }
      const data = (await res.json()) as CampItemRow[];
      setCampItems(Array.isArray(data) ? data : []);
      setCampMessage("");
      if (campSelected) {
        const fresh = (Array.isArray(data) ? data : []).find((x) => x.id === campSelected.id) || null;
        setCampSelected(fresh);
      }
    } catch (err) {
      setCampItems([]);
      setCampMessage(`Сеть/JS: ${(err as Error).message || "неизвестная ошибка"}`);
    }
  }

  function resetCampCreateForm() {
    setCampCreateName("");
    setCampCreateCategory("CONTAINER");
    setCampCreateInv("");
    setCampCreateSerial("");
    setCampCreateManufacturer("");
    setCampCreateLocation("");
    setCampCreateDescription("");
    setCampCreateStatus("IN_USE");
    setCampCreateFiles([]);
  }

  async function createCampItem() {
    if (!token) return;
    const name = campCreateName.trim();
    if (!name) {
      setCampMessage("Укажи название");
      return;
    }
    setCampCreating(true);
    try {
      const form = new FormData();
      form.append(
        "payload",
        JSON.stringify({
          name,
          category: campCreateCategory,
          inventoryNumber: campCreateInv.trim() || null,
          serialNumber: campCreateSerial.trim() || null,
          manufacturer: campCreateManufacturer.trim() || null,
          location: campCreateLocation.trim() || null,
          description: campCreateDescription.trim() || null,
          warehouseId: activeObjectId || null,
          section: objectSectionFilter,
          status: campCreateStatus
        })
      );
      for (const f of campCreateFiles) form.append("files", f);
      const res = await fetchWithSession(`${API_URL}/api/camp-items`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setCampMessage(typeof err.error === "string" ? err.error : "Не удалось создать запись");
        return;
      }
      setCampMessage(`Создано: ${name}`);
      resetCampCreateForm();
      setCampShowAddForm(false);
      await loadCampItems();
    } finally {
      setCampCreating(false);
    }
  }

  async function deleteCampItem(id: string) {
    if (!token) return;
    if (!window.confirm("Удалить позицию городка?")) return;
    const res = await fetchWithSession(`${API_URL}/api/camp-items/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setCampMessage("Не удалось удалить");
      return;
    }
    if (campSelected?.id === id) setCampSelected(null);
    setCampMessage("Удалено");
    await loadCampItems();
  }

  async function updateCampItem(id: string, patch: Partial<CampItemRow>) {
    if (!token) return;
    const res = await fetchWithSession(`${API_URL}/api/camp-items/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    if (!res.ok) {
      setCampMessage("Не удалось обновить");
      return;
    }
    await loadCampItems();
  }

  async function uploadCampItemFiles(id: string, files: File[]) {
    if (!token || !files.length) return;
    setCampDetailUploading(true);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const res = await fetchWithSession(`${API_URL}/api/camp-items/${id}/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      if (!res.ok) {
        setCampMessage("Не удалось загрузить файлы");
        return;
      }
      setCampDetailFiles([]);
      await loadCampItems();
    } finally {
      setCampDetailUploading(false);
    }
  }

  async function deleteCampItemFile(itemId: string, fileId: string) {
    if (!token) return;
    if (!window.confirm("Удалить файл?")) return;
    const res = await fetchWithSession(`${API_URL}/api/camp-items/${itemId}/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setCampMessage("Не удалось удалить файл");
      return;
    }
    await loadCampItems();
  }

  function statusClass(status: string) {
    const s = status.toUpperCase();
    if (["APPROVED", "ISSUED", "FORMED", "RECEIVED", "CLOSED", "IN_STOCK"].includes(s)) return "ok";
    if (["ON_APPROVAL", "SHIPPED", "ISSUED", "IN_REPAIR"].includes(s)) return "warn";
    if (["REJECTED", "LOST", "DAMAGED", "WRITTEN_OFF", "DISPUTED"].includes(s)) return "bad";
    return "neutral";
  }

  const selectedIssue = issues.find((x) => x.id === selectedIssueId) || null;
  const selectedWaybill = waybills.find((x) => x.id === selectedWaybillId) || null;
  const selectedDocument = documents.find((x) => x.id === selectedDocumentId) || null;
  const issuesTotalPages = Math.max(1, Math.ceil(issuesTotal / issuesPageSize));
  const waybillsTotalPages = Math.max(1, Math.ceil(waybillsTotal / waybillsPageSize));
  const toolsTotalPages = Math.max(1, Math.ceil(toolsTotal / toolsPageSize));

  async function resolveQrCode() {
    const value = qrCode.trim();
    if (!value) {
      setQrMessage("Введи код для поиска");
      setQrResult(null);
      return;
    }
    if (!token) return;

    setQrMessage("");
    const res = await fetchWithSession(`${API_URL}/api/tools?q=${encodeURIComponent(value)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setQrMessage("Ошибка поиска инструмента");
      setQrResult(null);
      return;
    }
    const payload = (await res.json()) as PagedResponse<ToolItem> | ToolItem[];
    const items = Array.isArray(payload) ? payload : payload.items;
    setTools(items);
    setToolsTotal(Array.isArray(payload) ? items.length : payload.total);
    const toolHit = items.find(
      (t) =>
        t.qrCode.toLowerCase() === value.toLowerCase() ||
        t.inventoryNumber.toLowerCase() === value.toLowerCase() ||
        t.id === value
    );
    if (toolHit) {
      setQrResult({ kind: "tool", tool: toolHit });
      return;
    }

    setQrResult(null);
    setQrMessage("Инструмент не найден по QR/коду");
  }

  useEffect(() => {
    const openOverlay = Boolean(
      limitPromptRequest ||
        manualStockModalOpen ||
        issueRecipientModal ||
        pendingAcceptanceRequestId ||
        materialWriteoffModal ||
        toolManualModalOpen ||
        toolDetailModalId
    );
    if (!openOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setLimitPromptRequest(null);
      setManualStockModalOpen(false);
      setIssueRecipientModal(null);
      setIssueRecipientSignedFile(null);
      setPendingAcceptanceRequestId(null);
      setPendingAcceptanceFiles([]);
      setMaterialWriteoffModal(null);
      setToolManualModalOpen(false);
      setToolDetailModalId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    limitPromptRequest,
    manualStockModalOpen,
    issueRecipientModal,
    pendingAcceptanceRequestId,
    materialWriteoffModal,
    toolManualModalOpen,
    toolDetailModalId
  ]);

  useEffect(() => {
    if (!token || !canReadNotifications) return;
    void loadNotifications();
    const id = window.setInterval(() => void loadNotifications(), 120_000);
    return () => window.clearInterval(id);
  }, [token, canReadNotifications]);

  useEffect(() => {
    if (!me?.fullName?.trim()) return;
    const name = me.fullName.trim();
    setIssueResponsible((v) => (v.trim() === "" ? name : v));
    setToolResponsible((v) => (v.trim() === "" ? name : v));
    setWaybillDriver((w) => (w === WAYBILL_DRIVER_PLACEHOLDER ? name : w));
    setWaybillSender((s) => (s === WAYBILL_SENDER_PLACEHOLDER ? name : s));
  }, [me?.id, me?.fullName]);

  useEffect(() => {
    if (token && !mustPickObject) {
      void loadMe();
      void loadStocks(q);
      void loadIssues();
      void loadApprovalQueue();
      void loadChatUsers();
      void loadConversations();
    }
  }, [token, objectSectionFilter, mustPickObject]);

  useEffect(() => {
    if (!token || activeTab !== "stocks" || mustPickObject || !activeObjectId) {
      return;
    }
    if (canReadOperations) {
      void loadReceiptRequests();
    }
  }, [token, activeTab, activeObjectId, objectSectionFilter, mustPickObject, canReadOperations]);

  // Подсказки «куда пихать» для раскрытых заявок, привязанных к шаблону лимита.
  useEffect(() => {
    if (!token) return;
    for (const r of receiptRequests) {
      if (!r.objectLimitTemplateId) continue;
      if (!expandedReceiptIds[r.id]) continue;
      if (limitSuggestions[r.id]) continue;
      void loadLimitSuggestions(r.id);
    }
  }, [token, receiptRequests, expandedReceiptIds]);

  useEffect(() => {
    if (!token || activeTab !== "stocks" || mustPickObject) {
      return;
    }
    void loadAnnouncementsBoard();
  }, [token, activeTab, mustPickObject]);

  useEffect(() => {
    if (!token || !canDashboard) {
      setDashboard(null);
      return;
    }
    void loadDashboardSummary();
  }, [token, canDashboard, me, dashboardWarehouseId]);

  useEffect(() => {
    if (!token || activeTab !== "audit" || !canReadAudit) {
      return;
    }
    void loadAuditLogs();
    void loadAuditMeta();
  }, [
    token,
    activeTab,
    canReadAudit,
    auditFilterUserId,
    auditFilterEntityType,
    auditFilterEntityId,
    auditFilterQuery,
    auditFilterFrom,
    auditFilterTo,
    auditShowReverted
  ]);

  useEffect(() => {
    if (!token || activeTab !== "integrations") {
      return;
    }
    if (canReadIntegrations) {
      void loadIntegrationJobs();
      void loadReadiness();
    }
    if (canReadIntegrations || canReadNotifications) {
      void loadNotifications();
    }
  }, [token, activeTab, canReadIntegrations, canReadNotifications]);

  useEffect(() => {
    if (!dashboardWarehouseId && warehouses.length) {
      setDashboardWarehouseId(activeObjectId || warehouses[0].id);
    }
  }, [dashboardWarehouseId, warehouses, activeObjectId]);

  useEffect(() => {
    if (!token || !chatWidgetOpen) return;
    void loadChatUsers();
    void loadConversations();
    const timer = window.setInterval(() => {
      void loadConversations();
      if (selectedConversationId)
        void loadConversationMessages(selectedConversationId, {
          silent: true,
          touchViewedAt: false
        });
    }, 10000);
    return () => window.clearInterval(timer);
  }, [token, chatWidgetOpen, selectedConversationId]);

  useEffect(() => {
    if (!token || !chatWidgetOpen || !selectedConversationId) return;
    void loadConversationMessages(selectedConversationId);
  }, [token, chatWidgetOpen, selectedConversationId]);

  useEffect(() => {
    const node = chatMessagesRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [chatMessages, selectedConversationId]);

  useEffect(() => {
    if (!token || activeTab !== "feedback") return;
    void loadFeedbackTickets();
  }, [token, activeTab]);

  useEffect(() => {
    if (!token || activeTab !== "feedback") return;
    if (!feedbackSelectedId || feedbackComposerMode !== "thread") {
      setFeedbackTicketDetail(null);
      return;
    }
    void loadFeedbackTicketDetail(feedbackSelectedId);
  }, [token, activeTab, feedbackSelectedId, feedbackComposerMode]);

  useEffect(() => {
    if (activeTab !== "reports") return;
    setWarehouseSnapshot(null);
    setReportsMessage("");
  }, [activeTab, activeObjectId, objectSectionFilter]);

  useEffect(() => {
    if (activeTab !== "feedback") return;
    const node = feedbackMessagesRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [activeTab, feedbackTicketDetail?.messages, feedbackDetailLoading]);

  useEffect(() => {
    if (token && canManageUsers && activeTab === "admin") {
      void loadAdminData();
      void loadCatalogData().catch(() => undefined);
      void loadProjects().catch(() => undefined);
    }
  }, [token, canManageUsers, activeTab]);

  useEffect(() => {
    const visibleTabs = new Set<string>();
    if (canDashboard) visibleTabs.add("stocks");
    if (canReadStocks) visibleTabs.add("warehouse");
    if (canReadIssues) {
      visibleTabs.add("issues");
      visibleTabs.add("approvals");
    }
    if (canReadOperations) visibleTabs.add("operations");
    if (canReadWaybills) visibleTabs.add("waybills");
    if (canReadStocks || canWriteCatalog) visibleTabs.add("catalog");
    if (canReadDocuments) visibleTabs.add("documents");
    if (canReadTools) {
      visibleTabs.add("tools");
      visibleTabs.add("qr");
    }
    if (canReadLimits) visibleTabs.add("limits");
    if (canMaterialReport) visibleTabs.add("materialReport");
    visibleTabs.add("camp");
    if (canReadIntegrations || canReadNotifications) visibleTabs.add("integrations");
    if (canReadNotifications) visibleTabs.add("notifications");
    visibleTabs.add("feedback");
    visibleTabs.add("reports");
    if (canReadAudit) visibleTabs.add("audit");
    if (canManageUsers) visibleTabs.add("admin");
    visibleTabs.add("password");
    visibleTabs.add("settings");
    visibleTabs.add("profile");
    if (!visibleTabs.has(activeTab)) {
      setActiveTab("stocks");
    }
  }, [
    activeTab,
    canDashboard,
    canReadStocks,
    canReadIssues,
    canReadOperations,
    canReadWaybills,
    canWriteCatalog,
    canReadDocuments,
    canReadTools,
    canReadLimits,
    canReadIntegrations,
    canReadNotifications,
    canReadAudit,
    canManageUsers
  ]);

  useEffect(() => {
    const u = users.find((x) => x.id === selectedUserId);
    if (u) {
      setSelectedWarehouseScopes(u.warehouseScopeIds ?? []);
      setSelectedProjectScopes(u.projectScopeIds ?? []);
      setSelectedRoleName(u.role);
      setSelectedStatus(u.status);
      setSelectedPermissions(u.customPermissions || u.permissions || []);
      const pos = positions.find((p) => p.name === u.position);
      setSelectedPositionId(pos?.id || "");
    }
  }, [users, selectedUserId, positions]);

  useEffect(() => {
    if (token && (activeTab === "catalog" || activeTab === "operations")) {
      void loadCatalogData();
      if (activeTab === "operations") {
        void loadOperations();
        void loadReceiptRequests();
        void loadMaterialMappings();
      }
    }
  }, [token, activeTab, toolSearch, toolStatusFilter, objectSectionFilter]);

  useEffect(() => {
    if (token && activeTab === "issues") {
      void loadCatalogData().catch(() => undefined);
      void loadProjects().catch(() => undefined);
      void loadIssues();
      void loadStocks(q);
      void loadMaterialMappings();
      void loadReceiptRequests();
    }
  }, [
    token,
    activeTab,
    issueStatusFilter,
    issueBasisFilter,
    issueFlowFilter,
    issueSearch,
    issueIssuesDomain,
    issuesSort,
    issuesPage,
    issuesPageSize,
    objectSectionFilter,
    activeObjectId
  ]);

  useEffect(() => {
    if (!token || activeTab !== "issues" || issueIssuesDomain !== "TOOLS" || !activeObjectId) {
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      setIssueToolCatalogLoading(true);
      try {
        const params = new URLSearchParams({
          section: objectSectionFilter,
          status: "IN_STOCK",
          warehouseId: activeObjectId,
          sort: "inventory",
          page: "1",
          pageSize: "150"
        });
        if (issueToolSearch.trim()) params.set("q", issueToolSearch.trim());
        const res = await fetchWithSession(`${API_URL}/api/tools?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = (await res.json()) as PagedResponse<ToolItem> | ToolItem[];
        const items = Array.isArray(payload) ? payload : payload.items;
        if (!cancelled) setIssueToolCatalog(items);
      } catch {
        if (!cancelled) setIssueToolCatalog([]);
      } finally {
        if (!cancelled) setIssueToolCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, activeTab, issueIssuesDomain, activeObjectId, objectSectionFilter, issueToolSearch]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [activeTab]);

  useEffect(() => {
    if (!qrScanning) return;
    if (!("mediaDevices" in navigator) || !navigator.mediaDevices?.getUserMedia) {
      setQrScanError("Сканер не поддерживается браузером. Введи код вручную.");
      setQrScanning(false);
      return;
    }

    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (!qrVideoRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        qrVideoRef.current.srcObject = stream;
        setQrStream(stream);
        setQrScanError("");

        const AnyBarcodeDetector = (window as WindowWithBarcodeDetector).BarcodeDetector;
        const decodeCanvas = document.createElement("canvas");

        const tickJsQr = async () => {
          const video = qrVideoRef.current;
          if (!video || cancelled) return;
          if (video.readyState < HTMLMediaElement.HAVE_METADATA || video.videoWidth < 8) {
            qrDetectTimerRef.current = window.setTimeout(tickJsQr, 250);
            return;
          }
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          const maxSide = 720;
          const scale = vw > maxSide || vh > maxSide ? maxSide / Math.max(vw, vh) : 1;
          const cw = Math.max(1, Math.round(vw * scale));
          const ch = Math.max(1, Math.round(vh * scale));
          decodeCanvas.width = cw;
          decodeCanvas.height = ch;
          const ctx = decodeCanvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) {
            if (!cancelled) qrDetectTimerRef.current = window.setTimeout(tickJsQr, 500);
            return;
          }
          ctx.drawImage(video, 0, 0, cw, ch);
          let value = "";
          try {
            const imageData = ctx.getImageData(0, 0, cw, ch);
            const qr = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: "attemptBoth"
            });
            if (qr?.data) value = qr.data.trim();
          } catch {
            // кадр ещё не готов или чтение пикселей недоступно
          }
          if (value) {
            setQrCode(value);
            stopQrScan();
            await resolveQrCode();
            return;
          }
          if (!cancelled) {
            qrDetectTimerRef.current = window.setTimeout(tickJsQr, 350);
          }
        };

        if (AnyBarcodeDetector) {
          const detector = new AnyBarcodeDetector({ formats: ["qr_code"] });

          const tick = async () => {
            if (!qrVideoRef.current || cancelled) return;
            try {
              const codes = await detector.detect(qrVideoRef.current);
              if (codes && codes.length) {
                const value = codes[0].rawValue || "";
                if (value) {
                  setQrCode(value);
                  stopQrScan();
                  await resolveQrCode();
                  return;
                }
              }
            } catch {
              // ignore frame errors
            }
            if (!cancelled && qrDetectTimerRef.current !== null) {
              window.clearTimeout(qrDetectTimerRef.current);
            }
            if (!cancelled) {
              qrDetectTimerRef.current = window.setTimeout(tick, 900);
            }
          };

          qrDetectTimerRef.current = window.setTimeout(tick, 900);
        } else {
          qrDetectTimerRef.current = window.setTimeout(tickJsQr, 300);
        }
      } catch (e) {
        setQrScanError(`Не удалось открыть камеру: ${String(e)}`);
        setQrScanning(false);
      }
    }

    void start();

    return () => {
      cancelled = true;
    };
  }, [qrScanning]);

  function stopQrScan() {
    if (qrDetectTimerRef.current !== null) {
      window.clearTimeout(qrDetectTimerRef.current);
      qrDetectTimerRef.current = null;
    }
    if (qrStream) {
      qrStream.getTracks().forEach((t) => t.stop());
      setQrStream(null);
    }
    setQrScanning(false);
  }

  useEffect(() => {
    if (activeTab !== "qr") {
      stopQrScan();
    }
  }, [activeTab]);

  useEffect(() => {
    if (!isStorekeeperMode || !stockOptionsForIssue.length || issueLines.length) return;
    setIssueLines([{ id: `issue-line-${Date.now()}`, materialId: stockOptionsForIssue[0].materialId, quantity: 1 }]);
  }, [isStorekeeperMode, stockOptionsForIssue, issueLines.length]);

  useEffect(() => {
    localStorage.setItem(ISSUE_FILTER_KEY, issueStatusFilter);
  }, [issueStatusFilter]);

  useEffect(() => {
    setIssuesPage(1);
  }, [issueSearch, issueStatusFilter, issueBasisFilter, issueFlowFilter, issuesSort, issuesPageSize]);

  useEffect(() => {
    if (issuesPage > issuesTotalPages) setIssuesPage(issuesTotalPages);
  }, [issuesPage, issuesTotalPages]);

  useEffect(() => {
    setWaybillsPage(1);
  }, [waybillStatusFilter, waybillsSort, waybillsPageSize]);

  useEffect(() => {
    if (waybillsPage > waybillsTotalPages) setWaybillsPage(waybillsTotalPages);
  }, [waybillsPage, waybillsTotalPages]);

  useEffect(() => {
    setToolsPage(1);
  }, [toolSearch, toolStatusFilter, toolsSort, toolsPageSize, toolListWarehouseId]);

  useEffect(() => {
    localStorage.setItem(
      LIST_VIEW_KEY,
      JSON.stringify({
        issuesPageSize,
        waybillsPageSize,
        toolsPageSize
      })
    );
  }, [issuesPageSize, waybillsPageSize, toolsPageSize]);

  useEffect(() => {
    if (toolsPage > toolsTotalPages) setToolsPage(toolsTotalPages);
  }, [toolsPage, toolsTotalPages]);

  useEffect(() => {
    localStorage.setItem(
      STOCK_VIEW_KEY,
      JSON.stringify({ showStockSku, showStockReserve, showStockPrice })
    );
  }, [showStockSku, showStockReserve, showStockPrice]);

  useEffect(() => {
    localStorage.setItem("skladpro_issue_domain", issueIssuesDomain);
  }, [issueIssuesDomain]);

  useEffect(() => {
    if (token && activeTab === "approvals") {
      void loadApprovalQueue();
      void loadReceiptRequests();
    }
  }, [token, activeTab, approvalQueueTab, objectSectionFilter]);

  useEffect(() => {
    if (token && activeTab === "limits") {
      void loadCatalogData();
      void loadProjects();
      void loadLimitTemplates();
      void loadStockMovements();
      setExpandedLimitNodes({});
      setLimitNodeDrafts({});
      setLimitTemplateTitleDrafts({});
    }
  }, [token, activeTab, activeObjectId, objectSectionFilter]);

  useEffect(() => {
    if (token && activeTab === "materialReport" && canMaterialReport) {
      void loadMaterialReportData();
    }
  }, [token, activeTab, activeObjectId, objectSectionFilter, canMaterialReport]);

  useEffect(() => {
    if (!limitEditMode) {
      setLimitNodeDrafts({});
      setLimitTemplateTitleDrafts({});
    }
  }, [limitEditMode]);

  useEffect(() => {
    if (token && activeTab === "warehouse") {
      void loadLimitTemplates();
      void loadMaterialMappings();
      void loadReceiptRequests().catch(() => undefined);
    }
  }, [token, activeTab, activeObjectId, objectSectionFilter]);

  useEffect(() => {
    if (token && activeTab === "documents") {
      void loadIssues();
      void loadOperations();
      void loadReceiptRequests();
      void loadDocuments();
    }
  }, [token, activeTab, docTypeFilter, docEntityType, docEntityId]);

  useEffect(() => {
    if (token && activeTab === "camp") {
      void loadCampItems();
    }
  }, [token, activeTab, objectSectionFilter, activeObjectId, campCategoryFilter, campStatusFilter, campSearch]);

  useEffect(() => {
    if (token && activeTab === "qr") {
      void loadTools();
    }
  }, [token, activeTab]);

  useEffect(() => {
    if (token && activeTab === "tools") {
      void loadCatalogData();
      void loadTools();
      void loadToolWarehouseSummary();
      void loadToolCategories();
      void loadToolGroupCards();
    }
  }, [
    token,
    activeTab,
    toolSearch,
    toolStatusFilter,
    toolsSort,
    toolsPage,
    toolsPageSize,
    objectSectionFilter,
    toolListWarehouseId,
    toolDrilledCard?.key
  ]);

  useEffect(() => {
    if (!token || !toolDetailModalId) {
      setToolDetailRecord(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetchWithSession(`${API_URL}/api/tools/${toolDetailModalId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!cancelled && res.ok) {
        setToolDetailRecord((await res.json()) as ToolItem);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, toolDetailModalId]);

  useEffect(() => {
    if (token && activeTab === "waybills") {
      void loadCatalogData();
      void loadWaybills();
      void loadPeerWarehouseSummaries();
      void loadTransferRequestsList();
    }
  }, [
    token,
    activeTab,
    waybillStatusFilter,
    waybillsSort,
    waybillsPage,
    waybillsPageSize,
    activeObjectId,
    objectSectionFilter
  ]);

  useEffect(() => {
    if (token && activeTab === "waybills" && selectedWaybillId) {
      void loadWaybillEvents(selectedWaybillId);
    }
  }, [token, activeTab, selectedWaybillId]);

  useEffect(() => {
    if (token && activeTab === "tools" && selectedToolForEvents) {
      void loadToolEvents(selectedToolForEvents);
    }
  }, [token, activeTab, selectedToolForEvents]);

  useEffect(() => {
    if (warehouses.length > 0 && !waybillFromWarehouseId) {
      setWaybillFromWarehouseId(warehouses[0].id);
    }
    if (materials.length > 0 && !waybillMaterialId) {
      setWaybillMaterialId(materials[0].id);
    }
    if (materials.length > 0 && !transferReqMaterialId) {
      setTransferReqMaterialId(materials[0].id);
    }
  }, [warehouses, materials, waybillFromWarehouseId, waybillMaterialId, transferReqMaterialId]);

  useEffect(() => {
    if (activeTab !== "waybills" || !warehouses.length) return;
    const to =
      activeObjectId && warehouses.some((w) => w.id === activeObjectId) ? activeObjectId : warehouses[0].id;
    setTransferReqToWarehouseId(to);
    const from = warehouses.find((w) => w.id !== to) ?? warehouses[0];
    setTransferReqFromWarehouseId(from.id);
  }, [activeTab, warehouses, activeObjectId]);

  useEffect(() => {
    if (activeObjectId) {
      setOpWarehouseId(activeObjectId);
      setIssueWarehouseId(activeObjectId);
      setToolWarehouseId(activeObjectId);
      setToolListWarehouseId(activeObjectId);
      if (!dashboardWarehouseId) setDashboardWarehouseId(activeObjectId);
    } else {
      setToolListWarehouseId("");
    }
  }, [activeObjectId, dashboardWarehouseId]);

  async function onLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setAuthError("");
    setSessionExpiredHint("");
    try {
      const res = await fetchWithSession(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password })
      });
      if (!res.ok) {
        let serverError = "";
        try {
          const body = await res.json();
          serverError = typeof body?.error === "string" ? body.error : "";
        } catch {
          try {
            serverError = await res.text();
          } catch {
            serverError = "";
          }
        }
        throw new Error(serverError || `Ошибка входа (HTTP ${res.status})`);
      }
      const data = (await res.json()) as LoginResponse;
      localStorage.setItem(TOKEN_KEY, data.token);
      if (Array.isArray(data.user.availableObjects)) {
        setAvailableObjects(data.user.availableObjects);
      }
      if (data.user.activeWarehouseId) {
        setActiveObjectId(data.user.activeWarehouseId);
      }
      if (data.user.activeSection) {
        setObjectSectionFilter(data.user.activeSection);
      }
      setMustPickObject(Boolean(data.user.requireObjectSelection));
      setToken(data.token);
    } catch (err) {
      setAuthError(String(err));
    }
  }

  if (!isAuthed) {
    return (
      <main className="loginShell">
        <div className="loginCard card">
          <div className="loginBrand">
            <h1>СкладПро</h1>
            <p className="muted">Warehouse ERP platform</p>
          </div>
          <h2>Вход в систему</h2>
          <form className="form" onSubmit={onLoginSubmit} autoComplete="off">
            <label style={{ flexDirection: "column", gap: 6 }}>
              Email
              <input
                name="login-email-field"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                spellCheck={false}
                readOnly={loginFieldsReadonly}
                onFocus={() => setLoginFieldsReadonly(false)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label style={{ flexDirection: "column", gap: 6 }}>
              Пароль
              <input
                name="login-password-field"
                type="password"
                autoComplete="current-password"
                readOnly={loginFieldsReadonly}
                onFocus={() => setLoginFieldsReadonly(false)}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit">Войти</button>
          </form>
          {authError && <p className="error">{authError}</p>}
          {sessionExpiredHint && !authError ? <p className="muted">{sessionExpiredHint}</p> : null}
        </div>
      </main>
    );
  }

  if (mustPickObject) {
    return (
      <main className="loginShell">
        <div className="loginCard card">
          <h2>Выберите объект</h2>
          <p className="muted">После выбора вы войдете в контур объекта. Сменить можно в верхней панели.</p>
          <div className="form">
            <label>
              Объект
              <select value={activeObjectId} onChange={(e) => setActiveObjectId(e.target.value)}>
                <option value="">— выберите —</option>
                {availableObjects.map((o) => (
                  <option key={o.id} value={o.id}>
                    {safeName(o.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Раздел
              <div className="sectionToggle" aria-label="Раздел СС/ЭОМ">
                <button
                  type="button"
                  className={`sectionToggleBtn ${objectSectionFilter === "SS" ? "active" : ""}`}
                  onClick={() => setObjectSectionFilter("SS")}
                >
                  СС
                </button>
                <button
                  type="button"
                  className={`sectionToggleBtn ${objectSectionFilter === "EOM" ? "active" : ""}`}
                  onClick={() => setObjectSectionFilter("EOM")}
                >
                  ЭОМ
                </button>
              </div>
            </label>
            <button
              type="button"
              disabled={!activeObjectId}
              onClick={async () => {
                if (!activeObjectId) return;
                const ok = await updateAuthContext({ warehouseId: activeObjectId, section: objectSectionFilter });
                if (!ok) setAuthError("Не удалось сохранить выбор объекта");
              }}
            >
              Войти в объект
            </button>
            {authError && <p className="error">{authError}</p>}
            <button type="button" className="ghostBtn" style={{ marginTop: 12 }} onClick={onLogout}>
              Выйти из аккаунта
            </button>
          </div>
        </div>
      </main>
    );
  }

  const adminDrawerUser = users.find((u) => u.id === selectedUserId);

  const PendingAcceptanceModal = () => {
    if (!pendingAcceptanceRequestId) return null;
    const row = receiptRequests.find((r) => r.id === pendingAcceptanceRequestId);
    if (!row) return null;
    const drafts = acceptanceDrafts[row.id] || {};
    const pickedItems = row.items.filter((it) => {
      const q = Number((drafts[it.id]?.qty ?? "").toString().replace(",", "."));
      return Number.isFinite(q) && q > 0;
    });
    const isSubmitting = Boolean(acceptanceSubmitting[row.id]);
    return (
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 60,
          padding: 16
        }}
        onMouseDown={(e) => {
          if (!isSubmitting && e.target === e.currentTarget) {
            setPendingAcceptanceRequestId(null);
            setPendingAcceptanceFiles([]);
          }
        }}
      >
        <div
          className="card"
          style={{ maxWidth: 560, width: "100%" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <h3 style={{ marginTop: 0 }}>Приложите документы к приёмке</h3>
          <p className="muted">
            Заявка <strong>{row.number}</strong>. Сейчас принимаем {pickedItems.length}{" "}
            {pickedItems.length === 1 ? "позицию" : "позиций"}. По одной заявке может быть несколько приёмок —
            документы прикрепятся именно к этой заявке (и к создаваемому приходу).
          </p>
          <ul className="plainList" style={{ maxHeight: 160, overflowY: "auto", marginBottom: 12 }}>
            {pickedItems.map((it) => (
              <li key={`pending-item-${it.id}`}>
                {it.sourceName}{" "}
                <span className="muted">
                  — {(drafts[it.id]?.qty || "0")} {drafts[it.id]?.newUnit || it.sourceUnit || "шт"}
                </span>
              </li>
            ))}
          </ul>
          <label>
            Сканы документов (УПД, ТН, фото, можно несколько)
            <input
              type="file"
              multiple
              onChange={(e) => setPendingAcceptanceFiles(Array.from(e.target.files || []))}
            />
          </label>
          {pendingAcceptanceFiles.length > 0 && (
            <ul className="plainList" style={{ marginTop: 6 }}>
              {pendingAcceptanceFiles.map((f, i) => (
                <li key={`pending-file-${i}`} className="muted">
                  📎 {f.name} <span>({Math.ceil(f.size / 1024)} КБ)</span>
                </li>
              ))}
            </ul>
          )}
          <div className="toolbar" style={{ marginTop: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button
              type="button"
              className="ghostBtn"
              disabled={isSubmitting}
              onClick={() => {
                setPendingAcceptanceRequestId(null);
                setPendingAcceptanceFiles([]);
              }}
            >
              Отмена
            </button>
            <button
              type="button"
              className="ghostBtn"
              disabled={isSubmitting}
              onClick={async () => {
                const targetRow = row;
                const ok = await submitReceiptAcceptance(targetRow, []);
                if (ok) {
                  setPendingAcceptanceRequestId(null);
                  setPendingAcceptanceFiles([]);
                }
              }}
            >
              Принять без документов
            </button>
            <button
              type="button"
              disabled={isSubmitting || pendingAcceptanceFiles.length === 0}
              onClick={async () => {
                const files = [...pendingAcceptanceFiles];
                const targetRow = row;
                const ok = await submitReceiptAcceptance(targetRow, files);
                if (ok) {
                  setPendingAcceptanceRequestId(null);
                  setPendingAcceptanceFiles([]);
                }
              }}
            >
              {isSubmitting ? "Принимаем…" : "Принять с документами"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <main className={`shell uiSupreme ${isStorekeeperMode ? "warehouseMode" : ""}`}>
      <aside className={`sidebar ${mobileNavOpen ? "mobileOpen" : ""}`}>
        <div className="brandWrap">
          <h2 className="brand">СкладПро</h2>
          <p className="brandSub">Warehouse ERP</p>
        </div>
        <div className="sidebarNavScroll">
          <p className="navSectionTitle">Операции</p>
          {canDashboard && <button className={`navBtn ${activeTab === "stocks" ? "active" : ""}`} onClick={() => setActiveTab("stocks")}><span className="navIcon">⌂</span>Главная</button>}
          {canReadStocks && <button className={`navBtn ${activeTab === "warehouse" ? "active" : ""}`} onClick={() => setActiveTab("warehouse")}><span className="navIcon">▦</span>Склад</button>}
          <button className={`navBtn ${activeTab === "camp" ? "active" : ""}`} onClick={() => setActiveTab("camp")}><span className="navIcon">▣</span>Городок</button>
          {canReadOperations && <button className={`navBtn ${activeTab === "operations" ? "active" : ""}`} onClick={() => setActiveTab("operations")}><span className="navIcon">↗</span>Приходы</button>}
          {canReadIssues && <button className={`navBtn ${activeTab === "issues" ? "active" : ""}`} onClick={() => setActiveTab("issues")}><span className="navIcon">⇄</span>Выдачи</button>}
          {canReadIssues && <button className={`navBtn ${activeTab === "approvals" ? "active" : ""}`} onClick={() => setActiveTab("approvals")}><span className="navIcon">☑</span>Заявки</button>}
          {canReadWaybills && <button className={`navBtn ${activeTab === "waybills" ? "active" : ""}`} onClick={() => setActiveTab("waybills")}><span className="navIcon">⇆</span>Перемещения</button>}

          <p className="navSectionTitle">Контроль</p>
          {canReadDocuments && <button className={`navBtn ${activeTab === "documents" ? "active" : ""}`} onClick={() => setActiveTab("documents")}><span className="navIcon">▤</span>Документы</button>}
          {canReadLimits && <button className={`navBtn ${activeTab === "limits" ? "active" : ""}`} onClick={() => setActiveTab("limits")}><span className="navIcon">▧</span>Лимиты</button>}
          {canMaterialReport && (
            <button
              type="button"
              className={`navBtn ${activeTab === "materialReport" ? "active" : ""}`}
              onClick={() => setActiveTab("materialReport")}
            >
              <span className="navIcon">▪</span>Материальный отчёт
            </button>
          )}
          <button className={`navBtn ${activeTab === "feedback" ? "active" : ""}`} onClick={() => setActiveTab("feedback")}><span className="navIcon">🛠</span>Обратная связь</button>
          <button className={`navBtn ${activeTab === "reports" ? "active" : ""}`} onClick={() => setActiveTab("reports")}><span className="navIcon">📄</span>Сводка</button>
          {canReadAudit && <button className={`navBtn ${activeTab === "audit" ? "active" : ""}`} onClick={() => setActiveTab("audit")}><span className="navIcon">◉</span>Логи</button>}
          {canReadNotifications && (
            <button
              className={`navBtn ${activeTab === "notifications" ? "active" : ""}`}
              type="button"
              onClick={() => setActiveTab("notifications")}
            >
              <span className="navIcon">🔔</span>Уведомления
              {unreadNotificationCount > 0 ? (
                <span
                  className="navBadgeMuted"
                  title="Непрочитанные уведомления"
                  style={{
                    marginLeft: 6,
                    fontSize: 11,
                    lineHeight: "18px",
                    minWidth: 18,
                    padding: "0 5px",
                    borderRadius: 9,
                    background: "var(--accent, #2563eb)",
                    color: "#fff",
                    display: "inline-block",
                    fontWeight: 700
                  }}
                >
                  {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                </span>
              ) : null}
            </button>
          )}

          <p className="navSectionTitle">Сервис</p>
          {(canReadStocks || canWriteCatalog) && <button className={`navBtn ${activeTab === "catalog" ? "active" : ""}`} onClick={() => setActiveTab("catalog")}><span className="navIcon">▣</span>Справочники</button>}
          {canReadTools && <button className={`navBtn ${activeTab === "tools" ? "active" : ""}`} onClick={() => setActiveTab("tools")}><span className="navIcon">⚒</span>Инструменты</button>}
          {canReadTools && <button className={`navBtn ${activeTab === "qr" ? "active" : ""}`} onClick={() => setActiveTab("qr")}><span className="navIcon">⌁</span>QR</button>}
          {(canReadIntegrations || canReadNotifications) && (
            <button
              className={`navBtn ${activeTab === "integrations" ? "active" : ""}`}
              type="button"
              onClick={() => setActiveTab("integrations")}
            >
              <span className="navIcon">⎘</span>
              {canReadIntegrations ? "Интеграции" : "Уведомления"}
              {unreadNotificationCount > 0 ? (
                <span
                  className="navBadgeMuted"
                  title="Непрочитанные уведомления"
                  style={{
                    marginLeft: 6,
                    fontSize: 11,
                    lineHeight: "18px",
                    minWidth: 18,
                    padding: "0 5px",
                    borderRadius: 9,
                    background: "var(--accent, #2563eb)",
                    color: "#fff",
                    display: "inline-block",
                    fontWeight: 700
                  }}
                >
                  {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                </span>
              ) : null}
            </button>
          )}

          <p className="navSectionTitle">Администрирование</p>
          {canManageUsers && <button className={`navBtn ${activeTab === "admin" ? "active" : ""}`} onClick={() => setActiveTab("admin")}><span className="navIcon">⚙</span>Доступы</button>}
        </div>

        <div className="sidebarFoot">
          <p className="navSectionTitle">Аккаунт</p>
          <button className={`navBtn ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}><span className="navIcon">◉</span>Профиль</button>
          <button className={`navBtn ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}><span className="navIcon">⚙</span>Настройки</button>
          <button className={`navBtn ${activeTab === "password" ? "active" : ""}`} onClick={() => setActiveTab("password")}><span className="navIcon">✱</span>Смена пароля</button>
          <button type="button" className="navBtn danger" onClick={onLogout}>Выйти</button>
        </div>
      </aside>
      {mobileNavOpen && (
        <button
          type="button"
          className="mobileNavBackdrop"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Закрыть меню"
        />
      )}
      <section className="canvas">
        <header className="pageHeader">
          <button
            type="button"
            className="mobileMenuBtn"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label="Открыть меню"
          >
            ☰
          </button>
          <div className="pageTitleBlock">
            <h1>{currentTitle}</h1>
            <p className="crumbs">{currentSection} / {currentTitle}</p>
            {me && <p className="muted">{me.fullName} ({roleLabel(me.role)}{me.position ? ` · ${me.position}` : ""})</p>}
          </div>
          <div className="toolbar topToolbar">
            <input placeholder="Глобальный поиск (материал/инструмент/код)" value={globalSearch} onChange={(e) => setGlobalSearch(e.target.value)} />
            <select
              value={activeObjectId}
              onChange={(e) => {
                const warehouseId = e.target.value;
                if (!warehouseId) return;
                void updateAuthContext({ warehouseId, section: objectSectionFilter });
              }}
            >
              {availableObjects.map((o) => (
                <option key={o.id} value={o.id}>
                  Объект: {safeName(o.name)}
                </option>
              ))}
            </select>
            <div className="sectionToggle" aria-label="Раздел СС/ЭОМ">
              <button
                type="button"
                className={`sectionToggleBtn ${objectSectionFilter === "SS" ? "active" : ""}`}
                onClick={() => setSection("SS")}
              >
                СС
              </button>
              <button
                type="button"
                className={`sectionToggleBtn ${objectSectionFilter === "EOM" ? "active" : ""}`}
                onClick={() => setSection("EOM")}
              >
                ЭОМ
              </button>
            </div>
            <button onClick={() => { setQ(globalSearch); setToolSearch(globalSearch); setActiveTab("warehouse"); }}>Найти</button>
            {canReadTools && <button onClick={() => setActiveTab("qr")}>QR</button>}


            <button className="topIconBtn" type="button" onClick={() => setActiveTab("profile")}>Профиль</button>
            <button className="topIconBtn" type="button" onClick={() => setActiveTab("settings")}>Настройки</button>
            <button className="topIconBtn topIconBtnDanger" type="button" onClick={onLogout}>
              Выйти
            </button>
            {me ? (
              <span className="userChip">
                <span className="userAvatar">
                  <UserAvatarChip fullName={me.fullName} avatarUrl={me.avatarUrl} imageClassName="userAvatarImage" />
                </span>
                <span>{me.fullName}</span>
              </span>
            ) : null}
          </div>
        </header>
        {dashboardError && activeTab === "stocks" && <p className="error">{dashboardError}</p>}
        {activeTab === "stocks" && (
          <div className="homeDashboard">
            <section className="card homeHero">
              <div className="homeHeroGrid">
                <div>
                  <p className="homeHeroKicker">
                    Выбран раздел · <strong>{objectSectionFilter === "SS" ? "СС" : "ЭОМ"}</strong>
                  </p>
                  <h2 className="homeHeroTitle">
                    {safeName(
                      dashboard?.object?.warehouseName ||
                        warehouses.find((w) => w.id === (activeObjectId || dashboardWarehouseId))?.name
                    )}
                  </h2>
                  <p className="muted homeHeroMeta">
                    Детальный склад, лимиты и отчёт открываются отдельно — здесь оперативные цифры и быстрые переходы.
                  </p>
                  <p className="muted homeHeroMeta">
                    {dashboard?.generatedAt
                      ? `Сводка API: ${new Date(dashboard.generatedAt).toLocaleString()} · строк остатков в выборке: ${stocks.length}`
                      : "Запрашиваем сводку с сервера…"}
                  </p>
                </div>
                <div className="homeHeroActions">
                  <button type="button" className="ghostBtn" onClick={() => setActiveTab("reports")}>
                    Полная сводка
                  </button>
                  <button
                    type="button"
                    className="primaryBtn"
                    onClick={() => {
                      void loadDashboardSummary();
                      void loadStocks(q);
                      void loadIssues();
                      void loadApprovalQueue();
                      if (activeObjectId && canReadOperations) void loadReceiptRequests();
                    }}
                  >
                    Обновить данные
                  </button>
                </div>
              </div>
              {dashboard && dashboard.project.overspendLimitLines > 0 && canReadLimits ? (
                <div className="homeAlertBanner">
                  <span>
                    По лимитам обнаружен перерасход в <strong>{dashboard.project.overspendLimitLines}</strong> строках.
                  </span>
                  <button type="button" className="miniActionBtn" onClick={() => setActiveTab("limits")}>
                    Перейти в лимиты
                  </button>
                </div>
              ) : null}
            </section>

            <section className="card homeSectionBlock">
              <h3 className="homeSectionTitle">Объявления</h3>
              {canWriteAnnouncements && (
                <div className="toolbar" style={{ marginBottom: 8 }}>
                  <button type="button" className="ghostBtn" onClick={() => setAnnouncementComposeOpen((v) => !v)}>
                    {announcementComposeOpen ? "Закрыть форму" : "Новое объявление"}
                  </button>
                </div>
              )}
              {announcementComposeOpen && canWriteAnnouncements ? (
                <div className="form card" style={{ marginBottom: 12 }}>
                  <label>
                    Заголовок
                    <input value={announcementTitleDraft} onChange={(e) => setAnnouncementTitleDraft(e.target.value)} />
                  </label>
                  <label>
                    Текст
                    <textarea
                      value={announcementBodyDraft}
                      onChange={(e) => setAnnouncementBodyDraft(e.target.value)}
                      rows={4}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!announcementTitleDraft.trim() || !announcementBodyDraft.trim()}
                    onClick={() => void publishAnnouncementDraft()}
                  >
                    Опубликовать
                  </button>
                </div>
              ) : null}
              {announcementsLoading ? (
                <p className="muted">Загрузка…</p>
              ) : announcements.length === 0 ? (
                <p className="muted">Объявлений пока нет.</p>
              ) : (
                <div className="homeInsightGrid">
                  {announcements.map((a) => (
                    <div
                      key={a.id}
                      className={`homeInsightCard ${a.isPinned ? "accentWarn" : ""}`}
                      style={{ alignItems: "flex-start" }}
                    >
                      <span className="homeInsightLabel">
                        {a.isPinned ? "Закреплено · " : ""}
                        {a.title}
                      </span>
                      <p className="homeInsightHint" style={{ whiteSpace: "pre-wrap" }}>
                        {a.body}
                      </p>
                      <span className="muted" style={{ fontSize: "0.85rem" }}>
                        {new Date(a.createdAt).toLocaleString()}
                        {a.author?.fullName ? ` · ${a.author.fullName}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {!dashboard ? (
              <p className="muted">Нет данных сводки{dashboardError ? "" : " (ожидание прав или ответа API)"}.</p>
            ) : (
              <>
                <section className="homeSectionBlock">
                  <h3 className="homeSectionTitle">Объект и ресурсы</h3>
                  <div className="homeInsightGrid">
                    <button
                      type="button"
                      className="homeInsightCard"
                      disabled={!canReadStocks}
                      onClick={() => {
                        setQ("");
                        void loadStocks("");
                        setActiveTab("warehouse");
                      }}
                    >
                      <span className="homeInsightLabel">Строк складской выборки</span>
                      <span className="homeInsightValue">{stocks.length.toLocaleString("ru-RU")}</span>
                      <span className="homeInsightHint">Открыть склад →</span>
                    </button>
                    <button
                      type="button"
                      className="homeInsightCard"
                      disabled={!canReadLimits}
                      onClick={() => setActiveTab("limits")}
                    >
                      <span className="homeInsightLabel">План по лимитам выполнен на</span>
                      <span className="homeInsightValue">{dashboard.object?.usagePercent ?? 0}%</span>
                      <span className="homeInsightHint muted">
                        {dashboard.object ? `${dashboard.object.issuedQty.toLocaleString("ru-RU")} из ${dashboard.object.plannedQty.toLocaleString("ru-RU")} ед.` : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="homeInsightCard"
                      disabled={!canReadLimits}
                      onClick={() => setActiveTab("limits")}
                    >
                      <span className="homeInsightLabel">Проектов / лимитов</span>
                      <span className="homeInsightValue">
                        {dashboard.object?.projectsCount ?? 0} · {dashboard.object?.limitsCount ?? 0}
                      </span>
                      <span className="homeInsightHint">Карточки лимитов →</span>
                    </button>
                    <button
                      type="button"
                      className="homeInsightCard"
                      disabled={!canReadOperations}
                      onClick={() => setActiveTab("operations")}
                    >
                      <span className="homeInsightLabel">Приёмки Excel в работе</span>
                      <span className="homeInsightValue">{(dashboard.object?.receiptRequestsOpen ?? 0).toLocaleString("ru-RU")}</span>
                      <span className="homeInsightHint">Вкладка «Приходы» →</span>
                    </button>
                    <button type="button" className="homeInsightCard" onClick={() => setActiveTab("camp")}>
                      <span className="homeInsightLabel">Единиц в городке</span>
                      <span className="homeInsightValue">{(dashboard.object?.campItemsCount ?? 0).toLocaleString("ru-RU")}</span>
                      <span className="homeInsightHint">Жилой фонд и контейнеры →</span>
                    </button>
                  </div>
                </section>

                <section className="homeSectionBlock">
                  <h3 className="homeSectionTitle">Сегодня (операционный день, UTC)</h3>
                  <div className="homeInsightGrid">
                    <button
                      type="button"
                      className="homeInsightCard"
                      disabled={!canReadOperations}
                      onClick={() => setActiveTab("operations")}
                    >
                      <span className="homeInsightLabel">Проведённые приходы</span>
                      <span className="homeInsightValue">{dashboard.warehouse.receiptsToday}</span>
                    </button>
                    <button
                      type="button"
                      className="homeInsightCard"
                      disabled={!canReadOperations}
                      onClick={() => setActiveTab("operations")}
                    >
                      <span className="homeInsightLabel">Проведённые расходы (операции)</span>
                      <span className="homeInsightValue">{dashboard.warehouse.issuesOperationsToday}</span>
                    </button>
                    <button type="button" className="homeInsightCard" disabled={!canReadIssues} onClick={() => setActiveTab("issues")}>
                      <span className="homeInsightLabel">Заявок закрыто «Выдано»</span>
                      <span className="homeInsightValue">{dashboard.warehouse.issuesRequestsIssuedToday}</span>
                    </button>
                    <button
                      type="button"
                      className="homeInsightCard"
                      disabled={!canReadOperations}
                      onClick={() => setActiveTab("operations")}
                    >
                      <span className="homeInsightLabel">Перемещения (тип трансфера)</span>
                      <span className="homeInsightValue">{dashboard.warehouse.transfersToday}</span>
                    </button>
                  </div>
                </section>

                <section className="homeSectionBlock">
                  <h3 className="homeSectionTitle">Заявки и контроль</h3>
                  <div className="homeInsightGrid">
                    <button
                      type="button"
                      className="homeInsightCard accentWarn"
                      disabled={!canReadIssues}
                      onClick={() => {
                        setIssueStatusFilter("ON_APPROVAL");
                        setActiveTab("approvals");
                      }}
                    >
                      <span className="homeInsightLabel">На согласовании</span>
                      <span className="homeInsightValue">{dashboard.warehouse.pendingApprovals}</span>
                      <span className="homeInsightHint">Открыть лист заявок →</span>
                    </button>
                    <button type="button" className="homeInsightCard accentWarn" disabled={!canReadIssues} onClick={() => setActiveTab("issues")}>
                      <span className="homeInsightLabel">Долго висящие (&gt;7 дней)</span>
                      <span className="homeInsightValue">{dashboard.warehouse.staleOpenIssues}</span>
                    </button>
                    <button
                      type="button"
                      className="homeInsightCard"
                      disabled={!canReadStocks}
                      onClick={() => {
                        setQ("low");
                        void loadStocks("low");
                        setActiveTab("warehouse");
                      }}
                    >
                      <span className="homeInsightLabel">Позиций с низким остатком</span>
                      <span className="homeInsightValue">{dashboard.warehouse.lowStockLines}</span>
                      <span className="homeInsightHint">Фильтр «низкий остаток» →</span>
                    </button>
                    <button type="button" className="homeInsightCard" disabled={!canReadWaybills} onClick={() => setActiveTab("waybills")}>
                      <span className="homeInsightLabel">ТТН не закрыты</span>
                      <span className="homeInsightValue">{dashboard.warehouse.waybillsOpen}</span>
                    </button>
                    <button
                      type="button"
                      className="homeInsightCard"
                      disabled={!canReadTools}
                      onClick={() => {
                        setToolStatusFilter("IN_REPAIR");
                        setActiveTab("tools");
                      }}
                    >
                      <span className="homeInsightLabel">Инструмент в ремонте</span>
                      <span className="homeInsightValue">{dashboard.warehouse.toolsInRepair}</span>
                    </button>
                    <button
                      type="button"
                      className="homeInsightCard"
                      disabled={!canReadIntegrations}
                      onClick={() => setActiveTab("integrations")}
                    >
                      <span className="homeInsightLabel">Сбои интеграций 24ч</span>
                      <span className="homeInsightValue">{dashboard.warehouse.failedIntegrations24h}</span>
                    </button>
                    <button
                      type="button"
                      className="homeInsightCard"
                      disabled={!canReadIntegrations && !canReadNotifications}
                      onClick={() => setActiveTab("integrations")}
                    >
                      <span className="homeInsightLabel">Непрочитанные уведомления</span>
                      <span className="homeInsightValue">{dashboard.warehouse.unreadNotifications}</span>
                    </button>
                    <button
                      type="button"
                      className="homeInsightCard accentBad"
                      disabled={!canReadIntegrations && !canReadNotifications}
                      onClick={() => setActiveTab("integrations")}
                    >
                      <span className="homeInsightLabel">Критичные алерты 24ч</span>
                      <span className="homeInsightValue">{dashboard.warehouse.errorNotifications24h}</span>
                    </button>
                    {dashboard.admin ? (
                      <button
                        type="button"
                        className="homeInsightCard mutedCard"
                        onClick={() => {
                          if (canReadAudit) setActiveTab("audit");
                          else setActiveTab("integrations");
                        }}
                      >
                        <span className="homeInsightLabel">Админ-срез · пользователей / аудит 24ч</span>
                        <span className="homeInsightValue">
                          {dashboard.admin.activeUsers} / {dashboard.admin.auditEvents24h}
                        </span>
                      </button>
                    ) : null}
                  </div>
                </section>

                <section className="homeSectionBlock">
                  <h3 className="homeSectionTitle">Графики</h3>
                  <p className="muted homeChartsLead">
                    Визуализация данных сводки и текущего списка заявок. Клик по сектору кольца отправляет в раздел выдачи с
                    нужным фильтром; кольцо лимитов — переход к лимитам.
                  </p>
                  <div className="homeChartsGridTwo">
                    <div className="homeChartSheet homeChartSheetPie">
                      <div className="homeChartSheetHead">
                        <h4>Заявки по статусам</h4>
                        <span className="muted">Пончик · список в памяти</span>
                      </div>
                      <div className="homePieFrame">
                        {homeIssuePieChartData.length ? (
                          <ResponsiveContainer width="100%" height={280}>
                            <PieChart margin={{ top: 8, right: 12, bottom: 8, left: 12 }}>
                              <Tooltip formatter={(value, name) => [`${value ?? ""} шт.`, String(name ?? "")]} />
                              <Pie
                                data={homeIssuePieChartData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                innerRadius={74}
                                outerRadius={106}
                                paddingAngle={3}
                                cornerRadius={6}
                                stroke="#fff"
                                strokeWidth={2}
                                animationDuration={600}
                                cursor="pointer"
                                onClick={(d: unknown) => {
                                  const pay =
                                    typeof d === "object" && d !== null && "payload" in d
                                      ? (d as { payload?: { status?: IssueStatus } }).payload
                                      : undefined;
                                  const st = pay?.status;
                                  if (!st) return;
                                  setIssueStatusFilter(st);
                                  setActiveTab("issues");
                                }}
                              >
                                {homeIssuePieChartData.map((entry) => (
                                  <Cell key={entry.status} fill={entry.fill} strokeOpacity={0.94} />
                                ))}
                              </Pie>
                              <Legend layout="horizontal" verticalAlign="bottom" align="center" iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                            </PieChart>
                          </ResponsiveContainer>
                        ) : (
                          <p className="muted homePieEmpty">Нет заявок в текущей выборке — откройте «Выдачи».</p>
                        )}
                        {homeIssuePieChartData.length ? (
                          <div className="homePieFloatingLabel" aria-hidden>
                            <strong>{issues.length}</strong>
                            <span>Всего</span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="homeChartSheet">
                      <div className="homeChartSheetHead">
                        <h4>Опер. день — UTC</h4>
                        <span className="muted">Сверка со сводкой API</span>
                      </div>
                      <ResponsiveContainer width="100%" height={homeTodayOpsBarRows.length ? 296 : 120}>
                        <BarChart data={homeTodayOpsBarRows} margin={{ top: 18, right: 12, left: 0, bottom: 6 }}>
                          <defs>
                            {HOME_TODAY_COLUMN_GRADIENTS.map(([a, b], i) => (
                              <linearGradient key={i} id={`homeTodayColGrad${i}`} x1="0" y1="1" x2="0" y2="0">
                                <stop offset="0%" stopColor={a} stopOpacity={0.88} />
                                <stop offset="100%" stopColor={b} stopOpacity={1} />
                              </linearGradient>
                            ))}
                          </defs>
                          <CartesianGrid strokeDasharray="4 6" vertical={false} stroke="#e8edf5" />
                          <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} interval={0} tickMargin={10} axisLine={{ stroke: "#dfe7f5" }} />
                          <YAxis width={44} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#dfe7f5" }} allowDecimals={false} />
                          <Tooltip formatter={(v: unknown) => [Number(v).toLocaleString("ru-RU"), "Количество"]} />
                          {homeTodayOpsBarRows.length ? (
                            <Bar dataKey="value" radius={[10, 10, 6, 6]} barSize={40} animationDuration={700}>
                              {homeTodayOpsBarRows.map((_, i) => (
                                <Cell key={i} fill={`url(#homeTodayColGrad${i % HOME_TODAY_COLUMN_GRADIENTS.length})`} />
                              ))}
                            </Bar>
                          ) : null}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="homeChartsGridTwo homeChartsBottomRow">
                    <div className="homeChartSheet homeChartSheetRing">
                      <div className="homeChartSheetHead">
                        <h4>Ход лимитов</h4>
                        <span className="muted">Выдано / план объекта</span>
                      </div>
                      <div className="homeRingLayout">
                        <div className="homeRingPieWrap">
                          <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                              <Pie
                                data={homeLimitRingData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                startAngle={100}
                                endAngle={-260}
                                innerRadius={74}
                                outerRadius={104}
                                paddingAngle={0}
                                stroke="none"
                                animationDuration={800}
                              >
                                {homeLimitRingData.map((slice) => (
                                  <Cell key={slice.name} fill={slice.fill} stroke={slice.name === "rest" ? "#f1f5f9" : "none"} />
                                ))}
                              </Pie>
                              <Tooltip formatter={(v: unknown) => [`${Number(v)}%`, "Частка"]} />
                            </PieChart>
                          </ResponsiveContainer>
                          <button
                            type="button"
                            className="homeRingCenterStack"
                            disabled={!canReadLimits}
                            onClick={() => setActiveTab("limits")}
                          >
                            <strong className="homeRingPct">{dashboard.object?.usagePercent ?? 0}%</strong>
                            <span className="muted tiny">
                              {dashboard.object
                                ? `${dashboard.object.issuedQty.toLocaleString("ru-RU")} / ${dashboard.object.plannedQty.toLocaleString("ru-RU")}`
                                : "—"}
                            </span>
                            {canReadLimits ? <span className="homeRingLinkHint">Лимиты →</span> : null}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="homeChartSheet homeChartSheetWide">
                      <div className="homeChartSheetHead">
                        <h4>Пульс контроля и сигналов</h4>
                        <span className="muted">Очередь, склад, перевозки, уведомления</span>
                      </div>
                      <ResponsiveContainer
                        width="100%"
                        height={Math.min(620, Math.max(240, 28 + homeAttentionBarsFull.length * 36))}
                      >
                        <BarChart layout="vertical" data={homeAttentionBarsFull} margin={{ top: 8, right: 28, left: 4, bottom: 8 }}>
                          <defs>
                            {HOME_ATTENTION_BAR_FILLS.map((c, idx) => (
                              <linearGradient key={idx} id={`homeAttnBar${idx}`} x1="0" y1="0.5" x2="1" y2="0.5">
                                <stop offset="0%" stopColor={c} stopOpacity={0.82} />
                                <stop offset="100%" stopColor={c} stopOpacity={0.35} />
                              </linearGradient>
                            ))}
                          </defs>
                          <CartesianGrid strokeDasharray="3 6" horizontal={false} stroke="#eaeef6" />
                          <XAxis
                            type="number"
                            tick={{ fontSize: 11, fill: "#64748b" }}
                            axisLine={{ stroke: "#dfe7f5" }}
                            tickLine={{ stroke: "#dfe7f5" }}
                            allowDecimals={false}
                          />
                          <YAxis
                            type="category"
                            width={148}
                            dataKey="label"
                            tick={{ fontSize: 12, fill: "#334155" }}
                            interval={0}
                            axisLine={{ stroke: "#dfe7f5" }}
                          />
                          <Tooltip formatter={(v: unknown) => [Number(v).toLocaleString("ru-RU"), ""]} />
                          <Bar dataKey="value" radius={[0, 8, 8, 0]} barSize={18} animationDuration={750}>
                            {homeAttentionBarsFull.map((_, i) => (
                              <Cell key={i} fill={`url(#homeAttnBar${i % HOME_ATTENTION_BAR_FILLS.length})`} stroke="#fff" strokeWidth={1} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>
              </>
            )}

            <div className="homeSplit">
              <div className="homeSplitPrimary">
                <section className="card homeWideCard">
                  <div className="rightCardHeader">
                    <h3>Выдачи: доля статусов (текущий список)</h3>
                    <button
                      type="button"
                      className="ghostBtn"
                      onClick={() => {
                        setIssueStatusFilter("");
                        setActiveTab("issues");
                      }}
                    >
                      Все заявки
                    </button>
                  </div>
                  {homeIssueStatusSummary.length ? (
                    <>
                      <div className="homeStackBar">
                        {homeIssueStatusSummary.map((seg) => (
                          <button
                            key={seg.status}
                            type="button"
                            className={`homeStackSegment status-${seg.status}`}
                            style={{ flexGrow: Math.max(seg.count, 1) }}
                            title={`${issueStatusLabel(seg.status)}: ${seg.count}`}
                            onClick={() => {
                              setIssueStatusFilter(seg.status);
                              setActiveTab("issues");
                            }}
                          >
                            <span>{seg.count}</span>
                          </button>
                        ))}
                      </div>
                      <div className="homeStackLegend">
                        {homeIssueStatusSummary.map((seg) => (
                          <button
                            key={seg.status}
                            type="button"
                            className="homeLegendItem"
                            onClick={() => {
                              setIssueStatusFilter(seg.status);
                              setActiveTab("issues");
                            }}
                          >
                            <span className={`badge ${statusClass(seg.status)}`}>{issueStatusLabel(seg.status)}</span>
                            <strong>{seg.count}</strong>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="muted">В выборке нет заявок — откройте вкладку «Выдачи», чтобы загрузить историю.</p>
                  )}
                </section>

                <section className="card homeWideCard">
                  <div className="rightCardHeader">
                    <h3>Быстрые действия</h3>
                  </div>
                  <div className="homeQuickActions">
                    {canWriteOperations ? (
                      <button type="button" className="secondaryBtn homeQuickBtn" onClick={() => setActiveTab("operations")}>
                        Поступление / приёмка
                      </button>
                    ) : null}
                    <button type="button" className="secondaryBtn homeQuickBtn" disabled={!canReadIssues} onClick={() => setActiveTab("issues")}>
                      Новая выдача
                    </button>
                    <button type="button" className="secondaryBtn homeQuickBtn" disabled={!canReadDocuments} onClick={() => setActiveTab("documents")}>
                      Документы объекта
                    </button>
                    <button type="button" className="secondaryBtn homeQuickBtn" disabled={!canReadWaybills} onClick={() => setActiveTab("waybills")}>
                      Перемещения ТТН
                    </button>
                    <button type="button" className="ghostBtn homeQuickBtn" onClick={() => setActiveTab("camp")}>
                      Городок
                    </button>
                  </div>
                </section>
              </div>

              <aside className="homeSplitAside">
                <div className="card approvalCard">
                  <h3>Следующая на согласовании</h3>
                  {approvalQueue[0] ? (
                    <>
                      <p className="muted compactLine">
                        <strong>{approvalQueue[0].number}</strong>
                        {" · "}
                        {approvalQueue[0].requestedBy?.fullName || approvalQueue[0].requestedById}
                      </p>
                      <div className="approvalActions">
                        <button
                          type="button"
                          className="dangerBtn"
                          onClick={() => void executeIssueAction(approvalQueue[0]!.id, "reject", { fromApprovals: true })}
                        >
                          Отклонить
                        </button>
                        <button
                          type="button"
                          onClick={() => void executeIssueAction(approvalQueue[0]!.id, "approve", { fromApprovals: true })}
                        >
                          Принять
                        </button>
                        <button
                          type="button"
                          className="secondaryBtn"
                          onClick={() => void executeIssueAction(approvalQueue[0]!.id, "issue", { fromApprovals: true })}
                        >
                          Выдать
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="muted">На сейчас нет заявок в статусе «На рассмотрении».</p>
                  )}
                </div>

                <div className="card">
                  <div className="rightCardHeader">
                    <h3>Очередь выдачи</h3>
                    <button type="button" className="ghostBtn" onClick={() => setActiveTab("approvals")}>
                      Все
                    </button>
                  </div>
                  <div className="queueList">
                    {(approvalQueue.length ? approvalQueue : issues.filter((i) => i.status !== "ISSUED").slice(0, 6)).map((i) => (
                      <div key={i.id} className="queueItem">
                        <div>
                          <strong>{i.number}</strong>
                          <p className="muted compactLine">{i.requestedBy?.fullName || i.requestedById}</p>
                        </div>
                        <div className="queueActions">
                          <span className={`badge ${statusClass(i.status)}`}>{issueStatusLabel(i.status)}</span>
                          <button
                            type="button"
                            className="miniActionBtn"
                            onClick={() => {
                              setSelectedIssueId(i.id);
                              setDrawerMode("issue");
                            }}
                          >
                            Детали
                          </button>
                        </div>
                      </div>
                    ))}
                    {!approvalQueue.length && !issues.length ? <p className="muted">Очередь пуста</p> : null}
                  </div>
                </div>

                <div className="card">
                  <div className="rightCardHeader">
                    <h3>Приёмки по разделу</h3>
                    <button type="button" className="ghostBtn" disabled={!canReadOperations} onClick={() => setActiveTab("operations")}>
                      Приходы
                    </button>
                  </div>
                  <div className="queueList">
                    {receiptRequests
                      .filter((r) => r.section === objectSectionFilter && r.status !== "RECEIVED" && r.status !== "CANCELLED")
                      .slice(0, 5)
                      .map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className="queueItem homeQueueClick"
                          disabled={!canReadOperations}
                          onClick={() => setActiveTab("operations")}
                        >
                          <span>
                            <strong>{r.number}</strong>
                            <p className="muted compactLine">
                              {(r.detectedProjectTitle || r.detectedOrderNumber || r.sourceFileName || "Excel").slice(0, 60)}
                            </p>
                          </span>
                          <span className={`badge ${r.status === "NEW" ? "neutral" : "warn"}`}>
                            {r.status === "NEW" ? "Новая" : "В работе"}
                          </span>
                        </button>
                      ))}
                    {!canReadOperations ? (
                      <p className="muted">Нет прав на приходы по заявке.</p>
                    ) : !receiptRequests.filter((x) => x.section === objectSectionFilter && x.status !== "RECEIVED" && x.status !== "CANCELLED")
                        .length ? (
                      <p className="muted">Активных приёмок в этом разделе нет.</p>
                    ) : null}
                  </div>
                </div>

                <div className="card">
                  <div className="rightCardHeader">
                    <h3>Недавние заявки</h3>
                    <button type="button" className="ghostBtn" disabled={!canReadIssues} onClick={() => setActiveTab("issues")}>
                      Выдачи
                    </button>
                  </div>
                  <div className="queueList">
                    {issues.slice(0, 6).map((i) => (
                      <button
                        key={i.id}
                        type="button"
                        className="queueItem homeQueueClick"
                        disabled={!canReadIssues}
                        onClick={() => {
                          setSelectedIssueId(i.id);
                          setDrawerMode("issue");
                        }}
                      >
                        <span>{i.number}</span>
                        <strong className={statusClass(i.status)}>{issueStatusLabel(i.status)}</strong>
                      </button>
                    ))}
                    {!issues.length ? <p className="muted">Заявки ещё не загружались.</p> : null}
                  </div>
                </div>
              </aside>
            </div>
          </div>
        )}
      {activeTab === "warehouse" && (
        <div className="card stockPanel">
          <div className="stockPanelHead">
            <div>
              <h2>Склад: материалы и остатки</h2>
              <p className="muted" style={{ margin: "6px 0 0" }}>
                Раздел <strong>{objectSectionFilter === "SS" ? "СС" : "ЭОМ"}</strong>
                {" · "}
                Показано <strong>{warehouseDisplayRows.length}</strong> из {warehouseVisibleRows.length} строк в текущей выборке
              </p>
            </div>
            <PeriodExportButton
              section="stocks"
              token={token}
              apiUrl={API_URL}
              fetchWithSession={fetchWithSession}
              title="Склад в Excel"
            />
          </div>
          <div className="toolbar stockToolbarPrimary">
            {manualStockMessage && !manualStockModalOpen ? (
              <p className="muted" role="status" style={{ gridColumn: "1 / -1", margin: "0 0 6px" }}>
                {manualStockMessage}
              </p>
            ) : null}
            <input
              className="stockSearchWide"
              placeholder="Поиск по материалу, SKU, синониму…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button type="button" className="primaryBtn" onClick={() => void loadStocks(q)}>
              Найти
            </button>
            <button type="button" onClick={() => void loadStockMovements()}>
              Журнал движений
            </button>
            {canWriteOperations && warehouses.length > 0 ? (
              <button
                type="button"
                className="secondaryBtn"
                onClick={() => {
                  setManualStockMessage("");
                  setManualStockModalOpen(true);
                }}
              >
                Добавить материал вручную
              </button>
            ) : null}
            <button
              type="button"
              className={showAttachedMaterials ? "secondaryBtn" : "ghostBtn"}
              onClick={() => setShowAttachedMaterials((v) => !v)}
            >
              {showAttachedMaterials ? "Только лимитные" : "Все материалы"}
            </button>
          </div>
          <div className="tabs" style={{ flexWrap: "wrap", marginTop: 8 }}>
            {(
              [
                ["ALL", "Все"],
                ["MATERIAL", "Основные материалы"],
                ["CONSUMABLE", "Расходники"],
                ["WORKWEAR", "Спецодежда"]
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={stockShelfKindTab === k ? "active" : ""}
                onClick={() => setStockShelfKindTab(k)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="stockFiltersStrip">
            <label>
              Склад
              <select value={stockFilterWarehouseId} onChange={(e) => setStockFilterWarehouseId(e.target.value)}>
                <option value="">Все из ответа</option>
                {stockWarehouseIdsInView.map((wid) => {
                  const nm =
                    warehouses.find((w) => w.id === wid)?.name ||
                    stocks.find((s) => s.warehouseId === wid)?.warehouseName;
                  return (
                    <option key={wid} value={wid}>
                      {safeName(nm || wid.slice(0, 8))}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="toggleLine">
              <input
                type="checkbox"
                checked={stockOnlyAvailable}
                onChange={(e) => setStockOnlyAvailable(e.target.checked)}
              />
              Только с остатком
            </label>
            <label className="toggleLine">
              <input type="checkbox" checked={stockOnlyLow} onChange={(e) => setStockOnlyLow(e.target.checked)} />
              Низкий остаток
            </label>
            <label className="toggleLine">
              <input
                type="checkbox"
                checked={stockOnlyWithFactNames}
                onChange={(e) => setStockOnlyWithFactNames(e.target.checked)}
              />
              Есть фактические названия
            </label>
            <label className="toggleLine">
              <input type="checkbox" checked={showStockSku} onChange={(e) => setShowStockSku(e.target.checked)} /> SKU колонкой
            </label>
            <label className="toggleLine">
              <input type="checkbox" checked={showStockReserve} onChange={(e) => setShowStockReserve(e.target.checked)} /> Резерв
            </label>
            <label className="toggleLine">
              <input
                type="checkbox"
                checked={showStockPrice}
                onChange={(e) => setShowStockPrice(e.target.checked)}
              />{" "}
              Цена за ед.
            </label>
          </div>
          {limitFilterEnabled && (
            <p className="muted">
              В списке показаны только материалы лимитов, которые реально есть на складе. Нулевые позиции из лимитов скрыты.
            </p>
          )}
          {loadingStocks && <p>Загрузка остатков...</p>}
          {stocksError && <p className="error">{stocksError}</p>}
          {!loadingStocks && !stocksError && !warehouseDisplayRows.length && (
            <EmptyState title="По текущим фильтрам ничего не нашлось" hint="Смените фильтры, либо снимите их." />
          )}
          {!loadingStocks && !stocksError && warehouseDisplayRows.length > 0 && (
            <div className="toolsCardGrid" style={{ marginTop: 10 }}>
              {warehouseDisplayRows.map((row) => {
                const isExpanded = expandedStockRowId === row.id;
                const factsCount = materialMappingsByTargetId.get(row.materialId)?.length || 0;
                const acceptedCount = acceptedBySourceByTargetId.get(row.materialId)?.size || 0;
                const kindLabel =
                  row.materialKind === "CONSUMABLE"
                    ? "расходники"
                    : row.materialKind === "WORKWEAR"
                      ? "спецодежда"
                      : "основной";
                return (
                  <article
                    key={`stock-card-${row.id}`}
                    className={`toolMiniCard${row.isLow ? " low" : ""}`}
                    style={{
                      borderLeft: row.isLow ? "4px solid #ef4444" : "4px solid #94a3b8"
                    }}
                  >
                    <div className="toolMiniCardTop">
                      <strong className="toolMiniCardTitle" title={row.materialName}>
                        {safeName(row.materialName)}
                      </strong>
                      <span className={`badge ${row.isLow ? "bad" : "ok"}`}>
                        {Number(row.available).toLocaleString("ru-RU", { maximumFractionDigits: 3 })} {row.materialUnit}
                      </span>
                    </div>
                    <p className="muted toolMiniCardMeta" style={{ fontSize: 12 }}>
                      {safeName(row.warehouseName)} · {kindLabel}
                      {row.materialSku ? ` · ${row.materialSku}` : ""}
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 12, marginTop: 6 }}>
                      <span>
                        <strong>Остаток:</strong> {Number(row.quantity).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                      </span>
                      <span>
                        <strong>Резерв:</strong> {Number(row.reserved).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                      </span>
                      <span>
                        <strong>Помещ.:</strong> {row.storageRoom || "—"}
                      </span>
                      <span>
                        <strong>Ячейка:</strong> {row.storageCell || "—"}
                      </span>
                      {row.unitPrice != null && Number.isFinite(Number(row.unitPrice)) ? (
                        <span style={{ gridColumn: "1 / -1" }}>
                          <strong>Цена за ед.:</strong>{" "}
                          {Number(row.unitPrice).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽
                        </span>
                      ) : null}
                    </div>
                    {(acceptedCount > 0 || factsCount > 0) ? (
                      <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                        фактических названий: {factsCount}
                        {acceptedCount ? ` · принято под разными именами: ${acceptedCount}` : ""}
                      </p>
                    ) : null}
                    <div className="toolbar" style={{ marginTop: 8, gap: 6 }}>
                      <button
                        type="button"
                        className="ghostBtn"
                        onClick={() => {
                          void loadStockMovements();
                          setExpandedStockRowId((prev) => (prev === row.id ? "" : row.id));
                        }}
                      >
                        {isExpanded ? "Свернуть" : "Подробнее"}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="card" style={{ marginTop: 8 }}>
                        {(acceptedCount > 0 || factsCount > 0) ? (
                          <>
                            <h4 style={{ marginTop: 0 }}>Фактические названия</h4>
                            <ul className="plainList">
                              {[...(acceptedBySourceByTargetId.get(row.materialId)?.values() || [])].map((x, i) => (
                                <li key={`actual-q-${row.id}-${i}`}>
                                  <strong>{x.sourceName}</strong> ({x.sourceUnit || row.materialUnit}) — принято{" "}
                                  {x.quantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                                </li>
                              ))}
                              {(materialMappingsByTargetId.get(row.materialId) || [])
                                .filter((m) => {
                                  const bucket = acceptedBySourceByTargetId.get(row.materialId);
                                  return !bucket?.has(`${m.sourceName}|${m.sourceUnit || ""}`);
                                })
                                .map((m) => (
                                  <li key={`actual-${row.id}-${m.id}`}>
                                    {m.sourceName} ({m.sourceUnit || row.materialUnit}) —{" "}
                                    <span className="muted">пока не принято</span>
                                  </li>
                                ))}
                            </ul>
                          </>
                        ) : null}
                        <h4>Движения по позиции</h4>
                        <table>
                          <thead>
                            <tr>
                              <th>Время</th>
                              <th>Тип</th>
                              <th>Кол-во</th>
                              <th>Источник</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(movementSlicesByStockKey.get(`${row.warehouseId}::${row.materialId}`) || []).map((m) => (
                              <tr key={`slice-${m.id}`}>
                                <td>{new Date(m.createdAt).toLocaleString()}</td>
                                <td>{m.direction === "IN" ? "Приход/возврат" : "Выдача"}</td>
                                <td>
                                  {Number.isFinite(Number(m.quantity)) ? Math.round(Number(m.quantity)) : 0}
                                </td>
                                <td>{m.operation?.documentNumber || m.issueRequest?.number || m.sourceDocumentType}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {stockMovementsLoading && <p>Загрузка движений...</p>}
          {stockMovementsError && <p className="error">{stockMovementsError}</p>}
        </div>
      )}

      {activeTab === "camp" && (() => {
        try {
        const categoryLabel: Record<CampItemCategory, string> = {
          CONTAINER: "Контейнер",
          EQUIPMENT: "Техника",
          CABIN: "Бытовка",
          TOOL: "Инструмент",
          OTHER: "Прочее"
        };
        const statusLabel: Record<CampItemStatus, string> = {
          IN_USE: "В эксплуатации",
          STORAGE: "На хранении",
          REPAIR: "В ремонте",
          WRITTEN_OFF: "Списан"
        };
        const statusTone: Record<CampItemStatus, string> = {
          IN_USE: "ok",
          STORAGE: "neutral",
          REPAIR: "warn",
          WRITTEN_OFF: "bad"
        };
        const categoryIcon: Record<CampItemCategory, string> = {
          CONTAINER: "▣",
          EQUIPMENT: "⚙",
          CABIN: "⌂",
          TOOL: "🔧",
          OTHER: "•"
        };
        const safeItems: CampItemRow[] = Array.isArray(campItems) ? campItems : [];
        const filtersActive =
          Boolean(campSearch.trim()) || Boolean(campCategoryFilter) || Boolean(campStatusFilter);
        return (
          <>
            <div className="card">
              <div className="rightCardHeader" style={{ flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h2 style={{ margin: 0 }}>Городок</h2>
                  <p className="muted">
                    Контейнеры, бытовки, техника и прочее имущество городка. Карточки с фото — нажми на карточку,
                    чтобы посмотреть полную информацию, добавить документы и фотографии.
                  </p>
                </div>
                <div className="kpiRow" style={{ margin: 0 }}>
                  <div className="kpi">
                    <span>Всего позиций</span>
                    <strong>{safeItems.length}</strong>
                  </div>
                  <div className="kpi">
                    <span>В эксплуатации</span>
                    <strong>{safeItems.filter((c) => c.status === "IN_USE").length}</strong>
                  </div>
                </div>
              </div>

              {campMessage && (
                <ResultBanner
                  text={campMessage}
                  tone={campMessage.includes("Не удалось") ? "error" : "neutral"}
                />
              )}

              <div className="form docCenterForm" style={{ marginTop: 8 }}>
                <label>
                  Поиск
                  <input
                    value={campSearch}
                    onChange={(e) => setCampSearch(e.target.value)}
                    placeholder="название, инв.№, серийный…"
                  />
                </label>
                <label>
                  Категория
                  <select
                    value={campCategoryFilter}
                    onChange={(e) => setCampCategoryFilter(e.target.value as "" | CampItemCategory)}
                  >
                    <option value="">Все категории</option>
                    {(Object.keys(categoryLabel) as CampItemCategory[]).map((c) => (
                      <option key={c} value={c}>{categoryLabel[c]}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Статус
                  <select
                    value={campStatusFilter}
                    onChange={(e) => setCampStatusFilter(e.target.value as "" | CampItemStatus)}
                  >
                    <option value="">Все статусы</option>
                    {(Object.keys(statusLabel) as CampItemStatus[]).map((s) => (
                      <option key={s} value={s}>{statusLabel[s]}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="toolbar" style={{ flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    resetCampCreateForm();
                    setCampShowAddForm((s) => !s);
                  }}
                >
                  {campShowAddForm ? "Скрыть форму" : "+ Добавить позицию"}
                </button>
                <button type="button" className="ghostBtn" onClick={() => void loadCampItems()}>
                  Обновить
                </button>
                {filtersActive && (
                  <button
                    type="button"
                    className="ghostBtn"
                    onClick={() => {
                      setCampSearch("");
                      setCampCategoryFilter("");
                      setCampStatusFilter("");
                    }}
                  >
                    Сбросить фильтры
                  </button>
                )}
              </div>

              {campShowAddForm && (
                <div className="card" style={{ marginTop: 12 }}>
                  <h3 style={{ marginTop: 0 }}>Новая позиция</h3>
                  <div className="form docCenterForm">
                    <label>
                      Название*
                      <input
                        value={campCreateName}
                        onChange={(e) => setCampCreateName(e.target.value)}
                        placeholder="Контейнер №3, бытовка-вагончик…"
                      />
                    </label>
                    <label>
                      Категория
                      <select
                        value={campCreateCategory}
                        onChange={(e) => setCampCreateCategory(e.target.value as CampItemCategory)}
                      >
                        {(Object.keys(categoryLabel) as CampItemCategory[]).map((c) => (
                          <option key={c} value={c}>{categoryLabel[c]}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Инвентаризационный №
                      <input
                        value={campCreateInv}
                        onChange={(e) => setCampCreateInv(e.target.value)}
                        placeholder="INV-001"
                      />
                    </label>
                    <label>
                      Серийный №
                      <input
                        value={campCreateSerial}
                        onChange={(e) => setCampCreateSerial(e.target.value)}
                      />
                    </label>
                    <label>
                      Производитель
                      <input
                        value={campCreateManufacturer}
                        onChange={(e) => setCampCreateManufacturer(e.target.value)}
                      />
                    </label>
                    <label>
                      Размещение
                      <input
                        value={campCreateLocation}
                        onChange={(e) => setCampCreateLocation(e.target.value)}
                        placeholder="напр. площадка №2"
                      />
                    </label>
                    <label>
                      Статус
                      <select
                        value={campCreateStatus}
                        onChange={(e) => setCampCreateStatus(e.target.value as CampItemStatus)}
                      >
                        {(Object.keys(statusLabel) as CampItemStatus[]).map((s) => (
                          <option key={s} value={s}>{statusLabel[s]}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Фото и документы (можно несколько)
                      <input
                        type="file"
                        multiple
                        accept="image/*,application/pdf"
                        onChange={(e) => setCampCreateFiles(Array.from(e.target.files || []))}
                      />
                      {campCreateFiles.length > 0 && (
                        <span className="muted">
                          Выбрано файлов: {campCreateFiles.length}
                        </span>
                      )}
                    </label>
                    <label style={{ gridColumn: "1 / -1" }}>
                      Описание / заметки
                      <textarea
                        rows={3}
                        value={campCreateDescription}
                        onChange={(e) => setCampCreateDescription(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="toolbar" style={{ flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => void createCampItem()}
                      disabled={campCreating || !campCreateName.trim()}
                    >
                      {campCreating ? "Сохраняем…" : "Сохранить"}
                    </button>
                    <button
                      type="button"
                      className="ghostBtn"
                      onClick={() => {
                        resetCampCreateForm();
                        setCampShowAddForm(false);
                      }}
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>

            {!safeItems.length ? (
              <EmptyState
                title="Городок пока пуст"
                hint="Нажми «+ Добавить позицию», заполни инв.№ и приложи фото — карточка появится здесь."
              />
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                  gap: 14,
                  marginTop: 12
                }}
              >
                {safeItems.map((c) => {
                  const photos = Array.isArray(c.photos) ? c.photos : [];
                  const documents = Array.isArray(c.documents) ? c.documents : [];
                  const cover = photos[0];
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="card"
                      style={{
                        padding: 0,
                        overflow: "hidden",
                        textAlign: "left",
                        cursor: "pointer",
                        border: "1px solid #e5e7eb",
                        background: "var(--card-bg, #fff)"
                      }}
                      onClick={() => setCampSelected(c)}
                    >
                      <div
                        style={{
                          height: 150,
                          background: "linear-gradient(135deg,#f1f5f9,#e2e8f0)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          overflow: "hidden",
                          position: "relative"
                        }}
                      >
                        {cover ? (
                          <img
                            src={`${API_URL}/${cover.filePath}`}
                            alt={c.name}
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          />
                        ) : (
                          <div style={{ fontSize: 48, color: "#94a3b8" }}>
                            {categoryIcon[c.category]}
                          </div>
                        )}
                        <span
                          className={`statusBadge ${statusTone[c.status]}`}
                          style={{ position: "absolute", top: 8, right: 8 }}
                        >
                          {statusLabel[c.status]}
                        </span>
                      </div>
                      <div style={{ padding: 12 }}>
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>{c.name}</div>
                        <div className="muted" style={{ fontSize: 13 }}>
                          {categoryLabel[c.category]}
                          {c.inventoryNumber ? ` · ${c.inventoryNumber}` : ""}
                        </div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                          📷 {photos.length} · 📎 {documents.length}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {campSelected && (() => {
              const sel = campSelected;
              const selPhotos = Array.isArray(sel.photos) ? sel.photos : [];
              const selDocs = Array.isArray(sel.documents) ? sel.documents : [];
              return (
                <div
                  role="dialog"
                  aria-modal="true"
                  style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(15, 23, 42, 0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 60,
                    padding: 16
                  }}
                  onClick={() => setCampSelected(null)}
                >
                  <div
                    className="card"
                    style={{ maxWidth: 880, width: "100%", maxHeight: "90vh", overflowY: "auto" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="rightCardHeader" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                      <div>
                        <h3 style={{ marginTop: 0 }}>{sel.name}</h3>
                        <p className="muted" style={{ margin: 0 }}>
                          {categoryLabel[sel.category]}
                          {sel.inventoryNumber ? ` · инв.№ ${sel.inventoryNumber}` : ""}
                          {sel.serialNumber ? ` · S/N ${sel.serialNumber}` : ""}
                        </p>
                      </div>
                      <div className="toolbar" style={{ flexWrap: "wrap" }}>
                        <select
                          value={sel.status}
                          onChange={(e) => void updateCampItem(sel.id, { status: e.target.value as CampItemStatus })}
                        >
                          {(Object.keys(statusLabel) as CampItemStatus[]).map((s) => (
                            <option key={s} value={s}>{statusLabel[s]}</option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="dangerBtn"
                          onClick={() => void deleteCampItem(sel.id)}
                        >
                          Удалить
                        </button>
                        <button type="button" className="ghostBtn" onClick={() => setCampSelected(null)}>
                          Закрыть
                        </button>
                      </div>
                    </div>

                    {selPhotos.length > 0 ? (
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                          gap: 8,
                          marginTop: 8
                        }}
                      >
                        {selPhotos.map((p) => (
                          <div key={p.id} style={{ position: "relative" }}>
                            <a href={`${API_URL}/${p.filePath}`} target="_blank" rel="noreferrer">
                              <img
                                src={`${API_URL}/${p.filePath}`}
                                alt={p.fileName}
                                style={{
                                  width: "100%",
                                  height: 110,
                                  objectFit: "cover",
                                  borderRadius: 8,
                                  border: "1px solid #e5e7eb"
                                }}
                              />
                            </a>
                            <button
                              type="button"
                              className="ghostBtn"
                              style={{ position: "absolute", top: 4, right: 4, padding: "2px 6px" }}
                              onClick={() => void deleteCampItemFile(sel.id, p.id)}
                              title="Удалить фото"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="muted">Фото пока нет.</p>
                    )}

                    <h4 style={{ marginTop: 16 }}>Информация</h4>
                    <div className="form docCenterForm">
                      <label>
                        Название
                        <input
                          defaultValue={sel.name}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v && v !== sel.name) void updateCampItem(sel.id, { name: v });
                          }}
                        />
                      </label>
                      <label>
                        Категория
                        <select
                          value={sel.category}
                          onChange={(e) =>
                            void updateCampItem(sel.id, { category: e.target.value as CampItemCategory })
                          }
                        >
                          {(Object.keys(categoryLabel) as CampItemCategory[]).map((c) => (
                            <option key={c} value={c}>{categoryLabel[c]}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Инвентаризационный №
                        <input
                          defaultValue={sel.inventoryNumber || ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (sel.inventoryNumber || "")) void updateCampItem(sel.id, { inventoryNumber: v });
                          }}
                        />
                      </label>
                      <label>
                        Серийный №
                        <input
                          defaultValue={sel.serialNumber || ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (sel.serialNumber || "")) void updateCampItem(sel.id, { serialNumber: v });
                          }}
                        />
                      </label>
                      <label>
                        Производитель
                        <input
                          defaultValue={sel.manufacturer || ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (sel.manufacturer || "")) void updateCampItem(sel.id, { manufacturer: v });
                          }}
                        />
                      </label>
                      <label>
                        Размещение
                        <input
                          defaultValue={sel.location || ""}
                          onBlur={(e) => {
                            const v = e.target.value.trim();
                            if (v !== (sel.location || "")) void updateCampItem(sel.id, { location: v });
                          }}
                        />
                      </label>
                      <label style={{ gridColumn: "1 / -1" }}>
                        Описание / заметки
                        <textarea
                          rows={3}
                          defaultValue={sel.description || ""}
                          onBlur={(e) => {
                            const v = e.target.value;
                            if (v !== (sel.description || "")) void updateCampItem(sel.id, { description: v });
                          }}
                        />
                      </label>
                    </div>
                    <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                      Изменения сохраняются автоматически при потере фокуса полем.
                    </p>

                    <h4 style={{ marginTop: 16 }}>Документы</h4>
                    {selDocs.length === 0 ? (
                      <p className="muted">Документов пока нет.</p>
                    ) : (
                      <ul className="plainList">
                        {selDocs.map((d) => (
                          <li
                            key={d.id}
                            style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}
                          >
                            <span>
                              📎{" "}
                              <a href={`${API_URL}/${d.filePath}`} target="_blank" rel="noreferrer">
                                {d.fileName}
                              </a>{" "}
                              <span className="muted">
                                ({d.size ? `${Math.max(1, Math.ceil(d.size / 1024))} КБ` : "—"})
                              </span>
                            </span>
                            <button
                              type="button"
                              className="ghostBtn"
                              onClick={() => void deleteCampItemFile(sel.id, d.id)}
                            >
                              Удалить
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    <h4 style={{ marginTop: 16 }}>Добавить фото / документы</h4>
                    <div className="toolbar" style={{ flexWrap: "wrap", alignItems: "center" }}>
                      <input
                        type="file"
                        multiple
                        accept="image/*,application/pdf"
                        onChange={(e) => setCampDetailFiles(Array.from(e.target.files || []))}
                      />
                      <button
                        type="button"
                        disabled={campDetailUploading || !campDetailFiles.length}
                        onClick={() => void uploadCampItemFiles(sel.id, campDetailFiles)}
                      >
                        {campDetailUploading
                          ? "Загружаем…"
                          : campDetailFiles.length
                          ? `Загрузить (${campDetailFiles.length})`
                          : "Загрузить"}
                      </button>
                    </div>

                    <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
                      Создано: {new Date(sel.createdAt).toLocaleString()}
                      {sel.createdBy ? ` · ${sel.createdBy.fullName}` : ""}
                      {sel.warehouse ? ` · объект: ${sel.warehouse.name}` : ""}
                    </p>
                  </div>
                </div>
              );
            })()}
          </>
        );
        } catch (err) {
          return (
            <div className="card">
              <h2>Городок</h2>
              <p className="error">
                Не удалось отрисовать вкладку: {(err as Error)?.message || String(err)}
              </p>
              <p className="muted">
                Открой консоль браузера (F12 → Console) и пришли скрин — там будет точная ошибка.
              </p>
            </div>
          );
        }
      })()}

      {activeTab === "audit" && canReadAudit && (
        <div className="card">
          <div className="rightCardHeader" style={{ flexWrap: "wrap", gap: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>Логи</h2>
              <p className="muted">
                Действия пользователей по всем объектам системы. Доступные действия можно
                отменить — система автоматически вернёт состояние объекта на момент до изменения.
              </p>
            </div>
            <div className="kpiRow" style={{ margin: 0 }}>
              <div className="kpi">
                <span>Записей</span>
                <strong>{auditLogs.length}</strong>
              </div>
              <div className="kpi">
                <span>Можно отменить</span>
                <strong>{auditLogs.filter((r) => r.revertable && !r.reverted).length}</strong>
              </div>
            </div>
          </div>

          {auditMessage && (
            <ResultBanner
              text={auditMessage}
              tone={auditMessage.includes("Не удалось") ? "error" : "neutral"}
            />
          )}

          <div className="form docCenterForm" style={{ marginTop: 8 }}>
            <label>
              Пользователь
              <select
                value={auditFilterUserId}
                onChange={(e) => setAuditFilterUserId(e.target.value)}
              >
                <option value="">Все пользователи</option>
                {auditMeta.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName || u.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Объект (тип)
              <select
                value={auditFilterEntityType}
                onChange={(e) => setAuditFilterEntityType(e.target.value)}
              >
                <option value="">Все типы</option>
                {auditMeta.entityTypes.map((t) => (
                  <option key={t.entityType} value={t.entityType}>
                    {t.label} ({t.count})
                  </option>
                ))}
              </select>
            </label>
            <label>
              ID объекта
              <input
                value={auditFilterEntityId}
                onChange={(e) => setAuditFilterEntityId(e.target.value)}
                placeholder="точный id…"
              />
            </label>
            <label>
              Поиск
              <input
                value={auditFilterQuery}
                onChange={(e) => setAuditFilterQuery(e.target.value)}
                placeholder="по описанию / имени"
              />
            </label>
            <label>
              С даты
              <input
                type="datetime-local"
                value={auditFilterFrom}
                onChange={(e) => setAuditFilterFrom(e.target.value)}
              />
            </label>
            <label>
              По дату
              <input
                type="datetime-local"
                value={auditFilterTo}
                onChange={(e) => setAuditFilterTo(e.target.value)}
              />
            </label>
          </div>

          <div className="toolbar" style={{ flexWrap: "wrap" }}>
            <label className="toolbar" style={{ gap: 6, padding: 0, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={auditShowReverted}
                onChange={(e) => setAuditShowReverted(e.target.checked)}
              />
              <span>Показывать уже отменённые</span>
            </label>
            <button type="button" className="ghostBtn" onClick={() => void loadAuditLogs()}>
              Обновить
            </button>
            {(auditFilterUserId ||
              auditFilterEntityType ||
              auditFilterEntityId ||
              auditFilterQuery ||
              auditFilterFrom ||
              auditFilterTo ||
              auditShowReverted) && (
              <button
                type="button"
                className="ghostBtn"
                onClick={() => {
                  setAuditFilterUserId("");
                  setAuditFilterEntityType("");
                  setAuditFilterEntityId("");
                  setAuditFilterQuery("");
                  setAuditFilterFrom("");
                  setAuditFilterTo("");
                  setAuditShowReverted(false);
                }}
              >
                Сбросить фильтры
              </button>
            )}
          </div>

          {!auditLogs.length ? (
            <EmptyState
              title="Записей пока нет"
              hint="Действия пользователей появятся здесь автоматически (создание/изменение/удаление объектов)."
            />
          ) : (
            <table style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Пользователь</th>
                  <th>Действие</th>
                  <th>Объект</th>
                  <th>Описание</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((row) => {
                  const busy = Boolean(auditReverting[row.id]);
                  return (
                    <tr
                      key={row.id}
                      style={row.reverted ? { opacity: 0.55, textDecoration: "line-through" } : undefined}
                    >
                      <td>{new Date(row.createdAt).toLocaleString()}</td>
                      <td>{row.user?.fullName || row.userId}</td>
                      <td>{row.actionLabel || row.action}</td>
                      <td>
                        <div>{row.entityLabel || row.entityType}</div>
                        <div className="muted" style={{ fontSize: 11 }}>
                          {row.entityId}
                        </div>
                      </td>
                      <td>
                        <div>{row.summary || "—"}</div>
                        {row.reverted && row.revertedAt && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            Отменено: {new Date(row.revertedAt).toLocaleString()}
                            {row.revertedBy?.fullName ? ` · ${row.revertedBy.fullName}` : ""}
                          </div>
                        )}
                        {Boolean(row.beforeData || row.afterData) && (
                          <details style={{ marginTop: 4 }}>
                            <summary className="muted" style={{ fontSize: 11, cursor: "pointer" }}>
                              JSON-снимок
                            </summary>
                            <pre
                              className="plainList"
                              style={{ whiteSpace: "pre-wrap", fontSize: 11, maxHeight: 200, overflow: "auto" }}
                            >
                              {JSON.stringify({ before: row.beforeData, after: row.afterData }, null, 2)}
                            </pre>
                          </details>
                        )}
                      </td>
                      <td>
                        {row.reverted ? (
                          <span className="muted">отменено</span>
                        ) : row.revertable && canRevertAudit ? (
                          <button
                            type="button"
                            className="dangerBtn"
                            disabled={busy}
                            onClick={() => void revertAuditLog(row.id)}
                          >
                            {busy ? "Отменяем…" : "Отменить"}
                          </button>
                        ) : (
                          <span className="muted" title="Откат этого типа действия пока не поддерживается">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "integrations" && (canReadIntegrations || canReadNotifications) && (
        <div className="card">
          <h2>{canReadIntegrations ? "Интеграции и уведомления" : "Уведомления"}</h2>
          {canReadIntegrations && (
            <>
              <h3 style={{ marginTop: 0 }}>Интеграционные задания</h3>
              <div className="form grid2">
                <label>
                  Тип задания
                  <input value={integrationKind} onChange={(e) => setIntegrationKind(e.target.value)} />
                </label>
                <label>
                  Параметры (JSON)
                  <input value={integrationPayload} onChange={(e) => setIntegrationPayload(e.target.value)} />
                </label>
              </div>
              <div className="toolbar">
                <button type="button" onClick={() => void createIntegrationJob()}>Создать задание</button>
                <button type="button" onClick={() => void loadIntegrationJobs()}>Обновить список</button>
                <button type="button" onClick={() => void loadReadiness()}>Проверка готовности</button>
              </div>
              {integrationMessage && <ErrorState text={integrationMessage} />}
              {readiness ? (
                <ReadinessPanel readiness={readiness} />
              ) : (
                <LoadingState text="Проверка готовности еще не загружена." />
              )}
              {integrationJobs.length ? (
                <IntegrationJobsTable
                  jobs={integrationJobs}
                  statusClass={statusClass}
                  onRun={(id) => {
                    void runIntegrationJob(id);
                  }}
                />
              ) : (
                <EmptyState title="Заданий пока нет." hint="Создай первую integration job и запусти ее." />
              )}
            </>
          )}

          <h3 style={{ marginTop: canReadIntegrations ? 16 : 0 }}>Уведомления</h3>
          {canReadNotifications ? (
            <div className="kpiRow" style={{ flexWrap: "wrap", alignItems: "center" }}>
              <div className="kpi">
                <span>Непрочитано</span>
                <strong>{unreadNotificationCount}</strong>
              </div>
              <p className="muted" style={{ margin: "4px 0 0", flex: "1 1 240px", minWidth: 200 }}>
                Список ниже синхронизируется каждые 2 мин. и при открытии раздела. Клик по строке может открыть связанную
                заявку или операцию.
              </p>
            </div>
          ) : null}
          <div className="toolbar">
            <button type="button" onClick={() => void loadNotifications()}>Обновить уведомления</button>
            <button
              type="button"
              onClick={() => void markNotificationsRead(notifications.filter((n) => !n.isRead).map((n) => n.id))}
            >
              Отметить все как прочитанные
            </button>
          </div>
          {notifications.length ? (
            <NotificationsTable notifications={notifications} onOpenLinked={openNotificationLinkedEntity} />
          ) : (
            <EmptyState title="Уведомлений пока нет." />
          )}
        </div>
      )}

      {activeTab === "notifications" && canReadNotifications && (
        <NotificationsTabBlock
          token={token}
          notifications={notifications}
          unreadNotificationCount={unreadNotificationCount}
          loadNotifications={loadNotifications}
          markNotificationsRead={markNotificationsRead}
          openNotificationLinkedEntity={openNotificationLinkedEntity}
          canManageRules={Boolean(me?.role === "ADMIN" || hasPermission("admin.users.manage") || hasPermission("notifications.rules.manage"))}
          users={users}
          fetchWithSession={fetchWithSession}
          apiUrl={API_URL}
        />
      )}

      {activeTab === "catalog" && (
        <div className="card">
          <h2>Справочники</h2>
          <div className="grid2">
            <div>
              <h3>Создать склад</h3>
              <div className="form">
                <label>
                  Название
                  <input value={warehouseName} onChange={(e) => setWarehouseName(e.target.value)} />
                </label>
                <label>
                  Адрес
                  <input
                    value={warehouseAddress}
                    onChange={(e) => setWarehouseAddress(e.target.value)}
                  />
                </label>
                <button
                  disabled={!canWriteCatalog}
                  onClick={async () => {
                    if (!token) return;
                    setCatalogMessage("");
                    const res = await fetchWithSession(`${API_URL}/api/warehouses`, {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json"
                      },
                      body: JSON.stringify({ name: warehouseName, address: warehouseAddress, isActive: true })
                    });
                    if (!res.ok) {
                      setCatalogMessage("Ошибка создания склада");
                      return;
                    }
                    setCatalogMessage("Склад создан");
                    await loadCatalogData();
                  }}
                >
                  Создать склад
                </button>
              </div>
            </div>

            <div className="card">
              <h3>Материалы</h3>
              <p className="muted">
                Новые позиции заводятся при приёмке и через «Склад» → «Добавить материал вручную». Там же задаются{" "}
                <strong>вид</strong> (основной / расходник / спецодежда) и <strong>цена за единицу</strong>. Правка
                карточки: API <code className="muted">PATCH /api/materials/:id</code> (поля kind, unitPrice).
              </p>
            </div>
          </div>
          {catalogMessage && <p className="muted">{catalogMessage}</p>}
        </div>
      )}

      {activeTab === "operations" && (
        <div className="receiptsWorkspace">
          <div className="tabs" style={{ flexWrap: "wrap", marginBottom: 6 }}>
            <button
              type="button"
              className={operationsSubTab === "materialReceipts" ? "active" : ""}
              onClick={() => setOperationsSubTab("materialReceipts")}
            >
              Приём материалов (Excel)
            </button>
            <button
              type="button"
              className={operationsSubTab === "toolReceipt" ? "active" : ""}
              onClick={() => setOperationsSubTab("toolReceipt")}
            >
              Приход инструмента
            </button>
          </div>

          {operationsSubTab === "materialReceipts" && (
            <>
              <div className="card">
                <div className="rightCardHeader" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <h2 style={{ margin: 0 }}>Приём материалов</h2>
                    <p className="muted">
                  Раздел {objectSectionFilter}. Материал принимается только из заявок (раздел «Заявки»).
                  Здесь отметь галочками позиции, которые принимаешь сейчас, проверь количества — после нажатия «Принять отмеченные»
                  спросим документы (по заявке их может быть несколько приёмок).
                    </p>
                  </div>
              <div className="kpiRow" style={{ margin: 0 }}>
                <div className="kpi">
                  <span>Активных заявок</span>
                  <strong>{receiptRequests.filter((r) => r.status !== "RECEIVED" && r.status !== "CANCELLED").length}</strong>
                </div>
                <div className="kpi">
                  <span>Принято полностью</span>
                  <strong>{receiptRequests.filter((r) => r.status === "RECEIVED").length}</strong>
                </div>
                <PeriodExportButton
                  section="receipts"
                  token={token}
                  apiUrl={API_URL}
                  fetchWithSession={fetchWithSession}
                  title="Поступления в Excel"
                />
              </div>
            </div>

            {opsMessage && (
              <ResultBanner
                text={opsMessage}
                tone={opsMessage.includes("Не удалось") || opsMessage.includes("Ошибка") ? "error" : "neutral"}
              />
            )}
          </div>

          {!receiptRequests.length && (
            <EmptyState
              title="Заявок ещё нет"
              hint="Загрузи Excel-заявку во вкладке «Заявки» — позиции появятся здесь для приёма."
            />
          )}

          {receiptRequests.map((row) => {
            const isExpanded = expandedReceiptIds[row.id] !== false; // по умолчанию открыты
            const totalQty = row.items.reduce((s, it) => s + Number(it.quantity), 0);
            const acceptedQty = row.items.reduce((s, it) => s + Number(it.acceptedQty || 0), 0);
            const donePct = totalQty > 0 ? Math.min(100, Math.round((acceptedQty / totalQty) * 100)) : 0;
            const finished = row.status === "RECEIVED" || row.status === "CANCELLED";
            const drafts = acceptanceDrafts[row.id] || {};
            const linkedTemplate = limitTemplates.find((t) => t.id === row.objectLimitTemplateId);
            // подсказки по фактическим названиям: список материалов из каталога + материалы из привязанного шаблона лимита
            const datalistId = `receipt-mat-suggest-${row.id}`;
            const linkedTplNodes = linkedTemplate?.nodes?.filter((n) => n.nodeType === "MATERIAL") || [];
            return (
              <div key={`receipt-${row.id}`} className="card" style={{ marginTop: 12 }}>
                <div className="rightCardHeader" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="toolbar" style={{ alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                      <h3 style={{ margin: 0 }}>{row.number}</h3>
                      <span
                        className={`badge ${row.status === "RECEIVED" ? "ok" : row.status === "CANCELLED" ? "bad" : ""}`}
                      >
                        {row.status === "NEW"
                          ? "Новая"
                          : row.status === "IN_PROGRESS"
                          ? "Частично принята"
                          : row.status === "RECEIVED"
                          ? "Принята полностью"
                          : "Отменена"}
                      </span>
                      {row.fromLimit && (
                        <span className="badge ok">
                          Из лимита{linkedTemplate ? ` · ${safeName(linkedTemplate.title)}` : ""}
                        </span>
                      )}
                    </div>
                    <p className="muted" style={{ margin: "4px 0 0" }}>
                      {row.section} · позиций {row.items.length} ·{" "}
                      принято {acceptedQty.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} из{" "}
                      {totalQty.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} ({donePct}%)
                      {row.sourceFileName ? ` · файл: ${row.sourceFileName}` : ""}
                    </p>
                    <div className="progressWrap" style={{ width: "100%", marginTop: 6 }}>
                      <div className="progressBar" style={{ width: `${donePct}%` }} />
                    </div>
                  </div>
                  <div className="toolbar" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button
                      type="button"
                      className="ghostBtn"
                      onClick={() => openDocumentsForEntity("receipt", row.id)}
                    >
                      Документы
                    </button>
                    <button
                      type="button"
                      className="ghostBtn"
                      onClick={() => {
                        setLimitPromptTemplateId(row.objectLimitTemplateId || "");
                        setLimitPromptRequest(row);
                      }}
                    >
                      {row.fromLimit ? "Изменить лимит" : "Связать с лимитом"}
                    </button>
                    <button
                      type="button"
                      className="ghostBtn"
                      onClick={() =>
                        setExpandedReceiptIds((prev) => ({ ...prev, [row.id]: !isExpanded }))
                      }
                    >
                      {isExpanded ? "Свернуть" : "Развернуть"}
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <>
                    <datalist id={datalistId}>
                      {materials.map((m) => (
                        <option key={`m-sug-${row.id}-${m.id}`} value={m.name}>
                          {m.unit}
                        </option>
                      ))}
                      {linkedTplNodes.map((n) => (
                        <option key={`lim-sug-${row.id}-${n.id}`} value={String(n.materialName || n.title)}>
                          {n.unit || ""}
                        </option>
                      ))}
                    </datalist>

                    {(() => {
                      const itemsLeft = row.items.filter(
                        (it) => Math.max(0, Number(it.quantity) - Number(it.acceptedQty || 0)) > 0
                      );
                      const selectedCount = itemsLeft.filter((it) => {
                        const q = Number((drafts[it.id]?.qty ?? "").toString().replace(",", "."));
                        return Number.isFinite(q) && q > 0;
                      }).length;
                      const allSelected = itemsLeft.length > 0 && selectedCount === itemsLeft.length;
                      const someSelected = selectedCount > 0;
                      const setSelectAll = (checked: boolean) => {
                        setAcceptanceDrafts((prev) => {
                          const next: typeof prev = { ...prev, [row.id]: { ...(prev[row.id] || {}) } };
                          for (const it of itemsLeft) {
                            const remaining = Math.max(
                              0,
                              Number(it.quantity) - Number(it.acceptedQty || 0)
                            );
                            const existing = next[row.id][it.id] || { newName: "", newUnit: "", qty: "" };
                            next[row.id][it.id] = checked
                              ? {
                                  newName: existing.newName || it.mappedMaterial?.name || it.sourceName,
                                  newUnit:
                                    existing.newUnit || it.mappedMaterial?.unit || it.sourceUnit || "шт",
                                  qty: existing.qty && Number(existing.qty) > 0 ? existing.qty : String(remaining)
                                }
                              : { ...existing, qty: "" };
                          }
                          return next;
                        });
                      };

                      return (
                        <>
                          <div className="form" style={{ marginTop: 10 }}>
                            <label>
                              Номер документа УПД / ТН (опционально)
                              <input
                                value={acceptanceDocNumbers[row.id] || ""}
                                onChange={(e) =>
                                  setAcceptanceDocNumbers((prev) => ({ ...prev, [row.id]: e.target.value }))
                                }
                                placeholder={`По умолчанию: ${row.number}`}
                                disabled={finished}
                              />
                            </label>
                          </div>

                          <div className="toolbar" style={{ marginTop: 6, flexWrap: "wrap" }}>
                            <label
                              className="toolbar"
                              style={{ gap: 6, alignItems: "center", padding: 0, cursor: "pointer" }}
                            >
                              <input
                                type="checkbox"
                                checked={allSelected}
                                ref={(el) => {
                                  if (el) el.indeterminate = !allSelected && someSelected;
                                }}
                                onChange={(e) => setSelectAll(e.target.checked)}
                                disabled={finished || !itemsLeft.length}
                              />
                              <span>
                                {allSelected
                                  ? "Снять все"
                                  : someSelected
                                  ? `Выбрано ${selectedCount} из ${itemsLeft.length}`
                                  : "Выбрать все оставшиеся"}
                              </span>
                            </label>
                          </div>

                          <div className="desktopTable" style={{ overflowX: "auto", marginTop: 8 }}>
                            <table>
                              <thead>
                                <tr>
                                  <th style={{ width: 36 }}>✓</th>
                                  <th>Название из заявки</th>
                                  <th>Принято / план</th>
                                  <th>Название по УПД</th>
                                  <th>Ед.</th>
                                  <th>Принять сейчас</th>
                                  {row.objectLimitTemplateId ? <th>Узел лимита</th> : null}
                                </tr>
                              </thead>
                              <tbody>
                                {row.items.map((it) => {
                                  const total = Number(it.quantity);
                                  const accepted = Number(it.acceptedQty || 0);
                                  const remaining = Math.max(0, total - accepted);
                                  const draft = drafts[it.id] || { newName: "", newUnit: "", qty: "" };
                                  const defaultName =
                                    draft.newName || it.mappedMaterial?.name || it.sourceName;
                                  const defaultUnit =
                                    draft.newUnit || it.mappedMaterial?.unit || it.sourceUnit || "шт";
                                  const fullyAccepted = remaining <= 1e-6;
                                  const isPicked =
                                    Number(draft.qty || 0) > 0 || (draft.qty || "").trim() !== "";
                                  const toggle = (checked: boolean) =>
                                    setAcceptanceDrafts((prev) => ({
                                      ...prev,
                                      [row.id]: {
                                        ...prev[row.id],
                                        [it.id]: checked
                                          ? {
                                              newName: prev[row.id]?.[it.id]?.newName || defaultName,
                                              newUnit: prev[row.id]?.[it.id]?.newUnit || defaultUnit,
                                              qty:
                                                prev[row.id]?.[it.id]?.qty &&
                                                Number(prev[row.id]?.[it.id]?.qty) > 0
                                                  ? prev[row.id][it.id]!.qty
                                                  : String(remaining),
                                              limitNodeId: prev[row.id]?.[it.id]?.limitNodeId
                                            }
                                          : {
                                              newName: prev[row.id]?.[it.id]?.newName || "",
                                              newUnit: prev[row.id]?.[it.id]?.newUnit || "",
                                              qty: "",
                                              limitNodeId: prev[row.id]?.[it.id]?.limitNodeId
                                            }
                                      }
                                    }));
                                  return (
                                    <tr
                                      key={it.id}
                                      style={{
                                        background: isPicked ? "rgba(34, 197, 94, 0.08)" : undefined,
                                        opacity: fullyAccepted ? 0.55 : 1
                                      }}
                                    >
                                      <td>
                                        <input
                                          type="checkbox"
                                          checked={isPicked}
                                          disabled={finished || fullyAccepted}
                                          onChange={(e) => toggle(e.target.checked)}
                                        />
                                      </td>
                                      <td style={{ maxWidth: 280 }}>{it.sourceName}</td>
                                      <td>
                                        {accepted.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} /{" "}
                                        {total.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}{" "}
                                        <span className="muted">{it.sourceUnit || "шт"}</span>
                                      </td>
                                      <td>
                                        <input
                                          list={datalistId}
                                          value={defaultName}
                                          placeholder="Как в УПД…"
                                          disabled={finished || fullyAccepted}
                                          onChange={(e) =>
                                            setAcceptanceDrafts((prev) => ({
                                              ...prev,
                                              [row.id]: {
                                                ...prev[row.id],
                                                [it.id]: {
                                                  newName: e.target.value,
                                                  newUnit: prev[row.id]?.[it.id]?.newUnit || "",
                                                  qty: prev[row.id]?.[it.id]?.qty || "",
                                                  limitNodeId: prev[row.id]?.[it.id]?.limitNodeId
                                                }
                                              }
                                            }))
                                          }
                                        />
                                      </td>
                                      <td style={{ width: 90 }}>
                                        <input
                                          value={defaultUnit}
                                          placeholder={it.sourceUnit || "шт"}
                                          disabled={finished || fullyAccepted}
                                          onChange={(e) =>
                                            setAcceptanceDrafts((prev) => ({
                                              ...prev,
                                              [row.id]: {
                                                ...prev[row.id],
                                                [it.id]: {
                                                  newName: prev[row.id]?.[it.id]?.newName || "",
                                                  newUnit: e.target.value,
                                                  qty: prev[row.id]?.[it.id]?.qty || "",
                                                  limitNodeId: prev[row.id]?.[it.id]?.limitNodeId
                                                }
                                              }
                                            }))
                                          }
                                        />
                                      </td>
                                      <td style={{ width: 130 }}>
                                        <input
                                          type="number"
                                          min={0}
                                          step={0.001}
                                          max={remaining || undefined}
                                          value={draft.qty}
                                          disabled={finished || fullyAccepted}
                                          placeholder={remaining ? String(remaining) : ""}
                                          onChange={(e) =>
                                            setAcceptanceDrafts((prev) => ({
                                              ...prev,
                                              [row.id]: {
                                                ...prev[row.id],
                                                [it.id]: {
                                                  newName: prev[row.id]?.[it.id]?.newName || "",
                                                  newUnit: prev[row.id]?.[it.id]?.newUnit || "",
                                                  qty: e.target.value,
                                                  limitNodeId: prev[row.id]?.[it.id]?.limitNodeId
                                                }
                                              }
                                            }))
                                          }
                                        />
                                      </td>
                                      {row.objectLimitTemplateId ? (
                                        <td style={{ minWidth: 220 }}>
                                          {(() => {
                                            const suggestions =
                                              limitSuggestions[row.id]?.items.find((x) => x.itemId === it.id)
                                                ?.suggestions || [];
                                            const value = draft.limitNodeId || "";
                                            if (suggestions.length === 0) {
                                              return (
                                                <span className="muted" style={{ fontSize: 12 }}>
                                                  узел не найден — приём пройдёт без привязки
                                                </span>
                                              );
                                            }
                                            return (
                                              <select
                                                value={value}
                                                disabled={finished || fullyAccepted}
                                                onChange={(e) =>
                                                  setAcceptanceDrafts((prev) => ({
                                                    ...prev,
                                                    [row.id]: {
                                                      ...prev[row.id],
                                                      [it.id]: {
                                                        newName: prev[row.id]?.[it.id]?.newName || "",
                                                        newUnit: prev[row.id]?.[it.id]?.newUnit || "",
                                                        qty: prev[row.id]?.[it.id]?.qty || "",
                                                        limitNodeId: e.target.value || undefined
                                                      }
                                                    }
                                                  }))
                                                }
                                              >
                                                <option value="">— без узла —</option>
                                                {suggestions.map((s) => (
                                                  <option key={s.id} value={s.id}>
                                                    {s.path || s.title}
                                                  </option>
                                                ))}
                                              </select>
                                            );
                                          })()}
                                        </td>
                                      ) : null}
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>

                          <div className="toolbar" style={{ marginTop: 10, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              onClick={() => {
                                setPendingAcceptanceFiles([]);
                                setPendingAcceptanceRequestId(row.id);
                              }}
                              disabled={finished || !canWriteOperations || !someSelected || Boolean(acceptanceSubmitting[row.id])}
                            >
                              {acceptanceSubmitting[row.id]
                                ? "Принимаем…"
                                : someSelected
                                ? `Принять отмеченные (${selectedCount})`
                                : "Принять отмеченные"}
                            </button>
                            <button
                              type="button"
                              className="ghostBtn"
                              onClick={() =>
                                setAcceptanceDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[row.id];
                                  return next;
                                })
                              }
                              disabled={finished || !someSelected}
                            >
                              Снять выбор
                            </button>
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            );
          })}

          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Последние приходы</h3>
            <p className="muted">Каждая приёмка по заявке создаёт операцию INCOME — здесь видна история и прикреплённые сканы.</p>
            <table className="desktopTable">
              <thead>
                <tr><th>Документ</th><th>Дата</th><th>Файлы</th></tr>
              </thead>
              <tbody>
                {operations.filter((o) => o.type === "INCOME").slice(0, 20).map((o) => (
                  <tr key={o.id}>
                    <td>{o.documentNumber || o.id.slice(0, 8)}</td>
                    <td>{o.operationDate ? new Date(o.operationDate).toLocaleString() : "-"}</td>
                    <td><button type="button" className="ghostBtn" onClick={() => openDocumentsForEntity("operation", o.id)}>Документы</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mobileCards">
              {operations.filter((o) => o.type === "INCOME").slice(0, 20).map((o) => (
                <article key={`m-op-${o.id}`} className="mobileCard">
                  <h4>{o.documentNumber || o.id.slice(0, 8)}</h4>
                  <p><strong>Дата:</strong> {o.operationDate ? new Date(o.operationDate).toLocaleString() : "-"}</p>
                  <button type="button" onClick={() => openDocumentsForEntity("operation", o.id)}>Документы</button>
                </article>
              ))}
            </div>
          </div>
            </>
          )}

          {operationsSubTab === "toolReceipt" && (
            <div className="card toolReceiptComposer">
              <div className="rightCardHeader" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0 }}>Оприходовать инструмент</h2>
                  <p className="muted" style={{ margin: "6px 0 0", maxWidth: 720 }}>
                    Единичная позиция: карточка инструмента на выбранном объекте, QR-код и запись CREATE в журнале. После этого выдаётся через вкладку «Выдачи → Инструмент».
                  </p>
                  <p className="muted" style={{ marginTop: 4 }}>
                    Склад:{" "}
                    {activeObjectId ? safeName(availableObjects.find((o) => o.id === activeObjectId)?.name || "") || activeObjectId : "не выбран"} · раздел {objectSectionFilter}
                  </p>
                </div>
              </div>
              {opsMessage ? (
                <ResultBanner
                  text={opsMessage}
                  tone={opsMessage.includes("Не удалось") || opsMessage.includes("Ошибка") ? "error" : "neutral"}
                />
              ) : null}
              <div className="form grid2" style={{ marginTop: 8 }}>
                <label>
                  Наименование
                  <input value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="Например, перфоратор" />
                </label>
                <label>
                  Инвентарный номер
                  <input value={toolInventoryNumber} onChange={(e) => setToolInventoryNumber(e.target.value)} />
                </label>
                <label>
                  Серийный номер (если есть)
                  <input value={toolSerialNumber} onChange={(e) => setToolSerialNumber(e.target.value)} />
                </label>
                <label>
                  Объект (склад)
                  <select value={toolWarehouseId} disabled>
                    <option value="">Не указан</option>
                    {warehouses
                      .filter((w) => (activeObjectId ? w.id === activeObjectId : true))
                      .map((w) => (
                        <option key={w.id} value={w.id}>
                          {safeName(w.name)}
                        </option>
                      ))}
                  </select>
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  Примечание
                  <input
                    value={toolReceiptNote}
                    onChange={(e) => setToolReceiptNote(e.target.value)}
                    placeholder="Состояние, комплектность..."
                  />
                </label>
              </div>
              <div className="toolbar" style={{ flexWrap: "wrap", marginTop: 6 }}>
                <button
                  type="button"
                  className="primaryBtn"
                  disabled={!toolName.trim() || !toolInventoryNumber.trim()}
                  onClick={async () => {
                    if (!token || !toolName.trim() || !toolInventoryNumber.trim()) return;
                    setOpsMessage("");
                    const res = await fetchWithSession(`${API_URL}/api/tools`, {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                      body: JSON.stringify({
                        name: toolName.trim(),
                        inventoryNumber: toolInventoryNumber.trim(),
                        serialNumber: toolSerialNumber.trim() || undefined,
                        warehouseId: toolWarehouseId || undefined,
                        section: objectSectionFilter,
                        note: toolReceiptNote.trim() || undefined
                      })
                    });
                    if (!res.ok) {
                      const text = await res.text();
                      setOpsMessage(`Не удалось создать инструмент: ${text}`);
                      return;
                    }
                    setOpsMessage(`Инструмент «${safeName(toolName.trim())}» зарегистрирован на складе.`);
                    setToolInventoryNumber(`INV-${Date.now()}`);
                    setToolSerialNumber("");
                    setToolReceiptNote("");
                    await loadTools().catch(() => undefined);
                  }}
                >
                  Зарегистрировать на складе
                </button>
                <button type="button" className="ghostBtn" onClick={() => setActiveTab("tools")}>
                  Открыть «Инструменты»
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "issues" && (
        <div className="issuesWorkspace">
          <div className="card issueComposer">
            <div className="rightCardHeader" style={{ alignItems: "flex-start", gap: 12 }}>
              <div>
                <h2>Выдачи со склада</h2>
                <p className="muted">
                  {issueIssuesDomain === "TOOLS"
                    ? "Инструмент · "
                    : issueIssuesDomain === "CONSUMABLES"
                      ? "Расходники · "
                      : issueIssuesDomain === "WORKWEAR"
                        ? "Спецодежда · "
                        : "Материалы · "}
                  раздел {objectSectionFilter}
                  {activeObjectId ? ` · ${safeName(availableObjects.find((o) => o.id === activeObjectId)?.name || "")}` : ""}
                </p>
              </div>
              <div className="kpiRow" style={{ margin: 0 }}>
                {issueIssuesDomain !== "TOOLS" ? (
                  <>
                    <div className="kpi">
                      <span>В корзине</span>
                      <strong>{issuePickCart.length}</strong>
                    </div>
                    <div className="kpi">
                      <span>Вариантов на складе</span>
                      <strong>{issueFacingRows.length}</strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="kpi">
                      <span>К выдаче</span>
                      <strong>{issueToolPickIds.length}</strong>
                    </div>
                    <div className="kpi">
                      <span>В каталоге (на складе)</span>
                      <strong>{issueToolCatalog.length}</strong>
                    </div>
                  </>
                )}
                <div className="kpi">
                  <span>В списке истории</span>
                  <strong>{issuesTotal}</strong>
                </div>
                <PeriodExportButton
                  section="issues"
                  token={token}
                  apiUrl={API_URL}
                  fetchWithSession={fetchWithSession}
                  title="Выдачи в Excel"
                />
              </div>
            </div>

            {issuesMessage && <ResultBanner text={issuesMessage} tone={issuesTone} />}

            <div className="tabs" style={{ flexWrap: "wrap", marginTop: 2 }}>
              <button
                type="button"
                className={issueIssuesDomain === "MATERIALS" ? "active" : ""}
                onClick={() => {
                  setIssueIssuesDomain("MATERIALS");
                  setIssuesPage(1);
                  setIssueToolPickIds([]);
                  setIssuePickCart([]);
                  setIssuePickQtyByKey({});
                }}
              >
                Материалы
              </button>
              <button
                type="button"
                className={issueIssuesDomain === "CONSUMABLES" ? "active" : ""}
                onClick={() => {
                  setIssueIssuesDomain("CONSUMABLES");
                  setIssuesPage(1);
                  setIssueToolPickIds([]);
                  setIssuePickCart([]);
                  setIssuePickQtyByKey({});
                }}
              >
                Расходники
              </button>
              <button
                type="button"
                className={issueIssuesDomain === "WORKWEAR" ? "active" : ""}
                onClick={() => {
                  setIssueIssuesDomain("WORKWEAR");
                  setIssuesPage(1);
                  setIssueToolPickIds([]);
                  setIssuePickCart([]);
                  setIssuePickQtyByKey({});
                }}
              >
                Спецодежда
              </button>
              <button
                type="button"
                className={issueIssuesDomain === "TOOLS" ? "active" : ""}
                onClick={() => {
                  setIssueIssuesDomain("TOOLS");
                  setIssuesPage(1);
                  setIssuePickCart([]);
                  setIssuePickQtyByKey({});
                }}
              >
                Инструмент
              </button>
            </div>

            <div className="grid2 issueRecipients">
              <label>
                Ответственное лицо
                <input
                  list="issueResponsibleSuggest"
                  autoComplete="off"
                  value={issueResponsible}
                  onChange={(e) => {
                    setIssueResponsible(e.target.value);
                    if (!issueActualRecipient.trim()) {
                      setIssueActualRecipient(e.target.value);
                    }
                  }}
                  placeholder="Начните вводить ФИО — выберите из списка"
                />
              </label>
              <label>
                Фактическое лицо
                <input
                  list="issueResponsibleSuggest"
                  autoComplete="off"
                  value={issueActualRecipient}
                  onChange={(e) => setIssueActualRecipient(e.target.value)}
                  placeholder="ФИО получателя (попадёт в акт)"
                />
              </label>
              <datalist id="issueResponsibleSuggest">
                {chatUsers.map((emp) => (
                  <option key={`emp-suggest-${emp.id}`} value={emp.fullName}>
                    {roleLabel(emp.role)}
                    {emp.position ? ` · ${emp.position}` : ""}
                  </option>
                ))}
              </datalist>
            </div>

            {issueIssuesDomain !== "TOOLS" && (
              <>
            <div className="issuePicker">
              <div className="rightCardHeader" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <h3 style={{ margin: 0 }}>Что выдавать</h3>
                  <p className="muted" style={{ margin: "4px 0 0" }}>
                    Сначала строки из <strong>фактических названий</strong> (УПД/сопоставления). Если названий несколько —
                    они развёрнуты отдельно; остаток один на номенклатуру карточки.
                  </p>
                </div>
                <span className="muted">
                  Строк:{issueFacingRowsFiltered.length}/{issueFacingRows.length}
                </span>
              </div>
              <input
                className="issueSearchInput"
                placeholder="Поиск по фактическому названию, карточке, SKU, ед. изм…"
                value={issueMaterialSearch}
                onChange={(e) => setIssueMaterialSearch(e.target.value)}
              />
              <div className="issueMaterialList">
                {(() => {
                  const rows = issueFacingRowsFiltered.slice(0, 250);
                  if (!rows.length) {
                    return (
                      <p className="muted">
                        Нет позиций с остатком или нет совпадений по поиску. Загрузите остатки и убедитесь, что есть
                        сопоставления/приходы по заявкам.
                      </p>
                    );
                  }
                  return rows.map((r) => {
                    const selected = issuePickCart.some((p) => p.pickKey === r.pickKey);
                    const title = r.factLabel ? safeName(r.factLabel) : safeName(r.canonName);
                    return (
                      <button
                        type="button"
                        key={r.pickKey}
                        className={`issueMaterialRow ${selected ? "selected" : ""}`}
                        onClick={() => toggleIssuePickRow(r)}
                      >
                        <div className="issueMaterialInfo">
                          <strong>{title}</strong>
                          <span className="muted">
                            {r.unit}
                            {r.sku ? ` · ${r.sku}` : ""}
                            {r.factLabel && safeName(r.factLabel) !== safeName(r.canonName)
                              ? ` · карточка: ${safeName(r.canonName)}`
                              : ""}
                          </span>
                          {typeof r.acceptedQty === "number" && r.acceptedQty > 0 ? (
                            <span className="muted" style={{ fontSize: 12 }}>
                              принято под этим названием:{" "}
                              {r.acceptedQty.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} {r.unit}
                            </span>
                          ) : null}
                        </div>
                        <div className="issueMaterialMeta">
                          <span className="badge ok">
                            {r.available.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} {r.unit}{" "}
                            <span className="muted" style={{ fontWeight: 400 }}>
                              на карточку
                            </span>
                          </span>
                          <span className="muted">{selected ? "В корзине" : "Добавить"}</span>
                        </div>
                      </button>
                    );
                  });
                })()}
              </div>
            </div>

            {issuePickCart.length > 0 && (
              <div className="issueCart">
                <h3>Подобрано к выдаче</h3>
                <div className="issueCartList">
                  {issuePickCart.map((row) => {
                    const qty = Number(issuePickQtyByKey[row.pickKey] ?? 1);
                    const stockRow = stocks.find(
                      (s) => s.materialId === row.materialId && s.warehouseId === activeObjectId
                    );
                    const totalSameMaterial = issuePickCart
                      .filter((c) => c.materialId === row.materialId)
                      .reduce((acc, c) => acc + Number(issuePickQtyByKey[c.pickKey] ?? 1), 0);
                    const exceeds = stockRow ? totalSameMaterial > stockRow.available : false;
                    const lineTitle = row.factLabel ? safeName(row.factLabel) : safeName(row.canonName);
                    return (
                      <div key={`cart-${row.pickKey}`} className={`issueCartRow ${exceeds ? "warn" : ""}`}>
                        <div className="issueCartName">
                          <strong>{lineTitle}</strong>
                          <span className="muted">
                            {row.unit} · доступно по карточке{" "}
                            {stockRow?.available.toLocaleString("ru-RU", { maximumFractionDigits: 3 }) ?? "—"}
                            {row.factLabel ? ` · номенклатура: ${safeName(row.canonName)}` : ""}
                          </span>
                        </div>
                        <div className="issueCartControls">
                          <button
                            type="button"
                            className="ghostBtn iconBtn"
                            onClick={() =>
                              setIssuePickQtyByKey((prev) => ({
                                ...prev,
                                [row.pickKey]: Math.max(0.001, Number((qty - 1).toFixed(3)))
                              }))
                            }
                            aria-label="Уменьшить"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={0.001}
                            step={0.001}
                            value={qty}
                            onChange={(e) =>
                              setIssuePickQtyByKey((prev) => ({
                                ...prev,
                                [row.pickKey]: Number(e.target.value)
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="ghostBtn iconBtn"
                            onClick={() =>
                              setIssuePickQtyByKey((prev) => ({
                                ...prev,
                                [row.pickKey]: Number((qty + 1).toFixed(3))
                              }))
                            }
                            aria-label="Увеличить"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className="ghostBtn"
                            onClick={() => {
                              setIssuePickCart((prev) => prev.filter((p) => p.pickKey !== row.pickKey));
                              setIssuePickQtyByKey((prev) => {
                                const next = { ...prev };
                                delete next[row.pickKey];
                                return next;
                              });
                            }}
                          >
                            Убрать
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {(issueIssuesDomain === "MATERIALS" ||
              issueIssuesDomain === "CONSUMABLES" ||
              issueIssuesDomain === "WORKWEAR") && (
              <label className="muted" style={{ display: "block", marginTop: 10, fontSize: 13 }}>
                Вложение подписанного акта при прямой выдаче (необязательно)
                <input
                  type="file"
                  accept="image/*,.pdf,application/pdf"
                  style={{ marginTop: 6 }}
                  disabled={issueSubmitting}
                  onChange={(e) => setDirectIssueSignedFile(e.target.files?.[0] ?? null)}
                />
              </label>
            )}

            <div className="issueActionBar">
              <button
                type="button"
                className="ghostBtn"
                disabled={issueSubmitting}
                onClick={() => void performDirectIssue({ openDocument: true })}
              >
                Сформировать передаточный документ
              </button>
              <button
                type="button"
                className="primaryBtn"
                disabled={issueSubmitting}
                onClick={() => void performDirectIssue()}
              >
                {issueSubmitting
                  ? "Выдача..."
                  : issueIssuesDomain === "WORKWEAR"
                    ? "Выдать спецодежду"
                    : issueIssuesDomain === "CONSUMABLES"
                      ? "Выдать расходники"
                      : "Выдать материал"}
              </button>
            </div>
              </>
            )}
            {issueIssuesDomain === "TOOLS" && (
              <div className="issueToolComposer">
                <div className="rightCardHeader" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div>
                    <h3 style={{ margin: 0 }}>Инструмент на складе</h3>
                    <p className="muted" style={{ margin: "4px 0 0" }}>
                      Только статус «на складе» и тот же раздел объекта. Проведение создаёт акт выдачи инструмента и событие в журнале.
                    </p>
                  </div>
                  {issueToolCatalogLoading ? <span className="muted">Загрузка...</span> : null}
                </div>
                <input
                  className="issueSearchInput"
                  placeholder="Поиск по названию или инв. номеру…"
                  value={issueToolSearch}
                  onChange={(e) => setIssueToolSearch(e.target.value)}
                />
                <div className="issueMaterialList">
                  {!activeObjectId ? (
                    <p className="muted">Выберите объект склада вверху страницы.</p>
                  ) : issueToolCatalog.length === 0 && !issueToolCatalogLoading ? (
                    <p className="muted">Нет доступного инструмента на этом объекте в статусе «на складе».</p>
                  ) : (
                    issueToolCatalog.map((t) => {
                      const picked = issueToolPickIds.includes(t.id);
                      return (
                        <button
                          type="button"
                          key={`issue-tool-${t.id}`}
                          className={`issueMaterialRow ${picked ? "selected" : ""}`}
                          disabled={!picked && t.status !== "IN_STOCK"}
                          onClick={() => {
                            if (picked) {
                              setIssueToolPickIds((prev) => prev.filter((id) => id !== t.id));
                            } else if (t.status === "IN_STOCK") {
                              setIssueToolPickIds((prev) => [...prev, t.id]);
                            }
                          }}
                        >
                          <div className="issueMaterialInfo">
                            <strong>{safeName(t.name)}</strong>
                            <span className="muted">
                              инв.&nbsp;{t.inventoryNumber}
                              {t.serialNumber ? ` · с/н ${t.serialNumber}` : ""}
                            </span>
                          </div>
                          <div className="issueMaterialMeta">
                            <span className={`badge ${statusClass(t.status)}`}>{toolStatusLabel(t.status)}</span>
                            <span className="muted">{picked ? "В списке" : t.status === "IN_STOCK" ? "Добавить" : "—"}</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
                {issueToolPickIds.length > 0 && (
                  <div className="issueCart">
                    <h3>Подобрано к выдаче</h3>
                    <div className="issueCartList">
                      {issueToolPickIds.map((id) => {
                        const row = issueToolCatalog.find((x) => x.id === id);
                        const label = row ? `${row.inventoryNumber} · ${safeName(row.name)}` : id.slice(0, 8);
                        return (
                          <div key={`tool-pick-${id}`} className="issueCartRow">
                            <div className="issueCartName">
                              <strong>{label}</strong>
                            </div>
                            <div className="issueCartControls">
                              <button type="button" className="ghostBtn" onClick={() => setIssueToolPickIds((p) => p.filter((x) => x !== id))}>
                                Убрать
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <label className="muted" style={{ display: "block", marginTop: 10, fontSize: 13 }}>
                  Подписанный акт по выдаче инструмента (необязательно)
                  <input
                    type="file"
                    accept="image/*,.pdf,application/pdf"
                    style={{ marginTop: 6 }}
                    disabled={issueSubmitting}
                    onChange={(e) => setDirectIssueSignedFile(e.target.files?.[0] ?? null)}
                  />
                </label>
                <div className="issueActionBar">
                  <button
                    type="button"
                    className="ghostBtn"
                    disabled={issueSubmitting}
                    onClick={() => void performDirectToolIssue({ openDocument: true })}
                  >
                    Акт инструмента (PDF)
                  </button>
                  <button type="button" className="primaryBtn" disabled={issueSubmitting} onClick={() => void performDirectToolIssue()}>
                    {issueSubmitting ? "Выдача..." : "Выдать инструмент"}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="card issueHistory">
            <div className="rightCardHeader" style={{ alignItems: "center", gap: 8 }}>
              <h3 style={{ margin: 0 }}>История выдачи</h3>
              <input
                placeholder="Поиск по номеру..."
                value={issueSearch}
                onChange={(e) => setIssueSearch(e.target.value)}
                style={{ maxWidth: 240 }}
              />
              <button type="button" className="ghostBtn" onClick={() => void loadIssues()}>
                Обновить
              </button>
            </div>
            {issuesLoading && <LoadingState text="Загрузка выдач..." />}
            {issuesError && <ErrorState text={issuesError} />}
            {!issuesLoading && !issuesError && !issues.length && (
              <EmptyState
                title="В этой вкладке пока нет записей"
                hint={
                  issueIssuesDomain === "TOOLS"
                    ? "Выберите инструмент из списка «на складе» и нажмите «Выдать инструмент»."
                    : "Подберите материалы в композере и нажмите «Выдать материал»."
                }
              />
            )}
            {!issuesLoading && !issuesError && issues.length > 0 && (
              <>
                <table className="desktopTable issueHistoryTable">
                  <thead>
                    <tr>
                      <th>Номер</th>
                      <th>Тип</th>
                      <th>Статус</th>
                      <th>Ответственный</th>
                      <th>Получил</th>
                      <th>Дата</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.map((i) => (
                      <tr key={i.id}>
                        <td><strong>{i.number}</strong></td>
                        <td>
                          <span className="badge neutral">
                            {effectiveIssueDomain(i) === "TOOLS" ? "Инструмент" : "Материалы"}
                          </span>
                        </td>
                        <td><span className={`badge ${statusClass(i.status)}`}>{issueStatusLabel(i.status)}</span></td>
                        <td>{i.responsibleName || "—"}</td>
                        <td>{i.actualRecipientName || "—"}</td>
                        <td>{new Date(i.createdAt).toLocaleString()}</td>
                        <td>
                          <div className="toolbar">
                            <button
                              type="button"
                              className="ghostBtn"
                              onClick={() => { setSelectedIssueId(i.id); setDrawerMode("issue"); }}
                            >
                              Детали
                            </button>
                            <button
                              type="button"
                              className="ghostBtn"
                              onClick={() => openDocumentsForEntity("issue", i.id)}
                            >
                              Документы
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mobileCards">
                  {issues.map((i) => (
                    <article key={`m-issue-${i.id}`} className="mobileCard">
                      <h4>{i.number}</h4>
                      <p>
                        <strong>Тип:</strong>{" "}
                        <span className="badge neutral">
                          {effectiveIssueDomain(i) === "TOOLS" ? "Инструмент" : "Материалы"}
                        </span>
                      </p>
                      <p><strong>Статус:</strong> <span className={`badge ${statusClass(i.status)}`}>{issueStatusLabel(i.status)}</span></p>
                      <p><strong>Ответственный:</strong> {i.responsibleName || "—"}</p>
                      <p><strong>Получил:</strong> {i.actualRecipientName || "—"}</p>
                      <p><strong>Дата:</strong> {new Date(i.createdAt).toLocaleString()}</p>
                      <div className="toolbar">
                        <button type="button" onClick={() => { setSelectedIssueId(i.id); setDrawerMode("issue"); }}>Детали</button>
                        <button type="button" onClick={() => openDocumentsForEntity("issue", i.id)}>Документы</button>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="toolbar">
                  <span className="muted">
                    Показано {Math.min((issuesPage - 1) * issuesPageSize + 1, issuesTotal)}-
                    {Math.min(issuesPage * issuesPageSize, issuesTotal)} из {issuesTotal}
                  </span>
                  <select
                    value={issuesPageSize}
                    onChange={(e) => setIssuesPageSize(Number(e.target.value) as ListPageSize)}
                    aria-label="Размер страницы выдач"
                  >
                    <option value={20}>20 на стр.</option>
                    <option value={50}>50 на стр.</option>
                    <option value={100}>100 на стр.</option>
                  </select>
                  <button type="button" onClick={() => setIssuesPage((p) => Math.max(1, p - 1))} disabled={issuesPage <= 1}>
                    Назад
                  </button>
                  <span className="muted">Стр. {issuesPage} / {issuesTotalPages}</span>
                  <button
                    type="button"
                    onClick={() => setIssuesPage((p) => Math.min(issuesTotalPages, p + 1))}
                    disabled={issuesPage >= issuesTotalPages}
                  >
                    Вперёд
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}


      {activeTab === "limits" && (
        <div className="card limitsWorkspace">
          <div className="rightCardHeader" style={{ alignItems: "flex-start", gap: 12 }}>
            <div>
              <h2>Лимиты</h2>
              <p className="muted">Импортированные лимиты по выбранному объекту и разделу. В обычном режиме показываем только структуру и выполнение.</p>
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="ghostBtn" onClick={() => void loadLimitTemplates()}>
                Обновить
              </button>
              <button
                type="button"
                className={limitEditMode ? "" : "ghostBtn"}
                disabled={!canWriteLimits}
                onClick={() => setLimitEditMode((v) => !v)}
              >
                {limitEditMode ? "Завершить правку" : "Редактировать"}
              </button>
              <PeriodExportButton
                section="limits"
                token={token}
                apiUrl={API_URL}
                fetchWithSession={fetchWithSession}
                title="Лимиты в Excel"
              />
            </div>
          </div>

          {limitsMessage && (
            <ResultBanner
              text={limitsMessage}
              tone={
                limitsMessage.includes("Не удалось") ||
                limitsMessage.includes("Ошибка") ||
                limitsMessage.includes("Недостаточно") ||
                limitsMessage.includes("Некоррект")
                  ? "error"
                  : "neutral"
              }
            />
          )}

          <div
            className="card limitImportCard"
            onDragOver={(e) => {
              if (canWriteLimits) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (!canWriteLimits) {
                setLimitsMessage("Недостаточно прав для импорта лимитов");
                return;
              }
              const file = e.dataTransfer.files?.[0];
              if (!file) return;
              if (!/\.(xlsx|xls)$/i.test(file.name)) {
                setLimitsMessage("Выберите Excel-файл .xlsx или .xls");
                return;
              }
              setLimitImportFile(file);
            }}
          >
            <div className="rightCardHeader" style={{ gap: 12 }}>
              <div>
                <h3>Загрузить Excel</h3>
                <p className="muted">
                  Перетащи файл сюда или выбери вручную. Поддерживаются .xlsx и .xls.
                </p>
                <p className="muted" style={{ marginTop: 4 }}>
                  Формат: жёлтым выделены заголовки разделов (можно «Раздел#Подраздел»),
                  материалы — без заливки. Колонки: B — наименование, F — ед. изм.,
                  G — кол-во по бюджету (если пусто — берём I).
                </p>
              </div>
              {limitImportFile && <span className="badge ok">Выбран файл</span>}
            </div>
            <div className="toolbar" style={{ marginTop: 8 }}>
              <input
                type="file"
                accept=".xlsx,.xls"
                disabled={!canWriteLimits}
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  if (file && !/\.(xlsx|xls)$/i.test(file.name)) {
                    setLimitsMessage("Выберите Excel-файл .xlsx или .xls");
                    return;
                  }
                  setLimitImportFile(file);
                }}
              />
              <button type="button" onClick={() => void uploadLimitTemplate()} disabled={!limitImportFile || !canWriteLimits}>
                Импортировать
              </button>
            </div>
            {limitImportFile && <p className="muted">Файл: {limitImportFile.name}</p>}
          </div>

          {limitTemplatesLoading && <LoadingState text="Загрузка лимитов..." />}
          {!limitTemplatesLoading && !limitTemplates.length && (
            <EmptyState title="Лимиты не загружены" hint="Импортируйте Excel-файл, чтобы увидеть дерево разделов и материалов." />
          )}

          {limitTemplates.map((tpl) => (
            <div key={`limit-tpl-${tpl.id}`} className="card limitTemplateCard" style={{ marginTop: 12 }}>
              {(() => {
                  const childrenByParent = new Map<string, LimitImportNode[]>();
                  for (const n of tpl.nodes) {
                    const key = n.parentId || "__root__";
                    const arr = childrenByParent.get(key) || [];
                    arr.push(n);
                    childrenByParent.set(key, arr);
                  }
                  for (const arr of childrenByParent.values()) {
                    arr.sort((a, b) => a.orderNo - b.orderNo);
                  }
                  const materialNodes = tpl.nodes.filter((n) => n.nodeType === "MATERIAL");
                  // Агрегаты «план / приход / выдача» для каждого узла — рекурсивно по поддереву
                  // (нужны полосы заполнения и на разделах, и на подразделах).
                  type NodeAgg = { plan: number; arrived: number; issued: number };
                  const aggByNodeId = new Map<string, NodeAgg>();
                  const computeAgg = (nodeId: string): NodeAgg => {
                    const cached = aggByNodeId.get(nodeId);
                    if (cached) return cached;
                    const node = tpl.nodes.find((x) => x.id === nodeId);
                    if (!node) {
                      const empty = { plan: 0, arrived: 0, issued: 0 };
                      aggByNodeId.set(nodeId, empty);
                      return empty;
                    }
                    if (node.nodeType === "MATERIAL") {
                      const plan = Number(node.plannedQty || 0);
                      const sm = node.materialId ? limitSupplyByMaterialId[node.materialId] : undefined;
                      const arrived = sm?.arrivedQty ?? 0;
                      const issued = node.materialId
                        ? Number(issuedTotalsByMaterialId.get(node.materialId) || 0)
                        : 0;
                      const a: NodeAgg = { plan, arrived, issued };
                      aggByNodeId.set(nodeId, a);
                      return a;
                    }
                    const kids = childrenByParent.get(nodeId) || [];
                    const agg: NodeAgg = { plan: 0, arrived: 0, issued: 0 };
                    for (const k of kids) {
                      const inner = computeAgg(k.id);
                      agg.plan += inner.plan;
                      agg.arrived += inner.arrived;
                      agg.issued += inner.issued;
                    }
                    aggByNodeId.set(nodeId, agg);
                    return agg;
                  };
                  for (const n of tpl.nodes) computeAgg(n.id);
                  const totalPlanned = materialNodes.reduce((sum, n) => sum + Number(n.plannedQty || 0), 0);
                  const totalIssued = materialNodes.reduce(
                    (sum, n) => sum + (n.materialId ? Number(issuedTotalsByMaterialId.get(n.materialId) || 0) : 0),
                    0
                  );
                  const totalArrived = materialNodes.reduce(
                    (sum, n) =>
                      sum + (n.materialId ? Number(limitSupplyByMaterialId[n.materialId]?.arrivedQty || 0) : 0),
                    0
                  );
                  const overallPct =
                    totalPlanned > 0 ? Math.min(100, Math.round((totalIssued / totalPlanned) * 100)) : 0;
                  const overallArrivedPct =
                    totalPlanned > 0 ? Math.min(100, Math.round((totalArrived / totalPlanned) * 100)) : 0;
                  const overCount = materialNodes.filter((n) => {
                    const planned = Number(n.plannedQty || 0);
                    const issued = n.materialId ? Number(issuedTotalsByMaterialId.get(n.materialId) || 0) : 0;
                    return planned > 0 && issued > planned;
                  }).length;

                  const collapseSubtree = (prev: Record<string, boolean>, nodeId: string) => {
                    const next = { ...prev };
                    const stack = [nodeId];
                    while (stack.length) {
                      const cur = stack.pop()!;
                      next[cur] = false;
                      const kids = childrenByParent.get(cur) || [];
                      for (const k of kids) stack.push(k.id);
                    }
                    return next;
                  };

                  const renderNode = (node: LimitImportNode, depth: number) => {
                    const children = childrenByParent.get(node.id) || [];
                    const isGroup = node.nodeType === "GROUP";
                    const isExpanded = Boolean(expandedLimitNodes[node.id]);
                    const planned = Number(node.plannedQty || 0);
                    const issued = node.materialId ? Number(issuedTotalsByMaterialId.get(node.materialId) || 0) : 0;
                    const arrived = node.materialId
                      ? Number(limitSupplyByMaterialId[node.materialId]?.arrivedQty || 0)
                      : 0;
                    const pct = planned > 0 ? Math.min(100, Math.round((issued / planned) * 100)) : 0;
                    const pctArrived = planned > 0 ? Math.min(100, Math.round((arrived / planned) * 100)) : 0;
                    const isOver = planned > 0 && issued > planned;
                    const nodeTitle = String(node.materialName || node.title || "");
                    const qtyText = `${Math.round(issued)} / ${Number.isFinite(planned) ? planned : 0} ${node.unit || "шт"}`;
                    const directMaterials = children.filter((c) => c.nodeType === "MATERIAL");
                    const metricFmt = (n: number) =>
                      Number.isFinite(Number(n)) ? Number(n).toLocaleString("ru-RU", { maximumFractionDigits: 3 }) : "0";
                    const agg = isGroup ? aggByNodeId.get(node.id) || { plan: 0, arrived: 0, issued: 0 } : null;
                    const groupArrivedPct = agg && agg.plan > 0 ? Math.min(100, Math.round((agg.arrived / agg.plan) * 100)) : 0;
                    const groupIssuedPct = agg && agg.plan > 0 ? Math.min(100, Math.round((agg.issued / agg.plan) * 100)) : 0;
                    const groupOver = !!(agg && agg.plan > 0 && agg.issued > agg.plan);

                    return (
                      <div key={node.id} style={{ marginLeft: depth * 10, marginTop: depth ? 2 : 4 }}>
                        {isGroup ? (
                          <div className="limitGroupRow" style={{ gap: 6, padding: "4px 0" }}>
                            <button
                              type="button"
                              className="ghostBtn"
                              style={{ width: 32, minWidth: 32, height: 32, borderRadius: 10 }}
                              aria-label={isExpanded ? "Свернуть" : "Раскрыть"}
                              onClick={() =>
                                setExpandedLimitNodes((prev) => {
                                  const willExpand = !prev[node.id];
                                  const parentKey = node.parentId || "__root__";
                                  const siblings = childrenByParent.get(parentKey) || [];
                                  let next = { ...prev };

                                  // Аккордеон: при раскрытии закрываем соседей на том же уровне.
                                  if (willExpand) {
                                    for (const s of siblings) {
                                      if (s.id !== node.id) {
                                        next = collapseSubtree(next, s.id);
                                      }
                                    }
                                  }

                                  // Переключаем текущий узел. При закрытии — закрываем и всё поддерево.
                                  next[node.id] = willExpand;
                                  if (!willExpand) {
                                    next = collapseSubtree(next, node.id);
                                  }
                                  return next;
                                })
                              }
                              disabled={!children.length}
                            >
                              {children.length ? (isExpanded ? "▾" : "▸") : "•"}
                            </button>
                            {limitEditMode ? (() => {
                              const draft = limitNodeDrafts[node.id] || {};
                              const titleValue = draft.title ?? node.title;
                              const dirty = draft.title !== undefined && draft.title !== node.title;
                              const saveTitle = () => {
                                const v = (titleValue || "").trim();
                                if (!v) {
                                  setLimitsMessage("Введите название раздела");
                                  return;
                                }
                                if (v === node.title) {
                                  setLimitNodeDrafts((prev) => {
                                    if (!prev[node.id]) return prev;
                                    const next = { ...prev };
                                    delete next[node.id];
                                    return next;
                                  });
                                  return;
                                }
                                void patchLimitImportNode(node.id, { title: v, nodeType: "GROUP" });
                              };
                              return (
                                <>
                                  <input
                                    value={titleValue}
                                    aria-label="Название раздела"
                                    style={{
                                      fontWeight: 700,
                                      color: "#243656",
                                      flex: "1 1 220px",
                                      minWidth: 120,
                                      borderColor: dirty ? "#ff9f1c" : undefined
                                    }}
                                    disabled={!canWriteLimits}
                                    onChange={(e) =>
                                      setLimitNodeDrafts((prev) => ({
                                        ...prev,
                                        [node.id]: { ...prev[node.id], title: e.target.value }
                                      }))
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        saveTitle();
                                      } else if (e.key === "Escape") {
                                        e.preventDefault();
                                        setLimitNodeDrafts((prev) => {
                                          if (!prev[node.id]) return prev;
                                          const next = { ...prev };
                                          delete next[node.id];
                                          return next;
                                        });
                                      }
                                    }}
                                  />
                                  <button
                                    type="button"
                                    className={dirty ? "" : "ghostBtn"}
                                    disabled={!canWriteLimits || !dirty}
                                    title="Enter — сохранить, Esc — отменить"
                                    onClick={saveTitle}
                                  >
                                    {dirty ? "Сохранить" : "Сохранено"}
                                  </button>
                                  <button
                                    type="button"
                                    className="ghostBtn"
                                    disabled={!canWriteLimits}
                                    onClick={() => {
                                      setExpandedLimitNodes((prev) => ({ ...prev, [node.id]: true }));
                                      void createLimitImportNode(tpl.id, {
                                        parentId: node.id,
                                        nodeType: "GROUP",
                                        title: "Новый подраздел"
                                      });
                                    }}
                                  >
                                    + Подраздел
                                  </button>
                                  <button
                                    type="button"
                                    className="ghostBtn"
                                    disabled={!canWriteLimits}
                                    onClick={() => {
                                      setExpandedLimitNodes((prev) => ({ ...prev, [node.id]: true }));
                                      void createLimitImportNode(tpl.id, {
                                        parentId: node.id,
                                        nodeType: "MATERIAL",
                                        title: "Новый материал",
                                        materialName: "Новый материал",
                                        unit: "шт",
                                        plannedQty: 0
                                      });
                                    }}
                                  >
                                    + Материал
                                  </button>
                                  <button
                                    type="button"
                                    className="ghostBtn"
                                    disabled={!canWriteLimits}
                                    onClick={() => void deleteLimitImportNode(node.id)}
                                  >
                                    Удалить
                                  </button>
                                </>
                              );
                            })() : (
                              <>
                                <strong style={{ color: "#243656" }}>{node.title}</strong>
                                {children.length ? <span className="muted">{children.length} поз.</span> : null}
                                {agg && agg.plan > 0 ? (
                                  <span className="muted" style={{ fontSize: 11 }}>
                                    {metricFmt(agg.issued)} / {metricFmt(agg.plan)} · приход {groupArrivedPct}% · выдача {groupIssuedPct}%
                                  </span>
                                ) : null}
                              </>
                            )}
                          </div>
                        ) : null}
                        {isGroup && agg && agg.plan > 0 ? (
                          <div style={{ margin: "2px 0 4px", paddingLeft: 36 }}>
                            <div className="progressWrap" style={{ height: 5, marginBottom: 2 }}>
                              <div
                                className="progressBar"
                                style={{
                                  width: `${groupArrivedPct}%`,
                                  background: "linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)",
                                  opacity: agg.arrived > 0 ? 1 : 0.2
                                }}
                              />
                            </div>
                            <div className="progressWrap" style={{ height: 5 }}>
                              <div
                                className={`progressBar ${groupOver ? "bad" : ""}`}
                                style={{
                                  width: `${groupIssuedPct}%`,
                                  ...(groupOver ? {} : { background: "linear-gradient(90deg, #22c55e 0%, #16a34a 100%)" })
                                }}
                              />
                            </div>
                          </div>
                        ) : null}
                        {!isGroup ? (
                          <div className={`limitMaterialRow ${isOver ? "low" : ""}`}>
                            {limitEditMode ? (() => {
                              const draft = limitNodeDrafts[node.id] || {};
                              const originalName = String(node.materialName || node.title || "");
                              const originalUnit = String(node.unit || "шт");
                              const originalPlan = Number.isFinite(planned) ? String(planned) : "";
                              const nameValue = draft.title ?? originalName;
                              const unitValue = draft.unit ?? originalUnit;
                              const planValue = draft.plannedQty ?? originalPlan;
                              const dirty =
                                (draft.title !== undefined && draft.title !== originalName) ||
                                (draft.unit !== undefined && draft.unit !== originalUnit) ||
                                (draft.plannedQty !== undefined && draft.plannedQty !== originalPlan);
                              const reset = () =>
                                setLimitNodeDrafts((prev) => {
                                  if (!prev[node.id]) return prev;
                                  const next = { ...prev };
                                  delete next[node.id];
                                  return next;
                                });
                              const save = () => {
                                const name = (nameValue || "").trim() || originalName.trim();
                                if (!name) {
                                  setLimitsMessage("Введите наименование материала");
                                  return;
                                }
                                const unit = (unitValue || "шт").trim() || "шт";
                                const planRaw = (planValue ?? "").toString().trim().replace(",", ".");
                                const planNum = planRaw === "" ? null : Number(planRaw);
                                if (planNum !== null && !Number.isFinite(planNum)) {
                                  setLimitsMessage("Некорректное плановое количество");
                                  return;
                                }
                                if (
                                  name === originalName.trim() &&
                                  unit === originalUnit.trim() &&
                                  String(planNum ?? "") === String(node.plannedQty ?? "")
                                ) {
                                  reset();
                                  return;
                                }
                                void patchLimitImportNode(node.id, {
                                  nodeType: "MATERIAL",
                                  title: name,
                                  materialName: name,
                                  unit,
                                  plannedQty: planNum
                                });
                              };
                              const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  save();
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  reset();
                                }
                              };
                              return (
                                <div className="rightCardHeader" style={{ marginBottom: 6, alignItems: "flex-start", gap: 10 }}>
                                  <div style={{ flex: 1, minWidth: 0 }} className="form" data-compact-limit-form>
                                    <label style={{ marginBottom: 6 }}>
                                      Наименование
                                      <input
                                        value={nameValue}
                                        disabled={!canWriteLimits}
                                        style={{ borderColor: draft.title !== undefined && draft.title !== originalName ? "#ff9f1c" : undefined }}
                                        onChange={(e) =>
                                          setLimitNodeDrafts((prev) => ({
                                            ...prev,
                                            [node.id]: { ...prev[node.id], title: e.target.value }
                                          }))
                                        }
                                        onKeyDown={handleKey}
                                      />
                                    </label>
                                    <div className="grid2" style={{ gap: 8 }}>
                                      <label style={{ marginBottom: 0 }}>
                                        Ед.
                                        <input
                                          value={unitValue}
                                          disabled={!canWriteLimits}
                                          style={{ borderColor: draft.unit !== undefined && draft.unit !== originalUnit ? "#ff9f1c" : undefined }}
                                          onChange={(e) =>
                                            setLimitNodeDrafts((prev) => ({
                                              ...prev,
                                              [node.id]: { ...prev[node.id], unit: e.target.value }
                                            }))
                                          }
                                          onKeyDown={handleKey}
                                        />
                                      </label>
                                      <label style={{ marginBottom: 0 }}>
                                        План
                                        <input
                                          type="number"
                                          step={0.001}
                                          value={planValue}
                                          disabled={!canWriteLimits}
                                          style={{ borderColor: draft.plannedQty !== undefined && draft.plannedQty !== originalPlan ? "#ff9f1c" : undefined }}
                                          onChange={(e) =>
                                            setLimitNodeDrafts((prev) => ({
                                              ...prev,
                                              [node.id]: { ...prev[node.id], plannedQty: e.target.value }
                                            }))
                                          }
                                          onKeyDown={handleKey}
                                        />
                                      </label>
                                    </div>
                                  </div>
                                  <div className="toolbar" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
                                    <button
                                      type="button"
                                      className={dirty ? "" : "ghostBtn"}
                                      disabled={!canWriteLimits || !dirty}
                                      title="Enter — сохранить, Esc — отменить"
                                      onClick={save}
                                    >
                                      {dirty ? "Сохранить" : "Сохранено"}
                                    </button>
                                    {dirty && (
                                      <button
                                        type="button"
                                        className="ghostBtn"
                                        disabled={!canWriteLimits}
                                        onClick={reset}
                                      >
                                        Отменить
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      className="ghostBtn"
                                      disabled={!canWriteLimits}
                                      onClick={() => void deleteLimitImportNode(node.id)}
                                    >
                                      Удалить
                                    </button>
                                  </div>
                                </div>
                              );
                            })() : (
                              <div className="rightCardHeader" style={{ marginBottom: 8, gap: 10 }}>
                                <div style={{ minWidth: 0 }}>
                                  <strong style={{ fontSize: 13 }}>{nodeTitle}</strong>
                                  <div className="muted">{node.unit || "шт"}{!node.materialId ? " · не сопоставлено" : ""}</div>
                                </div>
                                <span className={`badge ${isOver ? "bad" : "ok"}`}>{qtyText}</span>
                              </div>
                            )}
                            <div className="progressWrap" style={{ height: 5, marginBottom: 2, width: "100%" }}>
                              <div
                                className="progressBar"
                                style={{
                                  width: `${pctArrived}%`,
                                  background: "linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)",
                                  opacity: arrived > 0 ? 1 : 0.2
                                }}
                              />
                            </div>
                            <div className="progressWrap" style={{ height: 5, width: "100%" }}>
                              <div
                                className={`progressBar ${isOver ? "bad" : ""}`}
                                style={{
                                  width: `${pct}%`,
                                  ...(isOver ? {} : { background: "linear-gradient(90deg, #22c55e 0%, #16a34a 100%)" })
                                }}
                              />
                            </div>
                          </div>
                        ) : null}

                        {isGroup && isExpanded && directMaterials.length > 0 ? (
                          <div style={{ marginLeft: (depth + 1) * 10, marginBottom: 8, overflowX: "auto" }}>
                            <table className="desktopTable" style={{ fontSize: 12 }}>
                              <thead>
                                <tr>
                                  <th>Материал</th>
                                  <th>Ед.</th>
                                  <th>План</th>
                                  <th>Приход (учёт)</th>
                                  <th>Выдано</th>
                                  <th>Осталось привезти</th>
                                  <th>В закупке (заявки)</th>
                                  <th>Остаток на складе</th>
                                  <th style={{ minWidth: 128 }}>Структура</th>
                                </tr>
                              </thead>
                              <tbody>
                                {directMaterials.map((m) => {
                                  const plan = Number(m.plannedQty || 0);
                                  const sm = m.materialId ? limitSupplyByMaterialId[m.materialId] : undefined;
                                  const arrived = sm?.arrivedQty ?? 0;
                                  const iss = m.materialId ? Number(issuedTotalsByMaterialId.get(m.materialId) || 0) : 0;
                                  const onOrd = sm?.onOrderQty ?? 0;
                                  const stk = sm?.stockQty ?? 0;
                                  const remain = Math.max(0, plan - arrived);
                                  const base = Math.max(plan, 1e-9);
                                  const pctArr = Math.min(100, (arrived / base) * 100);
                                  const pctIss = Math.min(100, (iss / base) * 100);
                                  const overIss = plan > 0 && iss > plan;
                                  return (
                                    <tr key={`mt-${node.id}-${m.id}`}>
                                      <td>{safeName(String(m.materialName || m.title || ""))}</td>
                                      <td>{m.unit || "шт"}</td>
                                      <td>{metricFmt(plan)}</td>
                                      <td>{m.materialId ? metricFmt(arrived) : "—"}</td>
                                      <td>{m.materialId ? metricFmt(iss) : "—"}</td>
                                      <td>{m.materialId ? metricFmt(remain) : "—"}</td>
                                      <td>{m.materialId ? metricFmt(onOrd) : "—"}</td>
                                      <td>{m.materialId ? metricFmt(stk) : "—"}</td>
                                      <td>
                                        {m.materialId && plan > 0 ? (
                                          <div style={{ minWidth: 120 }}>
                                            <div
                                              className="muted"
                                              style={{ fontSize: 10, marginBottom: 2 }}
                                              title="Синим — доля прихода от плана; зелёным — доля выдачи от плана"
                                            >
                                              приход / выдача от плана
                                            </div>
                                            <div className="progressWrap" style={{ height: 7, marginBottom: 3 }}>
                                              <div
                                                className="progressBar"
                                                style={{
                                                  width: `${pctArr}%`,
                                                  background: "linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)",
                                                  opacity: arrived > 0 ? 1 : 0.25
                                                }}
                                              />
                                            </div>
                                            <div className="progressWrap" style={{ height: 7 }}>
                                              <div
                                                className={`progressBar ${overIss ? "bad" : ""}`}
                                                style={{
                                                  width: `${pctIss}%`,
                                                  ...(overIss ? {} : { background: "linear-gradient(90deg, #22c55e 0%, #16a34a 100%)" })
                                                }}
                                              />
                                            </div>
                                          </div>
                                        ) : (
                                          "—"
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                            <p className="muted" style={{ margin: "6px 0 0", fontSize: 11 }}>
                              Учётный раздел объекта: {objectSectionFilter === "SS" ? "СС" : "ЭОМ"}. Приход — операции INCOME по
                              разделу; выдано — движения OUT; «в закупке» — открытые заявки на приход. Структура — доля прихода и доля
                              выдачи от планового количества по строке.
                            </p>
                          </div>
                        ) : null}

                        {isGroup && isExpanded && children.length
                          ? children.filter((ch) => ch.nodeType !== "MATERIAL").map((ch) => renderNode(ch, depth + 1))
                          : null}
                      </div>
                    );
                  };

                  const roots = childrenByParent.get("__root__") || [];
                  return (
                    <>
                      <div className="rightCardHeader" style={{ alignItems: "flex-start", gap: 12 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          {limitEditMode ? (() => {
                            const titleDraft = limitTemplateTitleDrafts[tpl.id];
                            const titleValue = titleDraft ?? tpl.title;
                            const titleDirty = titleDraft !== undefined && titleDraft !== tpl.title;
                            const saveTitle = () => void patchLimitTemplateTitle(tpl.id, titleValue);
                            const resetTitle = () =>
                              setLimitTemplateTitleDrafts((prev) => {
                                if (!(tpl.id in prev)) return prev;
                                const next = { ...prev };
                                delete next[tpl.id];
                                return next;
                              });
                            return (
                              <div className="toolbar" style={{ flexWrap: "wrap" }}>
                                <input
                                  value={titleValue}
                                  aria-label="Название шаблона лимитов"
                                  style={{
                                    minWidth: 220,
                                    flex: "1 1 220px",
                                    borderColor: titleDirty ? "#ff9f1c" : undefined
                                  }}
                                  disabled={!canWriteLimits}
                                  onChange={(e) =>
                                    setLimitTemplateTitleDrafts((prev) => ({ ...prev, [tpl.id]: e.target.value }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      saveTitle();
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      resetTitle();
                                    }
                                  }}
                                />
                                <button
                                  type="button"
                                  className={titleDirty ? "" : "ghostBtn"}
                                  disabled={!canWriteLimits || !titleDirty}
                                  title="Enter — сохранить, Esc — отменить"
                                  onClick={saveTitle}
                                >
                                  {titleDirty ? "Сохранить" : "Сохранено"}
                                </button>
                                {titleDirty && (
                                  <button
                                    type="button"
                                    className="ghostBtn"
                                    disabled={!canWriteLimits}
                                    onClick={resetTitle}
                                  >
                                    Отменить
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="ghostBtn"
                                  disabled={!canWriteLimits}
                                  onClick={() =>
                                    void createLimitImportNode(tpl.id, {
                                      parentId: null,
                                      nodeType: "GROUP",
                                      title: "Новый раздел"
                                    })
                                  }
                                >
                                  + Раздел
                                </button>
                                <button
                                  type="button"
                                  className="dangerBtn"
                                  disabled={!canWriteLimits}
                                  onClick={() => void deleteLimitTemplate(tpl.id)}
                                >
                                  Удалить шаблон
                                </button>
                              </div>
                            );
                          })() : (
                            <>
                              <h3 style={{ marginBottom: 6 }}>{tpl.title}</h3>
                              <p className="muted">{tpl.section} · {new Date(tpl.createdAt).toLocaleString()}</p>
                            </>
                          )}
                        </div>
                        <div className="kpiRow" style={{ margin: 0 }}>
                          <div className="kpi">
                            <span>Материалов</span>
                            <strong>{materialNodes.length}</strong>
                          </div>
                          <div className="kpi">
                            <span>Выполнение</span>
                            <strong>{overallPct}%</strong>
                          </div>
                          <div className="kpi">
                            <span>Перерасход</span>
                            <strong>{overCount}</strong>
                          </div>
                        </div>
                      </div>
                      <div style={{ width: "100%", margin: "8px 0 10px" }}>
                        <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>
                          приход {overallArrivedPct}% · выдача {overallPct}%
                        </div>
                        <div className="progressWrap" style={{ height: 6, marginBottom: 3 }}>
                          <div
                            className="progressBar"
                            style={{
                              width: `${overallArrivedPct}%`,
                              background: "linear-gradient(90deg, #3b82f6 0%, #2563eb 100%)",
                              opacity: totalArrived > 0 ? 1 : 0.25
                            }}
                          />
                        </div>
                        <div className="progressWrap" style={{ height: 6 }}>
                          <div
                            className={`progressBar ${overCount ? "bad" : ""}`}
                            style={{
                              width: `${overallPct}%`,
                              ...(overCount ? {} : { background: "linear-gradient(90deg, #22c55e 0%, #16a34a 100%)" })
                            }}
                          />
                        </div>
                      </div>
                      <div className="plainList limitTree">
                        {roots.map((r) => renderNode(r, 0))}
                      </div>
                    </>
                  );
                })()}
            </div>
          ))}
        </div>
      )}

      {canMaterialReport && activeTab === "materialReport" && (
        <div className="card limitsWorkspace">
          <div className="rightCardHeader" style={{ alignItems: "flex-start", gap: 12 }}>
            <div>
              <h2>Материальный отчёт</h2>
              <p className="muted">
                Остатки выданных материалов, расходников и спецодежды на ответственных (после статуса «Выдано»: кто утвердил заявку
                или кто её создал). Учитывается раздел объекта — {objectSectionFilter === "SS" ? "СС" : "ЭОМ"}. Списание здесь не
                меняет складской остаток, только корректирует учёт «у ответственного» и фиксируется в журнале.
              </p>
            </div>
            <div className="toolbar" style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className="ghostBtn"
                disabled={!activeObjectId}
                onClick={() => void loadMaterialReportData()}
              >
                Обновить
              </button>
              <PeriodExportButton
                section="materialReport"
                token={token}
                apiUrl={API_URL}
                fetchWithSession={fetchWithSession}
                title="Мат. отчёт в Excel"
              />
            </div>
          </div>

          {!activeObjectId ? (
            <p className="muted">Выберите объект в верхней панели.</p>
          ) : (
            <>
              {materialReportMessage ? (
                <ResultBanner
                  text={materialReportMessage}
                  tone={
                    /403|502|Недостаточно|[Оо]шибка|[Нн]екоррект|Invalid/i.test(materialReportMessage)
                      ? "error"
                      : "neutral"
                  }
                />
              ) : null}
              {materialBalancesLoading ? (
                <LoadingState text="Загрузка материального отчёта..." />
              ) : materialBalances.length === 0 ? (
                <EmptyState
                  title="Нет позиций на ответственных"
                  hint="После выдачи заявок материалы/расходники/спецодежда попадут в этот раздел для выбранного объекта и раздела (СС/ЭОМ)."
                />
              ) : (
                <div className="plainList" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {materialBalances.map((h) => (
                    <div key={h.holderUserId} className="card" style={{ margin: 0, padding: "12px 14px" }}>
                      <div className="rightCardHeader" style={{ marginBottom: 8 }}>
                        <strong>{safeName(h.holderName)}</strong>
                        <span className="muted">{h.lines.length} поз.</span>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table className="desktopTable" style={{ fontSize: 13 }}>
                          <thead>
                            <tr>
                              <th>Материал</th>
                              <th>Ед.</th>
                              <th>Остаток у ответственного</th>
                              {canMaterialWriteoff ? <th aria-label="Действия" /> : null}
                            </tr>
                          </thead>
                          <tbody>
                            {h.lines.map((ln) => (
                              <tr key={`${h.holderUserId}-${ln.materialId}`}>
                                <td>{safeName(ln.name)}</td>
                                <td>{ln.unit}</td>
                                <td>{Number(ln.quantity).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}</td>
                                {canMaterialWriteoff ? (
                                  <td style={{ whiteSpace: "nowrap" }}>
                                    <button
                                      type="button"
                                      className="ghostBtn"
                                      onClick={() => {
                                        setMaterialWriteoffQty("");
                                        setMaterialWriteoffComment("");
                                        setMaterialWriteoffFile(null);
                                        setMaterialReportMessage("");
                                        setMaterialWriteoffModal({
                                          holderUserId: h.holderUserId,
                                          materialId: ln.materialId,
                                          name: ln.name,
                                          unit: ln.unit,
                                          maxQty: Number(ln.quantity) || 0
                                        });
                                      }}
                                    >
                                      Списать
                                    </button>
                                  </td>
                                ) : null}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="card" style={{ marginTop: 16 }}>
                <h3 style={{ marginTop: 0 }}>История списаний</h3>
                <p className="muted" style={{ marginTop: 0 }}>
                  Последние операции списания с ответственных по текущему объекту и разделу.
                </p>
                {!materialWriteoffHistory.length && !materialBalancesLoading ? (
                  <p className="muted">Записей пока нет.</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table className="desktopTable" style={{ fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th>Дата</th>
                          <th>Ответственный</th>
                          <th>Материал</th>
                          <th>Кол-во</th>
                          <th>Исполнитель</th>
                          <th>Комментарий</th>
                          <th>Вложение</th>
                        </tr>
                      </thead>
                      <tbody>
                        {materialWriteoffHistory.map((w) => (
                          <tr key={w.id}>
                            <td>{new Date(w.createdAt).toLocaleString("ru-RU")}</td>
                            <td>{safeName(w.holderName)}</td>
                            <td>
                              {safeName(w.materialName)} ({w.materialUnit})
                            </td>
                            <td>{Number(w.quantity).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}</td>
                            <td>{safeName(w.actorName)}</td>
                            <td>{w.comment ? String(w.comment) : "—"}</td>
                            <td>
                              {w.documentPath ? (
                                <a href={`${API_URL}/${w.documentPath}`} target="_blank" rel="noreferrer">
                                  {safeName(w.documentFileName || "Файл")}
                                </a>
                              ) : (
                                "—"
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "approvals" && (
        <div className="card">
          <h2>Заявки</h2>
          {issuesMessage && <ResultBanner text={issuesMessage} tone={issuesTone} />}
          <div className="kpiRow">
            <div className="kpi">
              <span>В очереди (
              {approvalQueueTab === "TOOLS"
                ? "инструмент"
                : approvalQueueTab === "CONSUMABLES"
                  ? "расходники"
                  : approvalQueueTab === "WORKWEAR"
                    ? "спецодежда"
                    : "материалы"}
              )</span>
              <strong>{approvalQueue.length}</strong>
            </div>
            <div className="kpi">
              <span>Приходные заявки</span>
              <strong>{receiptRequests.length}</strong>
            </div>
          </div>

          <div
            className="card"
            style={{ marginTop: 12 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (!file) return;
              if (!/\.(xlsx|xls)$/i.test(file.name)) {
                setOpsMessage("Выберите Excel-файл (.xlsx/.xls)");
                return;
              }
              setReceiptRequestFile(file);
            }}
          >
            <h3 style={{ marginTop: 0 }}>Загрузить заявку из Excel</h3>
            <p className="muted">
              Заявки на приёмку грузим сюда. После загрузки спросим, привязать ли заявку к лимиту.
              Сами материалы потом принимаем в разделе «Приходы» — там есть чекбоксы и приложение документов.
            </p>
            <div className="toolbar" style={{ flexWrap: "wrap" }}>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setReceiptRequestFile(e.target.files?.[0] || null)}
              />
              <button
                type="button"
                onClick={() => void uploadReceiptRequest()}
                disabled={!receiptRequestFile || !canWriteOperations}
              >
                Загрузить заявку
              </button>
              {receiptRequestFile && <span className="muted">{receiptRequestFile.name}</span>}
            </div>
            {opsMessage && (
              <ResultBanner
                text={opsMessage}
                tone={opsMessage.includes("Не удалось") || opsMessage.includes("Ошибка") ? "error" : "neutral"}
              />
            )}
          </div>

          <div className="tabs" style={{ marginTop: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className={approvalQueueTab === "MATERIALS" ? "active" : ""}
              onClick={() => setApprovalQueueTab("MATERIALS")}
            >
              Согласование: материалы
            </button>
            <button
              type="button"
              className={approvalQueueTab === "CONSUMABLES" ? "active" : ""}
              onClick={() => setApprovalQueueTab("CONSUMABLES")}
            >
              Расходники
            </button>
            <button
              type="button"
              className={approvalQueueTab === "WORKWEAR" ? "active" : ""}
              onClick={() => setApprovalQueueTab("WORKWEAR")}
            >
              Спецодежда
            </button>
            <button
              type="button"
              className={approvalQueueTab === "TOOLS" ? "active" : ""}
              onClick={() => setApprovalQueueTab("TOOLS")}
            >
              Согласование: инструмент
            </button>
          </div>
          <h3>Очередь на выдачу</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Показаны заявки со статусом «на рассмотрении» для выбранного типа (
            {approvalQueueTab === "TOOLS"
              ? "инструмент"
              : approvalQueueTab === "CONSUMABLES"
                ? "расходники"
                : approvalQueueTab === "WORKWEAR"
                  ? "спецодежда"
                  : "материалы"}
            ).
          </p>
          <table>
            <thead>
              <tr>
                <th>Номер</th>
                <th>Склад</th>
                <th>Инициатор</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {approvalQueue.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    В очереди ничего нет для этого типа.
                  </td>
                </tr>
              ) : (
              approvalQueue.map((i) => (
                <tr key={i.id}>
                  <td>{i.number}</td>
                  <td>{i.warehouse?.name || i.warehouseId}</td>
                  <td>{i.requestedBy?.fullName || i.requestedById}</td>
                  <td><span className={`badge ${statusClass(i.status)}`}>{issueStatusLabel(i.status)}</span></td>
                  <td>
                    <div className="toolbar">
                      <button onClick={() => { setSelectedIssueId(i.id); setDrawerMode("issue"); }}>Детали</button>
                      <button onClick={() => void executeIssueAction(i.id, "approve", { fromApprovals: true })}>Одобрить</button>
                      <button onClick={() => void executeIssueAction(i.id, "reject", { fromApprovals: true })}>Отклонить</button>
                      <button onClick={() => openDocumentsForEntity("issue", i.id)}>Документы</button>
                    </div>
                  </td>
                </tr>
              ))
              )}
            </tbody>
          </table>
          <h3 style={{ marginTop: 18 }}>Приходные заявки</h3>
          <table>
            <thead>
              <tr>
                <th>Номер</th>
                <th>Файл</th>
                <th>Статус</th>
                <th>Позиции</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {receiptRequests.map((row) => (
                <tr key={`approval-receipt-${row.id}`}>
                  <td>{row.number}</td>
                  <td>{row.sourceFileName || "—"}</td>
                  <td><span className={`badge ${row.status === "RECEIVED" ? "ok" : "warn"}`}>{row.status}</span></td>
                  <td>{row.items.length}</td>
                  <td>
                    <div className="toolbar">
                      <button type="button" onClick={() => setActiveTab("operations")}>Открыть приемку</button>
                      <button type="button" onClick={() => openDocumentsForEntity("receipt", row.id)}>Документы</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!receiptRequests.length && <p className="muted">Приходных заявок пока нет.</p>}
        </div>
      )}

      {activeTab === "documents" && (() => {
        const docTypeTabs = [
          { id: "", label: "Все виды" },
          { id: "upd", label: "УПД" },
          { id: "tn", label: "ТН" },
          { id: "upd-scan", label: "Сканы УПД" },
          { id: "receipt-request", label: "Заявки (Excel)" },
          { id: "photo", label: "Фото" },
          { id: "act", label: "Акты" },
          { id: "other", label: "Прочее" }
        ];
        const filtersActive =
          Boolean(docTypeFilter) || Boolean(docEntityType) || Boolean(docEntityId) || Boolean(docSearchQuery.trim());
        const search = docSearchQuery.trim().toLowerCase();
        const visibleDocs = search
          ? documents.filter((d) => d.fileName.toLowerCase().includes(search))
          : documents;
        return (
          <div className="card">
            <div className="rightCardHeader" style={{ flexWrap: "wrap", gap: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>Документы</h2>
                <p className="muted">
                  Только просмотр загруженных документов. Все файлы создаются в других разделах
                  (приёмки/выдачи/заявки) — здесь их удобно искать и открывать.
                </p>
              </div>
              <div className="kpiRow" style={{ margin: 0 }}>
                <div className="kpi">
                  <span>Найдено</span>
                  <strong>{visibleDocs.length}</strong>
                </div>
              </div>
            </div>

            <div className="tabs" style={{ flexWrap: "wrap", marginTop: 8 }}>
              {docTypeTabs.map((tab) => (
                <button
                  key={tab.id || "all"}
                  className={docTypeFilter === tab.id ? "active" : ""}
                  onClick={() => {
                    setDocTypeFilter(tab.id);
                    setSelectedDocumentId("");
                    setDocPreviewUrl("");
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="form docCenterForm" style={{ marginTop: 8 }}>
              <label>
                Раздел источника
                <select
                  value={docEntityType}
                  onChange={(e) => {
                    setDocEntityType(e.target.value as "" | "operation" | "issue" | "receipt");
                    setDocEntityId("");
                    setSelectedDocumentId("");
                    setDocPreviewUrl("");
                  }}
                >
                  <option value="">Все разделы</option>
                  <option value="issue">Заявки на выдачу</option>
                  <option value="operation">Операции (приходы/выдачи)</option>
                  <option value="receipt">Приходные заявки</option>
                </select>
              </label>
              <label>
                Конкретный документ
                {docEntityType === "issue" ? (
                  <select
                    value={docEntityId}
                    onChange={(e) => {
                      setDocEntityId(e.target.value);
                      setSelectedDocumentId("");
                      setDocPreviewUrl("");
                    }}
                  >
                    <option value="">Все заявки на выдачу</option>
                    {issues.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.number} ({issueStatusLabel(i.status)})
                      </option>
                    ))}
                  </select>
                ) : docEntityType === "operation" ? (
                  <select
                    value={docEntityId}
                    onChange={(e) => {
                      setDocEntityId(e.target.value);
                      setSelectedDocumentId("");
                      setDocPreviewUrl("");
                    }}
                  >
                    <option value="">Все операции</option>
                    {operations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {(o.documentNumber || o.id.slice(0, 8))} [{o.type}]
                      </option>
                    ))}
                  </select>
                ) : docEntityType === "receipt" ? (
                  <select
                    value={docEntityId}
                    onChange={(e) => {
                      setDocEntityId(e.target.value);
                      setSelectedDocumentId("");
                      setDocPreviewUrl("");
                    }}
                  >
                    <option value="">Все приходные заявки</option>
                    {receiptRequests.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.number} ({r.status})
                      </option>
                    ))}
                  </select>
                ) : (
                  <select disabled>
                    <option>Сначала выбери раздел</option>
                  </select>
                )}
              </label>
              <label>
                Поиск по имени файла
                <input
                  value={docSearchQuery}
                  onChange={(e) => setDocSearchQuery(e.target.value)}
                  placeholder="часть имени файла…"
                />
              </label>
            </div>

            <div className="toolbar" style={{ flexWrap: "wrap" }}>
              <button type="button" onClick={() => void loadDocuments()}>
                Обновить список
              </button>
              {filtersActive && (
                <button
                  type="button"
                  className="ghostBtn"
                  onClick={() => {
                    setDocTypeFilter("");
                    setDocEntityType("");
                    setDocEntityId("");
                    setDocSearchQuery("");
                    setSelectedDocumentId("");
                    setDocPreviewUrl("");
                  }}
                >
                  Сбросить фильтры
                </button>
              )}
            </div>

            {documentsMessage && <p className="muted">{documentsMessage}</p>}

            <div className="docCenterSplit" style={{ marginTop: 8 }}>
              <div className="card">
                {!visibleDocs.length ? (
                  <EmptyState
                    title="Ничего не нашлось"
                    hint={
                      filtersActive
                        ? "Попробуй сбросить фильтры или поменять раздел/вид документа."
                        : "Файлы появятся здесь автоматически после приёмки или выдачи."
                    }
                  />
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Дата</th>
                        <th>Версия</th>
                        <th>Источник</th>
                        <th>Вид</th>
                        <th>Файл</th>
                        <th>Размер</th>
                        <th>Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDocs.map((d) => (
                        <tr key={d.id} className={selectedDocumentId === d.id ? "selectedRow" : ""}>
                          <td>{new Date(d.createdAt).toLocaleString()}</td>
                          <td>v{d.version}</td>
                          <td title={`${d.entityType}:${d.entityId}`}>
                            {d.entityType}:{d.entityId.slice(0, 8)}…
                          </td>
                          <td>{d.type}</td>
                          <td>
                            <a href={`${API_URL}/${d.filePath}`} target="_blank" rel="noreferrer">
                              {d.fileName}
                            </a>
                          </td>
                          <td>
                            {d.size ? `${Math.max(1, Math.ceil(d.size / 1024))} КБ` : "—"}
                          </td>
                          <td>
                            <div className="toolbar">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedDocumentId(d.id);
                                  setDocPreviewUrl(`${API_URL}/${d.filePath}`);
                                }}
                              >
                                Превью
                              </button>
                              <a
                                className="ghostBtn"
                                href={`${API_URL}/${d.filePath}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Открыть
                              </a>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card">
                <h3>Панель предпросмотра</h3>
                {selectedDocument ? (
                  <>
                    <p className="muted">
                      {selectedDocument.fileName} • v{selectedDocument.version}
                    </p>
                    <iframe
                      src={docPreviewUrl || `${API_URL}/${selectedDocument.filePath}`}
                      title="document-preview"
                      style={{
                        width: "100%",
                        minHeight: 420,
                        border: "1px solid #d8dee9",
                        borderRadius: 8
                      }}
                    />
                  </>
                ) : (
                  <p className="muted">Выбери документ из списка слева.</p>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {activeTab === "waybills" && (
        <div className="card">
          <h2>Транспортные накладные</h2>
          {waybillsLoading && <LoadingState text="Загрузка ТН..." />}
          {waybillsError && <ErrorState text={waybillsError} />}
          <div className="kpiRow">
            <div className="kpi"><span>Всего</span><strong>{waybills.length}</strong></div>
            <div className="kpi"><span>В пути</span><strong>{waybills.filter((x) => x.status === "SHIPPED").length}</strong></div>
            <div className="kpi"><span>Черновики</span><strong>{waybills.filter((x) => x.status === "DRAFT").length}</strong></div>
          </div>
          <div className="toolbar">
            <select value={waybillStatusFilter} onChange={(e) => setWaybillStatusFilter((e.target.value || "") as "" | WaybillStatus)}>
              <option value="">Все статусы</option>
              <option value="DRAFT">{waybillStatusLabel("DRAFT")}</option>
              <option value="FORMED">{waybillStatusLabel("FORMED")}</option>
              <option value="SHIPPED">{waybillStatusLabel("SHIPPED")}</option>
              <option value="RECEIVED">{waybillStatusLabel("RECEIVED")}</option>
              <option value="CLOSED">{waybillStatusLabel("CLOSED")}</option>
            </select>
            <button onClick={() => void loadWaybills()}>Обновить</button>
          </div>

          <div className="grid2" style={{ marginBottom: 12 }}>
            <div className="card">
              <h3>Остатки на других складах</h3>
              <p className="muted">
                Раздел в шапке: {objectSectionFilter === "SS" ? "СС" : "ЭОМ"} · показаны склады вашего доступа, кроме текущего
                объекта.
              </p>
              {!activeObjectId ? (
                <p className="muted">Выберите объект в шапке.</p>
              ) : peerSummaries.length === 0 ? (
                <p className="muted">Нет сумм по другим складам (в доступе один объект или нет строк остатков).</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Склад</th>
                      <th>Позиций</th>
                      <th>Сумма количества</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peerSummaries.map((p) => (
                      <tr key={p.warehouseId}>
                        <td>{safeName(p.warehouseName)}</td>
                        <td>{p.stockLines}</td>
                        <td>{p.totalQty.toLocaleString("ru-RU")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="card">
              <h3>Заявка на перемещение</h3>
              {!canWriteWaybills ? (
                <p className="muted">Недостаточно прав (<code>waybills.write</code>).</p>
              ) : (
                <div className="form">
                  <label>
                    Склад-отправитель
                    <select value={transferReqFromWarehouseId} onChange={(e) => setTransferReqFromWarehouseId(e.target.value)}>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {safeName(w.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Склад-получатель
                    <select value={transferReqToWarehouseId} onChange={(e) => setTransferReqToWarehouseId(e.target.value)}>
                      {warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {safeName(w.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Материал · количество
                    <select value={transferReqMaterialId} onChange={(e) => setTransferReqMaterialId(e.target.value)}>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0.001}
                      step={0.001}
                      value={transferReqQty}
                      onChange={(e) => setTransferReqQty(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Комментарий
                    <input value={transferReqNote} onChange={(e) => setTransferReqNote(e.target.value)} />
                  </label>
                  <button type="button" disabled={transferReqSaving || transferReqFromWarehouseId === transferReqToWarehouseId} onClick={() => void submitWarehouseTransferRequest()}>
                    Отправить заявку
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <h3>Список заявок на перемещение</h3>
            {transferRequests.length === 0 ? (
              <p className="muted">Заявок нет.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Номер</th>
                    <th>Статус</th>
                    <th>Маршрут</th>
                    <th>Состав</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {transferRequests.map((tr) => (
                    <tr key={tr.id}>
                      <td>{tr.number}</td>
                      <td>{transferRequestStatusLabel(tr.status)}</td>
                      <td>
                        {safeName(tr.fromWarehouseName || tr.fromWarehouseId)} → {safeName(tr.toWarehouseName || tr.toWarehouseId)} ·{" "}
                        {tr.section}
                      </td>
                      <td>
                        {(tr.lines || []).map((ln) => (
                          <div key={`${tr.id}:${ln.materialId}`}>
                            {ln.materialName} · {ln.quantity} {ln.unit}
                          </div>
                        ))}
                      </td>
                      <td>
                        <div className="toolbar" style={{ flexWrap: "wrap" }}>
                          {tr.status === "NEW" ? (
                            <>
                              {canWriteWaybills ? (
                                <>
                                  <button type="button" className="ghostBtn" onClick={() => void patchWarehouseTransferStatus(tr.id, "APPROVED")}>
                                    Согласовать
                                  </button>
                                  <button type="button" className="ghostBtn" onClick={() => void patchWarehouseTransferStatus(tr.id, "REJECTED")}>
                                    Отказать
                                  </button>
                                </>
                              ) : null}
                              {me?.id === tr.requestedById ? (
                                <button type="button" className="ghostBtn" onClick={() => void patchWarehouseTransferStatus(tr.id, "CANCELLED")}>
                                  Отменить
                                </button>
                              ) : null}
                            </>
                          ) : null}
                          {tr.status === "APPROVED" && canWriteWaybills ? (
                            <button type="button" className="ghostBtn" onClick={() => void patchWarehouseTransferStatus(tr.id, "DONE")}>
                              Завершить
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="grid2">
            <div className="card">
              <h3>Новая ТН</h3>
              <div className="form">
                <label>
                  Склад отправитель
                  <select value={waybillFromWarehouseId} onChange={(e) => setWaybillFromWarehouseId(e.target.value)}>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{safeName(w.name)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Точка назначения
                  <input value={waybillToLocation} onChange={(e) => setWaybillToLocation(e.target.value)} />
                </label>
                <label>
                  Отправитель
                  <input value={waybillSender} onChange={(e) => setWaybillSender(e.target.value)} />
                </label>
                <label>
                  Получатель
                  <input value={waybillRecipient} onChange={(e) => setWaybillRecipient(e.target.value)} />
                </label>
                <label>
                  Транспорт / водитель
                  <input value={waybillVehicle} onChange={(e) => setWaybillVehicle(e.target.value)} placeholder="Транспорт" />
                  <input value={waybillDriver} onChange={(e) => setWaybillDriver(e.target.value)} placeholder="Водитель" />
                </label>
                <label>
                  Материал и количество
                  <select value={waybillMaterialId} onChange={(e) => setWaybillMaterialId(e.target.value)}>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <input type="number" min={0.001} step={0.001} value={waybillQty} onChange={(e) => setWaybillQty(Number(e.target.value))} />
                </label>
                <button
                  onClick={async () => {
                    if (!token || !waybillFromWarehouseId || !waybillMaterialId || !waybillToLocation) return;
                    setWaybillsMessage("");
                    setWaybillsTone("neutral");
                    const res = await fetchWithSession(`${API_URL}/api/waybills`, {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                      body: JSON.stringify({
                        fromWarehouseId: waybillFromWarehouseId,
                        toLocation: waybillToLocation,
                        sender: waybillSender,
                        recipient: waybillRecipient,
                        vehicle: waybillVehicle,
                        driverName: waybillDriver,
                        items: [{ materialId: waybillMaterialId, quantity: waybillQty }]
                      })
                    });
                    if (!res.ok) {
                      setWaybillsMessage("Ошибка создания ТН");
                      setWaybillsTone(res.status === 409 ? "conflict" : "error");
                      return;
                    }
                    setWaybillsMessage("ТН создана");
                    setWaybillsTone("success");
                    await loadWaybills();
                  }}
                >
                  Создать ТН
                </button>
              </div>
            </div>

            <div className="card">
              <h3>Список ТН</h3>
              {waybillsMessage && <ResultBanner text={waybillsMessage} tone={waybillsTone} />}
              {!waybillsLoading && !waybillsError && !waybills.length && <EmptyState title="ТН пока нет" hint="Создай первую транспортную накладную." />}
              {waybillsLoading && <LoadingState text="Загрузка списка ТН..." />}
              {waybillsError && <ErrorState text={waybillsError} />}
              {!waybillsLoading && !waybillsError && waybills.length > 0 && (
              <>
              <div className="toolbar">
                <select value={waybillsSort} onChange={(e) => setWaybillsSort(e.target.value as typeof waybillsSort)}>
                  <option value="created_desc">Сначала новые</option>
                  <option value="status">По статусу</option>
                  <option value="number">По номеру</option>
                </select>
                <select value={selectedWaybillId} onChange={(e) => setSelectedWaybillId(e.target.value)}>
                  {waybills.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.number} ({waybillStatusLabel(w.status)})
                    </option>
                  ))}
                </select>
                <button onClick={() => void loadWaybillEvents(selectedWaybillId)}>История статусов</button>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Номер</th>
                    <th>Статус</th>
                    <th>Маршрут</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {waybills.map((w) => (
                    <tr key={w.id}>
                      <td>{w.number}</td>
                      <td><span className={`badge ${statusClass(w.status)}`}>{waybillStatusLabel(w.status)}</span></td>
                      <td>{w.toLocation}</td>
                      <td>
                        <div className="toolbar">
                          <button onClick={() => { setSelectedWaybillId(w.id); setDrawerMode("waybill"); }}>Детали</button>
                          <button onClick={() => void executeWaybillStatus(w.id, "FORMED", "Сформировано в интерфейсе")}>Сформировать</button>
                          <button onClick={() => void executeWaybillStatus(w.id, "SHIPPED", "Отгружено к месту назначения")}>Отгружено</button>
                          <button onClick={() => void executeWaybillStatus(w.id, "RECEIVED", "Получено в пункте назначения")}>Получено</button>
                          <button onClick={() => void executeWaybillStatus(w.id, "CLOSED", "Закрыто")}>Закрыть</button>
                          <button onClick={async () => { await openWaybillPdf(w.id, w.number); }}>PDF</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h3>История статусов</h3>
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Статус</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {waybillEvents.map((e) => (
                    <tr key={e.id}>
                      <td>{new Date(e.createdAt).toLocaleString()}</td>
                      <td>{waybillStatusLabel(e.status)}</td>
                      <td>{e.comment || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="toolbar">
                <span className="muted">
                  Показано {Math.min((waybillsPage - 1) * waybillsPageSize + 1, waybillsTotal)}-
                  {Math.min(waybillsPage * waybillsPageSize, waybillsTotal)} из {waybillsTotal}
                </span>
                <select
                  value={waybillsPageSize}
                  onChange={(e) => setWaybillsPageSize(Number(e.target.value) as ListPageSize)}
                  aria-label="Размер страницы ТН"
                >
                  <option value={20}>20 на стр.</option>
                  <option value={50}>50 на стр.</option>
                  <option value={100}>100 на стр.</option>
                </select>
                <button type="button" onClick={() => setWaybillsPage((p) => Math.max(1, p - 1))} disabled={waybillsPage <= 1}>
                  Назад
                </button>
                <span className="muted">Стр. {waybillsPage} / {waybillsTotalPages}</span>
                <button type="button" onClick={() => setWaybillsPage((p) => Math.min(waybillsTotalPages, p + 1))} disabled={waybillsPage >= waybillsTotalPages}>
                  Вперед
                </button>
              </div>
              </>
              )}
            </div>
          </div>
          <div className="actionBar">
            <button onClick={() => setWaybillStatusFilter("DRAFT")}>Черновики</button>
            <button onClick={() => setWaybillStatusFilter("SHIPPED")}>В пути</button>
            <button onClick={() => setWaybillStatusFilter("RECEIVED")}>Полученные</button>
            <button onClick={() => setWaybillStatusFilter("")}>Все ТН</button>
          </div>
        </div>
      )}

      {drawerMode === "issue" && selectedIssue && (
        <aside className="detailDrawer">
          <div className="detailDrawerHeader">
            <h3>Карточка заявки {selectedIssue.number}</h3>
            <button onClick={() => setDrawerMode("")}>Закрыть</button>
          </div>
          <p><strong>Статус:</strong> <span className={`badge ${statusClass(selectedIssue.status)}`}>{issueStatusLabel(selectedIssue.status)}</span></p>
          <div className="card processCard">
            <h4>Шаг процесса</h4>
            <p className="muted">Текущий этап: <strong>{issueProcessStep(selectedIssue.status)}</strong></p>
            <div className="toolbar">
              {selectedIssue.status === "DRAFT" && (
                <button onClick={() => void executeIssueAction(selectedIssue.id, "send-for-approval", { closeDrawer: true })}>
                  В заявки
                </button>
              )}
              {selectedIssue.status === "ON_APPROVAL" && (
                <>
                  <button onClick={() => void executeIssueAction(selectedIssue.id, "approve", { closeDrawer: true })}>Одобрить</button>
                  <button className="dangerBtn" onClick={() => void executeIssueAction(selectedIssue.id, "reject", { closeDrawer: true })}>Отклонить</button>
                </>
              )}
              {(selectedIssue.status === "DRAFT" || selectedIssue.status === "APPROVED") && (
                <button className="secondaryBtn" onClick={() => void executeIssueAction(selectedIssue.id, "issue", { closeDrawer: true })}>
                  Выдать
                </button>
              )}
              {(selectedIssue.status === "DRAFT" || selectedIssue.status === "ON_APPROVAL") && (
                <button className="dangerBtn" onClick={() => void executeIssueAction(selectedIssue.id, "cancel", { closeDrawer: true })}>
                  Отменить
                </button>
              )}
            </div>
          </div>
          <p><strong>Склад:</strong> {selectedIssue.warehouse?.name || selectedIssue.warehouseId}</p>
          {selectedIssue.note ? <p><strong>Примечание:</strong> {selectedIssue.note}</p> : null}
          <p><strong>Ответственный:</strong> {selectedIssue.responsibleName || "—"}</p>
          <p><strong>Фактически получил:</strong> {selectedIssue.actualRecipientName || "—"}</p>
          <p><strong>Инициатор:</strong> {selectedIssue.requestedBy?.fullName || selectedIssue.requestedById}</p>
          {selectedIssue.approvedBy ? (
            <p><strong>Одобрил:</strong> {selectedIssue.approvedBy.fullName}</p>
          ) : null}
          <p><strong>Создана:</strong> {new Date(selectedIssue.createdAt).toLocaleString()}</p>
          {selectedIssue.toolItems && selectedIssue.toolItems.length > 0 ? (
            <div>
              <h4>Инструменты</h4>
              <table>
                <thead>
                  <tr>
                    <th>Инв. №</th>
                    <th>Наименование</th>
                    <th>Статус карточки</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedIssue.toolItems.map((line) => (
                    <tr key={line.id}>
                      <td>{line.tool?.inventoryNumber || line.toolId.slice(0, 8)}</td>
                      <td>{safeName(line.tool?.name || line.toolId)}</td>
                      <td>{line.tool?.status ? toolStatusLabel(line.tool.status as ToolStatus) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {selectedIssue.items && selectedIssue.items.length > 0 ? (
            <div>
              <h4>Позиции</h4>
              <table>
                <thead>
                  <tr><th>Материал</th><th>Кол-во</th></tr>
                </thead>
                <tbody>
                  {selectedIssue.items.map((line) => (
                    <tr key={line.id}>
                      <td>{safeName(line.factLabel?.trim() || line.material?.name || line.materialId)}</td>
                      <td>{String(line.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="toolbar">
            <button onClick={() => openDocumentsForEntity("issue", selectedIssue.id)}>Файлы</button>
            <button onClick={() => setActiveTab("issues")}>Открыть список</button>
          </div>
        </aside>
      )}

      {drawerMode === "waybill" && selectedWaybill && (
        <aside className="detailDrawer">
          <div className="detailDrawerHeader">
            <h3>Карточка ТН {selectedWaybill.number}</h3>
            <button onClick={() => setDrawerMode("")}>Закрыть</button>
          </div>
          <p><strong>Статус:</strong> <span className={`badge ${statusClass(selectedWaybill.status)}`}>{waybillStatusLabel(selectedWaybill.status)}</span></p>
          <div className="card processCard">
            <h4>Шаг процесса</h4>
            <p className="muted">Текущий этап: <strong>{waybillProcessStep(selectedWaybill.status)}</strong></p>
            <div className="toolbar">
              {selectedWaybill.status === "DRAFT" && (
                <button onClick={() => void executeWaybillStatus(selectedWaybill.id, "FORMED", "Сформировано в карточке ТН")}>Сформировать</button>
              )}
              {selectedWaybill.status === "FORMED" && (
                <button onClick={() => void executeWaybillStatus(selectedWaybill.id, "SHIPPED", "Отгружено к месту назначения")}>Отгрузить</button>
              )}
              {selectedWaybill.status === "SHIPPED" && (
                <button onClick={() => void executeWaybillStatus(selectedWaybill.id, "RECEIVED", "Получено в пункте назначения")}>Подтвердить получение</button>
              )}
              {selectedWaybill.status === "RECEIVED" && (
                <button className="secondaryBtn" onClick={() => void executeWaybillStatus(selectedWaybill.id, "CLOSED", "Закрыто после подтверждения")}>Закрыть ТН</button>
              )}
            </div>
            {waybillEvents.length ? (
              <p className="muted">
                Последнее событие: {new Date(waybillEvents[0].createdAt).toLocaleString()} — {waybillStatusLabel(waybillEvents[0].status)}
              </p>
            ) : null}
          </div>
          <p><strong>Маршрут:</strong> {selectedWaybill.toLocation}</p>
          <p><strong>Отправитель:</strong> {selectedWaybill.sender || "-"}</p>
          <p><strong>Получатель:</strong> {selectedWaybill.recipient || "-"}</p>
          <p><strong>Транспорт:</strong> {selectedWaybill.vehicle || "-"}</p>
          <p><strong>Водитель:</strong> {selectedWaybill.driverName || "-"}</p>
          <div className="toolbar">
            <button onClick={() => void openWaybillPdf(selectedWaybill.id, selectedWaybill.number)}>PDF</button>
            <button onClick={() => setActiveTab("waybills")}>Открыть список</button>
          </div>
        </aside>
      )}

      {drawerMode === "adminUser" && adminDrawerUser && (
        <aside className="detailDrawer detailDrawerAdminUser">
          <div className="detailDrawerHeader">
            <h3>{adminDrawerUser.fullName}</h3>
            <button type="button" onClick={() => setDrawerMode("")}>
              Закрыть
            </button>
          </div>
          <p className="muted">{adminDrawerUser.email}</p>
          <div className="form">
            <label>
              Роль
              <select value={selectedRoleName} onChange={(e) => setSelectedRoleName(e.target.value)}>
                {roles.map((r) => (
                  <option key={r.id} value={r.name}>
                    {roleLabel(r.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Статус
              <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value as "ACTIVE" | "BLOCKED")}>
                <option value="ACTIVE">{statusLabel("ACTIVE")}</option>
                <option value="BLOCKED">{statusLabel("BLOCKED")}</option>
              </select>
            </label>
            <label>
              Новый пароль (сброс)
              <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </label>
            <label>
              Должность
              <select value={selectedPositionId} onChange={(e) => setSelectedPositionId(e.target.value)}>
                <option value="">Не выбрана</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid2" style={{ marginTop: 12 }}>
            <div>
              <h4>Склады (scope)</h4>
              <p className="muted">Пусто — без фильтра по складу, пользователь переключает объект сам.</p>
              <div className="plainList">
                {warehouses.map((w) => (
                  <label key={`adm-drawer-wh-${w.id}`} style={{ display: "block" }}>
                    <input
                      type="checkbox"
                      checked={selectedWarehouseScopes.includes(w.id)}
                      onChange={(e) => {
                        setSelectedWarehouseScopes((prev) =>
                          e.target.checked ? [...prev, w.id] : prev.filter((id) => id !== w.id)
                        );
                      }}
                    />{" "}
                    {safeName(w.name)}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h4>Проекты (scope)</h4>
              <p className="muted">Пусто — без ограничения по проекту.</p>
              <div className="plainList">
                {projects.map((p) => (
                  <label key={`adm-drawer-pr-${p.id}`} style={{ display: "block" }}>
                    <input
                      type="checkbox"
                      checked={selectedProjectScopes.includes(p.id)}
                      onChange={(e) => {
                        setSelectedProjectScopes((prev) =>
                          e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                        );
                      }}
                    />{" "}
                    {safeName(p.name)}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="toolbar">
            <button
              type="button"
              onClick={async () => {
                if (!token || !selectedUserId) return;
                setAdminMessage("");
                const res = await fetchWithSession(`${API_URL}/api/admin/users/${selectedUserId}/scopes`, {
                  method: "PUT",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    warehouseIds: selectedWarehouseScopes,
                    projectIds: selectedProjectScopes
                  })
                });
                if (!res.ok) {
                  setAdminMessage("Ошибка сохранения scope");
                  return;
                }
                setAdminMessage("Области (склады/проекты) сохранены");
                await loadAdminData();
              }}
            >
              Сохранить scope
            </button>
          </div>
          <div className="card" style={{ marginTop: 10 }}>
            <h4>Вкладки и модули</h4>
            <div className="plainList">
              {sidebarAccessOptions.map((opt) => (
                <label key={`adm-drawer-perm-${opt.id}`} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={opt.permissions.some((p) => selectedPermissions.includes(p))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedPermissions((prev) => Array.from(new Set([...prev, ...opt.permissions])));
                      } else {
                        setSelectedPermissions((prev) => prev.filter((p) => !opt.permissions.includes(p)));
                      }
                    }}
                  />{" "}
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div className="toolbar">
            <button
              type="button"
              onClick={async () => {
                if (!token || !selectedUserId) return;
                setAdminMessage("");
                const res = await fetchWithSession(`${API_URL}/api/admin/users/${selectedUserId}/access`, {
                  method: "PATCH",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    roleName: selectedRoleName,
                    status: selectedStatus,
                    permissions: selectedPermissions,
                    positionId: selectedPositionId || null
                  })
                });
                if (!res.ok) {
                  setAdminMessage("Ошибка сохранения доступа");
                  return;
                }
                setAdminMessage("Доступы обновлены");
                await loadAdminData();
              }}
            >
              Сохранить доступы
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!token || !selectedUserId) return;
                setAdminMessage("");
                const res = await fetchWithSession(`${API_URL}/api/admin/users/${selectedUserId}/reset-password`, {
                  method: "PATCH",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({ newPassword })
                });
                if (!res.ok) {
                  setAdminMessage("Ошибка сброса пароля");
                  return;
                }
                setAdminMessage("Пароль сброшен");
              }}
            >
              Сбросить пароль
            </button>
          </div>
          {me?.id !== adminDrawerUser.id ? (
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="dangerBtn"
                disabled={!token}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `Удалить пользователя «${adminDrawerUser.fullName}»? Это нельзя откатить.`
                    )
                  ) {
                    return;
                  }
                  if (!token) return;
                  setAdminMessage("");
                  // Сначала пробуем «безопасное» удаление, если 409 — предлагаем force.
                  const tryDelete = async (force: boolean) =>
                    fetchWithSession(
                      `${API_URL}/api/admin/users/${encodeURIComponent(selectedUserId)}${force ? "?force=1" : ""}`,
                      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
                    );
                  let res = await tryDelete(false);
                  let body = (await res.json().catch(() => ({}))) as {
                    error?: string;
                    issuesAsAuthor?: number;
                    documentLinks?: number;
                    materialReportAsHolder?: number;
                    materialReportAsActor?: number;
                    transferRequests?: number;
                  };
                  if (res.status === 400 && body.error === "SELF_DELETE_FORBIDDEN") {
                    setAdminMessage("Нельзя удалить собственную учётную запись.");
                    return;
                  }
                  if (res.status === 409 && body.error === "USER_HAS_REFERENCES") {
                    const detail = [
                      body.issuesAsAuthor ? `заявок как автор: ${body.issuesAsAuthor}` : "",
                      body.documentLinks ? `связей с файлами: ${body.documentLinks}` : "",
                      body.materialReportAsHolder ? `записей мат. отчёта (подотчёт): ${body.materialReportAsHolder}` : "",
                      body.materialReportAsActor ? `записей мат. отчёта (исполнитель): ${body.materialReportAsActor}` : "",
                      body.transferRequests ? `заявок на перемещение: ${body.transferRequests}` : ""
                    ].filter(Boolean).join("; ");
                    if (
                      !window.confirm(
                        `Пользователь связан с данными: ${detail}.\n\nПринудительно удалить? История (заявки/перемещения/мат.отчёт) будет перепривязана на ТЕКУЩЕГО админа.`
                      )
                    ) {
                      setAdminMessage("Удаление отменено.");
                      return;
                    }
                    res = await tryDelete(true);
                    body = (await res.json().catch(() => ({}))) as typeof body;
                  }
                  if (!res.ok) {
                    setAdminMessage(body.error || "Не удалось удалить пользователя");
                    return;
                  }
                  setAdminMessage("Пользователь удалён");
                  const delId = selectedUserId;
                  setDrawerMode("");
                  const refreshedList = await loadAdminData();
                  setSelectedUserId(refreshedList?.find((u) => u.id !== delId)?.id ?? refreshedList?.[0]?.id ?? "");
                }}
              >
                Удалить пользователя
              </button>
            </div>
          ) : (
            <p className="muted" style={{ marginTop: 12 }}>
              Свою учётную запись здесь удалить нельзя.
            </p>
          )}
        </aside>
      )}

      {activeTab === "qr" && (
        <div className="card">
          <h2>QR-сканирование</h2>
          <div className="toolbar">
            <input
              placeholder="Вставь QR/код инструмента: TOOL:INV-001 или инв. номер"
              value={qrCode}
              onChange={(e) => setQrCode(e.target.value)}
            />
            <button onClick={() => void resolveQrCode()}>Найти</button>
            <button
              type="button"
              onClick={() => {
                setQrMessage("");
                setQrScanError("");
                setQrScanning((v) => !v);
              }}
            >
              {qrScanning ? "Остановить сканер" : "Сканировать камерой"}
            </button>
          </div>
          {qrMessage && <p className="muted">{qrMessage}</p>}
          {qrScanError && <p className="error">{qrScanError}</p>}
          {qrScanning && (
            <div className="qrScanner">
              <video ref={qrVideoRef} className="qrVideo" autoPlay muted playsInline />
              <p className="muted">Наведи камеру на QR-код инструмента.</p>
            </div>
          )}

          {qrResult?.kind === "tool" && (
            <div className="card">
              <h3>{qrResult.tool.name}</h3>
              <p className="muted">Инв. номер: {qrResult.tool.inventoryNumber}</p>
              <p className="muted">Статус: {toolStatusLabel(qrResult.tool.status)}</p>
              <div className="toolbar">
                <button onClick={() => { setActiveTab("tools"); }}>Открыть модуль инструмента</button>
                <button onClick={() => openToolActionDialog(qrResult.tool.id, "ISSUE")}>Выдать</button>
                <button onClick={() => openToolActionDialog(qrResult.tool.id, "RETURN")}>Вернуть</button>
                <button onClick={() => openToolActionDialog(qrResult.tool.id, "SEND_TO_REPAIR")}>В ремонт</button>
                <button onClick={() => openToolActionDialog(qrResult.tool.id, "MARK_DISPUTED")}>Спор</button>
                <button
                  onClick={async () => {
                    if (!token) return;
                    const res = await fetchWithSession(`${API_URL}/api/tools/${qrResult.tool.id}/qr`, {
                      headers: { Authorization: `Bearer ${token}` }
                    });
                    if (!res.ok) return;
                    const data = (await res.json()) as { id: string; dataUrl: string; qrCode: string };
                    setToolQrPreview({ toolId: data.id, dataUrl: data.dataUrl, qrCode: data.qrCode });
                    setActiveTab("tools");
                  }}
                >
                  Показать QR
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "tools" && (
        <div className="card">
          <div className="rightCardHeader" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0 }}>Инструменты</h2>
              <p className="muted" style={{ margin: "6px 0 0", maxWidth: 720 }}>
                Сначала выберите категорию. Затем нажмите карточку инструмента, чтобы открыть действия и журнал. Ручное создание — отдельной кнопкой.
              </p>
            </div>
            <div className="toolbar" style={{ justifyContent: "flex-end", flexWrap: "wrap" }}>
              {toolDrilledCard ? (
                <button type="button" className="ghostBtn" onClick={() => setToolDrilledCard(null)}>
                  ← Все категории
                </button>
              ) : null}
              {hasPermission("tools.write") && (
                <button type="button" className="ghostBtn" onClick={() => setToolCategoryAdminOpen(true)}>
                  Управление категориями
                </button>
              )}
              <PeriodExportButton
                section="tools"
                token={token}
                apiUrl={API_URL}
                fetchWithSession={fetchWithSession}
                title="Инструменты в Excel"
              />
            </div>
          </div>
          <p className="muted">Текущий раздел: {objectSectionFilter}{toolDrilledCard ? ` · Категория: ${toolDrilledCard.label}` : ""}</p>

          {!toolDrilledCard && (
            <>
              {toolGroupCardsLoading ? (
                <LoadingState text="Загрузка категорий..." />
              ) : !toolGroupCards.length ? (
                <EmptyState
                  title="Категорий пока нет"
                  hint="Импортируйте или добавьте инструменты — по их названиям соберутся карточки автоматически. Можно создать свою категорию."
                />
              ) : (
                <div className="toolsCardGrid" style={{ marginTop: 8 }}>
                  {toolGroupCards.map((card) => (
                    <article
                      key={`tcat-${card.key}`}
                      className="toolMiniCard"
                      style={{ cursor: "pointer", borderLeft: `4px solid ${card.type === "CATEGORY" ? "#2563eb" : "#94a3b8"}` }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setToolDrilledCard(card);
                          setToolsPage(1);
                        }
                      }}
                      onClick={() => {
                        setToolDrilledCard(card);
                        setToolsPage(1);
                      }}
                    >
                      <div className="toolMiniCardTop">
                        <strong className="toolMiniCardTitle">
                          {card.icon ? `${card.icon} ` : ""}{card.label}
                        </strong>
                        <span className="badge ok">{card.count}</span>
                      </div>
                      <p className="muted toolMiniCardMeta">
                        {card.type === "CATEGORY" ? "Категория (ручная)" : "Группа по названию"}
                      </p>
                      <p className="muted toolMiniCardMeta" style={{ fontSize: 12 }}>
                        на складе {card.inStock} · выдано {card.issued}
                        {card.inRepair ? ` · в ремонте ${card.inRepair}` : ""}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          {toolDrilledCard && (
          <>
          {toolWarehouseSummary.length > 1 && (
            <div className="card" style={{ marginBottom: 12, background: "rgba(148, 163, 184, 0.08)" }}>
              <h3 style={{ marginTop: 0 }}>Срез по объектам</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Сводка по доступным складам. Удобно, если вы не закреплены за одним объектом или ведёте несколько площадок.
              </p>
              <div className="toolbar" style={{ flexWrap: "wrap" }}>
                <button
                  type="button"
                  className={`ghostBtn${!toolListWarehouseId ? " active" : ""}`}
                  onClick={() => setToolListWarehouseId("")}
                >
                  Все объекты · {toolWarehouseSummary.reduce((s, x) => s + x.count, 0)} шт.
                </button>
                {toolWarehouseSummary.map((row) => (
                  <button
                    type="button"
                    key={`tw-sum-${row.warehouseId ?? "none"}`}
                    className={`ghostBtn${toolListWarehouseId === (row.warehouseId ?? "") ? " active" : ""}`}
                    onClick={() => setToolListWarehouseId(row.warehouseId ?? "")}
                  >
                    {row.warehouseName}: {row.count} (на складе {row.inStock}, выдано {row.issued})
                  </button>
                ))}
              </div>
            </div>
          )}

          {toolsLoading && <LoadingState text="Загрузка инструментов..." />}
          {toolsError && <ErrorState text={toolsError} />}

          <div className="toolbar" style={{ flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <input
              placeholder="Поиск (название, инв. номер, QR)"
              value={toolSearch}
              onChange={(e) => setToolSearch(e.target.value)}
            />
            <select value={toolStatusFilter} onChange={(e) => setToolStatusFilter((e.target.value || "") as "" | ToolStatus)}>
              <option value="">Все статусы</option>
              <option value="IN_STOCK">{toolStatusLabel("IN_STOCK")}</option>
              <option value="ISSUED">{toolStatusLabel("ISSUED")}</option>
              <option value="IN_REPAIR">{toolStatusLabel("IN_REPAIR")}</option>
              <option value="DAMAGED">{toolStatusLabel("DAMAGED")}</option>
              <option value="LOST">{toolStatusLabel("LOST")}</option>
              <option value="WRITTEN_OFF">{toolStatusLabel("WRITTEN_OFF")}</option>
              <option value="DISPUTED">{toolStatusLabel("DISPUTED")}</option>
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
              <span className="muted">Объект</span>
              <select value={toolListWarehouseId} onChange={(e) => setToolListWarehouseId(e.target.value)}>
                <option value="">Все в зоне доступа</option>
                {warehouses.map((w) => (
                  <option key={`twf-${w.id}`} value={w.id}>
                    {safeName(w.name)}
                  </option>
                ))}
              </select>
            </label>
            <select value={toolsSort} onChange={(e) => setToolsSort(e.target.value as typeof toolsSort)}>
              <option value="created_desc">Сначала новые</option>
              <option value="inventory">По инвентарному номеру</option>
              <option value="status">По статусу</option>
            </select>
            <button type="button" onClick={() => void loadTools().then(() => loadToolWarehouseSummary())}>
              Обновить список
            </button>
            {hasPermission("tools.write") && (
              <button
                type="button"
                className="primaryBtn"
                onClick={() => {
                  setToolsMessage("");
                  setToolsTone("neutral");
                  setToolName("");
                  setToolSerialNumber("");
                  setToolResponsible("");
                  setToolInventoryNumber(`INV-${Date.now()}`);
                  if (activeObjectId) setToolWarehouseId(activeObjectId);
                  setToolManualModalOpen(true);
                }}
              >
                Добавить вручную
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                if (!token || !selectedToolIds.length) {
                  setToolsMessage("Отметьте карточки для печати или откройте одну и сохраните");
                  setToolsTone("conflict");
                  return;
                }
                const res = await fetchWithSession(`${API_URL}/api/tools/labels/pdf?ids=${encodeURIComponent(selectedToolIds.join(","))}`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (!res.ok) {
                  setToolsMessage("Не удалось сформировать PDF");
                  setToolsTone("error");
                  return;
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "tool-labels.pdf";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Печать QR (PDF)
            </button>
          </div>
          {toolsMessage && <ResultBanner text={toolsMessage} tone={toolsTone} />}
          {!toolsLoading && !toolsError && !tools.length && (
            <EmptyState title="Инструменты не найдены" hint="Смените фильтры или добавьте карточку вручную." />
          )}
          {toolQrPreview && (
            <div className="card">
              <h3>QR предпросмотр: {toolQrPreview.qrCode}</h3>
              <img src={toolQrPreview.dataUrl} alt="Tool QR preview" style={{ maxWidth: 220 }} />
            </div>
          )}
          {!toolsLoading && !toolsError && tools.length > 0 && (
            <>
              <p className="muted" style={{ marginBottom: 8 }}>
                Отметьте позиции для массовой печати QR. Клик по карточке открывает детали.
              </p>
              <div className="toolsCardGrid">
                {tools.map((t) => (
                  <article
                    key={`tc-${t.id}`}
                    className="toolMiniCard"
                    style={{ cursor: "pointer" }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setToolDetailModalId(t.id);
                        setSelectedToolForEvents(t.id);
                        void loadToolEvents(t.id);
                      }
                    }}
                    onClick={() => {
                      setToolDetailModalId(t.id);
                      setSelectedToolForEvents(t.id);
                      void loadToolEvents(t.id);
                    }}
                  >
                    <div className="toolMiniCardTop">
                      <label className="toolMiniCardCheck" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedToolIds.includes(t.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedToolIds((prev) => [...prev, t.id]);
                            } else {
                              setSelectedToolIds((prev) => prev.filter((id) => id !== t.id));
                            }
                          }}
                        />
                      </label>
                      <strong className="toolMiniCardTitle">{safeName(t.name)}</strong>
                      <span className={`badge ${statusClass(t.status)}`}>{toolStatusLabel(t.status)}</span>
                    </div>
                    <p className="muted toolMiniCardMeta">
                      Инв. <strong>{t.inventoryNumber}</strong>
                      {t.serialNumber ? ` · с/н ${t.serialNumber}` : ""}
                      {t.warehouse?.name ? ` · ${safeName(t.warehouse.name)}` : ""}
                    </p>
                    <p className="muted toolMiniCardMeta" style={{ fontSize: 12 }}>
                      Нажмите карточку, чтобы выдать, вернуть или открыть журнал
                    </p>
                  </article>
                ))}
              </div>
              <div className="toolbar">
                <span className="muted">
                  Показано {Math.min((toolsPage - 1) * toolsPageSize + 1, toolsTotal)}-
                  {Math.min(toolsPage * toolsPageSize, toolsTotal)} из {toolsTotal}
                </span>
                <select
                  value={toolsPageSize}
                  onChange={(e) => setToolsPageSize(Number(e.target.value) as ListPageSize)}
                  aria-label="Размер страницы инструментов"
                >
                  <option value={20}>20 на стр.</option>
                  <option value={50}>50 на стр.</option>
                  <option value={100}>100 на стр.</option>
                </select>
                <button type="button" onClick={() => setToolsPage((p) => Math.max(1, p - 1))} disabled={toolsPage <= 1}>
                  Назад
                </button>
                <span className="muted">
                  Стр. {toolsPage} / {toolsTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setToolsPage((p) => Math.min(toolsTotalPages, p + 1))}
                  disabled={toolsPage >= toolsTotalPages}
                >
                  Вперед
                </button>
              </div>
            </>
          )}
          </>
          )}

          {toolManualModalOpen && hasPermission("tools.write") && (
            <div
              role="dialog"
              aria-modal="true"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15, 23, 42, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 55,
                padding: 16
              }}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setToolManualModalOpen(false);
              }}
            >
              <div className="card" style={{ maxWidth: 520, width: "100%" }} onMouseDown={(e) => e.stopPropagation()}>
                <h3 style={{ marginTop: 0 }}>Новый инструмент вручную</h3>
                <div className="form">
                  <label>
                    Наименование
                    <input value={toolName} onChange={(e) => setToolName(e.target.value)} placeholder="Например, перфоратор" />
                  </label>
                  <label>
                    Инвентарный номер
                    <input value={toolInventoryNumber} onChange={(e) => setToolInventoryNumber(e.target.value)} />
                  </label>
                  <label>
                    Серийный номер
                    <input value={toolSerialNumber} onChange={(e) => setToolSerialNumber(e.target.value)} />
                  </label>
                  <label>
                    Объект (склад)
                    <select value={toolWarehouseId} onChange={(e) => setToolWarehouseId(e.target.value)}>
                      <option value="">Не указан</option>
                      {warehouses.map((w) => (
                        <option key={`tmw-${w.id}`} value={w.id}>
                          {safeName(w.name)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Ответственный при создании
                    <input value={toolResponsible} onChange={(e) => setToolResponsible(e.target.value)} />
                  </label>
                  <label>
                    Категория (необязательно)
                    <select value={toolCategoryDraft} onChange={(e) => setToolCategoryDraft(e.target.value)}>
                      <option value="">— по умолчанию (группа по названию) —</option>
                      {toolCategories.map((c) => (
                        <option key={`tcat-opt-${c.id}`} value={c.id}>
                          {c.icon ? `${c.icon} ` : ""}{c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="toolbar" style={{ justifyContent: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
                  <button type="button" className="ghostBtn" onClick={() => setToolManualModalOpen(false)}>
                    Отмена
                  </button>
                  <button
                    type="button"
                    disabled={!toolName.trim() || !toolInventoryNumber.trim()}
                    onClick={async () => {
                      if (!token || !toolName.trim() || !toolInventoryNumber.trim()) return;
                      setToolsMessage("");
                      setToolsTone("neutral");
                      const res = await fetchWithSession(`${API_URL}/api/tools`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: toolName.trim(),
                          inventoryNumber: toolInventoryNumber.trim(),
                          serialNumber: toolSerialNumber.trim() || undefined,
                          warehouseId: toolWarehouseId || undefined,
                          section: objectSectionFilter,
                          responsible: toolResponsible.trim() || undefined,
                          categoryId: toolCategoryDraft || undefined
                        })
                      });
                      if (!res.ok) {
                        const text = await res.text();
                        setToolsMessage(`Ошибка создания: ${text}`);
                        setToolsTone(res.status === 409 ? "conflict" : "error");
                        return;
                      }
                      setToolsMessage("Инструмент создан");
                      setToolsTone("success");
                      setToolManualModalOpen(false);
                      setToolInventoryNumber(`INV-${Date.now()}`);
                      setToolSerialNumber("");
                      setToolCategoryDraft("");
                      await loadTools();
                      await loadToolWarehouseSummary();
                      await loadToolGroupCards();
                    }}
                  >
                    Создать
                  </button>
                </div>
              </div>
            </div>
          )}

          {toolCategoryAdminOpen && hasPermission("tools.write") && (
            <div
              role="dialog"
              aria-modal="true"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15, 23, 42, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 55,
                padding: 16
              }}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setToolCategoryAdminOpen(false);
              }}
            >
              <div
                className="card"
                style={{ maxWidth: 640, width: "100%", maxHeight: "90vh", overflowY: "auto" }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <h3 style={{ marginTop: 0 }}>Категории инструментов</h3>
                  <button type="button" className="ghostBtn" onClick={() => setToolCategoryAdminOpen(false)}>
                    Закрыть
                  </button>
                </div>
                <p className="muted">
                  По умолчанию инструменты группируются по полю «Название». Категории здесь — ручные группы поверх этого.
                </p>
                <div className="toolbar" style={{ alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    placeholder="Новая категория (например, Шуруповёрты)"
                    value={toolCategoryDraftName}
                    onChange={(e) => setToolCategoryDraftName(e.target.value)}
                    style={{ minWidth: 240 }}
                  />
                  <button
                    type="button"
                    disabled={!toolCategoryDraftName.trim()}
                    onClick={async () => {
                      const ok = await createToolCategory(toolCategoryDraftName);
                      if (ok) setToolCategoryDraftName("");
                    }}
                  >
                    Добавить
                  </button>
                </div>
                <table className="desktopTable" style={{ marginTop: 12 }}>
                  <thead>
                    <tr>
                      <th>Название</th>
                      <th style={{ width: 80 }}>Икона</th>
                      <th style={{ width: 80 }}>Порядок</th>
                      <th style={{ width: 200 }}>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {toolCategories.map((c) => {
                      const draft = toolCategoryEdit[c.id] || {
                        name: c.name,
                        icon: c.icon || "",
                        order: String(c.order || 0)
                      };
                      const dirty =
                        draft.name !== c.name ||
                        draft.icon !== (c.icon || "") ||
                        Number(draft.order || 0) !== Number(c.order || 0);
                      return (
                        <tr key={`tcat-row-${c.id}`}>
                          <td>
                            <input
                              value={draft.name}
                              onChange={(e) =>
                                setToolCategoryEdit((prev) => ({
                                  ...prev,
                                  [c.id]: { ...draft, name: e.target.value }
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              value={draft.icon}
                              placeholder="🔧"
                              onChange={(e) =>
                                setToolCategoryEdit((prev) => ({
                                  ...prev,
                                  [c.id]: { ...draft, icon: e.target.value }
                                }))
                              }
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              value={draft.order}
                              onChange={(e) =>
                                setToolCategoryEdit((prev) => ({
                                  ...prev,
                                  [c.id]: { ...draft, order: e.target.value }
                                }))
                              }
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              disabled={!dirty || !draft.name.trim()}
                              onClick={async () => {
                                const ok = await updateToolCategory(c.id, {
                                  name: draft.name.trim(),
                                  icon: draft.icon.trim() || null,
                                  order: Number(draft.order || 0)
                                });
                                if (ok)
                                  setToolCategoryEdit((prev) => {
                                    const next = { ...prev };
                                    delete next[c.id];
                                    return next;
                                  });
                              }}
                            >
                              Сохранить
                            </button>{" "}
                            <button
                              type="button"
                              className="ghostBtn"
                              onClick={() => {
                                if (!window.confirm(`Удалить категорию «${c.name}»? Инструменты останутся, но потеряют привязку.`))
                                  return;
                                void deleteToolCategory(c.id);
                              }}
                            >
                              Удалить
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {!toolCategories.length ? (
                      <tr>
                        <td colSpan={4} className="muted">
                          Категорий пока нет.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {toolDetailModalId && (
            <div
              role="dialog"
              aria-modal="true"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(15, 23, 42, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 56,
                padding: 16,
                overflowY: "auto"
              }}
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) setToolDetailModalId(null);
              }}
            >
              <div
                className="card"
                style={{ maxWidth: 720, width: "100%", maxHeight: "90vh", overflowY: "auto" }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {(() => {
                  const d = toolDetailRecord && toolDetailRecord.id === toolDetailModalId ? toolDetailRecord : null;
                  const t =
                    d || tools.find((x) => x.id === toolDetailModalId);
                  if (!t) {
                    return (
                      <>
                        <h3 style={{ marginTop: 0 }}>Карточка инструмента</h3>
                        <p className="muted">Загрузка данных…</p>
                        <div className="toolbar">
                          <button type="button" className="ghostBtn" onClick={() => setToolDetailModalId(null)}>
                            Закрыть
                          </button>
                        </div>
                      </>
                    );
                  }
                  return (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                        <h3 style={{ marginTop: 0 }}>{safeName(t.name)}</h3>
                        <button type="button" className="ghostBtn" onClick={() => setToolDetailModalId(null)}>
                          Закрыть
                        </button>
                      </div>
                      <p className="muted">
                        Инв. <strong>{t.inventoryNumber}</strong>
                        {t.serialNumber ? ` · с/н ${t.serialNumber}` : ""}
                        {t.qrCode ? ` · ${t.qrCode}` : ""}
                      </p>
                      <p className="muted">
                        Статус: <strong>{toolStatusLabel(t.status)}</strong>
                        {t.warehouse?.name ? ` · объект: ${safeName(t.warehouse.name)}` : ""}
                        {t.responsible ? ` · ответственный: ${t.responsible}` : ""}
                      </p>
                      <div className="toolbar" style={{ flexWrap: "wrap" }}>
                        {t.status !== "ISSUED" && (
                          <button type="button" onClick={() => openToolActionDialog(t.id, "ISSUE")}>
                            Выдать
                          </button>
                        )}
                        {t.status !== "IN_STOCK" && (
                          <button type="button" onClick={() => openToolActionDialog(t.id, "RETURN")}>
                            На склад
                          </button>
                        )}
                        {t.status !== "IN_REPAIR" && (
                          <button type="button" onClick={() => openToolActionDialog(t.id, "SEND_TO_REPAIR")}>
                            В ремонт
                          </button>
                        )}
                        {t.status !== "DISPUTED" && (
                          <button type="button" onClick={() => openToolActionDialog(t.id, "MARK_DISPUTED")}>
                            Спор
                          </button>
                        )}
                        {t.status !== "WRITTEN_OFF" && (
                          <button type="button" className="dangerBtn" onClick={() => openToolActionDialog(t.id, "WRITE_OFF")}>
                            Списать
                          </button>
                        )}
                        <button
                          type="button"
                          className="ghostBtn"
                          onClick={async () => {
                            if (!token) return;
                            const res = await fetchWithSession(`${API_URL}/api/tools/${t.id}/qr`, {
                              headers: { Authorization: `Bearer ${token}` }
                            });
                            if (!res.ok) {
                              setToolsMessage("Не удалось получить QR");
                              setToolsTone("error");
                              return;
                            }
                            const data = (await res.json()) as { id: string; dataUrl: string; qrCode: string };
                            setToolQrPreview({ toolId: data.id, dataUrl: data.dataUrl, qrCode: data.qrCode });
                            setQrCode(data.qrCode);
                          }}
                        >
                          Показать QR
                        </button>
                      </div>
                      <h4 style={{ marginBottom: 8 }}>Журнал</h4>
                      <div className="toolbar">
                        <button type="button" onClick={() => void loadToolEvents(t.id)}>
                          Обновить журнал
                        </button>
                      </div>
                      <table>
                        <thead>
                          <tr>
                            <th>Дата</th>
                            <th>Действие</th>
                            <th>Статус</th>
                            <th>Комментарий</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedToolForEvents !== t.id ? (
                            <tr>
                              <td colSpan={4} className="muted">
                                Загрузка журнала…
                              </td>
                            </tr>
                          ) : toolEvents.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="muted">
                                Записей пока нет
                              </td>
                            </tr>
                          ) : (
                            toolEvents.map((e) => (
                              <tr key={e.id}>
                                <td>{new Date(e.createdAt).toLocaleString()}</td>
                                <td>{toolActionLabel(e.action)}</td>
                                <td>{toolStatusLabel(e.status)}</td>
                                <td>{e.comment || "-"}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </>
                  );
                })()}
              </div>
            </div>
          )}

          {toolAction && (
            <div className="card">
              <h3>Подтверждение действия: {toolActionLabel(toolAction.action)}</h3>
              <div className="form">
                <label>
                  Ответственное лицо {toolAction.action === "ISSUE" ? "(обязательно)" : ""}
                  <input value={toolActionResponsible} onChange={(e) => setToolActionResponsible(e.target.value)} />
                </label>
                <label>
                  Комментарий
                  <input value={toolActionComment} onChange={(e) => setToolActionComment(e.target.value)} />
                </label>
                <label>
                  Фотофиксация (опционально)
                  <input type="file" accept="image/*" onChange={(e) => setToolActionPhoto(e.target.files?.[0] || null)} />
                </label>
              </div>
              <div className="toolbar">
                <button onClick={() => void submitToolActionDialog()}>Подтвердить</button>
                <button onClick={() => setToolAction(null)}>Отмена</button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "chat" && (
        <div className="card">
          <h2>Личные сообщения</h2>
          {chatError && <ErrorState text={chatError} />}
          <div className="grid2">
            <div className="card">
              <h3>Пользователи</h3>
              <div className="plainList">
                {chatUsers.map((u) => (
                  <div key={u.id} className="toolbar">
                    <span>{u.fullName} ({roleLabel(u.role)})</span>
                    <button type="button" onClick={() => void startDmConversation(u.id)}>Открыть чат</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h3>Диалоги</h3>
              <select value={selectedConversationId} onChange={(e) => setSelectedConversationId(e.target.value)}>
                <option value="">Выбери диалог</option>
                {chatConversations.map((c) => {
                  const peer = c.participants.map((p) => p.user.fullName).join(", ");
                  return <option key={c.id} value={c.id}>{peer}</option>;
                })}
              </select>
              <div className="plainList" style={{ maxHeight: 280, overflow: "auto", marginTop: 10 }}>
                {chatMessages.map((m) => (
                  <div key={m.id} className="card" style={{ marginBottom: 8 }}>
                    <p><strong>{m.sender.fullName}</strong> · {new Date(m.createdAt).toLocaleString()}</p>
                    <p>{m.text}</p>
                    {m.attachments?.map((a) => (
                      <p key={a.id}><a href={a.dataUrl} target="_blank" rel="noreferrer">{a.fileName}</a></p>
                    ))}
                  </div>
                ))}
              </div>
              <div className="form">
                <label>
                  Сообщение
                  <textarea value={chatText} onChange={(e) => setChatText(e.target.value)} />
                </label>
                <label>
                  Скриншот (опционально)
                  <input type="file" accept="image/*" onChange={(e) => setChatAttachment(e.target.files?.[0] || null)} />
                </label>
              </div>
              <div className="toolbar">
                <button type="button" onClick={() => void sendConversationMessage()} disabled={!selectedConversationId}>
                  Отправить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "feedback" && (
        <div className="card">
          <h2>Обратная связь</h2>
          <p className="muted">
            Обращения «ОБ-…» видны автору со статусом; поддержка может оставить ответ и перевести этапы.
          </p>
          {feedbackError && <ErrorState text={feedbackError} />}
          <div className="grid2">
            <div className="card">
              <div className="toolbar">
                <button
                  type="button"
                  className="primaryBtn"
                  onClick={() => {
                    setFeedbackComposerMode("new");
                    setFeedbackSelectedId("");
                    setFeedbackTicketDetail(null);
                  }}
                >
                  Новое обращение
                </button>
                <button type="button" className="ghostBtn" onClick={() => void loadFeedbackTickets()}>
                  Обновить список
                </button>
              </div>
              {feedbackListLoading ? (
                <LoadingState text="Загрузка обращений..." />
              ) : (
                <div className="plainList" style={{ maxHeight: 360, overflow: "auto", marginTop: 8 }}>
                  {feedbackTickets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="ghostBtn"
                      style={{
                        display: "block",
                        width: "100%",
                        marginBottom: 6,
                        textAlign: "left",
                        border: feedbackSelectedId === t.id ? "2px solid #4c6ef5" : undefined
                      }}
                      onClick={() => {
                        setFeedbackComposerMode("thread");
                        setFeedbackSelectedId(t.id);
                      }}
                    >
                      <strong>{t.number}</strong> · {feedbackTicketStatusLabel(t.status)}
                      <br />
                      <span className="muted">
                        {t.subject || "Без темы"} · от {t.authorName}
                      </span>
                    </button>
                  ))}
                  {!feedbackTickets.length ? <p className="muted">Обращений пока нет.</p> : null}
                </div>
              )}
            </div>

            <div className="card">
              {feedbackComposerMode === "new" ? (
                <h3 style={{ marginTop: 0 }}>Новое обращение</h3>
              ) : (
                <div className="toolbar" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <h3 style={{ flex: "1 1 auto", margin: 0 }}>
                    {feedbackTicketDetail
                      ? `${feedbackTicketDetail.number} · ${feedbackTicketStatusLabel(feedbackTicketDetail.status)}`
                      : "Выберите обращение слева"}
                  </h3>
                  {canManageFeedback && feedbackTicketDetail ? (
                    <label>
                      Статус{" "}
                      <select
                        value={feedbackTicketDetail.status}
                        onChange={(e) => void updateFeedbackTicketStatus(feedbackTicketDetail.id, e.target.value)}
                      >
                        {(["OPEN", "IN_PROGRESS", "WAITING_REPLY", "RESOLVED", "CLOSED"] as const).map((s) => (
                          <option key={s} value={s}>
                            {feedbackTicketStatusLabel(s)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
              )}
              {feedbackComposerMode === "new" ? (
                <div className="form" style={{ marginBottom: 8 }}>
                  <label>
                    Тема (необязательно)
                    <input value={feedbackNewSubject} onChange={(e) => setFeedbackNewSubject(e.target.value)} />
                  </label>
                </div>
              ) : null}

              <div className="chatMessages feedbackThread" ref={feedbackMessagesRef}>
                {feedbackDetailLoading ? (
                  <LoadingState text="Загрузка сообщений..." />
                ) : feedbackComposerMode === "new" ? (
                  <p className="muted">Опишите ситуацию в первом сообщении — появится лента переписки.</p>
                ) : feedbackTicketDetail?.messages?.length ? (
                  feedbackTicketDetail.messages.map((m) => (
                    <div key={m.id} className={`chatBubble ${m.senderId === me?.id ? "mine" : ""}`}>
                      <p>{m.text}</p>
                      {m.attachments?.map((a) => (
                        <a key={a.id} href={a.dataUrl} target="_blank" rel="noreferrer" className="chatAttachmentLink">
                          {a.fileName}
                        </a>
                      ))}
                      <small className="chatDeliveryState">
                        {m.sender.fullName} · {new Date(m.createdAt).toLocaleString()}
                      </small>
                    </div>
                  ))
                ) : (
                  <p className="muted">Нет сообщений в этом обращении.</p>
                )}
              </div>

              {(feedbackComposerMode === "new" || (feedbackComposerMode === "thread" && Boolean(feedbackSelectedId))) && (
                <div className="chatComposer">
                  <div className="chatQuickReplies">
                    {feedbackQuickReplies.map((text) => (
                      <button key={`feedback-quick-${text}`} type="button" className="ghostBtn" onClick={() => setFeedbackText(text)}>
                        {text}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder={
                      feedbackComposerMode === "new" ? "Первое сообщение обращения" : "Сообщение в тред"
                    }
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                        e.preventDefault();
                        void (feedbackComposerMode === "new" ? submitNewFeedbackTicket() : sendFeedbackTicketReply());
                      }
                    }}
                  />
                  <div className="chatComposerActions">
                    <button
                      type="button"
                      className="ghostBtn chatAttachBtn"
                      title="Добавить скриншот"
                      onClick={() => feedbackFileInputRef.current?.click()}
                    >
                      📎
                    </button>
                    <input
                      ref={feedbackFileInputRef}
                      className="chatHiddenFile"
                      type="file"
                      accept="image/*"
                      onChange={(e) => setFeedbackAttachment(e.target.files?.[0] || null)}
                    />
                    <button
                      type="button"
                      disabled={!feedbackText.trim()}
                      onClick={() =>
                        void (feedbackComposerMode === "new" ? submitNewFeedbackTicket() : sendFeedbackTicketReply())
                      }
                    >
                      {feedbackComposerMode === "new" ? "Создать обращение" : "Отправить"}
                    </button>
                  </div>
                  <p className="muted">Подсказка: Ctrl+Enter отправляет сообщение.</p>
                  {feedbackAttachment ? (
                    <div className="chatAttachmentBar">
                      <small>{feedbackAttachment.name}</small>
                      <button type="button" className="ghostBtn" onClick={() => setFeedbackAttachment(null)}>
                        Убрать
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === "reports" && (
        <div className="card">
          <h2>Сводка по объекту</h2>
          <p className="muted">
            Сводка объединяет все учётные данные по <strong>выбранному в шапке объекту</strong> (в базе это склад площадки: остатки, заявки, операции, ТН, лимиты связанных проектов).
            Раздел СС/ЭОМ в шапке задаёт контур видимости данных — смените объект или раздел там, затем обновите отчёт.
          </p>
          <div className="form" style={{ marginBottom: 8 }}>
            {!activeObjectId ? (
              <p className="muted">Выберите объект в верхней панели, затем сформируйте сводку.</p>
            ) : (
              <div>
                <strong>Текущий объект:</strong>{" "}
                {safeName(
                  availableObjects.find((o) => o.id === activeObjectId)?.name ||
                    warehouses.find((w) => w.id === activeObjectId)?.name
                )}
                <span className="muted">
                  {" "}
                  · Раздел в шапке: {objectSectionFilter === "SS" ? "СС" : "ЭОМ"}
                </span>
              </div>
            )}
          </div>
          <div className="toolbar">
            <button
              type="button"
              disabled={!token || !activeObjectId || reportsSnapshotLoading}
              onClick={() => void loadWarehouseSummarySnapshot()}
            >
              {reportsSnapshotLoading ? "Загрузка…" : "Сформировать сводку"}
            </button>
            <button
              type="button"
              disabled={!token || !activeObjectId}
              onClick={async () => {
                if (!token || !activeObjectId) return;
                setReportsMessage("");
                const res = await fetchWithSession(
                  `${API_URL}/api/reports/warehouse/${encodeURIComponent(activeObjectId)}/summary.pdf`,
                  {
                    headers: { Authorization: `Bearer ${token}` }
                  }
                );
                if (!res.ok) {
                  setReportsMessage("Не удалось сформировать PDF");
                  return;
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "warehouse-summary.pdf";
                a.target = "_blank";
                a.rel = "noopener noreferrer";
                a.click();
                URL.revokeObjectURL(url);
                setReportsMessage("PDF сформирован");
              }}
            >
              Скачать PDF
            </button>
          </div>
          {reportsMessage && <ResultBanner text={reportsMessage} tone={reportsMessage.includes("Не удалось") ? "error" : "neutral"} />}

          {reportsSnapshotLoading && !warehouseSnapshot ? <LoadingState text="Загружаем сводку…" /> : null}

          {warehouseSnapshot ? (
            <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
              <div>
                <h3 style={{ margin: "0 0 6px" }}>{safeName(warehouseSnapshot.warehouse.name)}</h3>
                <p className="muted" style={{ margin: 0 }}>
                  {warehouseSnapshot.warehouse.address || "Адрес не указан"}
                  {" · "}
                  Сформировано: {new Date(warehouseSnapshot.generatedAt).toLocaleString()}
                </p>
              </div>

              <div className="kpiRow" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))" }}>
                <div className="kpi">
                  <span>Строк остатков</span>
                  <strong>{warehouseSnapshot.counts.stockLines}</strong>
                </div>
                <div className="kpi">
                  <span>Суммарно по количеству</span>
                  <strong>{warehouseSnapshot.counts.totalStockQty.toFixed(2)}</strong>
                </div>
                <div className="kpi">
                  <span>Заявки на выдачу</span>
                  <strong>{warehouseSnapshot.counts.issuesTotal}</strong>
                </div>
                <div className="kpi">
                  <span>Открытые ТН</span>
                  <strong>{warehouseSnapshot.counts.waybillsOpen}</strong>
                </div>
                <div className="kpi">
                  <span>Инструменты</span>
                  <strong>{warehouseSnapshot.counts.tools}</strong>
                </div>
                <div className="kpi">
                  <span>Городок</span>
                  <strong>{warehouseSnapshot.counts.campItems}</strong>
                </div>
                <div className="kpi">
                  <span>Заявки на приход</span>
                  <strong>{warehouseSnapshot.counts.receiptRequests.total}</strong>
                </div>
                <div className="kpi">
                  <span>Шаблоны лимитов</span>
                  <strong>{warehouseSnapshot.counts.limitTemplates}</strong>
                </div>
                <div className="kpi">
                  <span>Проектов на объекте</span>
                  <strong>{warehouseSnapshot.counts.linkedProjects}</strong>
                </div>
              </div>

              <div className="grid2">
                <div className="card" style={{ padding: 14 }}>
                  <h4 style={{ margin: "0 0 8px" }}>Остатки по разделам (количество)</h4>
                  <div style={{ width: "100%", height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart data={reportsStockSectionRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e8ecf3" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip formatter={warehouseReportTooltipQty} />
                        <Bar dataKey="quantity" name="Количество" fill="#5b8def" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="card" style={{ padding: 14 }}>
                  <h4 style={{ margin: "0 0 8px" }}>Операции за 30 дней</h4>
                  <div style={{ width: "100%", height: 260 }}>
                    <ResponsiveContainer>
                      <BarChart data={reportsOpsBars} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e8ecf3" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                        <Tooltip formatter={warehouseReportTooltipCount} />
                        <Bar dataKey="count" name="Операций" fill="#3cb88d" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="grid2">
                <div className="card" style={{ padding: 14 }}>
                  <h4 style={{ margin: "0 0 8px" }}>Заявки на выдачу по статусам</h4>
                  <div style={{ width: "100%", height: 280 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={reportsIssuePieRows} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                          {reportsIssuePieRows.map((_, i) => (
                            <Cell key={`issue-cell-${i}`} fill={reportChartPalette[i % reportChartPalette.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="card" style={{ padding: 14 }}>
                  <h4 style={{ margin: "0 0 8px" }}>Заявки на приход по статусам</h4>
                  <div style={{ width: "100%", height: 280 }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={reportsReceiptPieRows} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                          {reportsReceiptPieRows.map((_, i) => (
                            <Cell key={`rcpt-cell-${i}`} fill={reportChartPalette[(i + 2) % reportChartPalette.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="grid2">
                <div className="card" style={{ padding: 14 }}>
                  <h4 style={{ margin: "0 0 8px" }}>Топ материалов на складе</h4>
                  <div style={{ width: "100%", height: 320 }}>
                    <ResponsiveContainer>
                      <BarChart layout="vertical" data={reportsTopMaterialsRows} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e8ecf3" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
                        <Tooltip formatter={warehouseReportTooltipQty} />
                        <Bar dataKey="quantity" name="Количество" fill="#9b82e8" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="card" style={{ padding: 14 }}>
                  <h4 style={{ margin: "0 0 8px" }}>Лимиты: загрузка по плану (топ позиций)</h4>
                  <div style={{ width: "100%", height: 320 }}>
                    <ResponsiveContainer>
                      <BarChart layout="vertical" data={reportsLimitUsageRows} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e8ecf3" />
                        <XAxis type="number" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 10 }} />
                        <Tooltip
                          formatter={warehouseReportTooltipPct}
                          labelFormatter={(_, payload) => {
                            const p = payload?.[0]?.payload as { project?: string; issued?: number; planned?: number } | undefined;
                            return p ? `${p.project ?? ""} · выдано ${p.issued ?? 0} из ${p.planned ?? 0}` : "";
                          }}
                        />
                        <Bar dataKey="percent" name="Загрузка %" fill="#e76b8a" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {warehouseSnapshot.projectLimits.length ? (
                <div style={{ display: "grid", gap: 14 }}>
                  <h3 style={{ margin: 0 }}>Детализация лимитов по проектам</h3>
                  {warehouseSnapshot.projectLimits.map((pl) => (
                    <div key={pl.limitId} className="card" style={{ overflow: "auto" }}>
                      <h4 style={{ margin: "0 0 6px" }}>
                        {safeName(pl.projectName)}
                        {pl.projectCode ? ` · ${pl.projectCode}` : ""}
                      </h4>
                      <p className="muted" style={{ margin: "0 0 12px" }}>
                        {pl.limitName} · версия {pl.version}
                      </p>
                      <table className="desktopTable">
                        <thead>
                          <tr>
                            <th>Материал</th>
                            <th>План</th>
                            <th>Выдано</th>
                            <th>Резерв</th>
                            <th>На складе</th>
                            <th>Остаток к плану</th>
                            <th>Загрузка</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pl.items.map((it) => (
                            <tr key={it.materialId}>
                              <td>
                                {it.materialName} <span className="muted">({it.unit})</span>
                              </td>
                              <td>{it.planned}</td>
                              <td>{it.issued}</td>
                              <td>{it.reserved}</td>
                              <td>{Number(it.onStock).toFixed(3)}</td>
                              <td>{it.remainingPlan}</td>
                              <td>
                                <span className={it.usagePercent > 90 ? "bad" : it.usagePercent > 70 ? "warnText" : "ok"}>
                                  {it.usagePercent}%
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">Нет активных лимитов по проектам, привязанным к этому складу.</p>
              )}
            </div>
          ) : !reportsSnapshotLoading ? (
            <p className="muted" style={{ marginTop: 12 }}>
              Нажмите «Сформировать сводку», чтобы загрузить данные и графики.
            </p>
          ) : null}
        </div>
      )}

      {activeTab === "admin" && canManageUsers && (
        <div className="card adminWorkspace">
          <div className="adminWorkspaceHead">
            <h2>Управление доступами</h2>
            <div className="adminWorkspaceTabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={adminWorkspaceTab === "users"}
                className={`adminTabBtn${adminWorkspaceTab === "users" ? " adminTabBtnActive" : ""}`}
                onClick={() => setAdminWorkspaceTab("users")}
              >
                Пользователи
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={adminWorkspaceTab === "objects"}
                className={`adminTabBtn${adminWorkspaceTab === "objects" ? " adminTabBtnActive" : ""}`}
                onClick={() => setAdminWorkspaceTab("objects")}
              >
                Объекты
              </button>
            </div>
          </div>
          {adminWorkspaceTab === "objects" && (
            <>
              <div className="card adminInsetCard">
                <h4>Создать объект</h4>
                <div className="form">
                <label>
                  Название объекта
                  <input value={newObjectName} onChange={(e) => setNewObjectName(e.target.value)} />
                </label>
                <label>
                  Адрес
                  <input value={newObjectAddress} onChange={(e) => setNewObjectAddress(e.target.value)} />
                </label>
                <p className="muted">Привязать пользователей сразу:</p>
                <div className="plainList">
                  {users.map((u) => (
                    <label key={`obj-new-user-${u.id}`} style={{ display: "block" }}>
                      <input
                        type="checkbox"
                        checked={newObjectUserIds.includes(u.id)}
                        onChange={(e) => {
                          setNewObjectUserIds((prev) =>
                            e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                          );
                        }}
                      />{" "}
                      {u.fullName}
                    </label>
                  ))}
                </div>
              </div>
              <div className="toolbar">
                <button
                  type="button"
                  onClick={async () => {
                    if (!token || !newObjectName.trim()) return;
                    const res = await fetchWithSession(`${API_URL}/api/admin/objects`, {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                      body: JSON.stringify({
                        name: newObjectName.trim(),
                        address: newObjectAddress.trim() || undefined,
                        userIds: newObjectUserIds
                      })
                    });
                    if (!res.ok) {
                      setAdminMessage("Не удалось создать объект");
                      return;
                    }
                    setAdminMessage("Объект создан");
                    setNewObjectName("");
                    setNewObjectAddress("");
                    setNewObjectUserIds([]);
                    await loadAdminData();
                    await loadCatalogData();
                  }}
                >
                  Создать объект
                </button>
              </div>
              </div>
              <div className="objectCards adminObjectCardGrid">
              {adminObjects.map((obj) => {
                const assigned = users.filter((u) => obj.userIds.includes(u.id));
                return (
                  <div key={`obj-card-${obj.id}`} className="objectCard">
                    <div className="rightCardHeader">
                      <h4>{obj.name}</h4>
                      <span className="muted">{obj.address || "Без адреса"}</span>
                    </div>
                    <div className="objectUsers">
                      {assigned.length ? assigned.map((u) => (
                        <div key={`obj-${obj.id}-user-${u.id}`} className="userMiniChip">
                          <span className="userAvatar">
                            <UserAvatarChip
                              fullName={u.fullName}
                              avatarUrl={u.avatarUrl}
                              imageClassName="userAvatarImage"
                              imageAlt={u.fullName}
                            />
                          </span>
                          <span>{u.fullName}</span>
                          <button
                            type="button"
                            className="ghostBtn"
                            onClick={async () => {
                              const next = obj.userIds.filter((id) => id !== u.id);
                              const ok = await syncObjectUsers(obj.id, next);
                              if (!ok) setAdminMessage("Не удалось убрать пользователя из объекта");
                            }}
                          >
                            Убрать
                          </button>
                        </div>
                      )) : <p className="muted">Пока нет привязанных пользователей</p>}
                    </div>
                    <div className="toolbar">
                      <select
                        value={objectQuickUserIds[obj.id] || ""}
                        onChange={(e) =>
                          setObjectQuickUserIds((prev) => ({ ...prev, [obj.id]: e.target.value }))
                        }
                      >
                        <option value="">Выбери пользователя</option>
                        {users
                          .filter((u) => !obj.userIds.includes(u.id))
                          .map((u) => (
                            <option key={`quick-${obj.id}-${u.id}`} value={u.id}>{u.fullName}</option>
                          ))}
                      </select>
                      <button
                        type="button"
                        onClick={async () => {
                          const pickedUserId = objectQuickUserIds[obj.id];
                          if (!pickedUserId) return;
                          const next = Array.from(new Set([...obj.userIds, pickedUserId]));
                          const ok = await syncObjectUsers(obj.id, next);
                          if (!ok) setAdminMessage("Не удалось добавить пользователя в объект");
                          else setObjectQuickUserIds((prev) => ({ ...prev, [obj.id]: "" }));
                        }}
                      >
                        Добавить
                      </button>
                      <button
                        type="button"
                        className="ghostBtn"
                        onClick={() => {
                          if (expandedAdminObjectId === obj.id) {
                            setExpandedAdminObjectId("");
                          } else {
                            setExpandedAdminObjectId(obj.id);
                            setSelectedObjectSection("SS");
                            const o = adminObjects.find((x) => x.id === obj.id);
                            setBindObjectSectionUserIds(o?.sectionUsers?.SS ?? []);
                          }
                        }}
                      >
                        {expandedAdminObjectId === obj.id ? "Скрыть СС/ЭОМ" : "Доступ СС / ЭОМ"}
                      </button>
                    </div>
                    {expandedAdminObjectId === obj.id ? (
                      <div className="adminObjectSectionPanel">
                        <label>
                          Раздел
                          <select
                            value={selectedObjectSection}
                            onChange={(e) => {
                              const section = e.target.value as "SS" | "EOM";
                              setSelectedObjectSection(section);
                              const o = adminObjects.find((x) => x.id === obj.id);
                              setBindObjectSectionUserIds(o?.sectionUsers?.[section] ?? []);
                            }}
                          >
                            <option value="SS">СС</option>
                            <option value="EOM">ЭОМ</option>
                          </select>
                        </label>
                        <p className="muted" style={{ margin: "6px 0 8px" }}>
                          Отметь, кто видит выбранный раздел на этом объекте (дополнительно к привязке к объекту).
                        </p>
                        <div className="plainList">
                          {users.map((u) => (
                            <label key={`obj-sec-${obj.id}-${u.id}`} style={{ display: "block" }}>
                              <input
                                type="checkbox"
                                checked={bindObjectSectionUserIds.includes(u.id)}
                                onChange={(e) => {
                                  setBindObjectSectionUserIds((prev) =>
                                    e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                                  );
                                }}
                              />{" "}
                              {u.fullName}
                            </label>
                          ))}
                        </div>
                        <div className="toolbar">
                          <button
                            type="button"
                            onClick={async () => {
                              const ok = await syncObjectSectionUsers(obj.id, selectedObjectSection, bindObjectSectionUserIds);
                              if (!ok) {
                                setAdminMessage("Не удалось сохранить доступы по разделу");
                              } else {
                                setAdminMessage(`Доступы к разделу ${selectedObjectSection} сохранены`);
                              }
                            }}
                          >
                            Сохранить доступ к разделу
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <div className="toolbar">
                      <button
                        type="button"
                        className="dangerBtn"
                        disabled={!token}
                        onClick={async () => {
                          const okCf = window.confirm(
                            `Удалить объект «${obj.name}»? Это нельзя откатить.`
                          );
                          if (!okCf || !token) return;
                          setAdminMessage("");
                          const tryDeleteObj = async (force: boolean) =>
                            fetchWithSession(
                              `${API_URL}/api/admin/objects/${encodeURIComponent(obj.id)}${force ? "?force=1" : ""}`,
                              { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
                            );
                          let res = await tryDeleteObj(false);
                          let body = (await res.json().catch(() => ({}))) as {
                            error?: string;
                            operations?: number;
                            stockMovements?: number;
                            issues?: number;
                            materialReport?: number;
                            transfers?: number;
                          };
                          if (res.status === 409 && body.error === "WAREHOUSE_NOT_EMPTY") {
                            const detail = [
                              body.operations ? `операций: ${body.operations}` : "",
                              body.stockMovements ? `движений остатка: ${body.stockMovements}` : "",
                              body.issues ? `заявок на выдачу: ${body.issues}` : "",
                              body.materialReport ? `мат. отчёта: ${body.materialReport}` : "",
                              body.transfers ? `перемещений: ${body.transfers}` : ""
                            ].filter(Boolean).join("; ");
                            if (
                              !window.confirm(
                                `На объекте есть данные: ${detail}.\n\nПринудительно удалить ВМЕСТЕ со всей историей? Это нельзя откатить.`
                              )
                            ) {
                              setAdminMessage("Удаление отменено.");
                              return;
                            }
                            res = await tryDeleteObj(true);
                            body = (await res.json().catch(() => ({}))) as typeof body;
                          }
                          if (!res.ok) {
                            setAdminMessage(body.error || "Не удалось удалить объект");
                            return;
                          }
                          setAdminMessage("Объект удалён");
                          if (expandedAdminObjectId === obj.id) setExpandedAdminObjectId("");
                          await loadAdminData();
                          await loadCatalogData();
                          await loadStocks(q);
                          if (activeObjectId === obj.id) setActiveObjectId("");
                        }}
                      >
                        Удалить объект
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            </>
          )}
          {adminWorkspaceTab === "users" && (
          <>
          <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
            Если не задан scope по складам и проектам, пользователь сам переключает объект в приложении — видимость данных как при полном доступе к списку объектов.
          </p>
          <h3>Создание пользователя</h3>
          <div className="form">
            <label>
              Email
              <input value={newUserEmail} onChange={(e) => setNewUserEmail(e.target.value)} />
            </label>
            <label>
              ФИО
              <input value={newUserFullName} onChange={(e) => setNewUserFullName(e.target.value)} />
            </label>
            <label>
              Роль
              <select value={newUserRoleName} onChange={(e) => setNewUserRoleName(e.target.value)}>
                {roles.map((r) => (
                  <option key={r.id} value={r.name}>
                    {roleLabel(r.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Пароль
              <input value={newUserPassword} onChange={(e) => setNewUserPassword(e.target.value)} />
            </label>
            <label>
              Должность
              <select value={newUserPositionId} onChange={(e) => setNewUserPositionId(e.target.value)}>
                <option value="">Не выбрана</option>
                {positions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label>
              Новая должность (создать)
              <input value={newPositionName} onChange={(e) => setNewPositionName(e.target.value)} />
            </label>
          </div>
          <div className="grid2" style={{ marginTop: 16 }}>
            <div>
              <h3>Склады новому пользователю</h3>
              <div className="plainList">
                {warehouses.map((w) => (
                  <label key={`new-wh-${w.id}`} style={{ display: "block" }}>
                    <input
                      type="checkbox"
                      checked={newUserWarehouseScopes.includes(w.id)}
                      onChange={(e) => {
                        setNewUserWarehouseScopes((prev) =>
                          e.target.checked ? [...prev, w.id] : prev.filter((id) => id !== w.id)
                        );
                      }}
                    />{" "}
                    {safeName(w.name)}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h3>Проекты новому пользователю</h3>
              <div className="plainList">
                {projects.map((p) => (
                  <label key={`new-pr-${p.id}`} style={{ display: "block" }}>
                    <input
                      type="checkbox"
                      checked={newUserProjectScopes.includes(p.id)}
                      onChange={(e) => {
                        setNewUserProjectScopes((prev) =>
                          e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                        );
                        const linked = p.warehouseId ? [p.warehouseId] : [];
                        if (e.target.checked) {
                          setNewUserWarehouseScopes((prev) => Array.from(new Set([...prev, ...linked])));
                        }
                      }}
                    />{" "}
                    {safeName(p.name)}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Доступ к вкладкам и модулям (индивидуально)</h3>
            <div className="plainList">
              {sidebarAccessOptions.map((opt) => (
                <label key={`new-perm-${opt.id}`} style={{ display: "block" }}>
                  <input
                    type="checkbox"
                    checked={opt.permissions.some((p) => newUserPermissions.includes(p))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setNewUserPermissions((prev) => Array.from(new Set([...prev, ...opt.permissions])));
                      } else {
                        setNewUserPermissions((prev) => prev.filter((p) => !opt.permissions.includes(p)));
                      }
                    }}
                  />{" "}
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div className="toolbar">
            <button
              type="button"
              onClick={async () => {
                if (!token) return;
                setAdminMessage("");
                const res = await fetchWithSession(`${API_URL}/api/admin/users`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    email: newUserEmail.trim(),
                    fullName: newUserFullName.trim(),
                    roleName: newUserRoleName,
                    password: newUserPassword,
                    warehouseIds: newUserWarehouseScopes,
                    projectIds: newUserProjectScopes,
                    permissions: newUserPermissions,
                    positionId: newUserPositionId || undefined,
                    positionName: newPositionName.trim() || undefined
                  })
                });
                if (!res.ok) {
                  setAdminMessage("Не удалось создать пользователя");
                  return;
                }
                setAdminMessage("Пользователь создан");
                setNewUserEmail("");
                setNewUserFullName("");
                setNewUserWarehouseScopes([]);
                setNewUserProjectScopes([]);
                setNewUserPermissions([]);
                setNewPositionName("");
                setNewUserPositionId("");
                await loadAdminData();
              }}
            >
              Создать пользователя
            </button>
          </div>
          <label style={{ display: "block", marginBottom: 14 }}>
            <span className="muted">Поиск пользователя</span>
            <input
              type="search"
              placeholder="ФИО или email…"
              value={adminUserFilter}
              onChange={(e) => setAdminUserFilter(e.target.value)}
              style={{ width: "100%", maxWidth: 360, marginTop: 6 }}
            />
          </label>
          <div className="adminUsersCardGrid">
            {users
              .filter((u) => {
                const q = adminUserFilter.trim().toLowerCase();
                if (!q) return true;
                return `${u.fullName} ${u.email}`.toLowerCase().includes(q);
              })
              .map((u) => {
                const bind = userObjectBindingKind(u);
                return (
                  <div key={`admin-u-${u.id}`} className="adminUserCard card">
                    <div className="adminUserCardTop">
                      <span className="userAvatar">
                        <UserAvatarChip fullName={u.fullName} avatarUrl={u.avatarUrl} imageClassName="userAvatarImage" />
                      </span>
                      <div>
                        <strong>{u.fullName}</strong>
                        <div className="muted" style={{ fontSize: 13 }}>{u.email}</div>
                        <div style={{ marginTop: 8 }}>
                          <span className={`badge ${u.status === "ACTIVE" ? "ok" : "bad"}`}>{statusLabel(u.status)}</span>{" "}
                          <span className="muted">{roleLabel(u.role)}</span>
                        </div>
                      </div>
                    </div>
                    <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                      {bind === "free" ? (
                        <span className="badge ok">Свободный выбор объекта</span>
                      ) : bind === "projects" ? (
                        <span className="badge warn">Только проекты (scope)</span>
                      ) : (
                        <span className="badge neutral">Только объекты (scope)</span>
                      )}
                      {u.sectionScopes && u.sectionScopes.length > 0 ? (
                        <span className="muted" style={{ fontSize: 12 }}>+ разделы</span>
                      ) : null}
                    </div>
                    <div className="toolbar" style={{ marginTop: "auto", paddingTop: 12 }}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedUserId(u.id);
                          setDrawerMode("adminUser");
                        }}
                      >
                        Открыть карточку
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
          </>
          )}
          {adminMessage && <p className="muted">{adminMessage}</p>}
        </div>
      )}

      {activeTab === "profile" && me && (
        <div className="card">
          <h2>Мой профиль</h2>
          <div style={{ marginBottom: 12 }}>
            <span className="userAvatar">
              <UserAvatarChip fullName={me.fullName} avatarUrl={me.avatarUrl} imageClassName="userAvatarImage" />
            </span>
          </div>
          <div className="form">
            <label>
              Объект
              <select
                value={activeObjectId}
                onChange={(e) => {
                  const warehouseId = e.target.value;
                  if (!warehouseId) return;
                  void updateAuthContext({ warehouseId, section: objectSectionFilter });
                }}
              >
                {availableObjects.map((o) => (
                  <option key={o.id} value={o.id}>
                    {safeName(o.name)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Раздел
              <div className="sectionToggle" aria-label="Раздел СС/ЭОМ">
                <button
                  type="button"
                  className={`sectionToggleBtn ${objectSectionFilter === "SS" ? "active" : ""}`}
                  onClick={() => setSection("SS")}
                >
                  СС
                </button>
                <button
                  type="button"
                  className={`sectionToggleBtn ${objectSectionFilter === "EOM" ? "active" : ""}`}
                  onClick={() => setSection("EOM")}
                >
                  ЭОМ
                </button>
              </div>
            </label>
            <label>
              Email
              <input value={me.email} disabled />
            </label>
            <label>
              ФИО
              <input value={profileFullName} onChange={(e) => setProfileFullName(e.target.value)} />
            </label>
            <label>
              Роль
              <input value={roleLabel(me.role)} disabled />
            </label>
            <label>
              Аватар
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setProfileMessage("");
                  void uploadProfileAvatar(file)
                    .then(() => setProfileMessage("Аватар обновлён"))
                    .catch((err) =>
                      setProfileMessage(err instanceof Error ? err.message : "Не удалось загрузить аватар")
                    );
                }}
              />
            </label>
          </div>
          <div className="toolbar">
            <button
              onClick={async () => {
                try {
                  await updateProfile({ fullName: profileFullName });
                  setProfileMessage("Профиль обновлен");
                } catch {
                  setProfileMessage("Не удалось обновить профиль");
                }
              }}
            >
              Сохранить профиль
            </button>
            <button
              type="button"
              onClick={async () => {
                try {
                  await updateProfile({ avatarUrl: null });
                  setProfileMessage("Аватар удален");
                } catch {
                  setProfileMessage("Не удалось удалить аватар");
                }
              }}
            >
              Удалить аватар
            </button>
          </div>
          {profileMessage && <p className="muted">{profileMessage}</p>}
        </div>
      )}

      {activeTab === "settings" && (
        <div className="card">
          <h2>Настройки</h2>
          <div className="form">
            <label>
              <span>Показывать SKU в остатках</span>
              <input type="checkbox" checked={showStockSku} onChange={(e) => setShowStockSku(e.target.checked)} />
            </label>
            <label>
              <span>Показывать резерв в остатках</span>
              <input type="checkbox" checked={showStockReserve} onChange={(e) => setShowStockReserve(e.target.checked)} />
            </label>
            <label>
              <span>Вид стартового раздела</span>
              <select value={activeTab} onChange={(e) => setActiveTab(e.target.value as typeof activeTab)}>
                <option value="stocks">Главная</option>
                {canReadStocks && <option value="warehouse">Склад</option>}
                {canReadIssues && <option value="issues">Быстрая выдача</option>}
                {canReadTools && <option value="tools">Инструменты</option>}
                {(canReadIntegrations || canReadNotifications) && (
                  <option value="integrations">{canReadIntegrations ? "Интеграции" : "Уведомления"}</option>
                )}
              </select>
            </label>
          </div>
          <p className="muted">Профиль пользователя доступен во вкладке "Профиль".</p>
        </div>
      )}

      {activeTab === "password" && (
        <div className="card">
          <h2>Смена пароля</h2>
          <div className="form">
            <label>
              Текущий пароль
              <input
                type="password"
                value={passCurrent}
                onChange={(e) => setPassCurrent(e.target.value)}
              />
            </label>
            <label>
              Новый пароль
              <input type="password" value={passNext} onChange={(e) => setPassNext(e.target.value)} />
            </label>
          </div>
          <div className="toolbar">
            <button
              onClick={async () => {
                if (!token) return;
                setPassMessage("");
                const res = await fetchWithSession(`${API_URL}/api/auth/change-password`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({ currentPassword: passCurrent, newPassword: passNext })
                });
                if (!res.ok) {
                  setPassMessage("Не удалось сменить пароль");
                  return;
                }
                setPassMessage("Пароль успешно изменен");
              }}
            >
              Изменить пароль
            </button>
          </div>
          {passMessage && <p className="muted">{passMessage}</p>}
        </div>
      )}
      {isAuthed && (
        <div className={`chatWidget ${chatWidgetOpen ? "open" : ""}`}>
          {!chatWidgetOpen ? (
            <button type="button" className="chatWidgetFab" onClick={() => setChatWidgetOpen(true)}>
              💬
              {chatUnreadTotal > 0 ? <span className="chatFabUnread">{chatUnreadTotal}</span> : null}
            </button>
          ) : (
            <div className="chatWidgetPanel card">
              <div className="chatWidgetHeader">
                <div>
                  <strong>Чат команды</strong>
                  <p className="muted">Выбери сотрудника и начни диалог</p>
                </div>
                <button type="button" onClick={() => setChatWidgetOpen(false)}>×</button>
              </div>
              {!chatWidgetUserId ? (
                <>
                  <input
                    value={chatSearch}
                    onChange={(e) => setChatSearch(e.target.value)}
                    placeholder="Поиск сотрудника..."
                  />
                  {chatRecent.length > 0 ? (
                    <div className="chatRecentList">
                      {chatRecent.slice(0, 4).map((row) => {
                        if (!row.peer) return null;
                        const isUnread =
                          row.last &&
                          row.last.senderId !== me?.id &&
                          new Date(row.last.createdAt) > new Date(chatViewedAt[row.conversation.id] || 0);
                        return (
                          <button
                            key={`recent-${row.conversation.id}`}
                            type="button"
                            className={`chatRecentItem ${isUnread ? "unread" : ""}`}
                            onClick={async () => {
                              await startDmConversation(row.peer!.id);
                              setChatWidgetUserId(row.peer!.id);
                            }}
                          >
                            <span>{row.peer.fullName}</span>
                            <small>{chatTimeLabel(row.last?.createdAt)}</small>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="chatUserList">
                  {filteredChatUsers.map((u) => {
                    const conv = dmByUserId.get(u.id);
                    const last = conv?.messages?.[0];
                    const unread =
                      conv && last && last.senderId !== me?.id && new Date(last.createdAt) > new Date(chatViewedAt[conv.id] || 0)
                        ? 1
                        : 0;
                    return (
                    <button
                      key={u.id}
                      type="button"
                      className="chatUserItem"
                      onClick={async () => {
                        const convId = await startDmConversation(u.id);
                        if (convId) setChatViewedAt((prev) => ({ ...prev, [convId]: new Date().toISOString() }));
                        setChatWidgetUserId(u.id);
                      }}
                    >
                      <span className="userAvatar">
                        <UserAvatarChip
                          fullName={u.fullName}
                          avatarUrl={u.avatarUrl}
                          imageClassName="userAvatarImage"
                          imageAlt={u.fullName}
                        />
                      </span>
                      <span className="chatUserMeta">
                        <strong>
                          {u.fullName}
                          {unread > 0 ? <em className="chatUnreadBadge">{unread}</em> : null}
                        </strong>
                        <small>
                          {last?.text ? `${last.text.slice(0, 34)}${last.text.length > 34 ? "..." : ""}` : (u.position || roleLabel(u.role))}
                        </small>
                      </span>
                      <span className="chatUserTime">{chatTimeLabel(last?.createdAt)}</span>
                    </button>
                  );})}
                  {!filteredChatUsers.length ? <p className="muted">Сотрудники не найдены</p> : null}
                  </div>
                </>
              ) : (
                <>
                  <div className="chatThreadHead">
                    <button type="button" className="ghostBtn" onClick={() => setChatWidgetUserId("")}>← К списку</button>
                    <strong>{chatUsers.find((u) => u.id === chatWidgetUserId)?.fullName || "Диалог"}</strong>
                  </div>
                  <div className="chatMessages" ref={chatMessagesRef}>
                    {chatLoading ? (
                      <>
                        <div className="chatSkeleton" />
                        <div className="chatSkeleton short" />
                        <div className="chatSkeleton" />
                      </>
                    ) : groupedChatMessages.length ? (
                      groupedChatMessages.map((row, idx) =>
                        row.type === "date" ? (
                          <div key={`date-${idx}`} className="chatDateDivider">{row.label}</div>
                        ) : (
                          <div key={row.item.id} className={`chatBubble ${row.item.senderId === me?.id ? "mine" : ""}`}>
                            <p>{row.item.text}</p>
                            {row.item.attachments.map((a) => (
                              <a key={a.id} href={a.dataUrl} target="_blank" rel="noreferrer" className="chatAttachmentLink">
                                Вложение
                              </a>
                            ))}
                            {row.item.senderId === me?.id ? (
                              <small className="chatDeliveryState">
                                {Date.now() - new Date(row.item.createdAt).getTime() > 8000 ? "Доставлено" : "Отправлено"}
                              </small>
                            ) : null}
                          </div>
                        )
                      )
                    ) : (
                      <p className="muted">Пока нет сообщений. Начни диалог первым.</p>
                    )}
                  </div>
                  <div className="chatComposer">
                    <div className="chatQuickReplies">
                      {chatQuickReplies.map((text) => (
                        <button
                          key={`quick-${text}`}
                          type="button"
                          className="ghostBtn"
                          onClick={() => setChatText(text)}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                    <input
                      value={chatText}
                      onChange={(e) => setChatText(e.target.value)}
                      placeholder="Введите сообщение"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void sendConversationMessage();
                        }
                      }}
                    />
                    <div className="chatComposerActions">
                      <button
                        type="button"
                        className="ghostBtn chatAttachBtn"
                        onClick={() => chatFileInputRef.current?.click()}
                        title="Добавить вложение"
                      >
                        📎
                      </button>
                      <input
                        ref={chatFileInputRef}
                        className="chatHiddenFile"
                        type="file"
                        accept="image/*"
                        onChange={(e) => setChatAttachment(e.target.files?.[0] || null)}
                      />
                      <button type="button" onClick={() => void sendConversationMessage()} disabled={!selectedConversationId}>
                        Отправить
                      </button>
                    </div>
                    {chatAttachment ? (
                      <div className="chatAttachmentBar">
                        <small>{chatAttachment.name}</small>
                        <button type="button" className="ghostBtn" onClick={() => setChatAttachment(null)}>
                          Убрать
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {chatError ? <p className="error">{chatError}</p> : null}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {issueRecipientModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="issue-recipient-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.48)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 65,
            padding: 16
          }}
          onClick={() => {
            setIssueRecipientModal(null);
            setIssueRecipientSignedFile(null);
          }}
        >
          <div className="card" style={{ maxWidth: 480, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <h3 id="issue-recipient-title" style={{ marginTop: 0 }}>
                Фактический получатель
              </h3>
              <button type="button" className="ghostBtn" onClick={() => {
                setIssueRecipientModal(null);
                setIssueRecipientSignedFile(null);
              }}>
                Закрыть
              </button>
            </div>
            <p className="muted">
              {issueRecipientModal.domain === "TOOLS"
                ? "Кто фактически получает инструмент? ФИО попадёт в акт выдачи."
                : issueRecipientModal.domain === "WORKWEAR"
                  ? "ФИО сотрудника, на которого оформляется спецодежда — попадёт в акт выдачи."
                  : "Кто фактически получает материалы или расходники? ФИО попадёт в акт выдачи."}
            </p>
            <label>
              ФИО
              <input
                value={issueRecipientDraft}
                onChange={(e) => setIssueRecipientDraft(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void (async () => {
                      const name = issueRecipientDraft.trim();
                      if (!name) {
                        setIssuesMessage(
                          issueRecipientModal.domain === "TOOLS"
                            ? "Укажи фактического получателя инструмента"
                            : issueRecipientModal.domain === "WORKWEAR"
                              ? "Укажи ФИО получателя спецодежды"
                              : "Укажи фактического получателя материалов"
                        );
                        setIssuesTone("error");
                        return;
                      }
                      const { issueId, opts } = issueRecipientModal;
                      const signed = issueRecipientSignedFile;
                      const ok = await executeIssueAction(issueId, "issue", {
                        ...opts,
                        actualRecipientName: name,
                        signedFile: signed
                      });
                      if (ok) {
                        setIssueRecipientModal(null);
                        setIssueRecipientSignedFile(null);
                      }
                    })();
                  }
                }}
              />
            </label>
            <label className="muted" style={{ marginTop: 10, display: "block", fontSize: 13 }}>
              Подписанный акт или скан (PDF, изображение) — необязательно, сохранится в карточке заявки
              <input
                type="file"
                accept="image/*,.pdf,application/pdf"
                style={{ marginTop: 6 }}
                onChange={(e) => setIssueRecipientSignedFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <div className="toolbar" style={{ marginTop: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button type="button" className="ghostBtn" onClick={() => {
                setIssueRecipientModal(null);
                setIssueRecipientSignedFile(null);
              }}>
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const name = issueRecipientDraft.trim();
                    if (!name) {
                      setIssuesMessage(
                        issueRecipientModal.domain === "TOOLS"
                          ? "Укажи фактического получателя инструмента"
                          : issueRecipientModal.domain === "WORKWEAR"
                            ? "Укажи ФИО получателя спецодежды"
                            : "Укажи фактического получателя материалов"
                      );
                      setIssuesTone("error");
                      return;
                    }
                    const { issueId, opts } = issueRecipientModal;
                    const signed = issueRecipientSignedFile;
                    const ok = await executeIssueAction(issueId, "issue", {
                      ...opts,
                      actualRecipientName: name,
                      signedFile: signed
                    });
                    if (ok) {
                      setIssueRecipientModal(null);
                      setIssueRecipientSignedFile(null);
                    }
                  })();
                }}
              >
                Подтвердить и выдать
              </button>
            </div>
          </div>
        </div>
      )}

      {materialWriteoffModal && canMaterialWriteoff && activeObjectId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="material-writeoff-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 55,
            padding: 16
          }}
          onClick={() =>
            !materialWriteoffBusy &&
            (() => {
              setMaterialWriteoffModal(null);
              setMaterialWriteoffQty("");
              setMaterialWriteoffComment("");
              setMaterialWriteoffFile(null);
            })()
          }
        >
          <div className="card" style={{ maxWidth: 520, width: "100%" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <h3 id="material-writeoff-title" style={{ marginTop: 0 }}>
                Списание с ответственного
              </h3>
              <button
                type="button"
                className="ghostBtn"
                disabled={materialWriteoffBusy}
                onClick={() => {
                  setMaterialWriteoffModal(null);
                  setMaterialWriteoffQty("");
                  setMaterialWriteoffComment("");
                  setMaterialWriteoffFile(null);
                }}
              >
                Закрыть
              </button>
            </div>
            <p className="muted" style={{ margin: "0 0 10px" }}>
              {safeName(materialWriteoffModal.name)} · не больше{" "}
              {materialWriteoffModal.maxQty.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} {materialWriteoffModal.unit}
            </p>
            <div className="form">
              <label>
                Количество ({materialWriteoffModal.unit})
                <input
                  type="number"
                  min={0.001}
                  step="any"
                  value={materialWriteoffQty}
                  onChange={(e) => setMaterialWriteoffQty(e.target.value)}
                  autoFocus
                />
              </label>
              <label>
                Комментарий (необязательно)
                <input value={materialWriteoffComment} onChange={(e) => setMaterialWriteoffComment(e.target.value)} />
              </label>
              <label>
                Подписанный акт или иной файл (необязательно)
                <input
                  type="file"
                  onChange={(e) => setMaterialWriteoffFile(e.target.files?.[0] || null)}
                  disabled={materialWriteoffBusy}
                />
              </label>
            </div>
            <div className="toolbar" style={{ marginTop: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                className="ghostBtn"
                disabled={materialWriteoffBusy}
                onClick={() => {
                  setMaterialWriteoffModal(null);
                  setMaterialWriteoffQty("");
                  setMaterialWriteoffComment("");
                  setMaterialWriteoffFile(null);
                }}
              >
                Отмена
              </button>
              <button type="button" className="primaryBtn" disabled={materialWriteoffBusy} onClick={() => void submitMaterialWriteoff()}>
                {materialWriteoffBusy ? "Сохранение…" : "Списать"}
              </button>
            </div>
          </div>
        </div>
      )}

      {manualStockModalOpen && canWriteOperations && warehouses.length > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 55,
            padding: 16
          }}
          onClick={() => !manualStockBusy && setManualStockModalOpen(false)}
        >
          <div
            className="card warehouseManualStockCard"
            style={{ maxWidth: 520, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <h3 style={{ marginTop: 0 }}>Добавить материал вручную</h3>
              <button type="button" className="ghostBtn" disabled={manualStockBusy} onClick={() => setManualStockModalOpen(false)}>
                Закрыть
              </button>
            </div>
            <p className="muted" style={{ margin: "0 0 10px" }}>
              Создаётся новая карточка номенклатуры только с названием и единицей и сразу увеличивается остаток по текущему разделу (
              {objectSectionFilter === "SS" ? "СС" : "ЭОМ"}) без сопоставления и без объединения с другими позициями.
            </p>
            {manualStockMessage ? <p className="muted">{manualStockMessage}</p> : null}
            <div className="form grid2">
              <label>
                Объект (склад)
                <select
                  value={(manualStockWarehouseOverride || activeObjectId || warehouses[0]?.id) ?? ""}
                  onChange={(e) => setManualStockWarehouseOverride(e.target.value)}
                >
                  {warehouses.map((w) => (
                    <option key={`man-wh-${w.id}`} value={w.id}>
                      {safeName(w.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Количество
                <input
                  type="number"
                  min={0.001}
                  step="any"
                  value={manualStockQty}
                  onChange={(e) => setManualStockQty(e.target.value)}
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Название материала
                <input
                  value={manualStockName}
                  onChange={(e) => setManualStockName(e.target.value)}
                  placeholder="Например: Перфоратор (аренда)"
                />
              </label>
              <label>
                Вид номенклатуры
                <select value={manualStockKind} onChange={(e) => setManualStockKind(e.target.value as typeof manualStockKind)}>
                  <option value="MATERIAL">Основной материал</option>
                  <option value="CONSUMABLE">Расходник</option>
                  <option value="WORKWEAR">Спецодежда</option>
                </select>
              </label>
              <label>
                Цена за ед., ₽ (необязательно)
                <input
                  type="text"
                  inputMode="decimal"
                  value={manualStockUnitPrice}
                  onChange={(e) => setManualStockUnitPrice(e.target.value)}
                  placeholder="0"
                />
              </label>
              <label>
                Ед. измерения
                <input value={manualStockUnit} onChange={(e) => setManualStockUnit(e.target.value)} placeholder="шт" />
              </label>
            </div>
            <div className="toolbar" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="primaryBtn"
                disabled={manualStockBusy || !manualStockName.trim()}
                onClick={async () => {
                  if (!token) return;
                  const wid = manualStockWarehouseOverride || activeObjectId || warehouses[0]?.id;
                  if (!wid) return;
                  const qty = Number(String(manualStockQty).trim().replace(",", "."));
                  if (!Number.isFinite(qty) || qty <= 0) {
                    setManualStockMessage("Укажи положительное количество.");
                    return;
                  }
                  const priceRaw = manualStockUnitPrice.trim().replace(",", ".");
                  let unitPrice: number | null | undefined;
                  if (priceRaw === "") {
                    unitPrice = undefined;
                  } else {
                    const p = Number(priceRaw);
                    if (!Number.isFinite(p) || p < 0) {
                      setManualStockMessage("Некорректная цена.");
                      return;
                    }
                    unitPrice = p;
                  }
                  setManualStockBusy(true);
                  setManualStockMessage("");
                  try {
                    const res = await fetchWithSession(`${API_URL}/api/stocks/manual-line`, {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json"
                      },
                      body: JSON.stringify({
                        warehouseId: wid,
                        section: objectSectionFilter,
                        materialName: manualStockName.trim(),
                        quantity: qty,
                        unit: (manualStockUnit.trim() || "шт").slice(0, 64),
                        kind: manualStockKind,
                        unitPrice: unitPrice ?? null
                      })
                    });
                    const data = (await res.json().catch(() => ({}))) as { error?: string };
                    if (res.status === 403) {
                      setManualStockMessage("Нет прав на этот объект или раздел.");
                      return;
                    }
                    if (!res.ok) {
                      setManualStockMessage(data.error || `Ошибка ${res.status}`);
                      return;
                    }
                    setManualStockMessage("Строка добавлена — остатки обновлены.");
                    setManualStockModalOpen(false);
                    setManualStockName("");
                    setManualStockQty("1");
                    await loadCatalogData();
                    await loadStocks(q);
                  } finally {
                    setManualStockBusy(false);
                  }
                }}
              >
                {manualStockBusy ? "Сохранение…" : "Добавить на склад"}
              </button>
            </div>
          </div>
        </div>
      )}

      {limitPromptRequest && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 16
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setLimitPromptRequest(null);
          }}
        >
          <div
            className="card"
            style={{ maxWidth: 480, width: "100%" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
              <h3 style={{ marginTop: 0 }}>Заявка из лимита?</h3>
              <button type="button" className="ghostBtn" onClick={() => setLimitPromptRequest(null)}>
                Закрыть
              </button>
            </div>
            <p className="muted">
              Заявка <strong>{limitPromptRequest.number}</strong> загружена.
              Можно привязать её к одному из шаблонов лимита этого объекта/раздела —
              тогда при приёмке будут предлагаться названия материалов из лимита. Связь с лимитом можно изменить позже в
              списке заявок.
            </p>
            {limitTemplates.length === 0 ? (
              <p className="muted">На объекте нет шаблонов лимита — только вариант «Не из лимита» или закройте окно.</p>
            ) : (
              <label>
                Шаблон лимита
                <select
                  value={limitPromptTemplateId}
                  onChange={(e) => setLimitPromptTemplateId(e.target.value)}
                >
                  <option value="">Не из лимита</option>
                  {limitTemplates.map((t) => (
                    <option key={`limit-prompt-${t.id}`} value={t.id}>
                      {safeName(t.title)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="toolbar" style={{ marginTop: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                className="ghostBtn"
                onClick={() => setLimitPromptRequest(null)}
              >
                Позже
              </button>
              <button
                type="button"
                className="ghostBtn"
                onClick={() => {
                  void (async () => {
                    const ok = await attachReceiptRequestToLimit(limitPromptRequest.id, null);
                    if (ok) setLimitPromptRequest(null);
                  })();
                }}
              >
                Не из лимита
              </button>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const ok = await attachReceiptRequestToLimit(
                      limitPromptRequest.id,
                      limitPromptTemplateId || null
                    );
                    if (ok) setLimitPromptRequest(null);
                  })();
                }}
                disabled={!limitPromptTemplateId}
              >
                Привязать к лимиту
              </button>
            </div>
          </div>
        </div>
      )}

      <PendingAcceptanceModal />
      </section>
    </main>
  );
}

export default App;
