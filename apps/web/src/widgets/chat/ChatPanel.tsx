import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorState } from "../../shared/ui/StateViews";
import { PageHero } from "../ui/PageHero";
import { UserAvatar } from "./UserAvatar";

export type ChatUser = {
  id: string;
  fullName: string;
  avatarUrl?: string | null;
  role: string;
  position?: string | null;
};

export type ChatAttachment = {
  id: string;
  fileName: string;
  mimeType?: string | null;
  dataUrl: string;
};

export type ChatMessage = {
  id: string;
  text: string;
  createdAt: string;
  senderId: string;
  sender: { id: string; fullName: string };
  attachments: ChatAttachment[];
};

export type Conversation = {
  id: string;
  kind: "DM" | "FEEDBACK";
  participants: Array<{ user: ChatUser }>;
  messages: ChatMessage[];
};

function formatPosition(position: unknown): string {
  if (!position) return "";
  if (typeof position === "string") return position;
  if (typeof position === "object" && position !== null && "name" in position) {
    const name = (position as { name?: unknown }).name;
    return typeof name === "string" ? name : "";
  }
  return "";
}

function formatRole(role: unknown, roleLabel: (r: string) => string): string {
  if (typeof role === "string") return roleLabel(role);
  if (typeof role === "object" && role !== null && "name" in role) {
    const name = (role as { name?: unknown }).name;
    return typeof name === "string" ? roleLabel(name) : "";
  }
  return "";
}

type Props = {
  meId: string;
  users: ChatUser[];
  filteredUsers: ChatUser[];
  recent: Array<{ conversation: Conversation; peer?: ChatUser; last?: ChatMessage }>;
  dmByUserId: Map<string, Conversation>;
  messages: ChatMessage[];
  groupedMessages: Array<{ type: "date"; label: string } | { type: "message"; item: ChatMessage }>;
  peerUserId: string;
  search: string;
  text: string;
  attachment: File | null;
  error: string;
  loading: boolean;
  unreadTotal: number;
  viewedAt: Record<string, string>;
  quickReplies: string[];
  roleLabel: (role: string) => string;
  timeLabel: (iso?: string) => string;
  onSearchChange: (v: string) => void;
  onTextChange: (v: string) => void;
  onAttachmentChange: (f: File | null) => void;
  onSelectPeer: (userId: string) => void | Promise<void>;
  onBackToList: () => void;
  onSend: () => void | Promise<void>;
  onRefresh: () => void;
};

