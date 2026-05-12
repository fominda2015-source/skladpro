import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { API_URL, ISSUE_FILTER_KEY, LIST_VIEW_KEY, STOCK_VIEW_KEY, TOKEN_KEY } from "./app/constants";
import { EmptyState, ErrorState, LoadingState, ResultBanner } from "./shared/ui/StateViews";
import {
  IntegrationJobsTable,
  type IntegrationJobRow
} from "./widgets/integrations/IntegrationJobsTable";
import { NotificationsTable, type NotificationRow } from "./widgets/integrations/NotificationsTable";
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
  category?: string | null;
  mergedIntoId?: string | null;
};
type IssueBasisType = "PROJECT_WORK" | "INTERNAL_NEED" | "EMERGENCY" | "OTHER";
type IssueFlowType = "REQUEST" | "DIRECT_ISSUE";
type IssueRequest = {
  id: string;
  number: string;
  status: string;
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
type IssueStatus = "DRAFT" | "ON_APPROVAL" | "APPROVED" | "REJECTED" | "ISSUED" | "CANCELLED";
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
  responsible?: string | null;
  note?: string | null;
  createdAt: string;
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
    matchQueuePending: number;
    failedIntegrations24h: number;
    unreadNotifications: number;
    errorNotifications24h: number;
  };
  project: { projectsCount: number; overspendLimitLines: number };
  object?: {
    warehouseId: string | null;
    warehouseName: string | null;
    projectsCount: number;
    limitsCount: number;
    materialsInLimits: number;
    plannedQty: number;
    issuedQty: number;
    usagePercent: number;
  };
  admin?: { activeUsers: number; auditEvents24h: number };
};

