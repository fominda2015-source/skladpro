import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useDebouncedValue } from "../../shared/hooks/useDebouncedValue";
import { EmptyState, ResultBanner } from "../../shared/ui/StateViews";
import { PageHero } from "../ui/PageHero";
import {
  CAMP_HUB_CARDS,
  campCategoryIcon,
  campCategoryLabel,
  isCampCategoryNav,
  type CampCategoryNavId,
  type CampItemCategory,
  type CampSummary
} from "./campCatalog";

export type CampItemStatus = "IN_USE" | "STORAGE" | "REPAIR" | "WRITTEN_OFF";

type CampItemFile = {
  id: string;
  fileName: string;
  filePath: string;
  size?: number | null;
  mimeType?: string | null;
  type?: string | null;
  createdAt: string;
};

export type CampItemRow = {
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

type Props = {
  token: string | null;
  apiUrl: string;
  fetchWithSession: (url: string, init?: RequestInit) => Promise<Response>;
  warehouseId: string;
  sectionFilter: "SS" | "EOM";
  warehouses: Array<{ id: string; name: string }>;
  canWrite: boolean;
  objectFilterSlot: ReactNode;
  compact?: boolean;
};

const statusLabel: Record<CampItemStatus, string> = {
  IN_USE: "В эксплуатации",
  STORAGE: "На хранении",
  REPAIR: "В ремонте",
  WRITTEN_OFF: "Списан"
};

const statusTone: Record<CampItemStatus, "ok" | "neutral" | "warn" | "bad"> = {
  IN_USE: "ok",
  STORAGE: "neutral",
  REPAIR: "warn",
  WRITTEN_OFF: "bad"
};

export function CampTab({
  token,
  apiUrl,
  fetchWithSession,
  warehouseId,
  sectionFilter,
  warehouses,
  canWrite,
  objectFilterSlot,
  compact
}: Props) {
  const [navCategory, setNavCategory] = useState<CampCategoryNavId>("hub");
  const [items, setItems] = useState<CampItemRow[]>([]);
  const [summary, setSummary] = useState<CampSummary | null>(null);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 280);
  const [statusFilter, setStatusFilter] = useState<"" | CampItemStatus>("");
  const [selected, setSelected] = useState<CampItemRow | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [detailFiles, setDetailFiles] = useState<File[]>([]);
  const [detailUploading, setDetailUploading] = useState(false);
  const [transferSection, setTransferSection] = useState<"SS" | "EOM" | "">("");
  const [transferNote, setTransferNote] = useState("");
  const [transferFiles, setTransferFiles] = useState<File[]>([]);
  const [transferBusy, setTransferBusy] = useState(false);
  const [moveWarehouseId, setMoveWarehouseId] = useState("");
  const [moveNote, setMoveNote] = useState("");
  const [moveFiles, setMoveFiles] = useState<File[]>([]);
  const [moveBusy, setMoveBusy] = useState(false);

  const [createName, setCreateName] = useState("");
  const [createCategory, setCreateCategory] = useState<CampItemCategory>("CONTAINER_CABIN");
  const [createInv, setCreateInv] = useState("");
  const [createSerial, setCreateSerial] = useState("");
  const [createManufacturer, setCreateManufacturer] = useState("");
  const [createLocation, setCreateLocation] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createStatus, setCreateStatus] = useState<CampItemStatus>("IN_USE");
  const [createFiles, setCreateFiles] = useState<File[]>([]);

  const categoryFilter = isCampCategoryNav(navCategory) ? navCategory : "";

  const loadItems = useCallback(async () => {
    if (!token) return;
    const parts: string[] = [];
    if (sectionFilter) parts.push(`section=${encodeURIComponent(sectionFilter)}`);
    if (warehouseId) parts.push(`warehouseId=${encodeURIComponent(warehouseId)}`);
    if (categoryFilter) parts.push(`category=${encodeURIComponent(categoryFilter)}`);
    if (statusFilter) parts.push(`status=${encodeURIComponent(statusFilter)}`);
    if (debouncedSearch.trim()) parts.push(`q=${encodeURIComponent(debouncedSearch.trim())}`);
    const query = parts.length ? `?${parts.join("&")}` : "";
    try {
      const res = await fetchWithSession(`${apiUrl}/api/camp-items${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        setItems([]);
        setMessage(`Не удалось загрузить городок (HTTP ${res.status})`);
        return;
      }
      const data = (await res.json()) as CampItemRow[];
      setItems(Array.isArray(data) ? data : []);
      setMessage("");
      setSelected((prev) => {
        if (!prev) return null;
        return (Array.isArray(data) ? data : []).find((x) => x.id === prev.id) || null;
      });
    } catch (err) {
      setItems([]);
      setMessage(`Сеть: ${(err as Error).message || "ошибка"}`);
    }
  }, [token, apiUrl, fetchWithSession, warehouseId, sectionFilter, categoryFilter, statusFilter, debouncedSearch]);

  const loadSummary = useCallback(async () => {
    if (!token) return;
    const q = new URLSearchParams();
    if (warehouseId) q.set("warehouseId", warehouseId);
    q.set("section", sectionFilter);
    const res = await fetchWithSession(`${apiUrl}/api/camp-items/summary?${q}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) setSummary((await res.json()) as CampSummary);
  }, [token, apiUrl, fetchWithSession, warehouseId, sectionFilter]);

  useEffect(() => {
    void loadItems();
    void loadSummary();
  }, [loadItems, loadSummary]);

  const hubStats = useMemo(() => {
    if (!summary) return undefined;
    const map: Record<string, { count: number }> = {};
    for (const c of summary.categories) map[c.key] = { count: c.count };
    return map;
  }, [summary]);

  const visibleItems = items;
  const filtersActive = Boolean(search.trim()) || Boolean(categoryFilter) || Boolean(statusFilter);

  function resetCreateForm() {
    setCreateName("");
    setCreateCategory(isCampCategoryNav(navCategory) ? navCategory : "CONTAINER_CABIN");
    setCreateInv("");
    setCreateSerial("");
    setCreateManufacturer("");
    setCreateLocation("");
    setCreateDescription("");
    setCreateStatus("IN_USE");
    setCreateFiles([]);
  }

  async function createItem() {
    if (!token || !canWrite) return;
    const name = createName.trim();
    if (!name) {
      setMessage("Укажи название");
      return;
    }
    setCreating(true);
    try {
      const form = new FormData();
      form.append(
        "payload",
        JSON.stringify({
          name,
          category: createCategory,
          inventoryNumber: createInv.trim() || null,
          serialNumber: createSerial.trim() || null,
          manufacturer: createManufacturer.trim() || null,
          location: createLocation.trim() || null,
          description: createDescription.trim() || null,
          warehouseId: warehouseId || null,
          section: sectionFilter,
          status: createStatus
        })
      );
      for (const f of createFiles) form.append("files", f);
      const res = await fetchWithSession(`${apiUrl}/api/camp-items`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage(typeof err.error === "string" ? err.error : "Не удалось создать запись");
        return;
      }
      setMessage(`Создано: ${name}`);
      resetCreateForm();
      setShowAddForm(false);
      await loadItems();
      await loadSummary();
    } finally {
      setCreating(false);
    }
  }

  async function updateItem(id: string, patch: Record<string, unknown>) {
    if (!token || !canWrite) return;
    const res = await fetchWithSession(`${apiUrl}/api/camp-items/${id}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    if (!res.ok) {
      setMessage("Не удалось сохранить изменения");
      return;
    }
    await loadItems();
    await loadSummary();
  }

  async function deleteItem(id: string) {
    if (!token || !canWrite) return;
    if (!window.confirm("Удалить позицию городка?")) return;
    const res = await fetchWithSession(`${apiUrl}/api/camp-items/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      setMessage("Не удалось удалить");
      return;
    }
    setSelected(null);
    await loadItems();
    await loadSummary();
  }

  async function uploadFiles(itemId: string, files: File[]) {
    if (!token || !canWrite || !files.length) return;
    setDetailUploading(true);
    try {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      const res = await fetchWithSession(`${apiUrl}/api/camp-items/${itemId}/files`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      if (!res.ok) {
        setMessage("Не удалось загрузить файлы");
        return;
      }
      setDetailFiles([]);
      await loadItems();
    } finally {
      setDetailUploading(false);
    }
  }

  async function deleteFile(itemId: string, fileId: string) {
    if (!token || !canWrite) return;
    await fetchWithSession(`${apiUrl}/api/camp-items/${itemId}/files/${fileId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
    await loadItems();
  }

  async function submitSectionTransfer(item: CampItemRow) {
    if (!token || !canWrite || !transferSection) return;
    if (!transferFiles.length) {
      setMessage("Приложите документ передачи между СС и ЭОМ");
      return;
    }
    setTransferBusy(true);
    try {
      const form = new FormData();
      form.append("payload", JSON.stringify({ targetSection: transferSection, note: transferNote.trim() || null }));
      for (const f of transferFiles) form.append("files", f);
      const res = await fetchWithSession(`${apiUrl}/api/camp-items/${item.id}/transfer-section`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage(typeof err.error === "string" ? err.error : "Не удалось передать");
        return;
      }
      setMessage(`Передано в ${transferSection === "SS" ? "СС" : "ЭОМ"}`);
      setTransferSection("");
      setTransferNote("");
      setTransferFiles([]);
      await loadItems();
      await loadSummary();
    } finally {
      setTransferBusy(false);
    }
  }

  async function submitWarehouseMove(item: CampItemRow) {
    if (!token || !canWrite || !moveWarehouseId) return;
    setMoveBusy(true);
    try {
      const form = new FormData();
      form.append(
        "payload",
        JSON.stringify({ targetWarehouseId: moveWarehouseId, note: moveNote.trim() || null })
      );
      for (const f of moveFiles) form.append("files", f);
      const res = await fetchWithSession(`${apiUrl}/api/camp-items/${item.id}/move-warehouse`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage(typeof err.error === "string" ? err.error : "Не удалось переместить");
        return;
      }
      setMessage("Позиция перемещена на другой объект");
      setMoveWarehouseId("");
      setMoveNote("");
      setMoveFiles([]);
      setSelected(null);
      await loadItems();
      await loadSummary();
    } finally {
      setMoveBusy(false);
    }
  }

  const inUseCount = visibleItems.filter((c) => c.status === "IN_USE").length;
  const repairCount = visibleItems.filter((c) => c.status === "REPAIR").length;

  return (
    <>
      {!compact ? objectFilterSlot : null}
      {!compact ? (
        <PageHero
          icon="▣"
          title="Городок"
          subtitle="Бытовки, мебель, оргтехника — не выдаётся, только учёт и перемещения"
          stats={[
            { label: "Всего позиций", value: summary?.total ?? visibleItems.length },
            { label: "В эксплуатации", value: inUseCount, tone: "ok" },
            { label: "В ремонте", value: repairCount, tone: repairCount ? "warn" : "neutral" }
          ]}
        />
      ) : null}

      <div className="card campWorkspace">
        {message ? (
          <ResultBanner text={message} tone={message.includes("Не удалось") ? "error" : "neutral"} />
        ) : null}

        <nav className="toolsCatalogBreadcrumb toolbar" style={{ flexWrap: "wrap", marginBottom: 12 }}>
          <button
            type="button"
            className={navCategory === "hub" ? "primaryBtn" : "ghostBtn"}
            onClick={() => setNavCategory("hub")}
          >
            Все категории
          </button>
          {navCategory !== "hub" ? (
            <span className="muted">
              {" "}
              / {campCategoryLabel(navCategory)}
              <button type="button" className="ghostBtn" style={{ marginLeft: 8 }} onClick={() => setNavCategory("hub")}>
                ← Назад
              </button>
            </span>
          ) : null}
        </nav>

        {navCategory === "hub" ? (
          <div className="toolsHubGrid" role="navigation" aria-label="Категории городка">
            {CAMP_HUB_CARDS.map((card) => {
              const st = hubStats?.[card.id];
              const sub = st?.count != null ? `Всего ${st.count}` : card.hint;
              return (
                <button
                  key={card.id}
                  type="button"
                  className="toolsHubCard"
                  onClick={() => setNavCategory(card.id)}
                >
                  <span className="toolsHubCardIcon" aria-hidden>
                    {card.icon}
                  </span>
                  <span className="toolsHubCardLabel">{card.label}</span>
                  {sub ? <span className="toolsHubCardHint muted">{sub}</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="form docCenterForm" style={{ marginTop: navCategory === "hub" ? 16 : 8 }}>
          <label>
            Поиск
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="название, инв.№, серийный…"
              aria-label="Поиск по городку"
            />
          </label>
          <label>
            Статус
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "" | CampItemStatus)}>
              <option value="">Все статусы</option>
              {(Object.keys(statusLabel) as CampItemStatus[]).map((s) => (
                <option key={s} value={s}>
                  {statusLabel[s]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="toolbar scrollX" style={{ flexWrap: "wrap" }}>
          {canWrite ? (
            <button
              type="button"
              onClick={() => {
                resetCreateForm();
                setShowAddForm((s) => !s);
              }}
            >
              {showAddForm ? "Скрыть форму" : "+ Добавить позицию"}
            </button>
          ) : null}
          <button type="button" className="ghostBtn" onClick={() => void loadItems()}>
            Обновить
          </button>
          {filtersActive ? (
            <button
              type="button"
              className="ghostBtn"
              onClick={() => {
                setSearch("");
                setStatusFilter("");
                setNavCategory("hub");
              }}
            >
              Сбросить фильтры
            </button>
          ) : null}
        </div>

        {showAddForm && canWrite ? (
          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Новая позиция</h3>
            <div className="form docCenterForm">
              <label>
                Название*
                <input value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="Бытовка №3…" />
              </label>
              <label>
                Категория
                <select
                  value={createCategory}
                  onChange={(e) => setCreateCategory(e.target.value as CampItemCategory)}
                >
                  {CAMP_HUB_CARDS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Инвентаризационный №
                <input value={createInv} onChange={(e) => setCreateInv(e.target.value)} />
              </label>
              <label>
                Серийный №
                <input value={createSerial} onChange={(e) => setCreateSerial(e.target.value)} />
              </label>
              <label>
                Производитель
                <input value={createManufacturer} onChange={(e) => setCreateManufacturer(e.target.value)} />
              </label>
              <label>
                Размещение
                <input value={createLocation} onChange={(e) => setCreateLocation(e.target.value)} />
              </label>
              <label>
                Статус
                <select value={createStatus} onChange={(e) => setCreateStatus(e.target.value as CampItemStatus)}>
                  {(Object.keys(statusLabel) as CampItemStatus[]).map((s) => (
                    <option key={s} value={s}>
                      {statusLabel[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Фото и документы
                <input
                  type="file"
                  multiple
                  accept="image/*,application/pdf"
                  onChange={(e) => setCreateFiles(Array.from(e.target.files || []))}
                />
              </label>
              <label style={{ gridColumn: "1 / -1" }}>
                Описание
                <textarea rows={3} value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} />
              </label>
            </div>
            <div className="toolbar">
              <button type="button" onClick={() => void createItem()} disabled={creating || !createName.trim()}>
                {creating ? "Сохраняем…" : "Сохранить"}
              </button>
              <button
                type="button"
                className="ghostBtn"
                onClick={() => {
                  resetCreateForm();
                  setShowAddForm(false);
                }}
              >
                Отмена
              </button>
            </div>
          </div>
        ) : null}

        {!visibleItems.length ? (
          <EmptyState
            title="Городок пока пуст"
            hint="Примите имущество через заявку в приходах или добавьте позицию вручную."
          />
        ) : (
          <div className="campCardGrid">
            {visibleItems.map((c) => {
              const photos = Array.isArray(c.photos) ? c.photos : [];
              const documents = Array.isArray(c.documents) ? c.documents : [];
              const cover = photos[0];
              return (
                <button key={c.id} type="button" className="campCard" onClick={() => setSelected(c)}>
                  <div className="campCardCover">
                    {cover ? (
                      <img src={`${apiUrl}/${cover.filePath}`} alt={c.name} />
                    ) : (
                      <span className="campCardPlaceholder">{campCategoryIcon(c.category)}</span>
                    )}
                    <span className={`statusBadge ${statusTone[c.status]}`}>{statusLabel[c.status]}</span>
                  </div>
                  <div className="campCardBody">
                    <div className="campCardTitle">{c.name}</div>
                    {(() => {
                      const brief = (c.description || c.location || "").trim();
                      return brief ? <div className="campCardDesc">{brief}</div> : null;
                    })()}
                    <div className="muted campCardMeta">
                      {campCategoryLabel(c.category)}
                      {c.inventoryNumber ? ` · ${c.inventoryNumber}` : ""}
                    </div>
                    <div className="muted campCardMeta">
                      {c.section === "SS" ? "СС" : "ЭОМ"}
                      {c.warehouse ? ` · ${c.warehouse.name}` : ""}
                    </div>
                    <div className="muted campCardMeta">
                      📷 {photos.length} · 📎 {documents.length}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {selected ? (
        <CampItemDrawer
          item={selected}
          apiUrl={apiUrl}
          canWrite={canWrite}
          warehouses={warehouses}
          transferSection={transferSection}
          transferNote={transferNote}
          transferFiles={transferFiles}
          transferBusy={transferBusy}
          moveWarehouseId={moveWarehouseId}
          moveNote={moveNote}
          moveFiles={moveFiles}
          moveBusy={moveBusy}
          detailFiles={detailFiles}
          detailUploading={detailUploading}
          onClose={() => setSelected(null)}
          onUpdate={(patch) => void updateItem(selected.id, patch)}
          onDelete={() => void deleteItem(selected.id)}
          onUploadFiles={(files) => void uploadFiles(selected.id, files)}
          onDeleteFile={(fileId) => void deleteFile(selected.id, fileId)}
          onTransferSectionChange={setTransferSection}
          onTransferNoteChange={setTransferNote}
          onTransferFilesChange={setTransferFiles}
          onSubmitTransfer={() => void submitSectionTransfer(selected)}
          onMoveWarehouseChange={setMoveWarehouseId}
          onMoveNoteChange={setMoveNote}
          onMoveFilesChange={setMoveFiles}
          onSubmitMove={() => void submitWarehouseMove(selected)}
          onDetailFilesChange={setDetailFiles}
        />
      ) : null}
    </>
  );
}

type DrawerProps = {
  item: CampItemRow;
  apiUrl: string;
  canWrite: boolean;
  warehouses: Array<{ id: string; name: string }>;
  transferSection: "SS" | "EOM" | "";
  transferNote: string;
  transferFiles: File[];
  transferBusy: boolean;
  moveWarehouseId: string;
  moveNote: string;
  moveFiles: File[];
  moveBusy: boolean;
  detailFiles: File[];
  detailUploading: boolean;
  onClose: () => void;
  onUpdate: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  onUploadFiles: (files: File[]) => void;
  onDeleteFile: (fileId: string) => void;
  onTransferSectionChange: (v: "SS" | "EOM" | "") => void;
  onTransferNoteChange: (v: string) => void;
  onTransferFilesChange: (files: File[]) => void;
  onSubmitTransfer: () => void;
  onMoveWarehouseChange: (id: string) => void;
  onMoveNoteChange: (v: string) => void;
  onMoveFilesChange: (files: File[]) => void;
  onSubmitMove: () => void;
  onDetailFilesChange: (files: File[]) => void;
};

function CampItemDrawer({
  item: sel,
  apiUrl,
  canWrite,
  warehouses,
  transferSection,
  transferNote,
  transferFiles,
  transferBusy,
  moveWarehouseId,
  moveNote,
  moveBusy,
  detailFiles,
  detailUploading,
  onClose,
  onUpdate,
  onDelete,
  onUploadFiles,
  onDeleteFile,
  onTransferSectionChange,
  onTransferNoteChange,
  onTransferFilesChange,
  onSubmitTransfer,
  onMoveWarehouseChange,
  onMoveNoteChange,
  onMoveFilesChange,
  onSubmitMove,
  onDetailFilesChange
}: DrawerProps) {
  const selPhotos = Array.isArray(sel.photos) ? sel.photos : [];
  const selDocs = Array.isArray(sel.documents) ? sel.documents : [];
  const otherSection = sel.section === "SS" ? "EOM" : "SS";

  return (
    <div className="modalBackdrop" onClick={onClose} role="presentation">
      <div className="card campDrawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="rightCardHeader" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h3 style={{ marginTop: 0 }}>{sel.name}</h3>
            <p className="muted" style={{ margin: 0 }}>
              {campCategoryLabel(sel.category)}
              {sel.inventoryNumber ? ` · инв.№ ${sel.inventoryNumber}` : ""}
              {sel.serialNumber ? ` · S/N ${sel.serialNumber}` : ""}
            </p>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              {sel.section === "SS" ? "СС" : "ЭОМ"}
              {sel.warehouse ? ` · ${sel.warehouse.name}` : ""}
            </p>
          </div>
          <div className="toolbar scrollX" style={{ flexWrap: "wrap" }}>
            {canWrite ? (
              <select value={sel.status} onChange={(e) => onUpdate({ status: e.target.value })}>
                {(Object.keys(statusLabel) as CampItemStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {statusLabel[s]}
                  </option>
                ))}
              </select>
            ) : null}
            {canWrite ? (
              <button type="button" className="dangerBtn" onClick={onDelete}>
                Удалить
              </button>
            ) : null}
            <button type="button" className="ghostBtn" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>

        {selPhotos.length > 0 ? (
          <div className="campPhotoGrid">
            {selPhotos.map((p) => (
              <div key={p.id} className="campPhotoCell">
                <a href={`${apiUrl}/${p.filePath}`} target="_blank" rel="noreferrer">
                  <img src={`${apiUrl}/${p.filePath}`} alt={p.fileName} />
                </a>
                {canWrite ? (
                  <button type="button" className="ghostBtn campPhotoRemove" onClick={() => onDeleteFile(p.id)}>
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Фото пока нет.</p>
        )}

        <h4>Информация</h4>
        <div className="form docCenterForm">
          <label>
            Название
            <input
              defaultValue={sel.name}
              readOnly={!canWrite}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (canWrite && v && v !== sel.name) onUpdate({ name: v });
              }}
            />
          </label>
          <label>
            Категория
            <select
              value={sel.category}
              disabled={!canWrite}
              onChange={(e) => onUpdate({ category: e.target.value })}
            >
              {CAMP_HUB_CARDS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Инв. №
            <input
              defaultValue={sel.inventoryNumber || ""}
              readOnly={!canWrite}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (canWrite && v !== (sel.inventoryNumber || "")) onUpdate({ inventoryNumber: v });
              }}
            />
          </label>
          <label>
            Серийный №
            <input
              defaultValue={sel.serialNumber || ""}
              readOnly={!canWrite}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (canWrite && v !== (sel.serialNumber || "")) onUpdate({ serialNumber: v });
              }}
            />
          </label>
          <label>
            Размещение
            <input
              defaultValue={sel.location || ""}
              readOnly={!canWrite}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (canWrite && v !== (sel.location || "")) onUpdate({ location: v });
              }}
            />
          </label>
        </div>

        {canWrite ? (
          <>
            <h4>Передача между подразделениями (СС ↔ ЭОМ)</h4>
            <p className="muted" style={{ fontSize: 13 }}>
              Сейчас: {sel.section === "SS" ? "СС" : "ЭОМ"}. Передача в {otherSection === "SS" ? "СС" : "ЭОМ"} — с
              приложением документа.
            </p>
            <div className="form docCenterForm">
              <label>
                Куда передать
                <select
                  value={transferSection}
                  onChange={(e) => onTransferSectionChange(e.target.value as "SS" | "EOM" | "")}
                >
                  <option value="">—</option>
                  <option value={otherSection}>{otherSection === "SS" ? "СС" : "ЭОМ"}</option>
                </select>
              </label>
              <label>
                Комментарий
                <input value={transferNote} onChange={(e) => onTransferNoteChange(e.target.value)} />
              </label>
              <label>
                Документ*
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => onTransferFilesChange(Array.from(e.target.files || []))}
                />
              </label>
            </div>
            <button
              type="button"
              disabled={transferBusy || !transferSection || !transferFiles.length}
              onClick={onSubmitTransfer}
            >
              {transferBusy ? "Передаём…" : "Передать между подразделениями"}
            </button>

            <h4 style={{ marginTop: 20 }}>Перемещение на другой объект</h4>
            <div className="form docCenterForm">
              <label>
                Объект
                <select value={moveWarehouseId} onChange={(e) => onMoveWarehouseChange(e.target.value)}>
                  <option value="">—</option>
                  {warehouses
                    .filter((w) => w.id !== sel.warehouseId)
                    .map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Комментарий
                <input value={moveNote} onChange={(e) => onMoveNoteChange(e.target.value)} />
              </label>
              <label>
                Документ (необязательно)
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => onMoveFilesChange(Array.from(e.target.files || []))}
                />
              </label>
            </div>
            <button type="button" disabled={moveBusy || !moveWarehouseId} onClick={onSubmitMove}>
              {moveBusy ? "Перемещаем…" : "Переместить на объект"}
            </button>
          </>
        ) : null}

        <h4 style={{ marginTop: 16 }}>Документы</h4>
        {selDocs.length === 0 ? (
          <p className="muted">Документов пока нет.</p>
        ) : (
          <ul className="plainList">
            {selDocs.map((d) => (
              <li key={d.id} className="campDocRow">
                <span>
                  📎{" "}
                  <a href={`${apiUrl}/${d.filePath}`} target="_blank" rel="noreferrer">
                    {d.fileName}
                  </a>
                </span>
                {canWrite ? (
                  <button type="button" className="ghostBtn" onClick={() => onDeleteFile(d.id)}>
                    Удалить
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canWrite ? (
          <>
            <h4>Добавить фото / документы</h4>
            <div className="toolbar" style={{ flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="file"
                multiple
                accept="image/*,application/pdf"
                onChange={(e) => onDetailFilesChange(Array.from(e.target.files || []))}
              />
              <button
                type="button"
                disabled={detailUploading || !detailFiles.length}
                onClick={() => onUploadFiles(detailFiles)}
              >
                {detailUploading ? "Загружаем…" : detailFiles.length ? `Загрузить (${detailFiles.length})` : "Загрузить"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