function useIsMobileChat(breakpoint = 720) {
  const [mobile, setMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(`(max-width: ${breakpoint}px)`).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return mobile;
}

export function ChatPanel({
  meId,
  users,
  filteredUsers,
  recent,
  dmByUserId,
  messages,
  groupedMessages,
  peerUserId,
  search,
  text,
  attachment,
  error,
  loading,
  unreadTotal,
  viewedAt,
  quickReplies,
  roleLabel,
  timeLabel,
  onSearchChange,
  onTextChange,
  onAttachmentChange,
  onSelectPeer,
  onBackToList,
  onSend,
  onRefresh
}: Props) {
  const isMobile = useIsMobileChat();
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const peer = useMemo(() => users.find((u) => u.id === peerUserId), [users, peerUserId]);
  const showThread = Boolean(peerUserId && peer);
  const showList = !isMobile || !showThread;

  useEffect(() => {
    const node = messagesRef.current;
    if (!node || !showThread) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, showThread, peerUserId]);

  const isPeerUnread = (convId: string, last?: ChatMessage) =>
    Boolean(
      last &&
        last.senderId !== meId &&
        new Date(last.createdAt) > new Date(viewedAt[convId] || 0)
    );

  return (
    <div className={`chatPage ${isMobile && showThread ? "chatPage--thread" : ""}`}>
      <PageHero
        variant="compact"
        icon="💬"
        title="Чат"
        subtitle="Личные сообщения с коллегами"
        stats={[
          { label: "Диалогов", value: recent.length, tone: "neutral" },
          { label: "Непрочитанных", value: unreadTotal, tone: unreadTotal > 0 ? "warn" : "neutral" }
        ]}
        actions={
          <button type="button" className="ghostBtn" onClick={onRefresh}>
            ↻ Обновить
          </button>
        }
      />

      {error ? <ErrorState text={error} /> : null}

      <div className="chatLayout">
        {showList ? (
          <aside className="chatSidebar" aria-label="Список диалогов">
            <div className="chatSidebarSearch">
              <input
                type="search"
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Поиск по имени или должности…"
                aria-label="Поиск сотрудника"
              />
            </div>

            {recent.length > 0 ? (
              <div className="chatSidebarSection">
                <span className="chatSidebarSectionTitle">Недавние</span>
                <ul className="chatContactList">
                  {recent.slice(0, 6).map((row) => {
                    if (!row.peer) return null;
                    const unread = isPeerUnread(row.conversation.id, row.last);
                    const active = row.peer.id === peerUserId;
                    return (
                      <li key={row.conversation.id}>
                        <button
                          type="button"
                          className={`chatContact ${active ? "active" : ""} ${unread ? "unread" : ""}`}
                          onClick={() => void onSelectPeer(row.peer!.id)}
                        >
                          <UserAvatar fullName={row.peer.fullName} avatarUrl={row.peer.avatarUrl} />
                          <span className="chatContactBody">
                            <span className="chatContactTop">
                              <strong>{row.peer.fullName}</strong>
                              <time>{timeLabel(row.last?.createdAt)}</time>
                            </span>
                            <span className="chatContactPreview">
                              {row.last?.text
                                ? row.last.text.slice(0, 48) + (row.last.text.length > 48 ? "…" : "")
                                : formatPosition(row.peer.position) ||
                                  formatRole(row.peer.role, roleLabel)}
                            </span>
                          </span>
                          {unread ? <span className="chatContactDot" aria-label="Непрочитано" /> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            <div className="chatSidebarSection chatSidebarSectionGrow">
              <span className="chatSidebarSectionTitle">Все сотрудники</span>
              <ul className="chatContactList">
                {filteredUsers.map((u) => {
                  const conv = dmByUserId.get(u.id);
                  const last = conv?.messages?.[0];
                  const unread = conv && last ? isPeerUnread(conv.id, last) : false;
                  const active = u.id === peerUserId;
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        className={`chatContact ${active ? "active" : ""} ${unread ? "unread" : ""}`}
                        onClick={() => void onSelectPeer(u.id)}
                      >
                        <UserAvatar fullName={u.fullName} avatarUrl={u.avatarUrl} />
                        <span className="chatContactBody">
                          <span className="chatContactTop">
                            <strong>{u.fullName}</strong>
                            <time>{timeLabel(last?.createdAt)}</time>
                          </span>
                          <span className="chatContactPreview muted">
                            {last?.text
                              ? last.text.slice(0, 48) + (last.text.length > 48 ? "…" : "")
                              : formatPosition(u.position) || formatRole(u.role, roleLabel)}
                          </span>
                        </span>
                        {unread ? <span className="chatContactDot" aria-label="Непрочитано" /> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!filteredUsers.length ? <p className="muted chatSidebarEmpty">Никого не найдено</p> : null}
            </div>
          </aside>
        ) : null}

        {showThread ? (
          <section className="chatThread" aria-label="Переписка">
            <header className="chatThreadHead">
              {isMobile ? (
                <button type="button" className="ghostBtn chatBackBtn" onClick={onBackToList}>
                  ← Назад
                </button>
              ) : null}
              <UserAvatar fullName={peer!.fullName} avatarUrl={peer!.avatarUrl} size="lg" />
              <div className="chatThreadHeadText">
                <strong>{peer!.fullName}</strong>
                <span className="muted">
                  {formatPosition(peer!.position) || formatRole(peer!.role, roleLabel)}
                </span>
              </div>
            </header>

            <div className="chatThreadMessages" ref={messagesRef}>
              {loading ? (
                <div className="chatThreadLoading">
                  <div className="chatSkeleton" />
                  <div className="chatSkeleton short" />
                  <div className="chatSkeleton" />
                </div>
              ) : groupedMessages.length ? (
                groupedMessages.map((row, idx) =>
                  row.type === "date" ? (
                    <div key={`d-${idx}`} className="chatDateDivider">
                      {row.label}
                    </div>
                  ) : (
                    <div
                      key={row.item.id}
                      className={`chatBubble ${row.item.senderId === meId ? "mine" : "theirs"}`}
                    >
                      {row.item.senderId !== meId ? (
                        <span className="chatBubbleSender">{row.item.sender.fullName}</span>
                      ) : null}
                      {row.item.text ? <p className="chatBubbleText">{row.item.text}</p> : null}
                      {row.item.attachments?.map((a) => (
                        <a
                          key={a.id}
                          href={a.dataUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="chatAttachmentLink"
                        >
                          📎 {a.fileName}
                        </a>
                      ))}
                      <time className="chatBubbleTime">{timeLabel(row.item.createdAt)}</time>
                    </div>
                  )
                )
              ) : (
                <div className="chatThreadEmpty">
                  <p>Начните диалог — напишите первое сообщение.</p>
                </div>
              )}
            </div>

            <footer className="chatThreadComposer">
              <div className="chatQuickReplies">
                {quickReplies.map((q) => (
                  <button key={q} type="button" className="ghostBtn" onClick={() => onTextChange(q)}>
                    {q}
                  </button>
                ))}
              </div>
              <div className="chatComposerRow">
                <button
                  type="button"
                  className="ghostBtn chatAttachBtn"
                  title="Вложение"
                  onClick={() => fileInputRef.current?.click()}
                >
                  📎
                </button>
                <input
                  ref={fileInputRef}
                  className="chatHiddenFile"
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => onAttachmentChange(e.target.files?.[0] || null)}
                />
                <textarea
                  className="chatComposerInput"
                  value={text}
                  onChange={(e) => onTextChange(e.target.value)}
                  placeholder="Сообщение…"
                  rows={1}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void onSend();
                    }
                  }}
                />
                <button
                  type="button"
                  className="primaryBtn chatSendBtn"
                  disabled={!text.trim() && !attachment}
                  onClick={() => void onSend()}
                >
                  Отправить
                </button>
              </div>
              {attachment ? (
                <div className="chatAttachmentBar">
                  <span>{attachment.name}</span>
                  <button type="button" className="ghostBtn" onClick={() => onAttachmentChange(null)}>
                    Убрать
                  </button>
                </div>
              ) : null}
            </footer>
          </section>
        ) : (
          <section className="chatThread chatThread--placeholder" aria-hidden={isMobile}>
            <div className="chatPlaceholder">
              <span className="chatPlaceholderIcon" aria-hidden>
                💬
              </span>
              <h3>Выберите собеседника</h3>
              <p className="muted">Слева список коллег — откройте диалог, чтобы переписываться.</p>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
