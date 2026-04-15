import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import { API_URL, ISSUE_FILTER_KEY, LIST_VIEW_KEY, STOCK_VIEW_KEY, TOKEN_KEY } from "./app/constants";
import { EmptyState, ErrorState, LoadingState, ResultBanner } from "./shared/ui/StateViews";
import {
  IntegrationJobsTable,
  type IntegrationJobRow
} from "./widgets/integrations/IntegrationJobsTable";
import { NotificationsTable, type NotificationRow } from "./widgets/integrations/NotificationsTable";
import { ReadinessPanel, type ReadinessResponse } from "./widgets/integrations/ReadinessPanel";

type LoginResponse = {
  token: string;
  user: { id: string; email: string; fullName: string; avatarUrl?: string | null; position?: string | null; role: string; permissions: string[] };
};
type StockRow = {
  id: string;
  warehouseId: string;
  warehouseName: string;
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
type MeResponse = {
  id: string;
  email: string;
  fullName: string;
  avatarUrl?: string | null;
  position?: string | null;
  role: string;
  permissions: string[];
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
type AdminObject = { id: string; name: string; address?: string | null; userIds: string[] };
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
type IssueRequest = {
  id: string;
  number: string;
  status: string;
  warehouseId: string;
  projectId?: string | null;
  requestedById: string;
  note?: string | null;
  basisType?: string;
  basisRef?: string | null;
  createdAt: string;
  items?: Array<{
    id: string;
    materialId: string;
    quantity: string | number;
    material?: { name: string; sku?: string | null };
  }>;
  warehouse?: { name: string };
  project?: { id: string; name: string; code?: string | null } | null;
  requestedBy?: { fullName: string };
  approvedBy?: { fullName: string } | null;
};
type IssueStatus = "DRAFT" | "ON_APPROVAL" | "APPROVED" | "REJECTED" | "ISSUED" | "CANCELLED";
type OperationRow = {
  id: string;
  type: "INCOME" | "EXPENSE";
  documentNumber?: string | null;
  operationDate?: string;
};
type ReceiptLine = {
  id: string;
  mode: "existing" | "new";
  materialId: string;
  quantity: number;
  name: string;
  sku: string;
  unit: string;
  category: string;
};
type ToolReceiptLine = {
  id: string;
  name: string;
  inventoryNumber: string;
  serialNumber: string;
  note: string;
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
type Project = { id: string; name: string; code?: string | null; warehouseId?: string | null };
type ChatUser = { id: string; fullName: string; avatarUrl?: string | null; role: string; position?: string | null };
type ChatAttachment = { id: string; fileName: string; mimeType?: string | null; dataUrl: string };
type ChatMessage = { id: string; text: string; createdAt: string; senderId: string; sender: { id: string; fullName: string }; attachments: ChatAttachment[] };
type Conversation = {
  id: string;
  kind: "DM" | "FEEDBACK";
  participants: Array<{ user: ChatUser }>;
  messages: ChatMessage[];
};
type ProjectLimitSummaryItem = {
  materialId: string;
  materialName: string;
  plannedQty: number;
  issuedQty: number;
  reservedQty: number;
  remainingQty: number;
  isOver: boolean;
};
type ProjectLimitSummary = {
  id: string;
  name: string;
  version: number;
  projectId: string;
  projectName: string;
  items: ProjectLimitSummaryItem[];
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
  entityType: string;
  entityId: string;
  beforeData: unknown;
  afterData: unknown;
  createdAt: string;
  user?: { email: string; fullName: string };
};
type ResultTone = "neutral" | "success" | "error" | "conflict";
type TeamEmployee = {
  id: string;
  fullName: string;
  email: string;
  avatarUrl?: string | null;
  role: string;
  status: "ACTIVE" | "BLOCKED";
  warehouses: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
};
type TeamTask = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  dueAt?: string | null;
  assignee?: { id: string; fullName: string; role?: { name: string } };
  createdBy?: { id: string; fullName: string; role?: { name: string } };
  project?: { id: string; name: string } | null;
  warehouse?: { id: string; name: string } | null;
  createdAt: string;
};
function App() {
  const [email, setEmail] = useState("admin@skladpro.local");
  const [password, setPassword] = useState("1111");
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [authError, setAuthError] = useState("");
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [q, setQ] = useState("");
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [stocksError, setStocksError] = useState("");
  const [stockMovements, setStockMovements] = useState<StockMovementRow[]>([]);
  const [stockMovementsLoading, setStockMovementsLoading] = useState(false);
  const [stockMovementsError, setStockMovementsError] = useState("");
  const [expandedStockRowId, setExpandedStockRowId] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
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
    | "audit"
    | "integrations"
    | "settings"
    | "profile"
    | "team"
    | "inbox"
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
  const [opStorageRoom, setOpStorageRoom] = useState("");
  const [opStorageCell, setOpStorageCell] = useState("");
  const [receiptDocumentNumber, setReceiptDocumentNumber] = useState("");
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([]);
  const [receiptTools, setReceiptTools] = useState<ToolReceiptLine[]>([]);
  const [receiptDocs, setReceiptDocs] = useState<File[]>([]);
  const [returnMaterialId, setReturnMaterialId] = useState("");
  const [returnQuantity, setReturnQuantity] = useState(1);
  const [returnDefect, setReturnDefect] = useState(false);
  const [issues, setIssues] = useState<IssueRequest[]>([]);
  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [issuesMessage, setIssuesMessage] = useState("");
  const [issuesTone, setIssuesTone] = useState<ResultTone>("neutral");
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [issuesError, setIssuesError] = useState("");
  const [issuesSort, setIssuesSort] = useState<"created_desc" | "status" | "number">("created_desc");
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
  const [issueBasisFilter, setIssueBasisFilter] = useState<"" | IssueBasisType>("");
  const [issueProjectId, setIssueProjectId] = useState("");
  const [issueNote, setIssueNote] = useState("");
  const [issueBasisType, setIssueBasisType] = useState<IssueBasisType>("OTHER");
  const [issueBasisRef, setIssueBasisRef] = useState("");
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([]);
  const [selectedIssueId, setSelectedIssueId] = useState("");
  const [issueWarehouseId, setIssueWarehouseId] = useState("");
  const [issueMaterialId, setIssueMaterialId] = useState("");
  const [issueQuantity, setIssueQuantity] = useState(1);
  const [approvalQueue, setApprovalQueue] = useState<IssueRequest[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [limitsMessage, setLimitsMessage] = useState("");
  const [projectName, setProjectName] = useState("Проект 1");
  const [projectCode, setProjectCode] = useState("PRJ-001");
  const [projectWarehouseId, setProjectWarehouseId] = useState("");
  const [limitProjectId, setLimitProjectId] = useState("");
  const [limitName, setLimitName] = useState("Лимит основного этапа");
  const [limitMaterialId, setLimitMaterialId] = useState("");
  const [limitPlannedQty, setLimitPlannedQty] = useState(100);
  const [limitIdForSummary, setLimitIdForSummary] = useState("");
  const [limitSummary, setLimitSummary] = useState<ProjectLimitSummary | null>(null);
  const [documents, setDocuments] = useState<DocumentFile[]>([]);
  const [documentsMessage, setDocumentsMessage] = useState("");
  const [docEntityType, setDocEntityType] = useState<"operation" | "issue">("issue");
  const [docEntityId, setDocEntityId] = useState("");
  const [docType, setDocType] = useState("photo");
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [docPreviewUrl, setDocPreviewUrl] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState("");
  const [docDragOver, setDocDragOver] = useState(false);
  const [docLinkTargetType, setDocLinkTargetType] = useState<"operation" | "issue">("issue");
  const [docLinkTargetId, setDocLinkTargetId] = useState("");
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
  const [integrationJobs, setIntegrationJobs] = useState<IntegrationJobRow[]>([]);
  const [integrationKind, setIntegrationKind] = useState("erp-sync");
  const [integrationPayload, setIntegrationPayload] = useState("{\"batch\":1}");
  const [integrationMessage, setIntegrationMessage] = useState("");
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [teamEmployees, setTeamEmployees] = useState<TeamEmployee[]>([]);
  const [teamTasks, setTeamTasks] = useState<TeamTask[]>([]);
  const [teamMessage, setTeamMessage] = useState("");
  const [teamTone, setTeamTone] = useState<ResultTone>("neutral");
  const [teamAssigneeId, setTeamAssigneeId] = useState("");
  const [teamTaskTitle, setTeamTaskTitle] = useState("");
  const [teamTaskDescription, setTeamTaskDescription] = useState("");
  const [teamTaskProjectId, setTeamTaskProjectId] = useState("");
  const [teamTaskWarehouseId, setTeamTaskWarehouseId] = useState("");
  const [teamTaskDueAt, setTeamTaskDueAt] = useState("");
  const [myTasks, setMyTasks] = useState<TeamTask[]>([]);
  const [inboxFilter, setInboxFilter] = useState<"all" | "mine" | "new" | "critical" | "overdue" | "read_today">("all");
  const [selectedNotificationIds, setSelectedNotificationIds] = useState<string[]>([]);
  const [focusedTeamTaskId, setFocusedTeamTaskId] = useState("");
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxError, setInboxError] = useState("");
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState("");
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
  const [reportProjectId, setReportProjectId] = useState("");
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
    { id: "approvals", label: "Согласования", permissions: ["issues.approve"] },
    { id: "waybills", label: "Перемещения", permissions: ["waybills.read", "waybills.write"] },
    { id: "documents", label: "Документы", permissions: ["documents.read", "documents.write", "documents.upload"] },
    { id: "limits", label: "Лимиты", permissions: ["limits.read", "limits.write"] },
    { id: "matching", label: "Сопоставление", permissions: ["materials.match", "materials.read"] },
    { id: "inbox", label: "Центр входящих", permissions: ["notifications.read", "team.read"] },
    { id: "team", label: "Команда и задачи", permissions: ["team.read", "team.tasks.write"] },
    { id: "catalog", label: "Справочники", permissions: ["warehouses.read", "materials.read", "materials.write"] },
    { id: "tools", label: "Инструменты", permissions: ["tools.read", "tools.write"] },
    { id: "qr", label: "QR", permissions: ["tools.read"] },
    { id: "integrations", label: "Интеграции", permissions: ["integrations.read", "integrations.write"] },
    { id: "audit", label: "Аудит", permissions: ["audit.read"] },
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
      ON_APPROVAL: "На согласовании",
      APPROVED: "Согласовано",
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
  const basisTypeLabel = (basisType: string) =>
    ({
      PROJECT_WORK: "Работы по проекту",
      INTERNAL_NEED: "Внутренняя потребность",
      EMERGENCY: "Аварийная потребность",
      OTHER: "Другое"
    })[basisType] ?? basisType;
  const issueActionLabel = (action: "send-for-approval" | "approve" | "reject" | "cancel" | "issue") =>
    ({
      "send-for-approval": "Отправить на согласование",
      approve: "Согласовать",
      reject: "Отклонить",
      cancel: "Отменить",
      issue: "Выдать"
    })[action];
  const issueProcessStep = (status: string) =>
    ({
      DRAFT: "Черновик заявки",
      ON_APPROVAL: "Согласование",
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
  const teamTaskStatusLabel = (status: string) =>
    ({
      OPEN: "Новая",
      IN_PROGRESS: "В работе",
      DONE: "Выполнена",
      VERIFIED: "Проверена"
    })[status] ?? status;
  const teamTaskNextStatuses = (status: string) =>
    ({
      OPEN: ["IN_PROGRESS", "DONE"],
      IN_PROGRESS: ["DONE"],
      DONE: ["VERIFIED"],
      VERIFIED: []
    })[status] ?? [];
  const isTaskClosed = (status: string) => status === "DONE" || status === "VERIFIED";
  const taskSlaKind = (task: TeamTask) => {
    if (!task.dueAt || isTaskClosed(task.status)) return "normal" as const;
    const due = new Date(task.dueAt).getTime();
    const now = Date.now();
    if (due < now) return "overdue" as const;
    if (due - now < 24 * 60 * 60 * 1000) return "today" as const;
    return "week" as const;
  };
  const taskSlaLabel = (task: TeamTask) =>
    ({
      overdue: "Просрочено",
      today: "Срок сегодня",
      week: "На неделе",
      normal: "Планово"
    })[taskSlaKind(task)];
  const taskSlaClass = (task: TeamTask) =>
    ({
      overdue: "slaBadge bad",
      today: "slaBadge warn",
      week: "slaBadge neutral",
      normal: "slaBadge ok"
    })[taskSlaKind(task)];
  const groupedInboxTasks = useMemo(() => {
    const source = myTasks.filter((t) => {
      const overdue = taskSlaKind(t) === "overdue";
      if (inboxFilter === "new") return t.status === "OPEN";
      if (inboxFilter === "critical") return overdue;
      if (inboxFilter === "overdue") return overdue;
      return true;
    });
    return {
      overdue: source.filter((t) => taskSlaKind(t) === "overdue"),
      today: source.filter((t) => taskSlaKind(t) === "today"),
      week: source.filter((t) => taskSlaKind(t) === "week"),
      later: source.filter((t) => taskSlaKind(t) === "normal")
    };
  }, [myTasks, inboxFilter]);
  const groupedInboxNotifications = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const source = notifications.filter((n) => {
      const isCritical = n.level === "ERROR" || n.level === "WARNING";
      const readToday = n.isRead && new Date(n.createdAt) >= startOfToday;
      if (inboxFilter === "new") return !n.isRead;
      if (inboxFilter === "critical") return isCritical;
      if (inboxFilter === "read_today") return readToday;
      if (inboxFilter === "mine") return false;
      return true;
    });
    return {
      critical: source.filter((n) => n.level === "ERROR" || n.level === "WARNING"),
      fresh: source.filter((n) => !n.isRead),
      readToday: source.filter((n) => n.isRead && new Date(n.createdAt) >= startOfToday),
      other: source.filter((n) => n.isRead && !(new Date(n.createdAt) >= startOfToday) && n.level === "INFO")
    };
  }, [notifications, inboxFilter]);
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
  const tabTitleMap: Record<string, string> = {
    stocks: "Главная",
    warehouse: "Склад",
    catalog: "Справочники",
    matching: "Сопоставление номенклатуры",
    audit: "Аудит действий",
    operations: "Приходы",
    issues: "Заявки на выдачу",
    limits: "Лимиты проекта",
    approvals: "Очередь согласований",
    documents: "Документы",
    waybills: "Транспортные накладные",
    qr: "QR-сканирование",
    tools: "Инструменты",
    integrations: "Интеграции и уведомления",
    inbox: "Центр входящих",
    team: "Команда и задачи",
    chat: "Личные сообщения",
    feedback: "Обратная связь",
    reports: "PDF сводка по объекту",
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
    team: "Контроль",
    chat: "Контроль",
    feedback: "Контроль",
    reports: "Контроль",
    audit: "Контроль",
    catalog: "Сервис",
    tools: "Сервис",
    qr: "Сервис",
    integrations: "Сервис",
    inbox: "Контроль",
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
  const canReadTeam = useMemo(() => hasPermission("team.read"), [me]);
  const canWriteTeamTasks = useMemo(() => hasPermission("team.tasks.write"), [me]);
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
      const query = search ? `?q=${encodeURIComponent(search)}` : "";
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
    const r = await fetch(`${API_URL}/api/audit?take=150`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (r.ok) {
      setAuditLogs((await r.json()) as AuditLogRow[]);
    } else {
      setAuditMessage(`Не удалось загрузить аудит: HTTP ${r.status}`);
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

  async function loadMyTasks() {
    if (!token || !canReadTeam) return;
    const r = await fetch(`${API_URL}/api/team/tasks?mineOnly=1`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setMyTasks((await r.json()) as TeamTask[]);
  }

  async function loadInboxData() {
    if (!token) return;
    setInboxError("");
    setInboxLoading(true);
    try {
      const tasks = [];
      if (canReadIntegrations) tasks.push(loadNotifications());
      if (canReadTeam) tasks.push(loadMyTasks());
      await Promise.all(tasks);
    } catch (e) {
      setInboxError(`Не удалось загрузить входящие: ${String(e)}`);
    } finally {
      setInboxLoading(false);
    }
  }

  async function markNotificationsRead(ids: string[]) {
    if (!token || !ids.length) return;
    await fetch(`${API_URL}/api/notifications/read`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });
    setSelectedNotificationIds((prev) => prev.filter((id) => !ids.includes(id)));
    await loadNotifications();
  }

  function openInboxEntity(notification: NotificationRow) {
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
    if (entityType === "stafftask" || entityType === "task") {
      setActiveTab("team");
      setFocusedTeamTaskId(notification.entityId);
      setTeamMessage(`Открыта задача из входящих: ${notification.entityId}`);
      setTeamTone("neutral");
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

  async function loadTeamData() {
    if (!token || !canReadTeam) return;
    setTeamError("");
    setTeamLoading(true);
    try {
      const [employeesRes, tasksRes] = await Promise.all([
        fetch(`${API_URL}/api/team/employees`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${API_URL}/api/team/tasks`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      if (!employeesRes.ok || !tasksRes.ok) {
        setTeamError("Не удалось загрузить сотрудников/задачи");
        return;
      }
      const employees = (await employeesRes.json()) as TeamEmployee[];
      const tasks = (await tasksRes.json()) as TeamTask[];
      setTeamEmployees(employees);
      setTeamTasks(tasks);
      if (employees.length && !teamAssigneeId) setTeamAssigneeId(employees[0].id);
    } finally {
      setTeamLoading(false);
    }
  }

  async function createTeamTask() {
    if (!token || !canWriteTeamTasks) return;
    setTeamMessage("");
    setTeamTone("neutral");
    const res = await fetch(`${API_URL}/api/team/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        assigneeId: teamAssigneeId,
        title: teamTaskTitle,
        description: teamTaskDescription || undefined,
        projectId: teamTaskProjectId || undefined,
        warehouseId: teamTaskWarehouseId || undefined,
        dueAt: teamTaskDueAt ? new Date(teamTaskDueAt).toISOString() : undefined
      })
    });
    if (!res.ok) {
      setTeamMessage("Не удалось поставить задачу");
      setTeamTone(res.status === 409 ? "conflict" : "error");
      return;
    }
    setTeamMessage("Задача поставлена");
    setTeamTone("success");
    setTeamTaskTitle("");
    setTeamTaskDescription("");
    setTeamTaskDueAt("");
    await loadTeamData();
  }

  async function updateTeamTaskStatus(taskId: string, status: "OPEN" | "IN_PROGRESS" | "DONE" | "VERIFIED") {
    if (!token) return;
    const ok = window.confirm(`Подтвердить перевод задачи в статус "${teamTaskStatusLabel(status)}"?`);
    if (!ok) return;
    const res = await fetch(`${API_URL}/api/team/tasks/${taskId}/status`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      setTeamMessage("Не удалось обновить статус задачи");
      setTeamTone(res.status === 409 ? "conflict" : "error");
      return;
    }
    setTeamMessage(`Статус задачи обновлен: ${teamTaskStatusLabel(status)}`);
    setTeamTone("success");
    await loadTeamData();
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
    if (materialsData.length && !returnMaterialId) {
      setReturnMaterialId(materialsData[0].id);
    }
    if (warehousesData.length && !issueWarehouseId) {
      setIssueWarehouseId(warehousesData[0].id);
    }
    if (warehousesData.length && !projectWarehouseId) {
      setProjectWarehouseId(warehousesData[0].id);
    }
    if (materialsData.length && !issueMaterialId) {
      setIssueMaterialId(materialsData[0].id);
    }
    if (materialsData.length && !limitMaterialId) {
      setLimitMaterialId(materialsData[0].id);
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
    if (data.length && !limitProjectId) {
      setLimitProjectId(data[0].id);
    }
    if (data.length && !reportProjectId) {
      setReportProjectId(data[0].id);
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
    opts?: { fromApprovals?: boolean; closeDrawer?: boolean }
  ) {
    if (!token) return;
    const actionText = issueActionLabel(action).toLowerCase();
    const ok = window.confirm(`Подтвердить действие: ${actionText}?`);
    if (!ok) return;
    const res = await fetch(`${API_URL}/api/issues/${issueId}/${action}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` }
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
    const res = await fetch(`${API_URL}/api/issues?status=ON_APPROVAL`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const payload = (await res.json()) as PagedResponse<IssueRequest> | IssueRequest[];
    setApprovalQueue(Array.isArray(payload) ? payload : payload.items);
  }

  async function loadOperations() {
    if (!token) return;
    const res = await fetch(`${API_URL}/api/operations`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    setOperations((await res.json()) as OperationRow[]);
  }

  async function ensureMaterialForReceipt(line: ReceiptLine) {
    if (!token) return line.materialId;
    if (line.mode === "existing") return line.materialId;
    const res = await fetch(`${API_URL}/api/materials`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: line.name.trim(),
        sku: line.sku.trim() || undefined,
        unit: line.unit.trim() || "шт",
        category: line.category.trim() || undefined
      })
    });
    if (!res.ok) {
      throw new Error(`Не удалось создать материал "${line.name}"`);
    }
    const row = (await res.json()) as Material;
    return row.id;
  }

  async function uploadOperationDocuments(operationId: string) {
    if (!token || !receiptDocs.length) return;
    for (const file of receiptDocs) {
      const form = new FormData();
      form.append("file", file);
      form.append("entityType", "operation");
      form.append("entityId", operationId);
      form.append("type", "invoice");
      await fetch(`${API_URL}/api/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
    }
  }

  async function submitReceiptOperation() {
    if (!token || !opWarehouseId) return;
    const validLines = receiptLines.filter((l) =>
      l.quantity > 0 && (l.mode === "existing" ? Boolean(l.materialId) : Boolean(l.name.trim()))
    );
    if (!validLines.length) {
      setOpsMessage("Добавь хотя бы одну позицию прихода");
      return;
    }
    setOpsMessage("");
    try {
      const materialIds = await Promise.all(validLines.map((line) => ensureMaterialForReceipt(line)));
      const opRes = await fetch(`${API_URL}/api/operations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "INCOME",
          warehouseId: opWarehouseId,
          documentNumber: receiptDocumentNumber.trim() || `IN-${Date.now()}`,
          storageRoom: opStorageRoom || undefined,
          storageCell: opStorageCell || undefined,
          items: validLines.map((line, idx) => ({ materialId: materialIds[idx], quantity: line.quantity }))
        })
      });
      if (!opRes.ok) {
        const errText = await opRes.text();
        setOpsMessage(`Ошибка прихода: ${errText}`);
        return;
      }
      const created = (await opRes.json()) as { id: string };
      await uploadOperationDocuments(created.id);
      for (const tool of receiptTools.filter((t) => t.name.trim() && t.inventoryNumber.trim())) {
        await fetch(`${API_URL}/api/tools`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: tool.name.trim(),
            inventoryNumber: tool.inventoryNumber.trim(),
            serialNumber: tool.serialNumber.trim() || undefined,
            warehouseId: opWarehouseId,
            note: tool.note.trim() || undefined
          })
        });
      }
      setOpsMessage("Приход проведен");
      setReceiptDocumentNumber("");
      setReceiptDocs([]);
      setReceiptTools([]);
      await loadCatalogData();
      await loadStocks(q);
      await loadOperations();
    } catch (e) {
      setOpsMessage(String(e));
    }
  }

  async function submitMaterialReturn() {
    if (!token || !opWarehouseId || !returnMaterialId || returnQuantity <= 0) return;
    setOpsMessage("");
    const res = await fetch(`${API_URL}/api/operations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "INCOME",
        warehouseId: opWarehouseId,
        documentNumber: `${returnDefect ? "RETURN-DEFECT" : "RETURN"}-${Date.now()}`,
        storageRoom: opStorageRoom || undefined,
        storageCell: opStorageCell || undefined,
        items: [{ materialId: returnMaterialId, quantity: returnQuantity }]
      })
    });
    if (!res.ok) {
      setOpsMessage("Ошибка возврата материала");
      return;
    }
    setOpsMessage("Возврат на склад проведен");
    setReturnQuantity(1);
    await loadStocks(q);
    await loadOperations();
    await loadStockMovements();
  }

  async function loadTools() {
    if (!token) return;
    setToolsError("");
    setToolsLoading(true);
    try {
      const queryParts = [
        toolSearch ? `q=${encodeURIComponent(toolSearch)}` : "",
        toolStatusFilter ? `status=${encodeURIComponent(toolStatusFilter)}` : "",
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
    const pdfUrl = `${API_URL}/api/waybills/${waybillId}/pdf?access_token=${encodeURIComponent(token)}&filename=${encodeURIComponent(waybillNumber)}.pdf`;
    const win = window.open(pdfUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      window.location.assign(pdfUrl);
    }
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
      docEntityId ? `entityType=${encodeURIComponent(docEntityType)}` : "",
      docEntityId ? `entityId=${encodeURIComponent(docEntityId)}` : "",
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

  async function uploadDocumentFile(file: File) {
    if (!token || !docEntityId) {
      setDocumentsMessage("Сначала выбери сущность");
      return;
    }
    setDocumentsMessage("");
    const formData = new FormData();
    formData.append("entityType", docEntityType);
    formData.append("entityId", docEntityId);
    formData.append("type", docType);
    formData.append("file", file);
    const res = await fetch(`${API_URL}/api/documents/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    if (!res.ok) {
      setDocumentsMessage("Не удалось загрузить документ");
      return;
    }
    setDocumentsMessage("Документ загружен");
    setDocFile(null);
    await loadDocuments();
  }

  async function replaceDocument(documentId: string) {
    if (!token) return;
    const input = document.createElement("input");
    input.type = "file";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`${API_URL}/api/documents/${documentId}/replace`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      if (!res.ok) {
        setDocumentsMessage("Не удалось заменить файл");
        return;
      }
      setDocumentsMessage("Новая версия документа загружена");
      await loadDocuments();
    };
    input.click();
  }

  async function deleteDocument(documentId: string) {
    if (!token) return;
    const ok = window.confirm("Удалить документ? Он пропадет из активного списка.");
    if (!ok) return;
    const res = await fetch(`${API_URL}/api/documents/${documentId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setDocumentsMessage("Не удалось удалить документ");
      return;
    }
    setDocumentsMessage("Документ удален");
    await loadDocuments();
  }

  async function unlinkDocumentLink(linkId: string) {
    if (!token) return;
    const ok = window.confirm("Отвязать файл только от этой карточки? Сам файл останется у владельца.");
    if (!ok) return;
    const res = await fetch(`${API_URL}/api/documents/links/${encodeURIComponent(linkId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setDocumentsMessage("Не удалось отвязать документ");
      return;
    }
    setDocumentsMessage("Связь удалена");
    await loadDocuments();
  }

  async function createDocumentLink() {
    if (!token || !selectedDocumentId) {
      setDocumentsMessage("Выбери строку в списке (Превью) и цель привязки");
      return;
    }
    if (!docLinkTargetId) {
      setDocumentsMessage("Выбери заявку или операцию для доп. привязки");
      return;
    }
    setDocumentsMessage("");
    const res = await fetch(`${API_URL}/api/documents/${encodeURIComponent(selectedDocumentId)}/links`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: docLinkTargetType, entityId: docLinkTargetId })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setDocumentsMessage(typeof err.error === "string" ? err.error : "Не удалось создать ссылку");
      return;
    }
    setDocumentsMessage("Файл привязан к дополнительной сущности");
    await loadDocuments();
  }

  function openDocumentsForEntity(entityType: "issue" | "operation", entityId: string) {
    setDocEntityType(entityType);
    setDocEntityId(entityId);
    setActiveTab("documents");
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
    if (token) {
      void loadMe();
      void loadStocks(q);
      void loadIssues();
      void loadApprovalQueue();
      void loadChatUsers();
      void loadConversations();
    }
  }, [token]);

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
  }, [token, activeTab, canReadAudit]);

  useEffect(() => {
    if (!token || activeTab !== "integrations") {
      return;
    }
    void loadIntegrationJobs();
    void loadNotifications();
    void loadReadiness();
  }, [token, activeTab]);

  useEffect(() => {
    if (!token || activeTab !== "team" || !canReadTeam) return;
    void loadCatalogData();
    void loadProjects();
    void loadTeamData();
  }, [token, activeTab, canReadTeam]);

  useEffect(() => {
    if (!dashboardWarehouseId && warehouses.length) {
      setDashboardWarehouseId(warehouses[0].id);
    }
  }, [dashboardWarehouseId, warehouses]);

  useEffect(() => {
    if (!materials.length || receiptLines.length) return;
    const first = materials[0];
    setReceiptLines([
      {
        id: `line-${Date.now()}`,
        mode: "existing",
        materialId: first.id,
        quantity: 1,
        name: "",
        sku: "",
        unit: first.unit || "шт",
        category: ""
      }
    ]);
  }, [materials, receiptLines.length]);

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
    if (activeTab !== "feedback") return;
    const node = feedbackMessagesRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [activeTab, feedbackMessages, feedbackLoading]);

  useEffect(() => {
    if (activeTab !== "team" || !focusedTeamTaskId) return;
    const row = document.getElementById(`team-task-${focusedTeamTaskId}`);
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeTab, focusedTeamTaskId, teamTasks]);

  useEffect(() => {
    if (!token || activeTab !== "inbox") return;
    void loadInboxData();
  }, [token, activeTab, canReadIntegrations, canReadTeam]);

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
    if (canReadIntegrations) visibleTabs.add("integrations");
    if (canReadIntegrations || canReadTeam) visibleTabs.add("inbox");
    if (canReadTeam) visibleTabs.add("team");
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
    canReadTeam,
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
      }
    }
  }, [token, activeTab, toolSearch, toolStatusFilter]);

  useEffect(() => {
    if (token && activeTab === "issues") {
      void loadCatalogData();
      void loadProjects();
      void loadIssues();
    }
  }, [token, activeTab, issueStatusFilter, issueBasisFilter, issueSearch, issuesSort, issuesPage, issuesPageSize]);

  useEffect(() => {
    localStorage.setItem(ISSUE_FILTER_KEY, issueStatusFilter);
  }, [issueStatusFilter]);

  useEffect(() => {
    setIssuesPage(1);
  }, [issueSearch, issueStatusFilter, issueBasisFilter, issuesSort, issuesPageSize]);

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
    }
  }, [token, activeTab]);

  useEffect(() => {
    if (token && activeTab === "limits") {
      void loadCatalogData();
      void loadProjects();
    }
  }, [token, activeTab]);

  useEffect(() => {
    if (token && activeTab === "documents") {
      void loadIssues();
      void loadOperations();
      void loadDocuments();
    }
  }, [token, activeTab, docTypeFilter]);

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
  }, [token, activeTab, toolSearch, toolStatusFilter, toolsSort, toolsPage, toolsPageSize]);

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
    if (docEntityType === "issue" && issues.length > 0 && !docEntityId) {
      setDocEntityId(issues[0].id);
    }
    if (docEntityType === "operation" && operations.length > 0 && !docEntityId) {
      setDocEntityId(operations[0].id);
    }
    if (warehouses.length > 0 && !waybillFromWarehouseId) {
      setWaybillFromWarehouseId(warehouses[0].id);
    }
    if (materials.length > 0 && !waybillMaterialId) {
      setWaybillMaterialId(materials[0].id);
    }
  }, [docEntityType, issues, operations, docEntityId, warehouses, materials, waybillFromWarehouseId, waybillMaterialId]);

  async function onLoginSubmit(e: FormEvent) {
    e.preventDefault();
    setAuthError("");
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        throw new Error("Неверный логин или пароль");
      }
      const data = (await res.json()) as LoginResponse;
      localStorage.setItem(TOKEN_KEY, data.token);
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
    setSelectedNotificationIds([]);
    setMyTasks([]);
    setUsers([]);
    setRoles([]);
    setMe(null);
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

  return (
    <main className={`shell uiSupreme ${isStorekeeperMode ? "warehouseMode" : ""}`}>
      <aside className="sidebar">
        <div className="brandWrap">
          <h2 className="brand">СкладПро</h2>
          <p className="brandSub">Warehouse ERP</p>
        </div>
        <p className="navSectionTitle">Операции</p>
        {canDashboard && <button className={`navBtn ${activeTab === "stocks" ? "active" : ""}`} onClick={() => setActiveTab("stocks")}><span className="navIcon">⌂</span>Главная</button>}
        {canReadStocks && <button className={`navBtn ${activeTab === "warehouse" ? "active" : ""}`} onClick={() => setActiveTab("warehouse")}><span className="navIcon">▦</span>Склад</button>}
        {canReadOperations && <button className={`navBtn ${activeTab === "operations" ? "active" : ""}`} onClick={() => setActiveTab("operations")}><span className="navIcon">↗</span>Приходы</button>}
        {canReadIssues && <button className={`navBtn ${activeTab === "issues" ? "active" : ""}`} onClick={() => setActiveTab("issues")}><span className="navIcon">⇄</span>Выдачи</button>}
        {canReadIssues && <button className={`navBtn ${activeTab === "approvals" ? "active" : ""}`} onClick={() => setActiveTab("approvals")}><span className="navIcon">☑</span>Согласования</button>}
        {canReadWaybills && <button className={`navBtn ${activeTab === "waybills" ? "active" : ""}`} onClick={() => setActiveTab("waybills")}><span className="navIcon">⇆</span>Перемещения</button>}

        <p className="navSectionTitle">Контроль</p>
        {canReadDocuments && <button className={`navBtn ${activeTab === "documents" ? "active" : ""}`} onClick={() => setActiveTab("documents")}><span className="navIcon">▤</span>Документы</button>}
        {canReadLimits && <button className={`navBtn ${activeTab === "limits" ? "active" : ""}`} onClick={() => setActiveTab("limits")}><span className="navIcon">▧</span>Лимиты</button>}
        {canMaterialMatch && <button className={`navBtn ${activeTab === "matching" ? "active" : ""}`} onClick={() => setActiveTab("matching")}><span className="navIcon">◇</span>Сопоставление</button>}
        {(canReadIntegrations || canReadTeam) && <button className={`navBtn ${activeTab === "inbox" ? "active" : ""}`} onClick={() => setActiveTab("inbox")}><span className="navIcon">✉</span>Центр входящих</button>}
        {canReadTeam && <button className={`navBtn ${activeTab === "team" ? "active" : ""}`} onClick={() => setActiveTab("team")}><span className="navIcon">👥</span>Команда и задачи</button>}
        <button className={`navBtn ${activeTab === "feedback" ? "active" : ""}`} onClick={() => setActiveTab("feedback")}><span className="navIcon">🛠</span>Обратная связь</button>
        <button className={`navBtn ${activeTab === "reports" ? "active" : ""}`} onClick={() => setActiveTab("reports")}><span className="navIcon">📄</span>Сводка PDF</button>
        {canReadAudit && <button className={`navBtn ${activeTab === "audit" ? "active" : ""}`} onClick={() => setActiveTab("audit")}><span className="navIcon">◉</span>Аудит</button>}

        <p className="navSectionTitle">Сервис</p>
        {(canReadStocks || canWriteCatalog) && <button className={`navBtn ${activeTab === "catalog" ? "active" : ""}`} onClick={() => setActiveTab("catalog")}><span className="navIcon">▣</span>Справочники</button>}
        {canReadTools && <button className={`navBtn ${activeTab === "tools" ? "active" : ""}`} onClick={() => setActiveTab("tools")}><span className="navIcon">⚒</span>Инструменты</button>}
        {canReadTools && <button className={`navBtn ${activeTab === "qr" ? "active" : ""}`} onClick={() => setActiveTab("qr")}><span className="navIcon">⌁</span>QR</button>}
        {canReadIntegrations && <button className={`navBtn ${activeTab === "integrations" ? "active" : ""}`} onClick={() => setActiveTab("integrations")}><span className="navIcon">⎘</span>Интеграции</button>}

        <p className="navSectionTitle">Администрирование</p>
        {canManageUsers && <button className={`navBtn ${activeTab === "admin" ? "active" : ""}`} onClick={() => setActiveTab("admin")}><span className="navIcon">⚙</span>Доступы</button>}

        <p className="navSectionTitle">Аккаунт</p>
        <button className={`navBtn ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}><span className="navIcon">◉</span>Профиль</button>
        <button className={`navBtn ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}><span className="navIcon">⚙</span>Настройки</button>
        <button className={`navBtn ${activeTab === "password" ? "active" : ""}`} onClick={() => setActiveTab("password")}><span className="navIcon">✱</span>Смена пароля</button>
        <button className="navBtn danger" onClick={onLogout}>Выйти</button>
      </aside>
      <section className="canvas">
        <header className="pageHeader">
          <div className="pageTitleBlock">
            <h1>{currentTitle}</h1>
            <p className="crumbs">{currentSection} / {currentTitle}</p>
            {me && <p className="muted">{me.fullName} ({roleLabel(me.role)}{me.position ? ` · ${me.position}` : ""})</p>}
          </div>
          <div className="toolbar topToolbar">
            <input placeholder="Глобальный поиск (материал/инструмент/код)" value={globalSearch} onChange={(e) => setGlobalSearch(e.target.value)} />
            <button onClick={() => { setQ(globalSearch); setToolSearch(globalSearch); setActiveTab("warehouse"); }}>Найти</button>
            {canReadTools && <button onClick={() => setActiveTab("qr")}>QR</button>}
            {(canReadIntegrations || canReadTeam) && <button className="topIconBtn" onClick={() => setActiveTab("inbox")}>Входящие</button>}
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
        {dashboard && (
          <div className="card dashboardStrip">
            <div className="toolbar dashboardFacts" style={{ flexWrap: "wrap", gap: 12 }}>
              <span>
                Приходов сегодня: <strong>{dashboard.warehouse.receiptsToday}</strong>
              </span>
              <span>
                Расходов (операций) сегодня: <strong>{dashboard.warehouse.issuesOperationsToday}</strong>
              </span>
              <span>
                Выдано заявок сегодня: <strong>{dashboard.warehouse.issuesRequestsIssuedToday}</strong>
              </span>
              <span>
                На согласовании: <strong>{dashboard.warehouse.pendingApprovals}</strong>
              </span>
              <span>
                Низкий остаток (&lt;5): <strong>{dashboard.warehouse.lowStockLines}</strong>
              </span>
              <span>
                Инструмент в ремонте: <strong>{dashboard.warehouse.toolsInRepair}</strong>
              </span>
              <span>
                Очередь сопоставления: <strong>{dashboard.warehouse.matchQueuePending}</strong>
              </span>
              <span>
                Сбои интеграций (24ч): <strong>{dashboard.warehouse.failedIntegrations24h}</strong>
              </span>
              <span>
                Мои непрочитанные уведомления: <strong>{dashboard.warehouse.unreadNotifications}</strong>
              </span>
              <span>
                Критические уведомления (24ч): <strong>{dashboard.warehouse.errorNotifications24h}</strong>
              </span>
              <span>
                Объект: <strong>{dashboard.object?.warehouseName || "—"}</strong>
              </span>
              <span>
                Проектов: <strong>{dashboard.object?.projectsCount ?? 0}</strong>
              </span>
              <span>
                Выполнение лимитов: <strong>{dashboard.object?.usagePercent ?? 0}%</strong>
              </span>
              {dashboard.admin && (
                <span>
                  Активных пользователей: <strong>{dashboard.admin.activeUsers}</strong> · аудит 24ч:{" "}
                  <strong>{dashboard.admin.auditEvents24h}</strong>
                </span>
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
                <button className="kpi kpiBtn" onClick={() => { setIssueStatusFilter("ON_APPROVAL"); setActiveTab("issues"); }}><span>На согласовании</span><strong>{dashboard?.warehouse.pendingApprovals ?? approvalQueue.length}</strong></button>
                <button className="kpi kpiBtn" onClick={() => setActiveTab("waybills")}><span>Перемещения</span><strong>{dashboard?.warehouse.transfersToday ?? waybills.length}</strong></button>
                <button type="button" className="kpi kpiBtn" onClick={() => setActiveTab("matching")}><span>Сопоставление</span><strong>{dashboard?.warehouse.matchQueuePending ?? matchQueue.length}</strong></button>
                <button type="button" className="kpi kpiBtn" onClick={() => setActiveTab("integrations")}><span>Интеграции</span><strong>{dashboard?.warehouse.unreadNotifications ?? notifications.filter((n) => !n.isRead).length}</strong></button>
              </div>
              <div className="card">
                <h3>Обзор по объекту</h3>
                <p className="muted">
                  Детальный список материалов и все остатки перенесены в отдельную вкладку `Склад`.
                </p>
                <div className="toolbar">
                  <label>
                    Объект
                    <select value={dashboardWarehouseId} onChange={(e) => setDashboardWarehouseId(e.target.value)}>
                      {warehouses.map((w) => (
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
                    <li>На согласовании: <strong>{approvalQueue.length}</strong></li>
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
                <h3>Карточка согласования</h3>
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
                  <p className="muted">Нет заявок на согласование.</p>
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
      {activeTab === "matching" && (
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
        <div className="card">
          <h2>Склад: материалы и остатки</h2>
          <div className="toolbar">
            <input
              placeholder="Поиск по материалу, sku, синониму"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <label><input type="checkbox" checked={showStockSku} onChange={(e) => setShowStockSku(e.target.checked)} /> SKU</label>
            <label><input type="checkbox" checked={showStockReserve} onChange={(e) => setShowStockReserve(e.target.checked)} /> Резерв</label>
            <button onClick={() => void loadStocks(q)}>Найти</button>
            <button type="button" onClick={() => void loadStockMovements()}>Журнал движений</button>
          </div>
          {loadingStocks && <p>Загрузка остатков...</p>}
          {stocksError && <p className="error">{stocksError}</p>}
          {!loadingStocks && !stocksError && (
            <table>
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
                {stocks.map((row) => (
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
                          {expandedStockRowId === row.id ? "−" : "+"}
                        </button>{" "}
                        {safeName(row.materialName)}
                      </td>
                      {showStockSku && <td>{row.materialSku || "-"}</td>}
                      <td>{row.materialUnit}</td>
                      <td>{row.storageRoom || "—"}</td>
                      <td>{row.storageCell || "—"}</td>
                      <td>{row.quantity}</td>
                      {showStockReserve && <td>{row.reserved}</td>}
                      <td>{row.available}</td>
                    </tr>
                    {expandedStockRowId === row.id && (
                      <tr>
                        <td colSpan={showStockSku && showStockReserve ? 9 : showStockSku || showStockReserve ? 8 : 7}>
                          <div className="card">
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
                                    <td>{m.quantity}</td>
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
          {stockMovementsLoading && <p>Загрузка движений...</p>}
          {stockMovementsError && <p className="error">{stockMovementsError}</p>}
        </div>
      )}

      {activeTab === "audit" && canReadAudit && (
        <div className="card">
          <h2>Журнал аудита</h2>
          {auditMessage && <p className="error">{auditMessage}</p>}
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Пользователь</th>
                <th>Действие</th>
                <th>Сущность</th>
                <th>До / После</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((row) => (
                <tr key={row.id}>
                  <td>{new Date(row.createdAt).toLocaleString()}</td>
                  <td>{row.user?.fullName || row.userId}</td>
                  <td>{row.action}</td>
                  <td>
                    {row.entityType} / {row.entityId}
                  </td>
                  <td>
                    <details>
                      <summary>JSON</summary>
                      <pre className="plainList" style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                        {JSON.stringify({ before: row.beforeData, after: row.afterData }, null, 2)}
                      </pre>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!auditLogs.length && <p className="muted">Записей пока нет.</p>}
        </div>
      )}

      {activeTab === "inbox" && (canReadIntegrations || canReadTeam) && (
        <div className="card">
          <h2>Центр входящих</h2>
          {inboxLoading && <LoadingState text="Загрузка входящих..." />}
          {inboxError && <ErrorState text={inboxError} />}
          <div className="toolbar">
            <select value={inboxFilter} onChange={(e) => setInboxFilter(e.target.value as typeof inboxFilter)}>
              <option value="all">Все входящие</option>
              <option value="new">Новые</option>
              <option value="critical">Критичные</option>
              <option value="overdue">Просроченные</option>
              <option value="read_today">Прочитанные сегодня</option>
              <option value="mine">Мои задачи</option>
            </select>
            {canReadIntegrations && <button type="button" onClick={() => void loadInboxData()}>Обновить уведомления</button>}
            {canReadTeam && <button type="button" onClick={() => void loadInboxData()}>Обновить задачи</button>}
            {canReadIntegrations && (
              <button
                type="button"
                onClick={() => void markNotificationsRead(notifications.filter((n) => !n.isRead).map((n) => n.id))}
              >
                Прочитать все уведомления
              </button>
            )}
          </div>

          {canReadIntegrations && inboxFilter !== "mine" && !inboxLoading && (
            <>
              <h3>Уведомления</h3>
              <div className="toolbar">
                <button
                  type="button"
                  onClick={() => void markNotificationsRead(selectedNotificationIds)}
                  disabled={!selectedNotificationIds.length}
                >
                  Прочитать выбранные ({selectedNotificationIds.length})
                </button>
                <button type="button" onClick={() => setSelectedNotificationIds([])} disabled={!selectedNotificationIds.length}>
                  Сбросить выбор
                </button>
              </div>
              {[
                { key: "critical", title: "Критичные", rows: groupedInboxNotifications.critical },
                { key: "fresh", title: "Новые", rows: groupedInboxNotifications.fresh },
                { key: "readToday", title: "Прочитанные сегодня", rows: groupedInboxNotifications.readToday },
                { key: "other", title: "Остальные", rows: groupedInboxNotifications.other }
              ].map((group) => (
                <div key={group.key} className="card inboxGroupCard">
                  <div className="rightCardHeader">
                    <h4>{group.title}</h4>
                    <span className="muted">{group.rows.length}</span>
                  </div>
                  {group.rows.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th></th>
                          <th>Время</th>
                          <th>Уровень</th>
                          <th>Тема</th>
                          <th>Статус</th>
                          <th>Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((n: NotificationRow) => (
                          <tr key={n.id}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedNotificationIds.includes(n.id)}
                                onChange={(e) => {
                                  setSelectedNotificationIds((prev) =>
                                    e.target.checked ? [...prev, n.id] : prev.filter((id) => id !== n.id)
                                  );
                                }}
                              />
                            </td>
                            <td>{new Date(n.createdAt).toLocaleString()}</td>
                            <td>{n.level === "ERROR" ? "Ошибка" : n.level === "WARNING" ? "Предупреждение" : "Инфо"}</td>
                            <td>{n.title}</td>
                            <td>{n.isRead ? "Прочитано" : "Новое"}</td>
                            <td>
                              <div className="toolbar">
                                {!n.isRead ? (
                                  <button type="button" onClick={() => void markNotificationsRead([n.id])}>Прочитать</button>
                                ) : (
                                  <span className="muted">—</span>
                                )}
                                {n.entityType && n.entityId ? (
                                  <button type="button" onClick={() => openInboxEntity(n)}>Открыть</button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted">Нет уведомлений в этой группе.</p>
                  )}
                </div>
              ))}
            </>
          )}

          {canReadTeam && !inboxLoading && (
            <>
              <h3 style={{ marginTop: 14 }}>Мои задачи</h3>
              {[
                { key: "overdue", title: "Просроченные", rows: groupedInboxTasks.overdue },
                { key: "today", title: "На сегодня", rows: groupedInboxTasks.today },
                { key: "week", title: "На этой неделе", rows: groupedInboxTasks.week },
                { key: "later", title: "Позже / без срока", rows: groupedInboxTasks.later }
              ].map((group) => (
                <div key={group.key} className="card inboxGroupCard">
                  <div className="rightCardHeader">
                    <h4>{group.title}</h4>
                    <span className="muted">{group.rows.length}</span>
                  </div>
                  {group.rows.length ? (
                    <table>
                      <thead>
                        <tr>
                          <th>Задача</th>
                          <th>SLA</th>
                          <th>Срок</th>
                          <th>Статус</th>
                          <th>Следующий шаг</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((t: TeamTask) => (
                          <tr key={t.id}>
                            <td>
                              {t.title}
                              {t.description ? <p className="muted">{t.description}</p> : null}
                            </td>
                            <td><span className={taskSlaClass(t)}>{taskSlaLabel(t)}</span></td>
                            <td>{t.dueAt ? new Date(t.dueAt).toLocaleString() : "—"}</td>
                            <td><span className={`badge ${statusClass(t.status)}`}>{teamTaskStatusLabel(t.status)}</span></td>
                            <td>
                              <div className="toolbar">
                                {teamTaskNextStatuses(t.status).map((next) => (
                                  <button
                                    key={`${t.id}-inbox-${next}`}
                                    type="button"
                                    onClick={() => void updateTeamTaskStatus(t.id, next as "OPEN" | "IN_PROGRESS" | "DONE" | "VERIFIED")}
                                  >
                                    {teamTaskStatusLabel(next)}
                                  </button>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted">Нет задач в этой группе.</p>
                  )}
                </div>
              ))}
              {!groupedInboxTasks.overdue.length &&
                !groupedInboxTasks.today.length &&
                !groupedInboxTasks.week.length &&
                !groupedInboxTasks.later.length && (
                  <EmptyState title="Входящих задач нет" hint="Новые задачи появятся в этом разделе автоматически." />
                )}
            </>
          )}
        </div>
      )}

      {activeTab === "integrations" && (
        <div className="card">
          <h2>Интеграционные задачи</h2>
          <div className="form grid2">
            <label>
              Тип задачи
              <input value={integrationKind} onChange={(e) => setIntegrationKind(e.target.value)} />
            </label>
            <label>
              Параметры (JSON)
              <input value={integrationPayload} onChange={(e) => setIntegrationPayload(e.target.value)} />
            </label>
          </div>
          <div className="toolbar">
            <button type="button" onClick={() => void createIntegrationJob()}>Создать задачу</button>
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
            <EmptyState title="Задач пока нет." hint="Создай первую integration job и запусти ее." />
          )}

          <h3 style={{ marginTop: 16 }}>Уведомления</h3>
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
            <NotificationsTable notifications={notifications} />
          ) : (
            <EmptyState title="Уведомлений пока нет." />
          )}
        </div>
      )}

      {activeTab === "team" && canReadTeam && (
        <div className="card">
          <h2>Сотрудники и задачи</h2>
          {teamLoading && <LoadingState text="Загрузка команды..." />}
          {teamError && <ErrorState text={teamError} />}
          {canWriteTeamTasks && (
            <>
              <h3>Поставить задачу сотруднику</h3>
              <div className="form grid2">
                <label>
                  Сотрудник
                  <select value={teamAssigneeId} onChange={(e) => setTeamAssigneeId(e.target.value)}>
                    {teamEmployees.map((u) => (
                      <option key={u.id} value={u.id}>{u.fullName} ({roleLabel(u.role)})</option>
                    ))}
                  </select>
                </label>
                <label>
                  Срок (опционально)
                  <input type="datetime-local" value={teamTaskDueAt} onChange={(e) => setTeamTaskDueAt(e.target.value)} />
                </label>
                <label>
                  Объект (проект)
                  <select value={teamTaskProjectId} onChange={(e) => setTeamTaskProjectId(e.target.value)}>
                    <option value="">Без проекта</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{safeName(p.name)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Склад (опционально)
                  <select value={teamTaskWarehouseId} onChange={(e) => setTeamTaskWarehouseId(e.target.value)}>
                    <option value="">Без склада</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{safeName(w.name)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form">
                <label>
                  Заголовок задачи
                  <input value={teamTaskTitle} onChange={(e) => setTeamTaskTitle(e.target.value)} />
                </label>
                <label>
                  Описание
                  <textarea value={teamTaskDescription} onChange={(e) => setTeamTaskDescription(e.target.value)} />
                </label>
              </div>
              <div className="toolbar">
                <button type="button" onClick={() => void createTeamTask()}>Поставить задачу</button>
                <button type="button" onClick={() => void loadTeamData()}>Обновить</button>
              </div>
            </>
          )}

          <h3>Все сотрудники</h3>
          <table>
            <thead>
              <tr>
                <th>ФИО</th>
                <th>Роль</th>
                <th>Статус</th>
                <th>Склады</th>
                <th>Проекты</th>
              </tr>
            </thead>
            <tbody>
              {teamEmployees.map((u) => (
                <tr key={u.id}>
                  <td>{u.fullName} <span className="muted">({u.email})</span></td>
                  <td>{roleLabel(u.role)}</td>
                  <td>{statusLabel(u.status)}</td>
                  <td>{u.warehouses.length ? u.warehouses.map((w) => safeName(w.name)).join(", ") : "Без ограничений"}</td>
                  <td>{u.projects.length ? u.projects.map((p) => safeName(p.name)).join(", ") : "Без ограничений"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ marginTop: 14 }}>Задачи команды</h3>
          <table>
            <thead>
              <tr>
                <th>Задача</th>
                <th>Кому</th>
                <th>От кого</th>
                <th>Объект</th>
                <th>Статус</th>
                <th>Следующий шаг</th>
              </tr>
            </thead>
            <tbody>
              {teamTasks.map((t) => (
                <tr key={t.id} id={`team-task-${t.id}`} className={focusedTeamTaskId === t.id ? "selectedRow" : ""}>
                  <td>
                    {t.title}
                    {t.description ? <p className="muted">{t.description}</p> : null}
                  </td>
                  <td>{t.assignee?.fullName || "-"}</td>
                  <td>{t.createdBy?.fullName || "-"}</td>
                  <td>{t.project?.name || t.warehouse?.name || "-"}</td>
                  <td><span className={`badge ${statusClass(t.status)}`}>{teamTaskStatusLabel(t.status)}</span></td>
                  <td>
                    <div className="toolbar">
                      {teamTaskNextStatuses(t.status).map((next) => (
                        <button
                          key={`${t.id}-${next}`}
                          type="button"
                          onClick={() => {
                            setFocusedTeamTaskId(t.id);
                            void updateTeamTaskStatus(t.id, next as "OPEN" | "IN_PROGRESS" | "DONE" | "VERIFIED");
                          }}
                        >
                          {teamTaskStatusLabel(next)}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {focusedTeamTaskId && (
            <div className="toolbar">
              <button type="button" onClick={() => setFocusedTeamTaskId("")}>Снять фокус с задачи</button>
            </div>
          )}
          {teamMessage && <ResultBanner text={teamMessage} tone={teamTone} />}
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
        <div className="card">
          <h2>Приходы (упрощенно)</h2>
          <p className="muted">Один экран: добавляй материалы/инструменты, документы и проводи приход.</p>
          <div className="form">
            <label>
              Склад
              <select value={opWarehouseId} onChange={(e) => setOpWarehouseId(e.target.value)}>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{safeName(w.name)}</option>
                ))}
              </select>
            </label>
            <label>
              Номер документа прихода
              <input value={receiptDocumentNumber} onChange={(e) => setReceiptDocumentNumber(e.target.value)} placeholder="Напр. ПР-124/26" />
            </label>
            <label>
              Помещение
              <input value={opStorageRoom} onChange={(e) => setOpStorageRoom(e.target.value)} placeholder="Напр. Подвал" />
            </label>
            <label>
              Ячейка
              <input value={opStorageCell} onChange={(e) => setOpStorageCell(e.target.value)} placeholder="Напр. A-12" />
            </label>
          </div>
          <h3>Материалы в приходе</h3>
          <div className="plainList">
            {receiptLines.map((line, idx) => (
              <div key={line.id} className="receiptLine">
                <label>
                  Режим
                  <select
                    value={line.mode}
                    onChange={(e) => {
                      const mode = e.target.value as "existing" | "new";
                      setReceiptLines((prev) =>
                        prev.map((x, i) =>
                          i === idx
                            ? {
                                ...x,
                                mode,
                                materialId: mode === "existing" ? (materials[0]?.id || "") : ""
                              }
                            : x
                        )
                      );
                    }}
                  >
                    <option value="existing">Из справочника</option>
                    <option value="new">Новый материал</option>
                  </select>
                </label>
                {line.mode === "existing" ? (
                  <label>
                    Материал
                    <select
                      value={line.materialId}
                      onChange={(e) =>
                        setReceiptLines((prev) => prev.map((x, i) => (i === idx ? { ...x, materialId: e.target.value } : x)))
                      }
                    >
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>{m.name} {m.sku ? `(${m.sku})` : ""}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label>
                      Название
                      <input value={line.name} onChange={(e) => setReceiptLines((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))} />
                    </label>
                    <label>
                      SKU
                      <input value={line.sku} onChange={(e) => setReceiptLines((prev) => prev.map((x, i) => (i === idx ? { ...x, sku: e.target.value } : x)))} />
                    </label>
                    <label>
                      Ед. изм.
                      <input value={line.unit} onChange={(e) => setReceiptLines((prev) => prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))} />
                    </label>
                    <label>
                      Категория
                      <input value={line.category} onChange={(e) => setReceiptLines((prev) => prev.map((x, i) => (i === idx ? { ...x, category: e.target.value } : x)))} />
                    </label>
                  </>
                )}
                <label>
                  Количество
                  <input
                    type="number"
                    min={0.001}
                    step={0.001}
                    value={line.quantity}
                    onChange={(e) => setReceiptLines((prev) => prev.map((x, i) => (i === idx ? { ...x, quantity: Number(e.target.value) } : x)))}
                  />
                </label>
                <button type="button" className="ghostBtn" onClick={() => setReceiptLines((prev) => prev.filter((x) => x.id !== line.id))}>
                  Убрать позицию
                </button>
              </div>
            ))}
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="ghostBtn"
              onClick={() =>
                setReceiptLines((prev) => [
                  ...prev,
                  {
                    id: `line-${Date.now()}-${Math.random()}`,
                    mode: "existing",
                    materialId: materials[0]?.id || "",
                    quantity: 1,
                    name: "",
                    sku: "",
                    unit: "шт",
                    category: ""
                  }
                ])
              }
            >
              + Материал
            </button>
          </div>
          <h3>Инструменты в приходе</h3>
          <div className="plainList">
            {receiptTools.map((tool, idx) => (
              <div key={tool.id} className="receiptLine">
                <label>
                  Название инструмента
                  <input value={tool.name} onChange={(e) => setReceiptTools((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))} />
                </label>
                <label>
                  Инвентарный номер
                  <input value={tool.inventoryNumber} onChange={(e) => setReceiptTools((prev) => prev.map((x, i) => (i === idx ? { ...x, inventoryNumber: e.target.value } : x)))} />
                </label>
                <label>
                  Серийный номер
                  <input value={tool.serialNumber} onChange={(e) => setReceiptTools((prev) => prev.map((x, i) => (i === idx ? { ...x, serialNumber: e.target.value } : x)))} />
                </label>
                <label>
                  Примечание
                  <input value={tool.note} onChange={(e) => setReceiptTools((prev) => prev.map((x, i) => (i === idx ? { ...x, note: e.target.value } : x)))} />
                </label>
                <button type="button" className="ghostBtn" onClick={() => setReceiptTools((prev) => prev.filter((x) => x.id !== tool.id))}>
                  Убрать инструмент
                </button>
              </div>
            ))}
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="ghostBtn"
              onClick={() =>
                setReceiptTools((prev) => [
                  ...prev,
                  { id: `tool-${Date.now()}-${Math.random()}`, name: "", inventoryNumber: "", serialNumber: "", note: "" }
                ])
              }
            >
              + Инструмент
            </button>
          </div>
          <label>
            Документы к приходу
            <input
              type="file"
              multiple
              onChange={(e) => setReceiptDocs(Array.from(e.target.files || []))}
            />
          </label>
          <div className="card" style={{ marginTop: 12 }}>
            <h3>Возврат материала на склад</h3>
            <div className="form">
              <label>
                Материал
                <select value={returnMaterialId} onChange={(e) => setReturnMaterialId(e.target.value)}>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Возврат, кол-во
                <input type="number" min={0.001} step={0.001} value={returnQuantity} onChange={(e) => setReturnQuantity(Number(e.target.value))} />
              </label>
              <label>
                <span>Возврат брака</span>
                <input type="checkbox" checked={returnDefect} onChange={(e) => setReturnDefect(e.target.checked)} />
              </label>
            </div>
            <div className="toolbar">
              <button type="button" onClick={() => void submitMaterialReturn()} disabled={!canWriteOperations}>
                Провести возврат
              </button>
            </div>
          </div>
          <div className="toolbar">
            <button disabled={!canWriteOperations} onClick={() => void submitReceiptOperation()}>
              Провести приход
            </button>
          </div>
          {opsMessage && <p className="muted">{opsMessage}</p>}
          <h3>Последние приходы</h3>
          <table>
            <thead>
              <tr><th>Документ</th><th>Тип</th><th>Дата</th><th>Файлы</th></tr>
            </thead>
            <tbody>
              {operations.filter((o) => o.type === "INCOME").map((o) => (
                <tr key={o.id}>
                  <td>{o.documentNumber || o.id.slice(0, 8)}</td>
                  <td>{o.type}</td>
                  <td>{o.operationDate ? new Date(o.operationDate).toLocaleString() : "-"}</td>
                  <td><button onClick={() => openDocumentsForEntity("operation", o.id)}>Документы</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "issues" && (
        <div className="card">
          <h2>Заявки на выдачу</h2>
          <div className="form">
            <label>
              Склад
              <select value={issueWarehouseId} onChange={(e) => setIssueWarehouseId(e.target.value)}>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{safeName(w.name)}</option>
                ))}
              </select>
            </label>
            <label>
              Проект (необязательно)
              <select value={issueProjectId} onChange={(e) => setIssueProjectId(e.target.value)}>
                <option value="">— без проекта —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{safeName(p.name)}{p.code ? ` (${p.code})` : ""}</option>
                ))}
              </select>
            </label>
            {!isStorekeeperMode && (
              <>
                <label>
                  Тип основания
                  <select
                    value={issueBasisType}
                    onChange={(e) => setIssueBasisType(e.target.value as IssueBasisType)}
                  >
                    <option value="OTHER">Прочее</option>
                    <option value="PROJECT_WORK">Работы по проекту</option>
                    <option value="INTERNAL_NEED">Внутренняя потребность</option>
                    <option value="EMERGENCY">Срочно / аварийно</option>
                  </select>
                </label>
                <label>
                  Ссылка на основание (номер договора, наряд…)
                  <input value={issueBasisRef} onChange={(e) => setIssueBasisRef(e.target.value)} placeholder="Необязательно" />
                </label>
              </>
            )}
            <label>
              Примечание
              <input value={issueNote} onChange={(e) => setIssueNote(e.target.value)} placeholder={isStorekeeperMode ? "Кратко: кому/куда" : "Необязательно"} />
            </label>
            <label>
              Материал
              <select value={issueMaterialId} onChange={(e) => setIssueMaterialId(e.target.value)}>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} {m.sku ? `(${m.sku})` : ""}</option>
                ))}
              </select>
            </label>
            <label>
              Количество
              <input type="number" min={0.001} step={0.001} value={issueQuantity} onChange={(e) => setIssueQuantity(Number(e.target.value))} />
            </label>
          </div>
          <div className="toolbar">
            <input placeholder="Поиск заявки (номер/статус)" value={issueSearch} onChange={(e) => setIssueSearch(e.target.value)} />
            <select value={issueStatusFilter} onChange={(e) => setIssueStatusFilter((e.target.value || "") as "" | IssueStatus)}>
              <option value="">Все статусы заявок</option>
              <option value="DRAFT">{issueStatusLabel("DRAFT")}</option>
              <option value="ON_APPROVAL">{issueStatusLabel("ON_APPROVAL")}</option>
              <option value="APPROVED">{issueStatusLabel("APPROVED")}</option>
              <option value="REJECTED">{issueStatusLabel("REJECTED")}</option>
              <option value="ISSUED">{issueStatusLabel("ISSUED")}</option>
              <option value="CANCELLED">{issueStatusLabel("CANCELLED")}</option>
            </select>
            <select
              value={issueBasisFilter}
              onChange={(e) => setIssueBasisFilter((e.target.value || "") as "" | IssueBasisType)}
            >
              <option value="">Все типы основания</option>
              <option value="PROJECT_WORK">{basisTypeLabel("PROJECT_WORK")}</option>
              <option value="INTERNAL_NEED">{basisTypeLabel("INTERNAL_NEED")}</option>
              <option value="EMERGENCY">{basisTypeLabel("EMERGENCY")}</option>
              <option value="OTHER">{basisTypeLabel("OTHER")}</option>
            </select>
            <select value={issuesSort} onChange={(e) => setIssuesSort(e.target.value as typeof issuesSort)}>
              <option value="created_desc">Сначала новые</option>
              <option value="status">По статусу</option>
              <option value="number">По номеру</option>
            </select>
            <button onClick={() => void loadIssues()}>Обновить список</button>
            {!isStorekeeperMode && (
              <button
                onClick={async () => {
                  if (!token || !selectedIssueIds.length) return;
                  for (const id of selectedIssueIds) {
                    await executeIssueAction(id, "send-for-approval");
                  }
                  setSelectedIssueIds([]);
                  await loadIssues();
                }}
              >
                Массово: на согласование
              </button>
            )}
            <button
              onClick={async () => {
                if (!token || !issueWarehouseId || !issueMaterialId) return;
                const res = await fetch(`${API_URL}/api/issues`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    warehouseId: issueWarehouseId,
                    projectId: issueProjectId || undefined,
                    note: issueNote.trim() || undefined,
                    basisType: issueBasisType,
                    basisRef: issueBasisRef.trim() || undefined,
                    items: [{ materialId: issueMaterialId, quantity: issueQuantity }]
                  })
                });
                if (!res.ok) {
                  setIssuesMessage("Ошибка создания заявки");
                  setIssuesTone(res.status === 409 ? "conflict" : "error");
                  return;
                }
                setIssuesMessage("Заявка создана");
                setIssuesTone("success");
                await loadIssues();
              }}
            >
              Создать заявку
            </button>
          </div>
          {issuesMessage && <ResultBanner text={issuesMessage} tone={issuesTone} />}
          {issuesLoading && <LoadingState text="Загрузка заявок..." />}
          {issuesError && <ErrorState text={issuesError} />}
          {!issuesLoading && !issuesError && !issues.length && (
            <EmptyState title="Заявок не найдено" hint="Смени фильтры или создай новую заявку." />
          )}
          {!issuesLoading && !issuesError && issues.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Номер</th>
                <th>Проект</th>
                <th>Основание</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIssueIds.includes(i.id)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedIssueIds((prev) => [...prev, i.id]);
                        else setSelectedIssueIds((prev) => prev.filter((x) => x !== i.id));
                      }}
                    />
                    {" "}
                    {i.number}
                  </td>
                  <td>{i.project?.name || "—"}</td>
                  <td className="muted">
                    {basisTypeLabel(i.basisType || "OTHER")}
                    {i.basisRef ? ` · ${i.basisRef}` : ""}
                  </td>
                  <td><span className={`badge ${statusClass(i.status)}`}>{issueStatusLabel(i.status)}</span></td>
                  <td>
                    <div className="toolbar">
                      <button onClick={() => { setSelectedIssueId(i.id); setDrawerMode("issue"); }}>Детали</button>
                      {i.status === "DRAFT" && (
                        <button onClick={() => void executeIssueAction(i.id, "send-for-approval")}>На согласование</button>
                      )}
                      {i.status === "ON_APPROVAL" && (
                        <>
                          <button onClick={() => void executeIssueAction(i.id, "approve")}>Одобрить</button>
                          <button onClick={() => void executeIssueAction(i.id, "reject")}>Отклонить</button>
                        </>
                      )}
                      {(i.status === "DRAFT" || i.status === "ON_APPROVAL") && (
                        <button onClick={() => void executeIssueAction(i.id, "cancel")}>Отменить</button>
                      )}
                      {(i.status === "DRAFT" || i.status === "APPROVED") && (
                        <button onClick={() => void executeIssueAction(i.id, "issue")}>Выдать</button>
                      )}
                      <button onClick={() => openDocumentsForEntity("issue", i.id)}>Документы</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          {!issuesLoading && !issuesError && issues.length > 0 && (
            <div className="toolbar">
              <span className="muted">
                Показано {Math.min((issuesPage - 1) * issuesPageSize + 1, issuesTotal)}-
                {Math.min(issuesPage * issuesPageSize, issuesTotal)} из {issuesTotal}
              </span>
              <select
                value={issuesPageSize}
                onChange={(e) => setIssuesPageSize(Number(e.target.value) as ListPageSize)}
                aria-label="Размер страницы заявок"
              >
                <option value={20}>20 на стр.</option>
                <option value={50}>50 на стр.</option>
                <option value={100}>100 на стр.</option>
              </select>
              <button type="button" onClick={() => setIssuesPage((p) => Math.max(1, p - 1))} disabled={issuesPage <= 1}>
                Назад
              </button>
              <span className="muted">Стр. {issuesPage} / {issuesTotalPages}</span>
              <button type="button" onClick={() => setIssuesPage((p) => Math.min(issuesTotalPages, p + 1))} disabled={issuesPage >= issuesTotalPages}>
                Вперед
              </button>
            </div>
          )}
          <div className="actionBar">
            <button onClick={() => setActiveTab("approvals")}>Открыть согласования</button>
            <button onClick={() => setIssueStatusFilter("DRAFT")}>Показать черновики</button>
            <button onClick={() => setIssueStatusFilter("ON_APPROVAL")}>Показать на согласовании</button>
            <button onClick={() => setIssueStatusFilter("")}>Сбросить фильтр</button>
          </div>
        </div>
      )}

      {activeTab === "limits" && (
        <div className="card">
          <h2>Лимиты по проектам</h2>
          <div className="grid2">
            <div>
              <h3>Создать проект</h3>
              <div className="form">
                <label>
                  Название проекта
                  <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
                </label>
                <label>
                  Код проекта
                  <input value={projectCode} onChange={(e) => setProjectCode(e.target.value)} />
                </label>
                <label>
                  Объект (склад)
                  <select value={projectWarehouseId} onChange={(e) => setProjectWarehouseId(e.target.value)}>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>{safeName(w.name)}</option>
                    ))}
                  </select>
                </label>
                <button
                  disabled={!canWriteLimits}
                  onClick={async () => {
                    if (!token) return;
                    const res = await fetch(`${API_URL}/api/projects`, {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                      body: JSON.stringify({ name: projectName, code: projectCode, warehouseId: projectWarehouseId || undefined })
                    });
                    if (!res.ok) {
                      setLimitsMessage("Ошибка создания проекта");
                      return;
                    }
                    setLimitsMessage("Проект создан");
                    await loadProjects();
                  }}
                >
                  Создать проект
                </button>
              </div>
            </div>

            <div>
              <h3>Создать лимит</h3>
              <div className="form">
                <label>
                  Проект
                  <select value={limitProjectId} onChange={(e) => setLimitProjectId(e.target.value)}>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>{safeName(p.name)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Название лимита
                  <input value={limitName} onChange={(e) => setLimitName(e.target.value)} />
                </label>
                <label>
                  Материал
                  <select value={limitMaterialId} onChange={(e) => setLimitMaterialId(e.target.value)}>
                    {materials.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  План, количество
                  <input type="number" min={0.001} step={0.001} value={limitPlannedQty} onChange={(e) => setLimitPlannedQty(Number(e.target.value))} />
                </label>
                <button
                  disabled={!canWriteLimits}
                  onClick={async () => {
                    if (!token || !limitProjectId || !limitMaterialId) return;
                    const res = await fetch(`${API_URL}/api/project-limits`, {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                      body: JSON.stringify({
                        projectId: limitProjectId,
                        name: limitName,
                        items: [{ materialId: limitMaterialId, plannedQty: limitPlannedQty }]
                      })
                    });
                    if (!res.ok) {
                      setLimitsMessage("Ошибка создания лимита");
                      return;
                    }
                    const data = await res.json();
                    setLimitIdForSummary(data.id);
                    setLimitsMessage("Лимит создан");
                  }}
                >
                  Создать лимит
                </button>
              </div>
            </div>
          </div>

          <div className="toolbar">
            <input
              placeholder="ID лимита для сводки"
              value={limitIdForSummary}
              onChange={(e) => setLimitIdForSummary(e.target.value)}
            />
            <button
              onClick={async () => {
                if (!token || !limitIdForSummary) return;
                const res = await fetch(`${API_URL}/api/project-limits/${limitIdForSummary}/summary`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (!res.ok) {
                  setLimitsMessage("Ошибка загрузки сводки лимита");
                  return;
                }
                setLimitSummary((await res.json()) as ProjectLimitSummary);
              }}
            >
              Загрузить сводку
            </button>
          </div>
          {limitsMessage && <p className="muted">{limitsMessage}</p>}

          {limitSummary && (
            <table>
              <thead>
                <tr>
                  <th>Материал</th>
                  <th>План</th>
                  <th>Выдано</th>
                  <th>Резерв</th>
                  <th>Остаток</th>
                  <th>Использование</th>
                </tr>
              </thead>
              <tbody>
                {limitSummary.items.map((item) => (
                  <tr key={item.materialId} className={item.isOver ? "low" : ""}>
                    <td>{item.materialName}</td>
                    <td>{item.plannedQty}</td>
                    <td>{item.issuedQty}</td>
                    <td>{item.reservedQty}</td>
                    <td>{item.remainingQty}</td>
                    <td>
                      <div className="progressWrap">
                        <div
                          className={`progressBar ${item.isOver ? "bad" : ""}`}
                          style={{ width: `${Math.min(100, Math.round(((item.issuedQty + item.reservedQty) / Math.max(1, item.plannedQty)) * 100))}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {activeTab === "approvals" && (
        <div className="card">
          <h2>Очередь согласований</h2>
          {issuesMessage && <ResultBanner text={issuesMessage} tone={issuesTone} />}
          <div className="kpiRow">
            <div className="kpi">
              <span>На согласовании</span>
              <strong>{approvalQueue.length}</strong>
            </div>
          </div>
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
        </div>
      )}

      {activeTab === "documents" && (
        <div className="card">
          <h2>Документный центр</h2>
          <div className="tabs">
            {[
              { id: "", label: "Все" },
              { id: "upd", label: "УПД" },
              { id: "tn", label: "ТН" },
              { id: "photo", label: "Фото" },
              { id: "act", label: "Акты" },
              { id: "other", label: "Прочее" }
            ].map((tab) => (
              <button key={tab.id || "all"} onClick={() => setDocTypeFilter(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          <div className="form docCenterForm">
            <label>
              Тип сущности
              <select
                value={docEntityType}
                onChange={(e) => {
                  const nextType = e.target.value as "operation" | "issue";
                  setDocEntityType(nextType);
                  setDocEntityId("");
                }}
              >
                <option value="issue">Заявка</option>
                <option value="operation">Операция</option>
              </select>
            </label>
            <label>
              Сущность
              {docEntityType === "issue" ? (
                <select value={docEntityId} onChange={(e) => setDocEntityId(e.target.value)}>
                  <option value="">Выбери заявку</option>
                  {issues.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.number} ({issueStatusLabel(i.status)})
                    </option>
                  ))}
                </select>
              ) : (
                <select value={docEntityId} onChange={(e) => setDocEntityId(e.target.value)}>
                  <option value="">Выбери операцию</option>
                  {operations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {(o.documentNumber || o.id.slice(0, 8))} [{o.type}]
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label>
              Вид документа
              <select value={docType} onChange={(e) => setDocType(e.target.value)}>
                <option value="upd">УПД</option>
                <option value="tn">ТН</option>
                <option value="photo">Фото</option>
                <option value="other">Прочее</option>
              </select>
            </label>
            <label>
              Файл
              <input type="file" onChange={(e) => setDocFile(e.target.files?.[0] || null)} />
            </label>
          </div>
          <div className="toolbar">
            <button
              onClick={async () => {
                if (!docFile) {
                  setDocumentsMessage("Выбери сущность и файл");
                  return;
                }
                await uploadDocumentFile(docFile);
              }}
            >
              Загрузить
            </button>
            <button onClick={() => void loadDocuments()}>Обновить список</button>
          </div>
          <div className="form docCenterForm">
            <p className="muted">Доп. привязка: один файл в списке можно связать с другой заявкой/операцией без повторной загрузки.</p>
            <label>
              Тип цели привязки
              <select
                value={docLinkTargetType}
                onChange={(e) => {
                  setDocLinkTargetType(e.target.value as "issue" | "operation");
                  setDocLinkTargetId("");
                }}
              >
                <option value="issue">Заявка</option>
                <option value="operation">Операция</option>
              </select>
            </label>
            <label>
              Цель привязки
              {docLinkTargetType === "issue" ? (
                <select value={docLinkTargetId} onChange={(e) => setDocLinkTargetId(e.target.value)}>
                  <option value="">Выбери заявку</option>
                  {issues.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.number} ({issueStatusLabel(i.status)})
                    </option>
                  ))}
                </select>
              ) : (
                <select value={docLinkTargetId} onChange={(e) => setDocLinkTargetId(e.target.value)}>
                  <option value="">Выбери операцию</option>
                  {operations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {(o.documentNumber || o.id.slice(0, 8))} [{o.type}]
                    </option>
                  ))}
                </select>
              )}
            </label>
            <button type="button" onClick={() => void createDocumentLink()}>
              Привязать выбранный в списке файл
            </button>
          </div>
          <div
            className={`dropZone ${docDragOver ? "over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDocDragOver(true);
            }}
            onDragLeave={() => setDocDragOver(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setDocDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) {
                await uploadDocumentFile(file);
              }
            }}
          >
            Перетащи файл сюда для быстрой загрузки
          </div>
          {documentsMessage && <p className="muted">{documentsMessage}</p>}
          <div className="docCenterSplit">
            <div className="card">
              <table>
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Версия</th>
                    <th>Владелец файла</th>
                    <th>Как открыто</th>
                    <th>Вид</th>
                    <th>Файл</th>
                    <th>Размер</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((d) => (
                    <tr key={d.id} className={selectedDocumentId === d.id ? "selectedRow" : ""}>
                      <td>{new Date(d.createdAt).toLocaleString()}</td>
                      <td>v{d.version}</td>
                      <td title={`${d.entityType}:${d.entityId}`}>{d.entityType}:{d.entityId.slice(0, 8)}…</td>
                      <td className="muted">
                        {!docEntityId ? "—" : d.matchedLinkId ? "по ссылке" : "основная"}
                      </td>
                      <td>{d.type}</td>
                      <td><a href={`${API_URL}/${d.filePath}`} target="_blank" rel="noreferrer">{d.fileName}</a></td>
                      <td>{d.size || 0}</td>
                      <td>
                        <div className="toolbar">
                          <button onClick={() => { setSelectedDocumentId(d.id); setDocPreviewUrl(`${API_URL}/${d.filePath}`); }}>Превью</button>
                          <button onClick={() => void replaceDocument(d.id)}>Новая версия</button>
                          {d.matchedLinkId ? (
                            <button onClick={() => void unlinkDocumentLink(d.matchedLinkId!)}>Отвязать</button>
                          ) : (
                            <button onClick={() => void deleteDocument(d.id)}>Удалить</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card">
              <h3>Панель предпросмотра</h3>
              {selectedDocument ? (
                <>
                  <p className="muted">{selectedDocument.fileName} • v{selectedDocument.version}</p>
                  <iframe src={docPreviewUrl || `${API_URL}/${selectedDocument.filePath}`} title="document-preview" style={{ width: "100%", minHeight: 420, border: "1px solid #d8dee9", borderRadius: 8 }} />
                </>
              ) : (
                <p className="muted">Выбери документ из списка слева.</p>
              )}
            </div>
          </div>
        </div>
      )}

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
                  На согласование
                </button>
              )}
              {selectedIssue.status === "ON_APPROVAL" && (
                <>
                  <button onClick={() => void executeIssueAction(selectedIssue.id, "approve", { closeDrawer: true })}>Согласовать</button>
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
          <p><strong>Проект:</strong> {selectedIssue.project?.name || "—"}</p>
          <p><strong>Основание:</strong> {basisTypeLabel(selectedIssue.basisType || "OTHER")}{selectedIssue.basisRef ? ` · ${selectedIssue.basisRef}` : ""}</p>
          {selectedIssue.note ? <p><strong>Примечание:</strong> {selectedIssue.note}</p> : null}
          <p><strong>Инициатор:</strong> {selectedIssue.requestedBy?.fullName || selectedIssue.requestedById}</p>
          {selectedIssue.approvedBy ? (
            <p><strong>Согласовал:</strong> {selectedIssue.approvedBy.fullName}</p>
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
                      <td>{line.material?.name || line.materialId}</td>
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
          <h2>QR инструмента</h2>
          <div className="toolbar">
            <input
              placeholder="Вставь QR/код инструмента: TOOL:INV-001 или инв. номер"
              value={qrCode}
              onChange={(e) => setQrCode(e.target.value)}
            />
            <button onClick={() => void resolveQrCode()}>Найти</button>
          </div>
          {qrMessage && <p className="muted">{qrMessage}</p>}

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
              <select value={toolWarehouseId} onChange={(e) => setToolWarehouseId(e.target.value)}>
                <option value="">Не указан</option>
                {warehouses.map((w) => (
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
          <h2>Сводка по объекту в PDF</h2>
          <div className="form">
            <label>
              Объект (проект)
              <select value={reportProjectId} onChange={(e) => setReportProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{safeName(p.name)}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="toolbar">
            <button
              type="button"
              onClick={() => {
                if (!token || !reportProjectId) return;
                const url = `${API_URL}/api/reports/object/${encodeURIComponent(reportProjectId)}/summary.pdf?access_token=${encodeURIComponent(token)}`;
                window.open(url, "_blank", "noopener,noreferrer");
              }}
            >
              Скачать PDF сводку
            </button>
          </div>
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
                    }}
                  >
                    {adminObjects.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
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
                {canReadIntegrations && <option value="integrations">Интеграции</option>}
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
      </section>
    </main>
  );
}

export default App;
