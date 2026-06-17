import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ErrorState } from "../../shared/ui/StateViews";
import { PageFileDropZone } from "../../shared/ui/PageFileDropZone";
import { useViewportContext } from "../layout/ViewportRoot";
import { UserAvatar } from "./UserAvatar";
import { ChatComposer } from "./ChatComposer";
import { ChatImageLightbox } from "./ChatImageLightbox";
import { appendChatFiles, isImageAttachment } from "./chatFiles";

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
  myLastReadAt?: string | null;
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
  attachments: File[];
  error: string;
  loading: boolean;
  unreadTotal: number;
  quickReplies: string[];
  roleLabel: (role: string) => string;
  timeLabel: (iso?: string) => string;
  onSearchChange: (v: string) => void;
  onTextChange: (v: string) => void;
  onAttachmentsChange: (files: File[]) => void;
  onFileReject?: (reason: string) => void;
  onSelectPeer: (userId: string) => void | Promise<void>;
  onBackToList: () => void;
  onSend: () => void | Promise<void>;
  onRefresh: () => void;
  onPeerProfileClick: (userId: string) => void;
};

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
  attachments,
  error,
  loading,
  unreadTotal,
  quickReplies,
  roleLabel,
  timeLabel,
  onSearchChange,
  onTextChange,
  onAttachmentsChange,
  onFileReject,
  onSelectPeer,
  onBackToList,
  onSend,
  onRefresh,
  onPeerProfileClick
}: Props) {
  const { isMobile, isCompact } = useViewportContext();
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [imageLightbox, setImageLightbox] = useState<{ src: string; alt: string } | null>(null);

  const peer = useMemo(() => users.find((u) => u.id === peerUserId), [users, peerUserId]);
  const canSend = Boolean(text.trim() || attachments.length);
  const showThread = Boolean(peerUserId && peer);
  /** На телефоне и компактных экранах — диалог на всю вкладку, список скрываем. */
  const threadFocus = (isMobile || isCompact) && showThread;
  const showList = !threadFocus;

  const updateScrollDownVisibility = useCallback(() => {
    const node = messagesRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    const atBottom = distance < 72;
    setShowScrollDown(!atBottom);
    stickToBottomRef.current = atBottom;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const node = messagesRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior });
    bottomRef.current?.scrollIntoView({ block: "end", behavior });
    updateScrollDownVisibility();
  }, [updateScrollDownVisibility]);

  useEffect(() => {
    stickToBottomRef.current = true;
    setShowScrollDown(false);
  }, [peerUserId]);

  useEffect(() => {
    if (!showThread || loading) return;
    stickToBottomRef.current = true;
    scrollToBottom("auto");
    const timers = [0, 50, 150, 350].map((ms) => window.setTimeout(() => scrollToBottom("auto"), ms));
    return () => {
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [peerUserId, loading, showThread, scrollToBottom]);

  useEffect(() => {
    if (!showThread || loading || !stickToBottomRef.current) return;
    scrollToBottom("auto");
  }, [messages, groupedMessages, showThread, loading, scrollToBottom]);

  useEffect(() => {
    const node = messagesRef.current;
    if (!node || !showThread) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        scrollToBottom("auto");
      } else {
        updateScrollDownVisibility();
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [showThread, scrollToBottom, updateScrollDownVisibility]);

  const isPeerUnread = (last?: ChatMessage, lastReadAt?: string | null) =>
    Boolean(
      last &&
        last.senderId !== meId &&
        new Date(last.createdAt) > new Date(lastReadAt || 0)
    );

  return (
    <div
      className={[
        "chatPage",
        threadFocus ? "chatPage--thread" : "",
        showList && !showThread ? "chatPage--list" : ""
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {!threadFocus ? (
        <header className="chatToolbar" aria-label="Чат">
          <div className="chatToolbarMain">
            <span className="chatToolbarIcon" aria-hidden>
              💬
            </span>
            <div className="chatToolbarText">
              <strong>Чат</strong>
              <span className="muted">Личные сообщения</span>
            </div>
          </div>
          <div className="chatToolbarMeta">
            {unreadTotal > 0 ? (
              <span className="chatToolbarBadge" title="Непрочитанных">
                {unreadTotal > 99 ? "99+" : unreadTotal}
              </span>
            ) : null}
            <span className="chatToolbarStat muted">
              {recent.length} {recent.length === 1 ? "диалог" : recent.length < 5 ? "диалога" : "диалогов"}
            </span>
            <button type="button" className="ghostBtn chatToolbarRefresh" onClick={onRefresh}>
              ↻
            </button>
          </div>
        </header>
      ) : null}

      {error ? (
        <div className="chatPageError">
          <ErrorState text={error} />
        </div>
      ) : null}

      <PageFileDropZone
        className="chatPageDropZone"
        enabled={showThread && Boolean(peer)}
        multiple
        overlayLabel="Отпустите файлы — добавим во вложения"
        overlayHint="Изображения и PDF"
        onFiles={(files) => appendChatFiles(attachments, files, onAttachmentsChange, onFileReject)}
      >
      <div className={`chatLayout${threadFocus ? " chatLayout--threadFocus" : ""}`}>
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
                    const unread = isPeerUnread(row.last, row.conversation.myLastReadAt);
                    const active = row.peer.id === peerUserId;
                    return (
                      <li key={row.conversation.id}>
                        <div
                          className={`chatContact ${active ? "active" : ""} ${unread ? "unread" : ""}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => void onSelectPeer(row.peer!.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              void onSelectPeer(row.peer!.id);
                            }
                          }}
                        >
                          <UserAvatar
                            fullName={row.peer.fullName}
                            avatarUrl={row.peer.avatarUrl}
                            onClick={(e) => {
                              e.stopPropagation();
                              onPeerProfileClick(row.peer!.id);
                            }}
                          />
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
                        </div>
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
                  const unread = conv && last ? isPeerUnread(last, conv.myLastReadAt) : false;
                  const active = u.id === peerUserId;
                  return (
                    <li key={u.id}>
                      <div
                        className={`chatContact ${active ? "active" : ""} ${unread ? "unread" : ""}`}
                        role="button"
                        tabIndex={0}
                        onClick={() => void onSelectPeer(u.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            void onSelectPeer(u.id);
                          }
                        }}
                      >
                        <UserAvatar
                          fullName={u.fullName}
                          avatarUrl={u.avatarUrl}
                          onClick={(e) => {
                            e.stopPropagation();
                            onPeerProfileClick(u.id);
                          }}
                        />
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
                      </div>
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
              {threadFocus ? (
                <button type="button" className="ghostBtn chatBackBtn" onClick={onBackToList}>
                  ← Назад
                </button>
              ) : null}
              <UserAvatar
                fullName={peer!.fullName}
                avatarUrl={peer!.avatarUrl}
                size="lg"
                onClick={() => onPeerProfileClick(peer!.id)}
              />
              <div className="chatThreadHeadText">
                <strong>{peer!.fullName}</strong>
                <span className="muted">
                  {formatPosition(peer!.position) || formatRole(peer!.role, roleLabel)}
                </span>
              </div>
            </header>

            <div
              className="chatThreadMessages"
              ref={messagesRef}
              onScroll={updateScrollDownVisibility}
            >
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
                      {row.item.attachments?.map((a) =>
                        isImageAttachment(a.mimeType, a.fileName) ? (
                          <button
                            key={a.id}
                            type="button"
                            className="chatBubbleImageBtn"
                            title="Открыть изображение"
                            onClick={() => setImageLightbox({ src: a.dataUrl, alt: a.fileName })}
                          >
                            <img src={a.dataUrl} alt={a.fileName} className="chatBubbleImage" loading="lazy" />
                          </button>
                        ) : (
                          <a
                            key={a.id}
                            href={a.dataUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="chatAttachmentLink"
                          >
                            📎 {a.fileName}
                          </a>
                        )
                      )}
                      <time className="chatBubbleTime">{timeLabel(row.item.createdAt)}</time>
                    </div>
                  )
                )
              ) : (
                <div className="chatThreadEmpty">
                  <p>Начните диалог — напишите первое сообщение.</p>
                </div>
              )}
              <div ref={bottomRef} aria-hidden="true" style={{ height: 1, flexShrink: 0 }} />
            </div>

            {showScrollDown ? (
              <button
                type="button"
                className="chatScrollDownBtn"
                aria-label="Прокрутить к последним сообщениям"
                title="К последним сообщениям"
                onClick={() => {
                  stickToBottomRef.current = true;
                  scrollToBottom("smooth");
                }}
              >
                ↓
              </button>
            ) : null}

            <ChatComposer
              text={text}
              attachments={attachments}
              quickReplies={quickReplies}
              canSend={canSend}
              onTextChange={onTextChange}
              onAttachmentsChange={onAttachmentsChange}
              onSend={onSend}
              onFileReject={onFileReject}
            />
          </section>
        ) : (
          <section className="chatThread chatThread--placeholder" aria-hidden={threadFocus}>
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
      </PageFileDropZone>

      {imageLightbox ? (
        <ChatImageLightbox
          src={imageLightbox.src}
          alt={imageLightbox.alt}
          onClose={() => setImageLightbox(null)}
        />
      ) : null}
    </div>
  );
}
