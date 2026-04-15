import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";
import { API_URL, ISSUE_FILTER_KEY, STOCK_VIEW_KEY, TOKEN_KEY } from "./app/constants";
import { EmptyState, ErrorState, LoadingState } from "./shared/ui/StateViews";
import {
  IntegrationJobsTable,
  type IntegrationJobRow
} from "./widgets/integrations/IntegrationJobsTable";
import { NotificationsTable, type NotificationRow } from "./widgets/integrations/NotificationsTable";
import { ReadinessPanel, type ReadinessResponse } from "./widgets/integrations/ReadinessPanel";

type LoginResponse = { token: string; user: { id: string; email: string; fullName: string; role: string; permissions: string[] } };
type StockRow = { id: string; warehouseName: string; materialName: string; materialSku: string | null; materialUnit: string; quantity: number; reserved: number; available: number; isLow: boolean; updatedAt: string };
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
type MeResponse = { id: string; email: string; fullName: string; role: string; permissions: string[] };
type AdminUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  status: "ACTIVE" | "BLOCKED";
  permissions: string[];
  warehouseScopeIds?: string[];
  projectScopeIds?: string[];
};
type AdminRole = { id: string; name: string; permissions: string[] };
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
type Project = { id: string; name: string; code?: string | null };
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
  const [globalSearch, setGlobalSearch] = useState("");
  const [activeTab, setActiveTab] = useState<
    | "stocks"
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
  >("stocks");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRoleName, setSelectedRoleName] = useState("VIEWER");
  const [selectedStatus, setSelectedStatus] = useState<"ACTIVE" | "BLOCKED">("ACTIVE");
  const [newPassword, setNewPassword] = useState("1111");
  const [adminMessage, setAdminMessage] = useState("");
  const [selectedWarehouseScopes, setSelectedWarehouseScopes] = useState<string[]>([]);
  const [selectedProjectScopes, setSelectedProjectScopes] = useState<string[]>([]);
  const [passCurrent, setPassCurrent] = useState("1111");
  const [passNext, setPassNext] = useState("1111");
  const [passMessage, setPassMessage] = useState("");
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [catalogMessage, setCatalogMessage] = useState("");
  const [opsMessage, setOpsMessage] = useState("");
  const [warehouseName, setWarehouseName] = useState("Главный склад");
  const [warehouseAddress, setWarehouseAddress] = useState("Москва");
  const [materialName, setMaterialName] = useState("Арматура 10 мм");
  const [materialSku, setMaterialSku] = useState("");
  const [materialUnit, setMaterialUnit] = useState("м");
  const [materialCategory, setMaterialCategory] = useState("Металл");
  const [opType, setOpType] = useState<"INCOME" | "EXPENSE">("INCOME");
  const [opWarehouseId, setOpWarehouseId] = useState("");
  const [opMaterialId, setOpMaterialId] = useState("");
  const [opQuantity, setOpQuantity] = useState(1);
  const [issues, setIssues] = useState<IssueRequest[]>([]);
  const [operations, setOperations] = useState<OperationRow[]>([]);
  const [issuesMessage, setIssuesMessage] = useState("");
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

  const isAuthed = useMemo(() => Boolean(token), [token]);
  const canManageUsers = useMemo(() => Boolean(me?.permissions?.includes("*") || me?.permissions?.includes("admin.users.manage")), [me]);
  const canWriteCatalog = useMemo(() => Boolean(me?.permissions?.includes("*") || me?.permissions?.includes("warehouses.write") || me?.permissions?.includes("materials.write")), [me]);
  const canWriteOperations = useMemo(() => Boolean(me?.permissions?.includes("*") || me?.permissions?.includes("operations.write")), [me]);
  const canWriteLimits = useMemo(() => Boolean(me?.permissions?.includes("*") || me?.permissions?.includes("limits.write")), [me]);
  const canReadAudit = useMemo(
    () => Boolean(me?.permissions?.includes("*") || me?.permissions?.includes("audit.read")),
    [me]
  );
  const canDashboard = useMemo(
    () =>
      Boolean(
        me?.permissions?.includes("*") ||
          me?.permissions?.includes("dashboard.read") ||
          me?.permissions?.includes("stocks.read")
      ),
    [me]
  );
  const canMaterialMatch = useMemo(
    () =>
      Boolean(
        me?.permissions?.includes("*") ||
          me?.permissions?.includes("materials.match") ||
          me?.permissions?.includes("materials.write")
      ),
    [me]
  );

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
  }

  async function loadDashboardSummary() {
    if (!token || !canDashboard) {
      return;
    }
    setDashboardError("");
    try {
      const r = await fetch(`${API_URL}/api/dashboard/summary`, {
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
    if (!r.ok) return;
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
    const [usersRes, rolesRes] = await Promise.all([
      fetch(`${API_URL}/api/admin/users`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_URL}/api/admin/roles`, { headers: { Authorization: `Bearer ${token}` } })
    ]);
    if (!usersRes.ok || !rolesRes.ok) {
      throw new Error("Не удалось загрузить админ-данные");
    }
    const usersData = (await usersRes.json()) as AdminUser[];
    const rolesData = (await rolesRes.json()) as AdminRole[];
    setUsers(usersData);
    setRoles(rolesData);
    if (usersData.length && !selectedUserId) {
      setSelectedUserId(usersData[0].id);
      setSelectedRoleName(usersData[0].role);
      setSelectedStatus(usersData[0].status);
    }
  }

  async function loadCatalogData() {
    if (!token) {
      return;
    }
    const [wRes, mRes] = await Promise.all([
      fetch(`${API_URL}/api/warehouses`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_URL}/api/materials`, { headers: { Authorization: `Bearer ${token}` } })
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
    if (materialsData.length && !opMaterialId) {
      setOpMaterialId(materialsData[0].id);
    }
    if (warehousesData.length && !issueWarehouseId) {
      setIssueWarehouseId(warehousesData[0].id);
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
  }

  async function loadIssues() {
    if (!token) return;
    const params = new URLSearchParams();
    if (issueStatusFilter) params.set("status", issueStatusFilter);
    if (issueBasisFilter) params.set("basisType", issueBasisFilter);
    const qs = params.toString();
    const query = qs ? `?${qs}` : "";
    const res = await fetch(`${API_URL}/api/issues${query}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = (await res.json()) as IssueRequest[];
    setIssues(data);
    if (data.length && !selectedIssueId) {
      setSelectedIssueId(data[0].id);
    }
  }

  async function loadApprovalQueue() {
    if (!token) return;
    const res = await fetch(`${API_URL}/api/issues?status=ON_APPROVAL`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    setApprovalQueue((await res.json()) as IssueRequest[]);
  }

  async function loadOperations() {
    if (!token) return;
    const res = await fetch(`${API_URL}/api/operations`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    setOperations((await res.json()) as OperationRow[]);
  }

  async function loadTools() {
    if (!token) return;
    const queryParts = [
      toolSearch ? `q=${encodeURIComponent(toolSearch)}` : "",
      toolStatusFilter ? `status=${encodeURIComponent(toolStatusFilter)}` : ""
    ].filter(Boolean);
    const query = queryParts.length ? `?${queryParts.join("&")}` : "";
    const res = await fetch(`${API_URL}/api/tools${query}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = (await res.json()) as ToolItem[];
    setTools(data);
    if (data.length && !selectedToolIds.length) {
      setSelectedToolIds([data[0].id]);
    }
    if (data.length && !selectedToolForEvents) {
      setSelectedToolForEvents(data[0].id);
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
    const query = waybillStatusFilter ? `?status=${encodeURIComponent(waybillStatusFilter)}` : "";
    const res = await fetch(`${API_URL}/api/waybills${query}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const data = (await res.json()) as Waybill[];
    setWaybills(data);
    if (data.length && !selectedWaybillId) {
      setSelectedWaybillId(data[0].id);
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
      return;
    }
    const pdfUrl = `${API_URL}/api/waybills/${waybillId}/pdf?access_token=${encodeURIComponent(token)}&filename=${encodeURIComponent(waybillNumber)}.pdf`;
    const win = window.open(pdfUrl, "_blank", "noopener,noreferrer");
    if (!win) {
      window.location.assign(pdfUrl);
    }
    setWaybillsMessage("Открываю PDF...");
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
      return;
    }
    const res = await fetch(`${API_URL}/api/tools/${toolId}/action`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action, responsible, comment })
    });
    if (!res.ok) {
      setToolsMessage("Не удалось изменить статус инструмента");
      return;
    }
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
  const filteredIssues = issues.filter((i) => {
    if (!issueSearch.trim()) return true;
    const q = issueSearch.toLowerCase();
    const basis = `${i.basisType || ""} ${i.basisRef || ""}`.toLowerCase();
    return (
      i.number.toLowerCase().includes(q) ||
      i.status.toLowerCase().includes(q) ||
      basis.includes(q)
    );
  });

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
    const items = (await res.json()) as ToolItem[];
    setTools(items);
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
    }
  }, [token]);

  useEffect(() => {
    if (!token || !canDashboard) {
      setDashboard(null);
      return;
    }
    void loadDashboardSummary();
  }, [token, canDashboard, me]);

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
    if (token && canManageUsers && activeTab === "admin") {
      void loadAdminData();
      void loadCatalogData().catch(() => undefined);
    }
  }, [token, canManageUsers, activeTab]);

  useEffect(() => {
    const u = users.find((x) => x.id === selectedUserId);
    if (u) {
      setSelectedWarehouseScopes(u.warehouseScopeIds ?? []);
      setSelectedProjectScopes(u.projectScopeIds ?? []);
    }
  }, [users, selectedUserId]);

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
  }, [token, activeTab, issueStatusFilter, issueBasisFilter]);

  useEffect(() => {
    localStorage.setItem(ISSUE_FILTER_KEY, issueStatusFilter);
  }, [issueStatusFilter]);

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
  }, [token, activeTab, toolSearch, toolStatusFilter]);

  useEffect(() => {
    if (token && activeTab === "waybills") {
      void loadCatalogData();
      void loadWaybills();
    }
  }, [token, activeTab, waybillStatusFilter]);

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
    setUsers([]);
    setRoles([]);
    setMe(null);
  }

  if (!isAuthed) {
    return (
      <main className="app">
        <h1>SkladPro</h1>
        <div className="card">
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
    <main className="shell">
      <aside className="sidebar">
        <h2 className="brand">SkladPro</h2>
        <button className="navBtn" onClick={() => setActiveTab("stocks")}>Остатки</button>
        <button className="navBtn" onClick={() => setActiveTab("catalog")}>Справочники</button>
        <button className="navBtn" onClick={() => setActiveTab("matching")}>Сопоставление</button>
        <button className="navBtn" onClick={() => setActiveTab("operations")}>Операции</button>
        <button className="navBtn" onClick={() => setActiveTab("issues")}>Заявки</button>
        <button className="navBtn" onClick={() => setActiveTab("limits")}>Лимиты</button>
        <button className="navBtn" onClick={() => setActiveTab("approvals")}>Согласования</button>
        <button className="navBtn" onClick={() => setActiveTab("documents")}>Документы</button>
        <button className="navBtn" onClick={() => setActiveTab("waybills")}>Транспортные ТН</button>
        <button className="navBtn" onClick={() => setActiveTab("qr")}>QR</button>
        <button className="navBtn" onClick={() => setActiveTab("tools")}>Инструмент</button>
        <button className="navBtn" onClick={() => setActiveTab("integrations")}>Интеграции</button>
        {canReadAudit && <button className="navBtn" onClick={() => setActiveTab("audit")}>Аудит</button>}
        {canManageUsers && <button className="navBtn" onClick={() => setActiveTab("admin")}>Доступы</button>}
        <button className="navBtn" onClick={() => setActiveTab("password")}>Сменить пароль</button>
        <button className="navBtn danger" onClick={onLogout}>Выйти</button>
      </aside>
      <section className="canvas">
        <header className="pageHeader">
          <div className="pageTitleBlock">
            <h1>
              {activeTab === "stocks"
                ? "Остатки"
                : activeTab === "catalog"
                  ? "Справочники"
                  : activeTab === "matching"
                    ? "Сопоставление номенклатуры"
                    : activeTab === "audit"
                      ? "Аудит действий"
                      : activeTab === "operations"
                        ? "Операции прихода/расхода"
                        : activeTab === "issues"
                          ? "Заявки на выдачу"
                          : activeTab === "limits"
                            ? "Лимиты проекта"
                            : activeTab === "approvals"
                              ? "Очередь согласований"
                              : activeTab === "documents"
                                ? "Документы"
                                : activeTab === "waybills"
                                  ? "Транспортные накладные"
                                  : activeTab === "qr"
                                    ? "QR-сканирование"
                                    : activeTab === "tools"
                                      ? "Инструмент и QR"
                                      : activeTab === "integrations"
                                        ? "Интеграции и уведомления"
                                      : activeTab === "admin"
                                        ? "Управление доступами"
                                        : "Смена пароля"}
            </h1>
            {me && <p className="muted">{me.fullName} ({me.role})</p>}
          </div>
          <div className="toolbar">
            <input placeholder="Глобальный поиск (материал/инструмент/код)" value={globalSearch} onChange={(e) => setGlobalSearch(e.target.value)} />
            <button onClick={() => { setQ(globalSearch); setToolSearch(globalSearch); setActiveTab("stocks"); }}>Найти</button>
            <button onClick={() => setActiveTab("qr")}>QR</button>
          </div>
        </header>
        {dashboard && (
          <div className="card dashboardStrip">
            <div className="toolbar" style={{ flexWrap: "wrap", gap: 12 }}>
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
                ERROR-уведомления (24ч): <strong>{dashboard.warehouse.errorNotifications24h}</strong>
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
          <div className="kpiRow">
            <button className="kpi kpiBtn" onClick={() => setActiveTab("stocks")}><span>Позиций</span><strong>{stocks.length}</strong></button>
            <button className="kpi kpiBtn" onClick={() => { setQ("low"); void loadStocks("low"); setActiveTab("stocks"); }}><span>Проблемные</span><strong>{stocks.filter((x) => x.isLow).length}</strong></button>
            <button className="kpi kpiBtn" onClick={() => { setIssueStatusFilter("ON_APPROVAL"); setActiveTab("issues"); }}><span>На согласовании</span><strong>{dashboard?.warehouse.pendingApprovals ?? approvalQueue.length}</strong></button>
            <button className="kpi kpiBtn" onClick={() => setActiveTab("waybills")}><span>Транспортные ТН</span><strong>{waybills.length}</strong></button>
            <button type="button" className="kpi kpiBtn" onClick={() => setActiveTab("matching")}><span>Сопоставление</span><strong>{dashboard?.warehouse.matchQueuePending ?? matchQueue.length}</strong></button>
            <button type="button" className="kpi kpiBtn" onClick={() => setActiveTab("integrations")}><span>Интеграции</span><strong>{dashboard?.warehouse.unreadNotifications ?? notifications.filter((n) => !n.isRead).length}</strong></button>
          </div>
        )}
        <p className="muted">Если в названиях видишь `????`, это старые тестовые данные с поврежденной кодировкой.</p>

      {activeTab === "stocks" && (
        <div className="card">
          <div className="toolbar">
            <input
              placeholder="Поиск по материалу, sku, синониму"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <label><input type="checkbox" checked={showStockSku} onChange={(e) => setShowStockSku(e.target.checked)} /> SKU</label>
            <label><input type="checkbox" checked={showStockReserve} onChange={(e) => setShowStockReserve(e.target.checked)} /> Резерв</label>
            <button onClick={() => void loadStocks(q)}>Найти</button>
            <button type="button" onClick={() => void loadStockMovements()}>
              Журнал движений
            </button>
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
                  <th>Остаток</th>
                  {showStockReserve && <th>Резерв</th>}
                  <th>Доступно</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((row) => (
                  <tr key={row.id} className={row.isLow ? "low" : ""}>
                    <td>{row.warehouseName}</td>
                    <td>{row.materialName}</td>
                    {showStockSku && <td>{row.materialSku || "-"}</td>}
                    <td>{row.materialUnit}</td>
                    <td>{row.quantity}</td>
                    {showStockReserve && <td>{row.reserved}</td>}
                    <td>{row.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {stockMovementsLoading && <p>Загрузка движений...</p>}
          {stockMovementsError && <p className="error">{stockMovementsError}</p>}
          {!stockMovementsLoading && stockMovements.length > 0 && (
            <>
              <h3 style={{ marginTop: 16 }}>Журнал движений (последние записи)</h3>
              <table>
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Склад</th>
                    <th>Материал</th>
                    <th>Напр.</th>
                    <th>Кол-во</th>
                    <th>Источник</th>
                    <th>Операция / заявка</th>
                  </tr>
                </thead>
                <tbody>
                  {stockMovements.map((m) => (
                    <tr key={m.id}>
                      <td>{new Date(m.createdAt).toLocaleString()}</td>
                      <td>{m.warehouse?.name ?? m.warehouseId}</td>
                      <td>{m.material?.name ?? m.materialId}</td>
                      <td>{m.direction}</td>
                      <td>{m.quantity}</td>
                      <td>{m.sourceDocumentType}</td>
                      <td>
                        {m.operation?.documentNumber || m.operation?.id || "—"}
                        {m.issueRequest?.number ? ` · заявка ${m.issueRequest.number}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {activeTab === "stocks" && (
        <div className="grid2">
          <div className="card">
            <h3>Проблемы сегодня</h3>
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
              <button onClick={() => setActiveTab("waybills")}>Новая ТН</button>
              <button onClick={() => setActiveTab("tools")}>Инструмент / QR</button>
            </div>
          </div>
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

      {activeTab === "integrations" && (
        <div className="card">
          <h2>IntegrationJob</h2>
          <div className="form grid2">
            <label>
              Тип задачи
              <input value={integrationKind} onChange={(e) => setIntegrationKind(e.target.value)} />
            </label>
            <label>
              Payload (JSON)
              <input value={integrationPayload} onChange={(e) => setIntegrationPayload(e.target.value)} />
            </label>
          </div>
          <div className="toolbar">
            <button type="button" onClick={() => void createIntegrationJob()}>Создать задачу</button>
            <button type="button" onClick={() => void loadIntegrationJobs()}>Обновить список</button>
            <button type="button" onClick={() => void loadReadiness()}>Readiness-check</button>
          </div>
          {integrationMessage && <ErrorState text={integrationMessage} />}
          {readiness ? (
            <ReadinessPanel readiness={readiness} />
          ) : (
            <LoadingState text="Readiness еще не загружен." />
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

            <div>
              <h3>Создать материал</h3>
              <div className="form">
                <label>
                  Название
                  <input value={materialName} onChange={(e) => setMaterialName(e.target.value)} />
                </label>
                <label>
                  SKU
                  <input value={materialSku} onChange={(e) => setMaterialSku(e.target.value)} />
                </label>
                <label>
                  Ед. изм.
                  <input value={materialUnit} onChange={(e) => setMaterialUnit(e.target.value)} />
                </label>
                <label>
                  Категория
                  <input value={materialCategory} onChange={(e) => setMaterialCategory(e.target.value)} />
                </label>
                <button
                  disabled={!canWriteCatalog}
                  onClick={async () => {
                    if (!token) return;
                    setCatalogMessage("");
                    const res = await fetch(`${API_URL}/api/materials`, {
                      method: "POST",
                      headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json"
                      },
                      body: JSON.stringify({
                        name: materialName,
                        sku: materialSku || undefined,
                        unit: materialUnit,
                        category: materialCategory
                      })
                    });
                    if (!res.ok) {
                      setCatalogMessage("Ошибка создания материала (возможно дубль SKU)");
                      return;
                    }
                    setCatalogMessage("Материал создан");
                    setMaterialSku("");
                    await loadCatalogData();
                  }}
                >
                  Создать материал
                </button>
              </div>
            </div>
          </div>
          {catalogMessage && <p className="muted">{catalogMessage}</p>}
        </div>
      )}

      {activeTab === "operations" && (
        <div className="card">
          <h2>Операции прихода / расхода</h2>
          <div className="form">
            <label>
              Тип операции
              <select value={opType} onChange={(e) => setOpType(e.target.value as "INCOME" | "EXPENSE")}>
                <option value="INCOME">INCOME (приход)</option>
                <option value="EXPENSE">EXPENSE (расход)</option>
              </select>
            </label>
            <label>
              Склад
              <select value={opWarehouseId} onChange={(e) => setOpWarehouseId(e.target.value)}>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Материал
              <select value={opMaterialId} onChange={(e) => setOpMaterialId(e.target.value)}>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.sku ? `(${m.sku})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Количество
              <input
                type="number"
                min={0.001}
                step={0.001}
                value={opQuantity}
                onChange={(e) => setOpQuantity(Number(e.target.value))}
              />
            </label>
          </div>
          <div className="toolbar">
            <button
              disabled={!canWriteOperations}
              onClick={async () => {
                if (!token || !opWarehouseId || !opMaterialId) return;
                setOpsMessage("");
                const res = await fetch(`${API_URL}/api/operations`, {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json"
                  },
                  body: JSON.stringify({
                    type: opType,
                    warehouseId: opWarehouseId,
                    documentNumber: `${opType}-${Date.now()}`,
                    items: [{ materialId: opMaterialId, quantity: opQuantity }]
                  })
                });
                if (!res.ok) {
                  const errText = await res.text();
                  setOpsMessage(`Ошибка операции: ${errText}`);
                  return;
                }
                setOpsMessage("Операция проведена");
                await loadStocks(q);
              }}
            >
              Провести операцию
            </button>
          </div>
          {opsMessage && <p className="muted">{opsMessage}</p>}
          <h3>Последние операции</h3>
          <table>
            <thead>
              <tr><th>Документ</th><th>Тип</th><th>Дата</th><th>Файлы</th></tr>
            </thead>
            <tbody>
              {operations.map((o) => (
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
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </label>
            <label>
              Проект (необязательно)
              <select value={issueProjectId} onChange={(e) => setIssueProjectId(e.target.value)}>
                <option value="">— без проекта —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ""}</option>
                ))}
              </select>
            </label>
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
            <label>
              Примечание
              <input value={issueNote} onChange={(e) => setIssueNote(e.target.value)} placeholder="Необязательно" />
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
              <option value="DRAFT">DRAFT</option>
              <option value="ON_APPROVAL">ON_APPROVAL</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="ISSUED">ISSUED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
            <select
              value={issueBasisFilter}
              onChange={(e) => setIssueBasisFilter((e.target.value || "") as "" | IssueBasisType)}
            >
              <option value="">Все типы основания</option>
              <option value="PROJECT_WORK">PROJECT_WORK</option>
              <option value="INTERNAL_NEED">INTERNAL_NEED</option>
              <option value="EMERGENCY">EMERGENCY</option>
              <option value="OTHER">OTHER</option>
            </select>
            <button onClick={() => void loadIssues()}>Обновить список</button>
            <button
              onClick={async () => {
                if (!token || !selectedIssueIds.length) return;
                for (const id of selectedIssueIds) {
                  await fetch(`${API_URL}/api/issues/${id}/send-for-approval`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } });
                }
                setSelectedIssueIds([]);
                await loadIssues();
              }}
            >
              Массово: на согласование
            </button>
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
                  return;
                }
                setIssuesMessage("Заявка создана");
                await loadIssues();
              }}
            >
              Создать заявку
            </button>
          </div>
          {issuesMessage && <p className="muted">{issuesMessage}</p>}
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
              {filteredIssues.map((i) => (
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
                    {i.basisType || "OTHER"}
                    {i.basisRef ? ` · ${i.basisRef}` : ""}
                  </td>
                  <td><span className={`badge ${statusClass(i.status)}`}>{i.status}</span></td>
                  <td>
                    <div className="toolbar">
                      <button onClick={() => { setSelectedIssueId(i.id); setDrawerMode("issue"); }}>Детали</button>
                      {i.status === "DRAFT" && (
                        <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/send-for-approval`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadIssues(); }}>На согласование</button>
                      )}
                      {i.status === "ON_APPROVAL" && (
                        <>
                          <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/approve`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadIssues(); }}>Одобрить</button>
                          <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/reject`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadIssues(); }}>Отклонить</button>
                        </>
                      )}
                      {(i.status === "DRAFT" || i.status === "ON_APPROVAL") && (
                        <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/cancel`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadIssues(); }}>Отменить</button>
                      )}
                      {(i.status === "DRAFT" || i.status === "APPROVED") && (
                        <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/issue`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadIssues(); await loadStocks(q); }}>Выдать</button>
                      )}
                      <button onClick={() => openDocumentsForEntity("issue", i.id)}>Документы</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="actionBar">
            <button onClick={() => setActiveTab("approvals")}>Открыть согласования</button>
            <button onClick={() => setIssueStatusFilter("DRAFT")}>Показать черновики</button>
            <button onClick={() => setIssueStatusFilter("ON_APPROVAL")}>Показать ON_APPROVAL</button>
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
                <button
                  disabled={!canWriteLimits}
                  onClick={async () => {
                    if (!token) return;
                    const res = await fetch(`${API_URL}/api/projects`, {
                      method: "POST",
                      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                      body: JSON.stringify({ name: projectName, code: projectCode })
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
                      <option key={p.id} value={p.id}>{p.name}</option>
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
                  <td><span className={`badge ${statusClass(i.status)}`}>{i.status}</span></td>
                  <td>
                    <div className="toolbar">
                      <button onClick={() => { setSelectedIssueId(i.id); setDrawerMode("issue"); }}>Детали</button>
                      <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/approve`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadApprovalQueue(); await loadIssues(); }}>Одобрить</button>
                      <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/reject`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadApprovalQueue(); await loadIssues(); }}>Отклонить</button>
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
                      {i.number} ({i.status})
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
                      {i.number} ({i.status})
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
              <h3>Preview panel</h3>
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
          <div className="kpiRow">
            <div className="kpi"><span>Всего</span><strong>{waybills.length}</strong></div>
            <div className="kpi"><span>В пути</span><strong>{waybills.filter((x) => x.status === "SHIPPED").length}</strong></div>
            <div className="kpi"><span>Черновики</span><strong>{waybills.filter((x) => x.status === "DRAFT").length}</strong></div>
          </div>
          <div className="toolbar">
            <select value={waybillStatusFilter} onChange={(e) => setWaybillStatusFilter((e.target.value || "") as "" | WaybillStatus)}>
              <option value="">Все статусы</option>
              <option value="DRAFT">DRAFT</option>
              <option value="FORMED">FORMED</option>
              <option value="SHIPPED">SHIPPED</option>
              <option value="RECEIVED">RECEIVED</option>
              <option value="CLOSED">CLOSED</option>
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
                      <option key={w.id} value={w.id}>{w.name}</option>
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
                      return;
                    }
                    setWaybillsMessage("ТН создана");
                    await loadWaybills();
                  }}
                >
                  Создать ТН
                </button>
              </div>
            </div>

            <div className="card">
              <h3>Список ТН</h3>
              {waybillsMessage && <p className="muted">{waybillsMessage}</p>}
              <div className="toolbar">
                <select value={selectedWaybillId} onChange={(e) => setSelectedWaybillId(e.target.value)}>
                  {waybills.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.number} ({w.status})
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
                      <td><span className={`badge ${statusClass(w.status)}`}>{w.status}</span></td>
                      <td>{w.toLocation}</td>
                      <td>
                        <div className="toolbar">
                          <button onClick={() => { setSelectedWaybillId(w.id); setDrawerMode("waybill"); }}>Детали</button>
                          <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/waybills/${w.id}/status`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "FORMED", comment: "Formed in UI" }) }); await loadWaybills(); if (selectedWaybillId === w.id) await loadWaybillEvents(w.id); }}>Сформировать</button>
                          <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/waybills/${w.id}/status`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "SHIPPED", comment: "Shipped to destination" }) }); await loadWaybills(); if (selectedWaybillId === w.id) await loadWaybillEvents(w.id); }}>Отгружено</button>
                          <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/waybills/${w.id}/status`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "RECEIVED", comment: "Received by destination" }) }); await loadWaybills(); if (selectedWaybillId === w.id) await loadWaybillEvents(w.id); }}>Получено</button>
                          <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/waybills/${w.id}/status`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ status: "CLOSED", comment: "Closed" }) }); await loadWaybills(); if (selectedWaybillId === w.id) await loadWaybillEvents(w.id); }}>Закрыть</button>
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
                      <td>{e.status}</td>
                      <td>{e.comment || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          <p><strong>Статус:</strong> <span className={`badge ${statusClass(selectedIssue.status)}`}>{selectedIssue.status}</span></p>
          <p><strong>Склад:</strong> {selectedIssue.warehouse?.name || selectedIssue.warehouseId}</p>
          <p><strong>Проект:</strong> {selectedIssue.project?.name || "—"}</p>
          <p><strong>Основание:</strong> {selectedIssue.basisType || "OTHER"}{selectedIssue.basisRef ? ` · ${selectedIssue.basisRef}` : ""}</p>
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
            {(selectedIssue.status === "DRAFT" || selectedIssue.status === "ON_APPROVAL") && token ? (
              <button
                onClick={async () => {
                  await fetch(`${API_URL}/api/issues/${selectedIssue.id}/cancel`, {
                    method: "PATCH",
                    headers: { Authorization: `Bearer ${token}` }
                  });
                  setDrawerMode("");
                  await loadIssues();
                }}
              >
                Отменить заявку
              </button>
            ) : null}
          </div>
        </aside>
      )}

      {drawerMode === "waybill" && selectedWaybill && (
        <aside className="detailDrawer">
          <div className="detailDrawerHeader">
            <h3>Карточка ТН {selectedWaybill.number}</h3>
            <button onClick={() => setDrawerMode("")}>Закрыть</button>
          </div>
          <p><strong>Статус:</strong> <span className={`badge ${statusClass(selectedWaybill.status)}`}>{selectedWaybill.status}</span></p>
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
              <p className="muted">Статус: {qrResult.tool.status}</p>
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
          <div className="toolbar">
            <input
              placeholder="Поиск инструмента (название, инв. номер, QR)"
              value={toolSearch}
              onChange={(e) => setToolSearch(e.target.value)}
            />
            <select value={toolStatusFilter} onChange={(e) => setToolStatusFilter((e.target.value || "") as "" | ToolStatus)}>
              <option value="">Все статусы</option>
              <option value="IN_STOCK">IN_STOCK</option>
              <option value="ISSUED">ISSUED</option>
              <option value="IN_REPAIR">IN_REPAIR</option>
              <option value="DAMAGED">DAMAGED</option>
              <option value="LOST">LOST</option>
              <option value="WRITTEN_OFF">WRITTEN_OFF</option>
              <option value="DISPUTED">DISPUTED</option>
            </select>
            <button onClick={() => void loadTools()}>Обновить список</button>
          </div>
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
                  <option key={w.id} value={w.id}>{w.name}</option>
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
                  return;
                }
                setToolsMessage("Инструмент создан");
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
                  return;
                }
                const res = await fetch(`${API_URL}/api/tools/labels/pdf?ids=${encodeURIComponent(selectedToolIds.join(","))}`, {
                  headers: { Authorization: `Bearer ${token}` }
                });
                if (!res.ok) {
                  setToolsMessage("Не удалось сформировать PDF");
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
          {toolsMessage && <p className="muted">{toolsMessage}</p>}
          {toolQrPreview && (
            <div className="card">
              <h3>QR предпросмотр: {toolQrPreview.qrCode}</h3>
              <img src={toolQrPreview.dataUrl} alt="Tool QR preview" style={{ maxWidth: 220 }} />
            </div>
          )}
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
                  <td><span className={`badge ${statusClass(t.status)}`}>{t.status}</span></td>
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
                  <td>{e.action}</td>
                  <td>{e.status}</td>
                  <td>{e.comment || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {toolAction && (
            <div className="card">
              <h3>Подтверждение действия: {toolAction.action}</h3>
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

      {activeTab === "admin" && canManageUsers && (
        <div className="card">
          <h2>Управление доступами</h2>
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
                    {r.name}
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
                <option value="ACTIVE">ACTIVE</option>
                <option value="BLOCKED">BLOCKED</option>
              </select>
            </label>
            <label>
              Новый пароль (сброс)
              <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
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
                      {w.name}
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
                      {p.name}
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
                  body: JSON.stringify({ roleName: selectedRoleName, status: selectedStatus })
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
      </section>
    </main>
  );
}

export default App;
