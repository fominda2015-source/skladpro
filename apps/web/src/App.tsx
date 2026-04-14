import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

type LoginResponse = { token: string; user: { id: string; email: string; fullName: string; role: string; permissions: string[] } };
type StockRow = { id: string; warehouseName: string; materialName: string; materialSku: string | null; materialUnit: string; quantity: number; reserved: number; available: number; isLow: boolean; updatedAt: string };
type MeResponse = { id: string; email: string; fullName: string; role: string; permissions: string[] };
type AdminUser = { id: string; email: string; fullName: string; role: string; status: "ACTIVE" | "BLOCKED"; permissions: string[] };
type AdminRole = { id: string; name: string; permissions: string[] };
type Warehouse = { id: string; name: string; address?: string | null; isActive: boolean };
type Material = { id: string; name: string; sku?: string | null; unit: string; category?: string | null };
type IssueRequest = {
  id: string;
  number: string;
  status: string;
  warehouseId: string;
  requestedById: string;
  createdAt: string;
  warehouse?: { name: string };
  requestedBy?: { fullName: string };
};
type IssueStatus = "DRAFT" | "ON_APPROVAL" | "APPROVED" | "REJECTED" | "ISSUED";
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
  replacedById?: string | null;
  isDeleted?: boolean;
  createdAt: string;
};

const API_URL = import.meta.env.VITE_API_URL || "http://194.156.117.250";
const TOKEN_KEY = "skladpro_token";