type MatchQueueRow = {
  id: string;
  rawName: string;
  normalizedName: string;
  status: string;
  confidence: number | null;
  suggestedMaterialId: string | null;
  suggestedMaterial?: { id: string; name: string } | null;
  resolvedMaterial?: { id: string; name: string } | null;
};
type MaterialMergeHistoryRow = {
  id: string;
  sourceMaterialId: string;
  targetMaterialId: string;
  reason?: string | null;
  createdAt: string;
  sourceMaterial?: { id: string; name: string; sku?: string | null; unit: string };
  targetMaterial?: { id: string; name: string; sku?: string | null; unit: string };
  actor?: { id: string; fullName: string; email: string } | null;
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
  const [email, setEmail] = useState("admin@skladpro.local");
  const [password, setPassword] = useState("1111");
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [authError, setAuthError] = useState("");
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
    | "matching"
    | "camp"
    | "audit"
    | "integrations"
    | "settings"
    | "profile"
    | "chat"
    | "feedback"
    | "reports"
  >("stocks");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [adminObjects, setAdminObjects] = useState<AdminObject[]>([]);
  const [newObjectName, setNewObjectName] = useState("");
  const [newObjectAddress, setNewObjectAddress] = useState("");
  const [newObjectUserIds, setNewObjectUserIds] = useState<string[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState("");
  const [bindObjectUserIds, setBindObjectUserIds] = useState<string[]>([]);
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
  const [newPassword, setNewPassword] = useState("1111");
  const [adminMessage, setAdminMessage] = useState("");
  const [selectedWarehouseScopes, setSelectedWarehouseScopes] = useState<string[]>([]);
  const [selectedProjectScopes, setSelectedProjectScopes] = useState<string[]>([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserFullName, setNewUserFullName] = useState("");
  const [newUserRoleName, setNewUserRoleName] = useState("VIEWER");
  const [newUserPassword, setNewUserPassword] = useState("1111");
  const [newUserWarehouseScopes, setNewUserWarehouseScopes] = useState<string[]>([]);
  const [newUserProjectScopes, setNewUserProjectScopes] = useState<string[]>([]);
  const [passCurrent, setPassCurrent] = useState("1111");
  const [passNext, setPassNext] = useState("1111");
  const [passMessage, setPassMessage] = useState("");
  const [profileFullName, setProfileFullName] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
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
  const [approvalQueue, setApprovalQueue] = useState<IssueRequest[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [limitsMessage, setLimitsMessage] = useState("");
  const [limitImportFile, setLimitImportFile] = useState<File | null>(null);
  const [limitTemplates, setLimitTemplates] = useState<LimitImportTemplate[]>([]);
  const [limitTemplatesLoading, setLimitTemplatesLoading] = useState(false);
  const [limitIssuedTotals, setLimitIssuedTotals] = useState<Record<string, number>>({});
  const [limitEditMode, setLimitEditMode] = useState(false);
  const [expandedLimitNodes, setExpandedLimitNodes] = useState<Record<string, boolean>>({});
  // Локальные «черновики» правки строк лимита: ключ — id узла шаблона.
  const [limitNodeDrafts, setLimitNodeDrafts] = useState<
    Record<string, { title?: string; unit?: string; plannedQty?: string }>
  >({});
  const [limitTemplateTitleDrafts, setLimitTemplateTitleDrafts] = useState<Record<string, string>>({});
  const [receiptRequestFile, setReceiptRequestFile] = useState<File | null>(null);
  const [receiptRequests, setReceiptRequests] = useState<ReceiptRequestRow[]>([]);
  // Модалка «Заявка из лимита?» после загрузки Excel.
  const [limitPromptRequest, setLimitPromptRequest] = useState<ReceiptRequestRow | null>(null);
  const [limitPromptTemplateId, setLimitPromptTemplateId] = useState<string>("");
  // Черновики приёмки: на заявку → на позицию → {newName, newUnit, qty}.
  type AcceptanceDraftItem = { newName: string; newUnit: string; qty: string };
  const [acceptanceDrafts, setAcceptanceDrafts] = useState<Record<string, Record<string, AcceptanceDraftItem>>>({});
  const [acceptanceScans, setAcceptanceScans] = useState<Record<string, File | null>>({});
  const [acceptanceDocNumbers, setAcceptanceDocNumbers] = useState<Record<string, string>>({});
  const [acceptanceSubmitting, setAcceptanceSubmitting] = useState<Record<string, boolean>>({});
  const [expandedReceiptIds, setExpandedReceiptIds] = useState<Record<string, boolean>>({});
  // Модалка «приложить документы» перед самым приёмом.
  const [pendingAcceptanceRequestId, setPendingAcceptanceRequestId] = useState<string | null>(null);
  const [pendingAcceptanceFiles, setPendingAcceptanceFiles] = useState<File[]>([]);
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
  const [toolName, setToolName] = useState("Перфоратор Bosch");
  const [toolInventoryNumber, setToolInventoryNumber] = useState(`INV-${Date.now()}`);
  const [toolSerialNumber, setToolSerialNumber] = useState("");
  const [toolWarehouseId, setToolWarehouseId] = useState("");
  const [toolResponsible, setToolResponsible] = useState("");
  const [toolSearch, setToolSearch] = useState("");
  const [toolStatusFilter, setToolStatusFilter] = useState<"" | ToolStatus>("");
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
  const [waybillSender, setWaybillSender] = useState("СкладПро");
  const [waybillRecipient, setWaybillRecipient] = useState("ООО Подрядчик");
  const [waybillVehicle, setWaybillVehicle] = useState("ГАЗель");
  const [waybillDriver, setWaybillDriver] = useState("Иванов И.И.");
  const [waybillMaterialId, setWaybillMaterialId] = useState("");
  const [waybillQty, setWaybillQty] = useState(1);
  const [selectedWaybillId, setSelectedWaybillId] = useState("");
  const [waybillEvents, setWaybillEvents] = useState<WaybillEvent[]>([]);
  const [drawerMode, setDrawerMode] = useState<"" | "issue" | "waybill">("");
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [dashboardError, setDashboardError] = useState("");
  const [matchQueue, setMatchQueue] = useState<MatchQueueRow[]>([]);
  const [matchRaw, setMatchRaw] = useState("Арматура d12");
  const [matchArticle, setMatchArticle] = useState("");
  const [matchTryResult, setMatchTryResult] = useState<Record<string, unknown> | null>(null);
  const [matchMessage, setMatchMessage] = useState("");
  const [resolveMaterialId, setResolveMaterialId] = useState("");
  const [mergeSourceMaterialId, setMergeSourceMaterialId] = useState("");
  const [mergeTargetMaterialId, setMergeTargetMaterialId] = useState("");
  const [mergeReason, setMergeReason] = useState("");
  const [materialMergeHistory, setMaterialMergeHistory] = useState<MaterialMergeHistoryRow[]>([]);
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
  const [feedbackMessages, setFeedbackMessages] = useState<ChatMessage[]>([]);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackAttachment, setFeedbackAttachment] = useState<File | null>(null);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [reportsMessage, setReportsMessage] = useState("");
  const [warehouseSnapshot, setWarehouseSnapshot] = useState<WarehouseSnapshotReport | null>(null);
  const [reportsSnapshotLoading, setReportsSnapshotLoading] = useState(false);
  const chatMessagesRef = useRef<HTMLDivElement | null>(null);
  const chatFileInputRef = useRef<HTMLInputElement | null>(null);
  const feedbackFileInputRef = useRef<HTMLInputElement | null>(null);
  const feedbackMessagesRef = useRef<HTMLDivElement | null>(null);

  const hasPermission = (permission: string) =>
    Boolean(me?.permissions?.includes("*") || me?.permissions?.includes(permission));
  const sidebarAccessOptions: Array<{ id: string; label: string; permissions: string[] }> = [
    { id: "stocks", label: "Главная", permissions: ["dashboard.read"] },
    { id: "warehouse", label: "Склад", permissions: ["stocks.read"] },
    { id: "operations", label: "Приходы", permissions: ["operations.read", "operations.write"] },
    { id: "issues", label: "Выдачи", permissions: ["issues.read", "issues.write"] },
    { id: "approvals", label: "Заявки", permissions: ["issues.approve"] },
    { id: "waybills", label: "Перемещения", permissions: ["waybills.read", "waybills.write"] },
    { id: "documents", label: "Документы", permissions: ["documents.read", "documents.write", "documents.upload"] },
    { id: "limits", label: "Лимиты", permissions: ["limits.read", "limits.write"] },
    { id: "matching", label: "Сопоставление", permissions: ["materials.match", "materials.read"] },
    { id: "catalog", label: "Справочники", permissions: ["warehouses.read", "materials.read", "materials.write"] },
    { id: "tools", label: "Инструменты", permissions: ["tools.read", "tools.write"] },
    { id: "qr", label: "QR", permissions: ["tools.read"] },
    { id: "integrations", label: "Интеграции", permissions: ["integrations.read", "integrations.write", "notifications.read"] },
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
  const groupedFeedbackMessages = useMemo(() => {
    const rows: Array<{ type: "date"; label: string } | { type: "message"; item: ChatMessage }> = [];
    let prevDateKey = "";
    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    for (const item of feedbackMessages) {
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
  }, [feedbackMessages]);
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
  }, [stocks, activeObjectId, acceptedBySourceByTargetId, materialMappingsByTargetId]);

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
    matching: "Сопоставление номенклатуры",
    audit: "Аудит действий",
    operations: "Приходы",
    issues: "Заявки на выдачу",
    limits: "Лимиты проекта",
    approvals: "Заявки",
    documents: "Документы",
    waybills: "Транспортные накладные",
    qr: "QR-сканирование",
    tools: "Инструменты",
    integrations: "Интеграции и уведомления",
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
    matching: "Контроль",
    chat: "Контроль",
    feedback: "Контроль",
    reports: "Контроль",
    audit: "Контроль",
    catalog: "Сервис",
    tools: "Сервис",
    qr: "Сервис",
    integrations: "Сервис",
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
  const canWriteLimits = useMemo(() => hasPermission("limits.write"), [me]);
  const canReadAudit = useMemo(
    () => hasPermission("audit.read"),
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
  const canMaterialMatch = useMemo(
    () =>
      Boolean(
        hasPermission("materials.match") ||
          hasPermission("materials.write")
      ),
    [me]
  );
  const canReadStocks = useMemo(() => hasPermission("stocks.read"), [me]);
  const canReadIssues = useMemo(() => hasPermission("issues.read"), [me]);
  const canReadOperations = useMemo(() => hasPermission("operations.read"), [me]);
  const canReadLimits = useMemo(() => hasPermission("limits.read"), [me]);
  const canReadDocuments = useMemo(() => hasPermission("documents.read"), [me]);
  const canReadTools = useMemo(() => hasPermission("tools.read"), [me]);
  const canReadWaybills = useMemo(() => hasPermission("waybills.read"), [me]);
  const canReadIntegrations = useMemo(() => hasPermission("integrations.read"), [me]);
  const canReadNotifications = useMemo(() => hasPermission("notifications.read"), [me]);
  const showLegacyMatching = false;
  const isStorekeeperMode = useMemo(() => me?.role === "STOREKEEPER", [me]);

  async function loadStockMovements() {
    if (!token) {
      return;
    }
    setStockMovementsLoading(true);
    setStockMovementsError("");
    try {
      const res = await fetch(`${API_URL}/api/stock-movements?take=150`, {
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
      const res = await fetch(`${API_URL}/api/stocks${query}`, {
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
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      throw new Error("Сессия невалидна");
    }
    const data = (await res.json()) as MeResponse;
    setMe(data);
    setProfileFullName(data.fullName);
    setProfileAvatarUrl(data.avatarUrl ?? null);
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
    const res = await fetch(`${API_URL}/api/auth/context`, {
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

  async function updateProfile(next: { fullName?: string; avatarUrl?: string | null }) {
    if (!token) return;
    const res = await fetch(`${API_URL}/api/auth/me/profile`, {
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
    setProfileAvatarUrl(data.avatarUrl ?? null);
  }

  async function loadDashboardSummary() {
    if (!token || !canDashboard) {
      return;
    }
    setDashboardError("");
    try {
      const query = dashboardWarehouseId ? `?warehouseId=${encodeURIComponent(dashboardWarehouseId)}` : "";
      const r = await fetch(`${API_URL}/api/dashboard/summary${query}`, {
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

  async function loadMatchQueue() {
    if (!token) {
      return;
    }
    const r = await fetch(`${API_URL}/api/material-match/queue`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (r.ok) {
      setMatchQueue((await r.json()) as MatchQueueRow[]);
    }
  }

  async function loadMaterialMergeHistory() {
    if (!token) return;
    const r = await fetch(`${API_URL}/api/materials/merge-history`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (r.ok) {
      setMaterialMergeHistory((await r.json()) as MaterialMergeHistoryRow[]);
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
    const r = await fetch(`${API_URL}/api/audit?${parts.join("&")}`, {
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
    const r = await fetch(`${API_URL}/api/audit/meta`, {
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
      const r = await fetch(`${API_URL}/api/audit/${id}/revert`, {
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
    const r = await fetch(`${API_URL}/api/integrations/jobs`, {
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
    const r = await fetch(`${API_URL}/api/integrations/jobs`, {
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
    const r = await fetch(`${API_URL}/api/integrations/jobs/${encodeURIComponent(id)}/run`, {
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
    const r = await fetch(`${API_URL}/api/notifications`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setNotifications((await r.json()) as NotificationRow[]);
  }

  async function markNotificationsRead(ids: string[]) {
    if (!token || !ids.length) return;
    await fetch(`${API_URL}/api/notifications/read`, {
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
    if (entityType === "documentfile") {
      setActiveTab("documents");
      return;
    }
    setActiveTab("integrations");
  }

  async function loadReadiness() {
    if (!token) return;
    const r = await fetch(`${API_URL}/api/contracts/readiness`, {
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
    const res = await fetch(`${API_URL}/api/chat/users`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    setChatUsers((await res.json()) as ChatUser[]);
  }

  async function loadConversations() {
    if (!token) return;
    const res = await fetch(`${API_URL}/api/chat/conversations`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const rows = (await res.json()) as Conversation[];
    setChatConversations(rows);
    if (rows.length && !selectedConversationId) setSelectedConversationId(rows[0].id);
  }

  async function startDmConversation(userId: string): Promise<string | undefined> {
    if (!token) return;
    setChatError("");
    const res = await fetch(`${API_URL}/api/chat/conversations/dm`, {
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

  async function loadConversationMessages(conversationId: string) {
    if (!token || !conversationId) return;
    setChatError("");
    setChatLoading(true);
    const res = await fetch(`${API_URL}/api/chat/conversations/${conversationId}/messages`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setChatError("Не удалось загрузить сообщения");
      setChatLoading(false);
      return;
    }
    setChatMessages((await res.json()) as ChatMessage[]);
    setChatViewedAt((prev) => ({ ...prev, [conversationId]: new Date().toISOString() }));
    setChatLoading(false);
  }

  async function sendConversationMessage() {
    if (!token || !selectedConversationId || !chatText.trim()) return;
    setChatError("");
    const attachments = chatAttachment
      ? [{ fileName: chatAttachment.name, mimeType: chatAttachment.type, dataUrl: await fileToDataUrl(chatAttachment) }]
      : [];
    const res = await fetch(`${API_URL}/api/chat/conversations/${selectedConversationId}/messages`, {
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
    await loadConversationMessages(selectedConversationId);
    await loadConversations();
  }

  async function loadFeedbackMessages() {
    if (!token) return;
    setFeedbackLoading(true);
    setFeedbackError("");
    const res = await fetch(`${API_URL}/api/feedback/messages`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setFeedbackError("Не удалось загрузить сообщения поддержки");
      setFeedbackLoading(false);
      return;
    }
    const payload = (await res.json()) as { items: ChatMessage[] };
    setFeedbackMessages(payload.items);
    setFeedbackLoading(false);
  }

  async function sendFeedbackMessage() {
    if (!token || !feedbackText.trim()) return;
    setFeedbackError("");
    const attachments = feedbackAttachment
      ? [{ fileName: feedbackAttachment.name, mimeType: feedbackAttachment.type, dataUrl: await fileToDataUrl(feedbackAttachment) }]
      : [];
    const res = await fetch(`${API_URL}/api/feedback/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text: feedbackText.trim(), attachments })
    });
    if (!res.ok) {
      setFeedbackError("Не удалось отправить сообщение в поддержку");
      return;
    }
    setFeedbackText("");
    setFeedbackAttachment(null);
    await loadFeedbackMessages();
  }

  async function syncObjectUsers(objectId: string, userIds: string[]) {
    if (!token) return false;
    const res = await fetch(`${API_URL}/api/admin/objects/${objectId}/users`, {
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
    const res = await fetch(`${API_URL}/api/admin/objects/${objectId}/sections/${section}/users`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userIds })
    });
    if (!res.ok) return false;
    await loadAdminData();
    return true;
  }

  async function runMaterialMatch(enqueue: boolean) {
    if (!token) {
      return;
    }
    setMatchMessage("");
    setMatchTryResult(null);
    try {
      const r = await fetch(`${API_URL}/api/material-match/try`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          rawName: matchRaw.trim(),
          article: matchArticle.trim() || undefined,
          enqueue
        })
      });
      const data = (await r.json()) as Record<string, unknown> & { error?: string };
      if (!r.ok) {
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      setMatchTryResult(data);
      if (data.autoResolved) {
        setMatchMessage("Авто-сопоставление: материал автоматически схлопнут (safe-режим).");
      }
      if (enqueue) {
        await loadMatchQueue();
      }
    } catch (e) {
      setMatchMessage(String(e));
    }
  }

  async function resolveMatchQueue(id: string) {
    if (!token || !resolveMaterialId) {
      setMatchMessage("Выберите материал для привязки");
      return;
    }
    const r = await fetch(`${API_URL}/api/material-match/queue/${encodeURIComponent(id)}/resolve`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ materialId: resolveMaterialId })
    });
    if (!r.ok) {
      setMatchMessage(await r.text());
    } else {
      await loadMatchQueue();
    }
  }

  async function rejectMatchQueue(id: string) {
    if (!token) {
      return;
    }
    const r = await fetch(`${API_URL}/api/material-match/queue/${encodeURIComponent(id)}/reject`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) {
      setMatchMessage(await r.text());
    } else {
      await loadMatchQueue();
    }
  }

  async function mergeMaterials() {
    if (!token || !mergeSourceMaterialId || !mergeTargetMaterialId) {
      setMatchMessage("Выберите исходный и целевой материалы");
      return;
    }
    if (mergeSourceMaterialId === mergeTargetMaterialId) {
      setMatchMessage("Исходный и целевой материалы должны отличаться");
      return;
    }
    const ok = window.confirm("Объединить материалы? Операция переносит остатки, лимиты и историю на целевой материал.");
    if (!ok) return;
    const r = await fetch(`${API_URL}/api/materials/merge`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceMaterialId: mergeSourceMaterialId,
        targetMaterialId: mergeTargetMaterialId,
        reason: mergeReason.trim() || undefined
      })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      setMatchMessage(typeof err.error === "string" ? err.error : "Не удалось объединить материалы");
      return;
    }
    setMatchMessage("Материалы объединены");
    setMergeSourceMaterialId("");
    setMergeReason("");
    await loadCatalogData();
    await loadMatchQueue();
    await loadMaterialMergeHistory();
  }

  async function loadAdminData() {
    if (!token || !canManageUsers) {
      return;
    }
    const [usersRes, rolesRes, positionsRes, objectsRes] = await Promise.all([
      fetch(`${API_URL}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_URL}/api/admin/roles`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_URL}/api/admin/positions`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_URL}/api/admin/objects`, { headers: { Authorization: `Bearer ${token}` } })
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
    if (objectsData.length && !selectedObjectId) {
      setSelectedObjectId(objectsData[0].id);
      setBindObjectUserIds(objectsData[0].userIds || []);
      setBindObjectSectionUserIds(objectsData[0].sectionUsers?.[selectedObjectSection] || []);
    }
    if (usersData.length && !selectedUserId) {
      setSelectedUserId(usersData[0].id);
      setSelectedRoleName(usersData[0].role);
      setSelectedStatus(usersData[0].status);
      setSelectedPermissions(usersData[0].customPermissions || usersData[0].permissions || []);
      const pos = positionsData.find((p) => p.name === usersData[0].position);
      setSelectedPositionId(pos?.id || "");
    }
  }

  async function loadCatalogData() {
    if (!token) {
      return;
    }
    const [wRes, mRes] = await Promise.all([
      fetch(`${API_URL}/api/warehouses`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_URL}/api/materials?expandMerged=1`, { headers: { Authorization: `Bearer ${token}` } })
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
    const res = await fetch(`${API_URL}/api/projects`, {
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
      const res = await fetch(
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
      const [templatesRes, issuedRes] = await Promise.all([
        fetch(`${API_URL}/api/limit-imports?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(`${API_URL}/api/stock-movements/issued-summary?${params.toString()}`, {
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
    } catch (e) {
      setLimitTemplates([]);
      setLimitIssuedTotals({});
      setLimitsMessage(`Не удалось загрузить лимиты: ${String(e)}`);
    } finally {
      setLimitTemplatesLoading(false);
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
    const res = await fetch(`${API_URL}/api/limit-imports/upload`, {
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
    const res = await fetch(`${API_URL}/api/limit-imports/${templateId}`, {
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
    const res = await fetch(`${API_URL}/api/limit-imports/${templateId}`, {
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
    const res = await fetch(`${API_URL}/api/limit-imports/${templateId}/nodes`, {
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
    const res = await fetch(`${API_URL}/api/limit-imports/nodes/${nodeId}`, {
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
    const res = await fetch(`${API_URL}/api/limit-imports/nodes/${nodeId}`, {
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
    const res = await fetch(`${API_URL}/api/receipt-requests?${params.toString()}`, {
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
    const res = await fetch(`${API_URL}/api/material-mappings?${params.toString()}`, {
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
    const res = await fetch(`${API_URL}/api/receipt-requests/upload`, {
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

  async function attachReceiptRequestToLimit(requestId: string, templateId: string | null) {
    if (!token) return;
    const res = await fetch(`${API_URL}/api/receipt-requests/${requestId}/limit`, {
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
      return;
    }
    setOpsMessage(templateId ? "Заявка привязана к лимиту" : "Заявка отвязана от лимита");
    await loadReceiptRequests();
  }

  async function submitReceiptAcceptance(row: ReceiptRequestRow, extraFiles: File[] = []) {
    if (!token) return;
    const drafts = acceptanceDrafts[row.id] || {};
    const mappings: Array<{
      itemId: string;
      materialId?: string;
      newMaterialName?: string;
      newMaterialUnit?: string;
      acceptedQty: number;
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
        return;
      }
      const explicitName = (draft?.newName ?? "").trim();
      const explicitUnit = (draft?.newUnit ?? "").trim();
      const finalName = explicitName || it.sourceName;
      mappings.push({
        itemId: it.id,
        newMaterialName: finalName,
        newMaterialUnit: explicitUnit || it.sourceUnit || "шт",
        acceptedQty: qty
      });
    }
    if (!mappings.length) {
      setOpsMessage("Поставьте галочки на тех позициях, которые сейчас принимаются");
      return;
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
      const res = await fetch(`${API_URL}/api/receipt-requests/${row.id}/accept`, {
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
        return;
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
      await loadReceiptRequests();
      await loadMaterialMappings();
      await loadStocks(q);
      await loadOperations();
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
      if (issueSearch.trim()) params.set("q", issueSearch.trim());
      params.set("sort", issuesSort);
      params.set("page", String(issuesPage));
      params.set("pageSize", String(issuesPageSize));
      const qs = params.toString();
      const query = qs ? `?${qs}` : "";
      const res = await fetch(`${API_URL}/api/issues${query}`, {
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
    opts?: { fromApprovals?: boolean; closeDrawer?: boolean; actualRecipientName?: string }
  ) {
    if (!token) return;
    const actionText = issueActionLabel(action).toLowerCase();
    let actualRecipientName = opts?.actualRecipientName?.trim();
    if (action === "issue" && !actualRecipientName) {
      const issue = issues.find((x) => x.id === issueId) || approvalQueue.find((x) => x.id === issueId) || selectedIssue;
      const fallback = issue?.actualRecipientName || issue?.responsibleName || "";
      const prompted = window.prompt("Кто фактически получает материалы? Это ФИО попадёт в акт выдачи.", fallback);
      if (prompted === null) return;
      actualRecipientName = prompted.trim();
      if (!actualRecipientName) {
        setIssuesMessage("Укажи фактического получателя материалов");
        setIssuesTone("error");
        return;
      }
    }
    const ok = window.confirm(`Подтвердить действие: ${actionText}?`);
    if (!ok) return;
    const res = await fetch(`${API_URL}/api/issues/${issueId}/${action}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(action === "issue" ? { "Content-Type": "application/json" } : {})
      },
      ...(action === "issue" ? { body: JSON.stringify({ actualRecipientName }) } : {})
    });
    if (!res.ok) {
      setIssuesMessage(`Не удалось выполнить действие: ${issueActionLabel(action)}`);
      setIssuesTone(res.status === 409 ? "conflict" : "error");
      return;
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
    }
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
      const createRes = await fetch(`${API_URL}/api/issues`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouseId: activeObjectId,
          section: objectSectionFilter,
          note: issueNote.trim() || undefined,
          responsibleName,
          flowType: "DIRECT_ISSUE",
          basisType: "OTHER",
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
      const issueRes = await fetch(`${API_URL}/api/issues/${created.id}/issue`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ actualRecipientName })
      });
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

  async function executeWaybillStatus(
    waybillId: string,
    status: WaybillStatus,
    comment: string
  ) {
    if (!token) return;
    const ok = window.confirm(`Подтвердить перевод ТН в статус "${waybillStatusLabel(status)}"?`);
    if (!ok) return;
    const res = await fetch(`${API_URL}/api/waybills/${waybillId}/status`, {
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
    const res = await fetch(`${API_URL}/api/issues?status=ON_APPROVAL&section=${encodeURIComponent(objectSectionFilter)}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const payload = (await res.json()) as PagedResponse<IssueRequest> | IssueRequest[];
    setApprovalQueue(Array.isArray(payload) ? payload : payload.items);
  }

  async function loadOperations() {
    if (!token) return;
    const res = await fetch(`${API_URL}/api/operations?section=${encodeURIComponent(objectSectionFilter)}`, {
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
        `sort=${encodeURIComponent(toolsSort)}`,
        `page=${encodeURIComponent(String(toolsPage))}`,
        `pageSize=${encodeURIComponent(String(toolsPageSize))}`
      ].filter(Boolean);
      const query = queryParts.length ? `?${queryParts.join("&")}` : "";
      const res = await fetch(`${API_URL}/api/tools${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as PagedResponse<ToolItem> | ToolItem[];
      const items = Array.isArray(payload) ? payload : payload.items;
      setTools(items);
      setToolsTotal(Array.isArray(payload) ? items.length : payload.total);
      if (items.length && !selectedToolIds.length) {
        setSelectedToolIds([items[0].id]);
      }
      if (items.length && !selectedToolForEvents) {
        setSelectedToolForEvents(items[0].id);
      }
    } catch (e) {
      setToolsError(`Не удалось загрузить инструменты: ${String(e)}`);
    } finally {
      setToolsLoading(false);
    }
  }

  async function loadToolEvents(toolId: string) {
    if (!token || !toolId) return;
    const res = await fetch(`${API_URL}/api/tools/${toolId}/events`, {
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
      const res = await fetch(`${API_URL}/api/waybills${query}`, {
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
    const res = await fetch(`${API_URL}/api/waybills/${waybillId}/events`, {
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
    const res = await fetch(`${API_URL}/api/waybills/${waybillId}/pdf`, {
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
  ) {
    if (!token) return;
    const responsible = opts?.responsible?.trim() || undefined;
    const comment = opts?.comment?.trim() || undefined;
    if (action === "ISSUE" && !responsible) {
      setToolsMessage("Выдача отменена: ответственное лицо обязательно");
      setToolsTone("conflict");
      return;
    }
    const res = await fetch(`${API_URL}/api/tools/${toolId}/action`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, responsible, comment })
    });
    if (!res.ok) {
      setToolsMessage("Не удалось изменить статус инструмента");
      setToolsTone(res.status === 409 ? "conflict" : "error");
      return;
    }
    setToolsTone("success");
    if (opts?.photo) {
      const formData = new FormData();
      formData.append("entityType", "tool");
      formData.append("entityId", toolId);
      formData.append("type", "photo");
      formData.append("file", opts.photo);
      await fetch(`${API_URL}/api/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
    }
    await loadTools();
    await loadToolEvents(toolId);
  }

  function openToolActionDialog(toolId: string, action: ToolActionKind) {
    const selected = tools.find((t) => t.id === toolId);
    setToolAction({ toolId, action });
    setToolActionResponsible(selected?.responsible || "");
    setToolActionComment("");
    setToolActionPhoto(null);
  }

  async function submitToolActionDialog() {
    if (!toolAction) return;
    await doToolAction(toolAction.toolId, toolAction.action, {
      responsible: toolActionResponsible,
      comment: toolActionComment,
      photo: toolActionPhoto
    });
    setToolAction(null);
  }

  async function loadDocuments() {
    if (!token) return;
    const parts = [
      docEntityType && docEntityId ? `entityType=${encodeURIComponent(docEntityType)}` : "",
      docEntityType && docEntityId ? `entityId=${encodeURIComponent(docEntityId)}` : "",
      docTypeFilter ? `type=${encodeURIComponent(docTypeFilter)}` : ""
    ].filter(Boolean);
    const query = parts.length ? `?${parts.join("&")}` : "";
    const res = await fetch(`${API_URL}/api/documents${query}`, {
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
      const res = await fetch(`${API_URL}/api/camp-items${query}`, {
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
      const res = await fetch(`${API_URL}/api/camp-items`, {
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
    const res = await fetch(`${API_URL}/api/camp-items/${id}`, {
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
    const res = await fetch(`${API_URL}/api/camp-items/${id}`, {
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
      const res = await fetch(`${API_URL}/api/camp-items/${id}/files`, {
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
    const res = await fetch(`${API_URL}/api/camp-items/${itemId}/files/${fileId}`, {
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
  const selectedTool = tools.find((x) => x.id === selectedToolForEvents) || tools[0] || null;
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
    const res = await fetch(`${API_URL}/api/tools?q=${encodeURIComponent(value)}`, {
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
    if (!token || !canDashboard) {
      setDashboard(null);
      return;
    }
    void loadDashboardSummary();
  }, [token, canDashboard, me, dashboardWarehouseId]);

  useEffect(() => {
    if (!token || activeTab !== "matching") {
      return;
    }
    void loadCatalogData().catch(() => undefined);
    void loadMatchQueue();
    void loadMaterialMergeHistory();
  }, [token, activeTab]);

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
      if (selectedConversationId) void loadConversationMessages(selectedConversationId);
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
    void loadFeedbackMessages();
  }, [token, activeTab]);

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
  }, [activeTab, feedbackMessages, feedbackLoading]);

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
    if (canMaterialMatch) visibleTabs.add("matching");
    if (canReadLimits) visibleTabs.add("limits");
    visibleTabs.add("camp");
    if (canReadIntegrations || canReadNotifications) visibleTabs.add("integrations");
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
    canMaterialMatch,
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
    issuesSort,
    issuesPage,
    issuesPageSize,
    objectSectionFilter,
    activeObjectId
  ]);

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
        if (!AnyBarcodeDetector) {
          setQrScanError("Сканер доступен только в современных браузерах (BarcodeDetector).");
          return;
        }
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
  }, [toolSearch, toolStatusFilter, toolsSort, toolsPageSize]);

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
      JSON.stringify({ showStockSku, showStockReserve })
    );
  }, [showStockSku, showStockReserve]);

  useEffect(() => {
    if (token && activeTab === "approvals") {
      void loadApprovalQueue();
      void loadReceiptRequests();
    }
  }, [token, activeTab]);

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
    }
  }, [token, activeTab, toolSearch, toolStatusFilter, toolsSort, toolsPage, toolsPageSize, objectSectionFilter]);

  useEffect(() => {
    if (token && activeTab === "waybills") {
      void loadCatalogData();
      void loadWaybills();
    }
  }, [token, activeTab, waybillStatusFilter, waybillsSort, waybillsPage, waybillsPageSize]);

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
  }, [warehouses, materials, waybillFromWarehouseId, waybillMaterialId]);

  useEffect(() => {
    if (activeObjectId) {
      setOpWarehouseId(activeObjectId);
      setIssueWarehouseId(activeObjectId);
      setToolWarehouseId(activeObjectId);
      if (!dashboardWarehouseId) setDashboardWarehouseId(activeObjectId);
    }
  }, [activeObjectId, dashboardWarehouseId]);

  async function onLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setAuthError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
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

  function onLogout() {
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
          <form className="form" onSubmit={onLoginSubmit}>
            <label>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Пароль
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button type="submit">Войти</button>
          </form>
          {authError && <p className="error">{authError}</p>}
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
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className={`shell uiSupreme ${isStorekeeperMode ? "warehouseMode" : ""}`}>
      <aside className={`sidebar ${mobileNavOpen ? "mobileOpen" : ""}`}>
        <div className="brandWrap">
          <h2 className="brand">СкладПро</h2>
          <p className="brandSub">Warehouse ERP</p>
        </div>
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
        {showLegacyMatching && canMaterialMatch && <button className={`navBtn ${activeTab === "matching" ? "active" : ""}`} onClick={() => setActiveTab("matching")}><span className="navIcon">◇</span>Сопоставление</button>}


        <button className={`navBtn ${activeTab === "feedback" ? "active" : ""}`} onClick={() => setActiveTab("feedback")}><span className="navIcon">🛠</span>Обратная связь</button>
        <button className={`navBtn ${activeTab === "reports" ? "active" : ""}`} onClick={() => setActiveTab("reports")}><span className="navIcon">📄</span>Сводка</button>
        {canReadAudit && <button className={`navBtn ${activeTab === "audit" ? "active" : ""}`} onClick={() => setActiveTab("audit")}><span className="navIcon">◉</span>Логи</button>}

        <p className="navSectionTitle">Сервис</p>
        {(canReadStocks || canWriteCatalog) && <button className={`navBtn ${activeTab === "catalog" ? "active" : ""}`} onClick={() => setActiveTab("catalog")}><span className="navIcon">▣</span>Справочники</button>}
        {canReadTools && <button className={`navBtn ${activeTab === "tools" ? "active" : ""}`} onClick={() => setActiveTab("tools")}><span className="navIcon">⚒</span>Инструменты</button>}
        {canReadTools && <button className={`navBtn ${activeTab === "qr" ? "active" : ""}`} onClick={() => setActiveTab("qr")}><span className="navIcon">⌁</span>QR</button>}
        {(canReadIntegrations || canReadNotifications) && <button className={`navBtn ${activeTab === "integrations" ? "active" : ""}`} onClick={() => setActiveTab("integrations")}><span className="navIcon">⎘</span>{canReadIntegrations ? "Интеграции" : "Уведомления"}</button>}

        <p className="navSectionTitle">Администрирование</p>
        {canManageUsers && <button className={`navBtn ${activeTab === "admin" ? "active" : ""}`} onClick={() => setActiveTab("admin")}><span className="navIcon">⚙</span>Доступы</button>}

        <p className="navSectionTitle">Аккаунт</p>
        <button className={`navBtn ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}><span className="navIcon">◉</span>Профиль</button>
        <button className={`navBtn ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}><span className="navIcon">⚙</span>Настройки</button>
        <button className={`navBtn ${activeTab === "password" ? "active" : ""}`} onClick={() => setActiveTab("password")}><span className="navIcon">✱</span>Смена пароля</button>
        <button className="navBtn danger" onClick={onLogout}>Выйти</button>
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


            <button className="topIconBtn" onClick={() => setActiveTab("profile")}>Профиль</button>
            <button className="topIconBtn" onClick={() => setActiveTab("settings")}>Настройки</button>
            {me ? (
              <span className="userChip">
                <span className="userAvatar">
                  {me.avatarUrl ? <img src={me.avatarUrl} alt={me.fullName} className="userAvatarImage" /> : me.fullName.slice(0, 1).toUpperCase()}
                </span>
                <span>{me.fullName}</span>
              </span>
            ) : null}
          </div>
        </header>
        {dashboard && activeTab === "stocks" && (
          <div className="card dashboardStrip">
            <div className="toolbar dashboardFacts" style={{ flexWrap: "wrap", gap: 12 }}>
              <button type="button" className="dashboardFactBtn" onClick={() => canReadOperations && setActiveTab("operations")}>
                Приходов сегодня: <strong>{dashboard.warehouse.receiptsToday}</strong>
              </button>
              <button type="button" className="dashboardFactBtn" onClick={() => canReadIssues && setActiveTab("issues")}>
                Расходов (операций) сегодня: <strong>{dashboard.warehouse.issuesOperationsToday}</strong>
              </button>
              <button type="button" className="dashboardFactBtn" onClick={() => canReadIssues && setActiveTab("issues")}>
                Выдано заявок сегодня: <strong>{dashboard.warehouse.issuesRequestsIssuedToday}</strong>
              </button>
              <button type="button" className="dashboardFactBtn" onClick={() => canReadIssues && setActiveTab("approvals")}>
                Заявок в работе: <strong>{dashboard.warehouse.pendingApprovals}</strong>
              </button>
              <button
                type="button"
                className="dashboardFactBtn"
                onClick={() => {
                  if (!canReadStocks) return;
                  setQ("low");
                  void loadStocks("low");
                  setActiveTab("warehouse");
                }}
              >
                Низкий остаток (&lt;5): <strong>{dashboard.warehouse.lowStockLines}</strong>
              </button>
              <button
                type="button"
                className="dashboardFactBtn"
                onClick={() => {
                  if (!canReadTools) return;
                  setToolStatusFilter("IN_REPAIR");
                  setActiveTab("tools");
                }}
              >
                Инструмент в ремонте: <strong>{dashboard.warehouse.toolsInRepair}</strong>
              </button>
              <button
                type="button"
                className="dashboardFactBtn"
                onClick={() => {
                  if (!canMaterialMatch || !showLegacyMatching) return;
                  setActiveTab("matching");
                }}
              >
                Очередь сопоставления: <strong>{dashboard.warehouse.matchQueuePending}</strong>
              </button>
              <button
                type="button"
                className="dashboardFactBtn"
                onClick={() => {
                  if (!canReadIntegrations) return;
                  setActiveTab("integrations");
                }}
              >
                Сбои интеграций (24ч): <strong>{dashboard.warehouse.failedIntegrations24h}</strong>
              </button>
              <button
                type="button"
                className="dashboardFactBtn"
                onClick={() => {
                  if (!canReadNotifications && !canReadIntegrations) return;
                  setActiveTab("integrations");
                }}
              >
                Мои непрочитанные уведомления: <strong>{dashboard.warehouse.unreadNotifications}</strong>
              </button>
              <button
                type="button"
                className="dashboardFactBtn"
                onClick={() => {
                  if (!canReadNotifications && !canReadIntegrations) return;
                  setActiveTab("integrations");
                }}
              >
                Критические уведомления (24ч): <strong>{dashboard.warehouse.errorNotifications24h}</strong>
              </button>
              <button
                type="button"
                className="dashboardFactBtn"
                onClick={() => {
                  if (!canReadStocks) return;
                  setActiveTab("warehouse");
                }}
              >
                Объект: <strong>{dashboard.object?.warehouseName || "—"}</strong>
              </button>
              <button
                type="button"
                className="dashboardFactBtn"
                onClick={() => {
                  if (!canReadLimits) return;
                  setActiveTab("limits");
                }}
              >
                Проектов: <strong>{dashboard.object?.projectsCount ?? 0}</strong>
              </button>
              <button
                type="button"
                className="dashboardFactBtn"
                onClick={() => {
                  if (!canReadLimits) return;
                  setActiveTab("limits");
                }}
              >
                Выполнение лимитов: <strong>{dashboard.object?.usagePercent ?? 0}%</strong>
              </button>
              {dashboard.admin && (
                <button
                  type="button"
                  className="dashboardFactBtn"
                  onClick={() => {
                    if (canReadAudit) setActiveTab("audit");
                    else if (canReadIntegrations || canReadNotifications) setActiveTab("integrations");
                  }}
                >
                  Активных пользователей: <strong>{dashboard.admin.activeUsers}</strong> · аудит 24ч:{" "}
                  <strong>{dashboard.admin.auditEvents24h}</strong>
                </button>
              )}
            </div>
          </div>
        )}
        {dashboardError && <p className="error">{dashboardError}</p>}
        {activeTab === "stocks" && (
          <div className="dashboardBoard">
            <section className="dashboardMain">
              <div className="kpiRow">
                <button className="kpi kpiBtn" onClick={() => setActiveTab("stocks")}><span>Поступления</span><strong>{dashboard?.warehouse.receiptsToday ?? stocks.length}</strong></button>
                <button className="kpi kpiBtn" onClick={() => { setQ("low"); void loadStocks("low"); setActiveTab("warehouse"); }}><span>Проблемные</span><strong>{stocks.filter((x) => x.isLow).length}</strong></button>
                <button className="kpi kpiBtn" onClick={() => { setIssueStatusFilter("ON_APPROVAL"); setActiveTab("issues"); }}><span>Заявки в работе</span><strong>{dashboard?.warehouse.pendingApprovals ?? approvalQueue.length}</strong></button>
                <button className="kpi kpiBtn" onClick={() => setActiveTab("waybills")}><span>Перемещения</span><strong>{dashboard?.warehouse.transfersToday ?? waybills.length}</strong></button>
                {showLegacyMatching ? (
                  <button type="button" className="kpi kpiBtn" onClick={() => setActiveTab("matching")}><span>Сопоставление</span><strong>{dashboard?.warehouse.matchQueuePending ?? matchQueue.length}</strong></button>
                ) : null}
                <button
                  type="button"
                  className="kpi kpiBtn"
                  onClick={() => {
                    if (canReadIntegrations || canReadNotifications) setActiveTab("integrations");
                  }}
                >
                  <span>Уведомления</span>
                  <strong>{dashboard?.warehouse.unreadNotifications ?? notifications.filter((n) => !n.isRead).length}</strong>
                </button>
              </div>
              <div className="card">
                <h3>Обзор по объекту</h3>
                <p className="muted">
                  Детальный список материалов и все остатки перенесены в отдельную вкладку `Склад`.
                </p>
                <div className="toolbar">
                  <label>
                    Объект
                    <select value={dashboardWarehouseId} onChange={(e) => setDashboardWarehouseId(e.target.value)} disabled>
                      {warehouses
                        .filter((w) => (activeObjectId ? w.id === activeObjectId : true))
                        .map((w) => (
                          <option key={w.id} value={w.id}>{safeName(w.name)}</option>
                        ))}
                    </select>
                  </label>
                  <button type="button" onClick={() => setActiveTab("warehouse")}>Открыть склад</button>
                </div>
              </div>
              <div className="grid2">
                <div className="card">
                  <h3>Проблемные остатки</h3>
                  <ul className="plainList">
                    <li>Критичных остатков: <strong>{stocks.filter((x) => x.isLow).length}</strong></li>
                    <li>На рассмотрении: <strong>{approvalQueue.length}</strong></li>
                    <li>Заявки в работе: <strong>{issues.filter((x) => x.status !== "ISSUED" && x.status !== "REJECTED").length}</strong></li>
                  </ul>
                </div>
                <div className="card">
                  <h3>Быстрые действия</h3>
                  <div className="toolbar">
                    <button onClick={() => setActiveTab("operations")}>Новое поступление</button>
                    <button onClick={() => setActiveTab("issues")}>Новая выдача</button>
                    <button onClick={() => setActiveTab("operations")}>Возврат материала</button>
                    <button onClick={() => setActiveTab("tools")}>Приход инструмента</button>
                  </div>
                </div>
              </div>
            </section>
            <aside className="dashboardRight">
              <div className="card">
                <div className="rightCardHeader">
                  <h3>Очередь заявок</h3>
                  <button className="ghostBtn" onClick={() => setActiveTab("approvals")}>Открыть</button>
                </div>
                <div className="queueList">
                  {(approvalQueue.length ? approvalQueue : issues.filter((i) => i.status !== "ISSUED").slice(0, 5)).map((i) => (
                    <div key={i.id} className="queueItem">
                      <div>
                        <strong>{i.number}</strong>
                        <p className="muted">{i.requestedBy?.fullName || i.requestedById}</p>
                      </div>
                      <div className="queueActions">
                        <span className={`badge ${statusClass(i.status)}`}>{issueStatusLabel(i.status)}</span>
                        <button className="miniActionBtn" onClick={() => { setSelectedIssueId(i.id); setDrawerMode("issue"); }}>Детали</button>
                      </div>
                    </div>
                  ))}
                  {!approvalQueue.length && !issues.length && <p className="muted">Очередь пуста</p>}
                </div>
              </div>
              <div className="card approvalCard">
                <h3>Карточка заявки</h3>
                {approvalQueue.length ? (
                  <>
                    <p className="muted">
                      {approvalQueue[0]?.number} · {approvalQueue[0]?.requestedBy?.fullName || approvalQueue[0]?.requestedById}
                    </p>
                    <div className="approvalActions">
                      <button
                        className="dangerBtn"
                        onClick={() => approvalQueue[0] && void executeIssueAction(approvalQueue[0].id, "reject", { fromApprovals: true })}
                      >
                        Отклонить
                      </button>
                      <button
                        onClick={() => approvalQueue[0] && void executeIssueAction(approvalQueue[0].id, "approve", { fromApprovals: true })}
                      >
                        Подтвердить
                      </button>
                      <button
                        className="secondaryBtn"
                        onClick={() => approvalQueue[0] && void executeIssueAction(approvalQueue[0].id, "issue", { fromApprovals: true })}
                      >
                        Выдать
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted">Нет заявок на рассмотрении.</p>
                )}
              </div>
              <div className="card">
                <h3>Последние заявки</h3>
                <div className="queueList">
                  {issues.slice(0, 4).map((i) => (
                    <div key={i.id} className="queueItem">
                      <span>{i.number}</span>
                      <strong className={statusClass(i.status)}>{issueStatusLabel(i.status)}</strong>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <h3>Динамика расходов</h3>
                <div className="miniBars">
                  {[32, 46, 28, 62, 52, 44].map((v, idx) => (
                    <div key={idx} className="miniBarWrap">
                      <div className="miniBar" style={{ height: `${v}%` }} />
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        )}
      {showLegacyMatching && activeTab === "matching" && (
        <div className="card">
          <h2>Сопоставление с канонической номенклатурой</h2>
          <p className="muted">
            Проверка строки из УПД/накладной: точное имя, SKU, синонимы и нечёткое совпадение. При низкой уверенности
            запись попадает в очередь (ТЗ: material_match_queue).
          </p>
          <div className="form grid2">
            <label>
              Сырое название
              <input value={matchRaw} onChange={(e) => setMatchRaw(e.target.value)} />
            </label>
            <label>
              Артикул / SKU (необязательно)
              <input value={matchArticle} onChange={(e) => setMatchArticle(e.target.value)} />
            </label>
          </div>
          <div className="toolbar">
            <button type="button" onClick={() => void runMaterialMatch(false)}>
              Проверить совпадение
            </button>
            <button type="button" onClick={() => void runMaterialMatch(true)}>
              В очередь сопоставления
            </button>
          </div>
          {matchMessage && <p className="error">{matchMessage}</p>}
          {matchTryResult && (
            <pre className="plainList" style={{ whiteSpace: "pre-wrap" }}>
              {JSON.stringify(matchTryResult, null, 2)}
            </pre>
          )}

          <h3>Очередь (ожидают решения)</h3>
          <div className="toolbar">
            <label>
              Материал для привязки
              <select value={resolveMaterialId} onChange={(e) => setResolveMaterialId(e.target.value)}>
                <option value="">— выберите —</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Уверенность</th>
                <th>Подсказка</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {matchQueue.map((row) => (
                <tr key={row.id}>
                  <td>{row.rawName}</td>
                  <td>{row.confidence != null ? row.confidence.toFixed(2) : "—"}</td>
                  <td>{row.suggestedMaterial?.name || "—"}</td>
                  <td>
                    <button type="button" disabled={!canMaterialMatch} onClick={() => void resolveMatchQueue(row.id)}>
                      Привязать
                    </button>{" "}
                    <button type="button" disabled={!canMaterialMatch} onClick={() => void rejectMatchQueue(row.id)}>
                      Отклонить
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!matchQueue.length && <p className="muted">Очередь пуста.</p>}

          <h3 style={{ marginTop: 18 }}>Объединение дублей материалов</h3>
          <p className="muted">
            Переносит ссылки, остатки и лимиты с исходного материала на целевой. Исходный материал помечается как
            объединенный и скрывается из рабочих списков.
          </p>
          <div className="form grid2">
            <label>
              Исходный (дубль)
              <select value={mergeSourceMaterialId} onChange={(e) => setMergeSourceMaterialId(e.target.value)}>
                <option value="">— выберите —</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.sku ? `(${m.sku})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Целевой (канон)
              <select value={mergeTargetMaterialId} onChange={(e) => setMergeTargetMaterialId(e.target.value)}>
                <option value="">— выберите —</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.sku ? `(${m.sku})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Причина (необязательно)
              <input
                value={mergeReason}
                onChange={(e) => setMergeReason(e.target.value)}
                placeholder="Напр. дубль после импорта УПД"
              />
            </label>
          </div>
          <div className="toolbar">
            <button type="button" disabled={!canMaterialMatch} onClick={() => void mergeMaterials()}>
              Объединить материалы
            </button>
          </div>

          <h3 style={{ marginTop: 18 }}>История объединений</h3>
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Из</th>
                <th>В</th>
                <th>Причина</th>
                <th>Кто</th>
              </tr>
            </thead>
            <tbody>
              {materialMergeHistory.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.createdAt).toLocaleString()}</td>
                  <td>{row.sourceMaterial?.name || row.sourceMaterialId}</td>
                  <td>{row.targetMaterial?.name || row.targetMaterialId}</td>
                  <td>{row.reason || "—"}</td>
                  <td>{row.actor?.fullName || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!materialMergeHistory.length && <p className="muted">Объединений пока нет.</p>}
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
          </div>
          <div className="toolbar stockToolbarPrimary">
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
            <button
              type="button"
              className={showAttachedMaterials ? "secondaryBtn" : "ghostBtn"}
              onClick={() => setShowAttachedMaterials((v) => !v)}
            >
              {showAttachedMaterials ? "Только лимитные" : "Все материалы"}
            </button>
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
          </div>
          {limitFilterEnabled && (
            <p className="muted">
              В списке показаны только материалы лимитов, которые реально есть на складе. Нулевые позиции из лимитов скрыты.
            </p>
          )}
          {loadingStocks && <p>Загрузка остатков...</p>}
          {stocksError && <p className="error">{stocksError}</p>}
          {!loadingStocks && !stocksError && (
            <table className="desktopTable">
              <thead>
                <tr>
                  <th>Склад</th>
                  <th>Материал</th>
                  {showStockSku && <th>SKU</th>}
                  <th>Ед.</th>
                  <th>Помещение</th>
                  <th>Ячейка</th>
                  <th>Остаток</th>
                  {showStockReserve && <th>Резерв</th>}
                  <th>Доступно</th>
                </tr>
              </thead>
              <tbody>
                {warehouseDisplayRows.map((row) => (
                  <Fragment key={row.id}>
                    <tr className={row.isLow ? "low" : ""}>
                      <td>{safeName(row.warehouseName)}</td>
                      <td>
                        <button
                          type="button"
                          className="ghostBtn"
                          onClick={() => {
                            void loadStockMovements();
                            setExpandedStockRowId((prev) => (prev === row.id ? "" : row.id));
                          }}
                        >
                          {expandedStockRowId === row.id ? "+" : "−"}
                        </button>{" "}
                        {safeName(row.materialName)}
                        {(materialMappingsByTargetId.get(row.materialId)?.length || 0) > 0 ? (
                          <span className="muted"> · фактических названий: {materialMappingsByTargetId.get(row.materialId)?.length}</span>
                        ) : null}
                      </td>
                      {showStockSku && <td>{row.materialSku || "-"}</td>}
                      <td>{row.materialUnit}</td>
                      <td>{row.storageRoom || "—"}</td>
                      <td>{row.storageCell || "—"}</td>
                      <td>
                        {(Number(row.quantity)).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                      </td>
                      {showStockReserve && <td>{(Number(row.reserved)).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}</td>}
                      <td>{(Number(row.available)).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}</td>
                    </tr>
                    {expandedStockRowId === row.id && (
                      <tr>
                        <td colSpan={showStockSku && showStockReserve ? 9 : showStockSku || showStockReserve ? 8 : 7}>
                          <div className="card">
                            {((acceptedBySourceByTargetId.get(row.materialId)?.size || 0) > 0 ||
                              (materialMappingsByTargetId.get(row.materialId)?.length || 0) > 0) ? (
                              <>
                                <h4>Фактические названия</h4>
                                <p className="muted" style={{ margin: "0 0 8px" }}>
                                  По каждой строке — как в УПД / сопоставлении; суммарный складской остаток см. в основной строке таблицы.
                                </p>
                                <ul className="plainList">
                                  {[...(acceptedBySourceByTargetId.get(row.materialId)?.values() || [])].map((x, i) => (
                                    <li key={`actual-q-${row.id}-${i}`}>
                                      <strong>{x.sourceName}</strong> ({x.sourceUnit || row.materialUnit}) —{" "}
                                      принято {x.quantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                                    </li>
                                  ))}
                                  {(materialMappingsByTargetId.get(row.materialId) || [])
                                    .filter((m) => {
                                      // не дублируем то, что уже показано выше
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
                            <h4>Движения по позиции (куски, возвраты, приходы)</h4>
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
                                    <td>{Number.isFinite(Number(m.quantity)) ? Math.round(Number(m.quantity)) : 0}</td>
                                    <td>{m.operation?.documentNumber || m.issueRequest?.number || m.sourceDocumentType}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
          {!loadingStocks && !stocksError && (
            <div className="mobileCards">
              {warehouseDisplayRows.map((row) => (
                <article key={`m-stock-${row.id}`} className={`mobileCard ${row.isLow ? "low" : ""}`}>
                  <h4>{safeName(row.materialName)}</h4>
                  <p><strong>Склад:</strong> {safeName(row.warehouseName)}</p>
                  {showStockSku ? <p><strong>SKU:</strong> {row.materialSku || "-"}</p> : null}
                  <p><strong>Ед.:</strong> {row.materialUnit}</p>
                  <p><strong>Помещение:</strong> {row.storageRoom || "—"}</p>
                  <p><strong>Ячейка:</strong> {row.storageCell || "—"}</p>
                  <p><strong>Остаток:</strong> {Number(row.quantity).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}</p>
                  {showStockReserve ? (
                    <p>
                      <strong>Резерв:</strong> {Number(row.reserved).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                    </p>
                  ) : null}
                  <p>
                    <strong>Доступно:</strong> {Number(row.available).toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                  </p>
                  {(materialMappingsByTargetId.get(row.materialId)?.length || 0) > 0 ||
                  (acceptedBySourceByTargetId.get(row.materialId)?.size || 0) > 0 ? (
                    <details>
                      <summary>Фактические названия и принятые количества</summary>
                      <ul className="plainList">
                        {[...(acceptedBySourceByTargetId.get(row.materialId)?.values() || [])].map((x, i) => (
                          <li key={`m-acc-${row.id}-${i}`}>
                            <strong>{x.sourceName}</strong> ({x.sourceUnit || row.materialUnit}) — принято{" "}
                            {x.quantity.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}
                          </li>
                        ))}
                        {(materialMappingsByTargetId.get(row.materialId) || [])
                          .filter((m) => {
                            const bk = `${m.sourceName}|${m.sourceUnit || ""}`;
                            return !acceptedBySourceByTargetId.get(row.materialId)?.has(bk);
                          })
                          .map((m) => (
                            <li key={`m-map-${row.id}-${m.id}`}>
                              {m.sourceName} ({m.sourceUnit || row.materialUnit}) —{" "}
                              <span className="muted">пока не принято</span>
                            </li>
                          ))}
                      </ul>
                    </details>
                  ) : null}
                </article>
              ))}
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
                        ) : row.revertable ? (
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
                    const res = await fetch(`${API_URL}/api/warehouses`, {
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
                Добавление новых материалов перенесено в раздел `Приходы`, чтобы кладовщик работал в одном сценарии.
              </p>
            </div>
          </div>
          {catalogMessage && <p className="muted">{catalogMessage}</p>}
        </div>
      )}

      {activeTab === "operations" && (
        <div className="receiptsWorkspace">
          <div className="card">
            <div className="rightCardHeader" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ margin: 0 }}>Приходы</h2>
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
                                                  : String(remaining)
                                            }
                                          : {
                                              newName: prev[row.id]?.[it.id]?.newName || "",
                                              newUnit: prev[row.id]?.[it.id]?.newUnit || "",
                                              qty: ""
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
                                                  qty: prev[row.id]?.[it.id]?.qty || ""
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
                                                  qty: prev[row.id]?.[it.id]?.qty || ""
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
                                                  qty: e.target.value
                                                }
                                              }
                                            }))
                                          }
                                        />
                                      </td>
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
        </div>
      )}

      {activeTab === "issues" && (
        <div className="issuesWorkspace">
          <div className="card issueComposer">
            <div className="rightCardHeader" style={{ alignItems: "flex-start", gap: 12 }}>
              <div>
                <h2>Выдача материалов</h2>
                <p className="muted">Раздел {objectSectionFilter}{activeObjectId ? ` · ${safeName(availableObjects.find((o) => o.id === activeObjectId)?.name || "")}` : ""}</p>
              </div>
              <div className="kpiRow" style={{ margin: 0 }}>
                <div className="kpi">
                  <span>В корзине</span>
                  <strong>{issuePickCart.length}</strong>
                </div>
                <div className="kpi">
                  <span>Вариантов на складе</span>
                  <strong>{issueFacingRows.length}</strong>
                </div>
                <div className="kpi">
                  <span>Всего выдач</span>
                  <strong>{issuesTotal}</strong>
                </div>
              </div>
            </div>

            {issuesMessage && <ResultBanner text={issuesMessage} tone={issuesTone} />}

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
                {issueSubmitting ? "Выдача..." : "Выдать материал"}
              </button>
            </div>
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
              <EmptyState title="Выдач пока нет" hint="Подберите материалы выше и нажмите «Выдать материал»." />
            )}
            {!issuesLoading && !issuesError && issues.length > 0 && (
              <>
                <table className="desktopTable issueHistoryTable">
                  <thead>
                    <tr>
                      <th>Номер</th>
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
            <div className="toolbar" style={{ justifyContent: "flex-end" }}>
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
                  const totalPlanned = materialNodes.reduce((sum, n) => sum + Number(n.plannedQty || 0), 0);
                  const totalIssued = materialNodes.reduce(
                    (sum, n) => sum + (n.materialId ? Number(issuedTotalsByMaterialId.get(n.materialId) || 0) : 0),
                    0
                  );
                  const overallPct =
                    totalPlanned > 0 ? Math.min(100, Math.round((totalIssued / totalPlanned) * 100)) : 0;
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
                    const pct = planned > 0 ? Math.min(100, Math.round((issued / planned) * 100)) : 0;
                    const isOver = planned > 0 && issued > planned;
                    const nodeTitle = String(node.materialName || node.title || "");
                    const qtyText = `${Math.round(issued)} / ${Number.isFinite(planned) ? planned : 0} ${node.unit || "шт"}`;

                    return (
                      <div key={node.id} style={{ marginLeft: depth * 16 }}>
                        {isGroup ? (
                          <div className="limitGroupRow">
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
                              </>
                            )}
                          </div>
                        ) : (
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
                            <div className="progressWrap" style={{ width: "100%" }}>
                              <div className={`progressBar ${isOver ? "bad" : ""}`} style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        )}

                        {isGroup && isExpanded && children.length
                          ? children.map((ch) => renderNode(ch, depth + 1))
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
                      <div className="progressWrap" style={{ width: "100%", margin: "10px 0 14px" }}>
                        <div className={`progressBar ${overCount ? "bad" : ""}`} style={{ width: `${overallPct}%` }} />
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

      {activeTab === "approvals" && (
        <div className="card">
          <h2>Заявки</h2>
          {issuesMessage && <ResultBanner text={issuesMessage} tone={issuesTone} />}
          <div className="kpiRow">
            <div className="kpi">
              <span>На рассмотрении</span>
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

          <h3>Заявки на выдачу</h3>
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
              {approvalQueue.map((i) => (
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
              ))}
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
                    const res = await fetch(`${API_URL}/api/waybills`, {
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
                    const res = await fetch(`${API_URL}/api/tools/${qrResult.tool.id}/qr`, {
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
          <h2>Инструмент: карточка, QR и печать</h2>
          <p className="muted">Текущий раздел: {objectSectionFilter}</p>
          {toolsLoading && <LoadingState text="Загрузка инструментов..." />}
          {toolsError && <ErrorState text={toolsError} />}
          <div className="toolbar">
            <input
              placeholder="Поиск инструмента (название, инв. номер, QR)"
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
            <select value={toolsSort} onChange={(e) => setToolsSort(e.target.value as typeof toolsSort)}>
              <option value="created_desc">Сначала новые</option>
              <option value="inventory">По инвентарному номеру</option>
              <option value="status">По статусу</option>
            </select>
            <button onClick={() => void loadTools()}>Обновить список</button>
          </div>
          {selectedTool && (
            <div className="card processCard">
              <h4>Шаг процесса инструмента</h4>
              <p className="muted">
                {selectedTool.inventoryNumber} · {selectedTool.name} · текущий этап:{" "}
                <strong>{toolStatusLabel(selectedTool.status)}</strong>
              </p>
              <div className="toolbar">
                {selectedTool.status !== "ISSUED" && (
                  <button onClick={() => openToolActionDialog(selectedTool.id, "ISSUE")}>Выдать</button>
                )}
                {selectedTool.status !== "IN_STOCK" && (
                  <button onClick={() => openToolActionDialog(selectedTool.id, "RETURN")}>Вернуть на склад</button>
                )}
                {selectedTool.status !== "IN_REPAIR" && (
                  <button onClick={() => openToolActionDialog(selectedTool.id, "SEND_TO_REPAIR")}>Передать в ремонт</button>
                )}
                {selectedTool.status !== "DISPUTED" && (
                  <button onClick={() => openToolActionDialog(selectedTool.id, "MARK_DISPUTED")}>Открыть спор</button>
                )}
                {selectedTool.status !== "WRITTEN_OFF" && (
                  <button className="dangerBtn" onClick={() => openToolActionDialog(selectedTool.id, "WRITE_OFF")}>Списать</button>
                )}
              </div>
              <p className="muted">История изменений доступна ниже в журнале инструмента.</p>
            </div>
          )}
          <div className="form">
            <label>
              Название
              <input value={toolName} onChange={(e) => setToolName(e.target.value)} />
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
              Склад
              <select value={toolWarehouseId} onChange={(e) => setToolWarehouseId(e.target.value)} disabled>
                <option value="">Не указан</option>
                {warehouses
                  .filter((w) => (activeObjectId ? w.id === activeObjectId : true))
                  .map((w) => (
                    <option key={w.id} value={w.id}>{safeName(w.name)}</option>
                  ))}
              </select>
            </label>
            <label>
              Ответственный
              <input value={toolResponsible} onChange={(e) => setToolResponsible(e.target.value)} />
            </label>
          </div>
          <div className="toolbar">
            <button
              onClick={async () => {
                if (!token || !toolName || !toolInventoryNumber) return;
                setToolsMessage("");
                setToolsTone("neutral");
                const res = await fetch(`${API_URL}/api/tools`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: toolName,
                    inventoryNumber: toolInventoryNumber,
                    serialNumber: toolSerialNumber || undefined,
                    warehouseId: toolWarehouseId || undefined,
                    section: objectSectionFilter,
                    responsible: toolResponsible || undefined
                  })
                });
                if (!res.ok) {
                  const text = await res.text();
                  setToolsMessage(`Ошибка создания инструмента: ${text}`);
                  setToolsTone(res.status === 409 ? "conflict" : "error");
                  return;
                }
                setToolsMessage("Инструмент создан");
                setToolsTone("success");
                setToolInventoryNumber(`INV-${Date.now()}`);
                setToolSerialNumber("");
                await loadTools();
              }}
            >
              Создать инструмент
            </button>
            <button
              onClick={async () => {
                if (!token || !selectedToolIds.length) {
                  setToolsMessage("Выбери хотя бы один инструмент");
                  setToolsTone("conflict");
                  return;
                }
                const res = await fetch(`${API_URL}/api/tools/labels/pdf?ids=${encodeURIComponent(selectedToolIds.join(","))}`, {
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
          {!toolsLoading && !toolsError && !tools.length && <EmptyState title="Инструменты не найдены" hint="Добавь инструмент или проверь фильтры." />}
          {toolQrPreview && (
            <div className="card">
              <h3>QR предпросмотр: {toolQrPreview.qrCode}</h3>
              <img src={toolQrPreview.dataUrl} alt="Tool QR preview" style={{ maxWidth: 220 }} />
            </div>
          )}
          {!toolsLoading && !toolsError && tools.length > 0 && (
          <>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Инв. номер</th>
                <th>Название</th>
                <th>Серийный</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.id}>
                  <td>
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
                  </td>
                  <td>{t.inventoryNumber}</td>
                  <td>{t.name}</td>
                  <td>{t.serialNumber || "-"}</td>
                  <td><span className={`badge ${statusClass(t.status)}`}>{toolStatusLabel(t.status)}</span></td>
                  <td>
                    <div className="toolbar">
                      <button onClick={() => openToolActionDialog(t.id, "ISSUE")}>Выдать</button>
                      <button onClick={() => openToolActionDialog(t.id, "RETURN")}>Вернуть</button>
                      <button onClick={() => openToolActionDialog(t.id, "SEND_TO_REPAIR")}>Ремонт</button>
                      <button onClick={() => openToolActionDialog(t.id, "WRITE_OFF")}>Списать</button>
                      <button
                        onClick={async () => {
                          if (!token) return;
                          const res = await fetch(`${API_URL}/api/tools/${t.id}/qr`, {
                            headers: { Authorization: `Bearer ${token}` }
                          });
                          if (!res.ok) {
                            setToolsMessage("Не удалось получить QR");
                            setToolsTone("error");
                            return;
                          }
                          const data = (await res.json()) as { toolId?: string; id: string; dataUrl: string; qrCode: string };
                          setToolQrPreview({ toolId: data.id, dataUrl: data.dataUrl, qrCode: data.qrCode });
                          setQrCode(data.qrCode);
                          setSelectedToolForEvents(t.id);
                          await loadToolEvents(t.id);
                        }}
                      >
                        QR
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            <span className="muted">Стр. {toolsPage} / {toolsTotalPages}</span>
            <button type="button" onClick={() => setToolsPage((p) => Math.min(toolsTotalPages, p + 1))} disabled={toolsPage >= toolsTotalPages}>
              Вперед
            </button>
          </div>
          <h3>Журнал инструмента</h3>
          <div className="toolbar">
            <select value={selectedToolForEvents} onChange={(e) => setSelectedToolForEvents(e.target.value)}>
              {tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.inventoryNumber} - {t.name}
                </option>
              ))}
            </select>
            <button onClick={() => void loadToolEvents(selectedToolForEvents)}>Обновить журнал</button>
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
              {toolEvents.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.createdAt).toLocaleString()}</td>
                  <td>{toolActionLabel(e.action)}</td>
                  <td>{toolStatusLabel(e.status)}</td>
                  <td>{e.comment || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
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
          <p className="muted">Чат напрямую с администратором. Можно приложить скриншот ошибки.</p>
          {feedbackError && <ErrorState text={feedbackError} />}
          <div className="chatMessages feedbackThread" ref={feedbackMessagesRef}>
            {feedbackLoading ? (
              <>
                <div className="chatSkeleton" />
                <div className="chatSkeleton short" />
                <div className="chatSkeleton" />
              </>
            ) : groupedFeedbackMessages.length ? (
              groupedFeedbackMessages.map((row, idx) =>
                row.type === "date" ? (
                  <div key={`feedback-date-${idx}`} className="chatDateDivider">{row.label}</div>
                ) : (
                  <div key={row.item.id} className={`chatBubble ${row.item.senderId === me?.id ? "mine" : ""}`}>
                    <p>{row.item.text}</p>
                    {row.item.attachments?.map((a) => (
                      <a key={a.id} href={a.dataUrl} target="_blank" rel="noreferrer" className="chatAttachmentLink">
                        {a.fileName}
                      </a>
                    ))}
                    <small className="chatDeliveryState">{row.item.senderId === me?.id ? "Вы" : "Администратор"}</small>
                  </div>
                )
              )
            ) : (
              <p className="muted">Сообщений пока нет. Опиши проблему, и админ ответит в этом треде.</p>
            )}
          </div>
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
              placeholder="Опиши проблему или вопрос"
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                  e.preventDefault();
                  void sendFeedbackMessage();
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
              <button type="button" onClick={() => void sendFeedbackMessage()}>Отправить в поддержку</button>
            </div>
            <p className="muted">Подсказка: `Ctrl+Enter` отправляет сообщение.</p>
            {feedbackAttachment ? (
              <div className="chatAttachmentBar">
                <small>{feedbackAttachment.name}</small>
                <button type="button" className="ghostBtn" onClick={() => setFeedbackAttachment(null)}>
                  Убрать
                </button>
              </div>
            ) : null}
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
                const res = await fetch(
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
        <div className="card">
          <h2>Управление доступами</h2>
          <h3>Объекты (дом/площадка)</h3>
          <div className="grid2">
            <div className="card">
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
                    const res = await fetch(`${API_URL}/api/admin/objects`, {
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
            <div className="card">
              <h4>Привязать пользователей к объекту</h4>
              <div className="form">
                <label>
                  Объект
                  <select
                    value={selectedObjectId}
                    onChange={(e) => {
                      setSelectedObjectId(e.target.value);
                      const obj = adminObjects.find((x) => x.id === e.target.value);
                      setBindObjectUserIds(obj?.userIds || []);
                      setBindObjectSectionUserIds(obj?.sectionUsers?.[selectedObjectSection] || []);
                    }}
                  >
                    {adminObjects.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Раздел для точечного доступа
                  <select
                    value={selectedObjectSection}
                    onChange={(e) => {
                      const section = e.target.value as "SS" | "EOM";
                      setSelectedObjectSection(section);
                      const obj = adminObjects.find((x) => x.id === selectedObjectId);
                      setBindObjectSectionUserIds(obj?.sectionUsers?.[section] || []);
                    }}
                  >
                    <option value="SS">СС</option>
                    <option value="EOM">ЭОМ</option>
                  </select>
                </label>
                <div className="plainList">
                  {users.map((u) => (
                    <label key={`obj-bind-user-${u.id}`} style={{ display: "block" }}>
                      <input
                        type="checkbox"
                        checked={bindObjectUserIds.includes(u.id)}
                        onChange={(e) => {
                          setBindObjectUserIds((prev) =>
                            e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                          );
                        }}
                      />{" "}
                      {u.fullName}
                    </label>
                  ))}
                </div>
                <h4 style={{ margin: "10px 0 6px" }}>Доступ к разделу {selectedObjectSection}</h4>
                <div className="plainList">
                  {users.map((u) => (
                    <label key={`obj-bind-sec-user-${u.id}`} style={{ display: "block" }}>
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
              </div>
              <div className="toolbar">
                <button
                  type="button"
                  onClick={async () => {
                    if (!token || !selectedObjectId) return;
                    const res = await fetch(`${API_URL}/api/admin/objects/${selectedObjectId}/users`, {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                      body: JSON.stringify({ userIds: bindObjectUserIds })
                    });
                    if (!res.ok) {
                      setAdminMessage("Не удалось привязать пользователей к объекту");
                      return;
                    }
                    setAdminMessage("Пользователи привязаны к объекту");
                    await loadAdminData();
                  }}
                >
                  Привязать пользователей
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!selectedObjectId) return;
                    const ok = await syncObjectSectionUsers(
                      selectedObjectId,
                      selectedObjectSection,
                      bindObjectSectionUserIds
                    );
                    if (!ok) {
                      setAdminMessage("Не удалось сохранить доступы по разделу");
                      return;
                    }
                    setAdminMessage(`Доступы к разделу ${selectedObjectSection} сохранены`);
                  }}
                >
                  Сохранить доступ к разделу
                </button>
              </div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h4>Карточки объектов</h4>
            <div className="objectCards">
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
                            {u.avatarUrl ? <img src={u.avatarUrl} alt={u.fullName} className="userAvatarImage" /> : u.fullName.slice(0, 1).toUpperCase()}
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
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
                const res = await fetch(`${API_URL}/api/admin/users`, {
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
          <hr />
          <h3>Редактирование существующего пользователя</h3>
          <div className="form">
            <label>
              Пользователь
              <select
                value={selectedUserId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedUserId(id);
                  const user = users.find((u) => u.id === id);
                  if (user) {
                    setSelectedRoleName(user.role);
                    setSelectedStatus(user.status);
                    setSelectedPermissions(user.customPermissions || user.permissions || []);
                    const pos = positions.find((p) => p.name === user.position);
                    setSelectedPositionId(pos?.id || "");
                  }
                }}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName} ({u.email})
                  </option>
                ))}
              </select>
            </label>
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
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value as "ACTIVE" | "BLOCKED")}
              >
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
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid2" style={{ marginTop: 16 }}>
              <div>
                <h3>Склады (scope)</h3>
                <p className="muted">Пусто = без ограничения по складу. Иначе пользователь видит только отмеченные.</p>
                <div className="plainList">
                  {warehouses.map((w) => (
                    <label key={w.id} style={{ display: "block" }}>
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
                <h3>Проекты (scope)</h3>
                <p className="muted">Пусто = без ограничения по проекту.</p>
                <div className="plainList">
                  {projects.map((p) => (
                    <label key={p.id} style={{ display: "block" }}>
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
                const res = await fetch(`${API_URL}/api/admin/users/${selectedUserId}/scopes`, {
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
              Сохранить склады/проекты (scope)
            </button>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Индивидуальные доступы (override)</h3>
            <div className="plainList">
              {sidebarAccessOptions.map((opt) => (
                <label key={`selected-perm-${opt.id}`} style={{ display: "block" }}>
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
              onClick={async () => {
                if (!token || !selectedUserId) return;
                setAdminMessage("");
                const res = await fetch(`${API_URL}/api/admin/users/${selectedUserId}/access`, {
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
              onClick={async () => {
                if (!token || !selectedUserId) return;
                setAdminMessage("");
                const res = await fetch(`${API_URL}/api/admin/users/${selectedUserId}/reset-password`, {
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
          {adminMessage && <p className="muted">{adminMessage}</p>}
        </div>
      )}

      {activeTab === "profile" && me && (
        <div className="card">
          <h2>Мой профиль</h2>
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
                  const reader = new FileReader();
                  reader.onload = () => setProfileAvatarUrl(typeof reader.result === "string" ? reader.result : null);
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          </div>
          <div className="toolbar">
            <button
              onClick={async () => {
                try {
                  await updateProfile({ fullName: profileFullName, avatarUrl: profileAvatarUrl });
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
                  setProfileAvatarUrl(null);
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
                const res = await fetch(`${API_URL}/api/auth/change-password`, {
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
                        {u.avatarUrl ? <img src={u.avatarUrl} alt={u.fullName} className="userAvatarImage" /> : u.fullName.slice(0, 1).toUpperCase()}
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
          onClick={() => setLimitPromptRequest(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 480, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Заявка из лимита?</h3>
            <p className="muted">
              Заявка <strong>{limitPromptRequest.number}</strong> загружена.
              Можно привязать её к одному из шаблонов лимита этого объекта/раздела —
              тогда при приёмке будут предлагаться названия материалов из лимита.
            </p>
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
            <div className="toolbar" style={{ marginTop: 12, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                className="ghostBtn"
                onClick={() => {
                  void attachReceiptRequestToLimit(limitPromptRequest.id, null);
                  setLimitPromptRequest(null);
                }}
              >
                Не из лимита
              </button>
              <button
                type="button"
                onClick={() => {
                  void attachReceiptRequestToLimit(
                    limitPromptRequest.id,
                    limitPromptTemplateId || null
                  );
                  setLimitPromptRequest(null);
                }}
                disabled={!limitPromptTemplateId}
              >
                Привязать к лимиту
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingAcceptanceRequestId && (() => {
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
            onClick={() => {
              if (!isSubmitting) {
                setPendingAcceptanceRequestId(null);
                setPendingAcceptanceFiles([]);
              }
            }}
          >
            <div
              className="card"
              style={{ maxWidth: 560, width: "100%" }}
              onClick={(e) => e.stopPropagation()}
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
                  onChange={(e) =>
                    setPendingAcceptanceFiles(Array.from(e.target.files || []))
                  }
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
                    setPendingAcceptanceRequestId(null);
                    setPendingAcceptanceFiles([]);
                    await submitReceiptAcceptance(targetRow, []);
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
                    setPendingAcceptanceRequestId(null);
                    setPendingAcceptanceFiles([]);
                    await submitReceiptAcceptance(targetRow, files);
                  }}
                >
                  {isSubmitting ? "Принимаем…" : "Принять с документами"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      </section>
    </main>
  );
}

export default App;