function App() {
  const [email, setEmail] = useState("admin@skladpro.local");
  const [password, setPassword] = useState("1111");
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [authError, setAuthError] = useState("");
  const [stocks, setStocks] = useState<StockRow[]>([]);
  const [q, setQ] = useState("");
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [stocksError, setStocksError] = useState("");
  const [globalSearch, setGlobalSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"stocks" | "admin" | "password" | "catalog" | "operations" | "issues" | "limits" | "approvals" | "documents" | "qr" | "tools" | "waybills">("stocks");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRoleName, setSelectedRoleName] = useState("VIEWER");
  const [selectedStatus, setSelectedStatus] = useState<"ACTIVE" | "BLOCKED">("ACTIVE");
  const [newPassword, setNewPassword] = useState("1111");
  const [adminMessage, setAdminMessage] = useState("");
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
  const [issueStatusFilter, setIssueStatusFilter] = useState<"" | IssueStatus>("");
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

  const isAuthed = useMemo(() => Boolean(token), [token]);
  const canManageUsers = useMemo(() => Boolean(me?.permissions?.includes("*") || me?.permissions?.includes("admin.users.manage")), [me]);
  const canWriteCatalog = useMemo(() => Boolean(me?.permissions?.includes("*") || me?.permissions?.includes("warehouses.write") || me?.permissions?.includes("materials.write")), [me]);
  const canWriteOperations = useMemo(() => Boolean(me?.permissions?.includes("*") || me?.permissions?.includes("operations.write")), [me]);
  const canWriteLimits = useMemo(() => Boolean(me?.permissions?.includes("*") || me?.permissions?.includes("limits.write")), [me]);

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
    const query = issueStatusFilter ? `?status=${encodeURIComponent(issueStatusFilter)}` : "";
    const res = await fetch(`${API_URL}/api/issues${query}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    setIssues((await res.json()) as IssueRequest[]);
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
    setDocuments((await res.json()) as DocumentFile[]);
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
    }
  }, [token]);

  useEffect(() => {
    if (token && canManageUsers && activeTab === "admin") {
      void loadAdminData();
    }
  }, [token, canManageUsers, activeTab]);

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
      void loadIssues();
    }
  }, [token, activeTab, issueStatusFilter]);

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
        <button className="navBtn" onClick={() => setActiveTab("operations")}>Операции</button>
        <button className="navBtn" onClick={() => setActiveTab("issues")}>Заявки</button>
        <button className="navBtn" onClick={() => setActiveTab("limits")}>Лимиты</button>
        <button className="navBtn" onClick={() => setActiveTab("approvals")}>Согласования</button>
        <button className="navBtn" onClick={() => setActiveTab("documents")}>Документы</button>
        <button className="navBtn" onClick={() => setActiveTab("waybills")}>Транспортные ТН</button>
        <button className="navBtn" onClick={() => setActiveTab("qr")}>QR</button>
        <button className="navBtn" onClick={() => setActiveTab("tools")}>Инструмент</button>
        {canManageUsers && <button className="navBtn" onClick={() => setActiveTab("admin")}>Доступы</button>}
        <button className="navBtn" onClick={() => setActiveTab("password")}>Сменить пароль</button>
        <button className="navBtn danger" onClick={onLogout}>Выйти</button>
      </aside>
      <section className="canvas">
        <header className="pageHeader">
          <div className="pageTitleBlock">
            <h1>{activeTab === "stocks" ? "Остатки" : activeTab === "catalog" ? "Справочники" : activeTab === "operations" ? "Операции прихода/расхода" : activeTab === "issues" ? "Заявки на выдачу" : activeTab === "limits" ? "Лимиты проекта" : activeTab === "approvals" ? "Очередь согласований" : activeTab === "documents" ? "Документы" : activeTab === "waybills" ? "Транспортные накладные" : activeTab === "qr" ? "QR-сканирование" : activeTab === "tools" ? "Инструмент и QR" : activeTab === "admin" ? "Управление доступами" : "Смена пароля"}</h1>
            {me && <p className="muted">{me.fullName} ({me.role})</p>}
          </div>
          <div className="toolbar">
            <input placeholder="Глобальный поиск (материал/инструмент/код)" value={globalSearch} onChange={(e) => setGlobalSearch(e.target.value)} />
            <button onClick={() => { setQ(globalSearch); setToolSearch(globalSearch); setActiveTab("stocks"); }}>Найти</button>
            <button onClick={() => setActiveTab("qr")}>QR</button>
          </div>
        </header>
        {activeTab === "stocks" && (
          <div className="kpiRow">
            <div className="kpi"><span>Позиций</span><strong>{stocks.length}</strong></div>
            <div className="kpi"><span>Проблемные</span><strong>{stocks.filter((x) => x.isLow).length}</strong></div>
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
            <button onClick={() => void loadStocks(q)}>Найти</button>
          </div>

          {loadingStocks && <p>Загрузка остатков...</p>}
          {stocksError && <p className="error">{stocksError}</p>}
          {!loadingStocks && !stocksError && (
            <table>
              <thead>
                <tr>
                  <th>Склад</th>
                  <th>Материал</th>
                  <th>SKU</th>
                  <th>Ед.</th>
                  <th>Остаток</th>
                  <th>Резерв</th>
                  <th>Доступно</th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((row) => (
                  <tr key={row.id} className={row.isLow ? "low" : ""}>
                    <td>{row.warehouseName}</td>
                    <td>{row.materialName}</td>
                    <td>{row.materialSku || "-"}</td>
                    <td>{row.materialUnit}</td>
                    <td>{row.quantity}</td>
                    <td>{row.reserved}</td>
                    <td>{row.available}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <select value={issueStatusFilter} onChange={(e) => setIssueStatusFilter((e.target.value || "") as "" | IssueStatus)}>
              <option value="">Все статусы заявок</option>
              <option value="DRAFT">DRAFT</option>
              <option value="ON_APPROVAL">ON_APPROVAL</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="ISSUED">ISSUED</option>
            </select>
            <button onClick={() => void loadIssues()}>Обновить список</button>
            <button
              onClick={async () => {
                if (!token || !issueWarehouseId || !issueMaterialId) return;
                const res = await fetch(`${API_URL}/api/issues`, {
                  method: "POST",
                  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                  body: JSON.stringify({
                    warehouseId: issueWarehouseId,
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
              <tr><th>Номер</th><th>Статус</th><th>Действия</th></tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.id}>
                  <td>{i.number}</td>
                  <td><span className={`badge ${statusClass(i.status)}`}>{i.status}</span></td>
                  <td>
                    <div className="toolbar">
                      <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/send-for-approval`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadIssues(); }}>На согласование</button>
                      <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/approve`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadIssues(); }}>Одобрить</button>
                      <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/issue`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadIssues(); await loadStocks(q); }}>Выдать</button>
                      <button onClick={() => openDocumentsForEntity("issue", i.id)}>Документы</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                      <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/approve`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadApprovalQueue(); await loadIssues(); }}>Одобрить</button>
                      <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/reject`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadApprovalQueue(); await loadIssues(); }}>Отклонить</button>
                      <button onClick={async () => { if (!token) return; await fetch(`${API_URL}/api/issues/${i.id}/issue`, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } }); await loadApprovalQueue(); await loadIssues(); await loadStocks(q); }}>Выдать</button>
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
          <h2>УПД / ТН / Фото</h2>
          <div className="form">
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
            <select value={docTypeFilter} onChange={(e) => setDocTypeFilter(e.target.value)}>
              <option value="">Все типы</option>
              <option value="upd">УПД</option>
              <option value="tn">ТН</option>
              <option value="photo">Фото</option>
              <option value="act">Акт</option>
              <option value="other">Прочее</option>
            </select>
            <button
              onClick={async () => {
                if (!token || !docEntityId || !docFile) {
                  setDocumentsMessage("Выбери сущность и файл");
                  return;
                }
                setDocumentsMessage("");
                const formData = new FormData();
                formData.append("entityType", docEntityType);
                formData.append("entityId", docEntityId);
                formData.append("type", docType);
                formData.append("file", docFile);
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
              }}
            >
              Загрузить
            </button>
            <button onClick={() => void loadDocuments()}>Обновить список</button>
          </div>
          {documentsMessage && <p className="muted">{documentsMessage}</p>}
          {docPreviewUrl && (
            <div className="card">
              <h3>Предпросмотр</h3>
              <iframe src={docPreviewUrl} title="document-preview" style={{ width: "100%", minHeight: 360, border: "1px solid #d8dee9", borderRadius: 8 }} />
            </div>
          )}
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Версия</th>
                <th>Сущность</th>
                <th>Вид</th>
                <th>Файл</th>
                <th>Размер</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={d.id}>
                  <td>{new Date(d.createdAt).toLocaleString()}</td>
                  <td>v{d.version}</td>
                  <td>{d.entityType}:{d.entityId}</td>
                  <td>{d.type}</td>
                  <td><a href={`${API_URL}/${d.filePath}`} target="_blank" rel="noreferrer">{d.fileName}</a></td>
                  <td>{d.size || 0}</td>
                  <td>
                    <div className="toolbar">
                      <button onClick={() => setDocPreviewUrl(`${API_URL}/${d.filePath}`)}>Превью</button>
                      <button onClick={() => void replaceDocument(d.id)}>Новая версия</button>
                      <button onClick={() => void deleteDocument(d.id)}>Удалить</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        </div>
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
