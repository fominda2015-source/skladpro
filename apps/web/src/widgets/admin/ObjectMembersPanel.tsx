import { useEffect, useMemo, useState } from "react";

export type ObjectMember = {
  userId: string;
  sections: ("SS" | "EOM")[] | null;
};

type UserOption = {
  id: string;
  fullName: string;
  avatarUrl?: string | null;
};

type Props = {
  objectId: string;
  users: UserOption[];
  members: ObjectMember[];
  onSave: (members: ObjectMember[]) => Promise<boolean>;
};

function memberSections(member: ObjectMember) {
  if (!member.sections?.length || member.sections.length >= 2) {
    return { ss: true, eom: true };
  }
  return { ss: member.sections.includes("SS"), eom: member.sections.includes("EOM") };
}

function sectionsFromFlags(ss: boolean, eom: boolean): ("SS" | "EOM")[] | null {
  if (ss && eom) return null;
  if (ss) return ["SS"];
  if (eom) return ["EOM"];
  return [];
}

function sectionLabel(member: ObjectMember) {
  const { ss, eom } = memberSections(member);
  if (ss && eom) return "СС + ЭОМ";
  if (ss) return "только СС";
  return "только ЭОМ";
}

export function ObjectMembersPanel({ objectId, users, members, onSave }: Props) {
  const [draft, setDraft] = useState<ObjectMember[]>(members);
  const [pickUserId, setPickUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const membersKey = useMemo(
    () =>
      members
        .map((m) => `${m.userId}:${m.sections?.slice().sort().join(",") ?? "both"}`)
        .sort()
        .join("|"),
    [members]
  );

  useEffect(() => {
    setDraft(members);
    setError("");
  }, [membersKey, members]);

  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const memberIds = new Set(draft.map((m) => m.userId));
  const availableToAdd = users.filter((u) => !memberIds.has(u.id));
  const dirty =
    draft.length !== members.length ||
    draft.some((m) => {
      const orig = members.find((x) => x.userId === m.userId);
      if (!orig) return true;
      const a = m.sections?.slice().sort().join(",") ?? "both";
      const b = orig.sections?.slice().sort().join(",") ?? "both";
      return a !== b;
    }) ||
    members.some((m) => !draft.find((x) => x.userId === m.userId));

  function updateMember(userId: string, ss: boolean, eom: boolean) {
    const sections = sectionsFromFlags(ss, eom);
    if (!sections?.length && sections !== null) {
      setDraft((prev) => prev.filter((m) => m.userId !== userId));
      return;
    }
    setDraft((prev) =>
      prev.map((m) => (m.userId === userId ? { userId, sections } : m))
    );
  }

  function removeMember(userId: string) {
    setDraft((prev) => prev.filter((m) => m.userId !== userId));
  }

  function addMember(userId: string) {
    if (!userId || memberIds.has(userId)) return;
    setDraft((prev) => [...prev, { userId, sections: null }]);
    setPickUserId("");
  }

  async function handleSave() {
    const invalid = draft.some((m) => {
      const { ss, eom } = memberSections(m);
      return !ss && !eom;
    });
    if (invalid) {
      setError("У каждого участника должен быть выбран хотя бы один раздел");
      return;
    }
    setBusy(true);
    setError("");
    const ok = await onSave(draft);
    setBusy(false);
    if (!ok) {
      setError("Не удалось сохранить участников");
    }
  }

  return (
    <div className="objectMembersPanel" data-object-id={objectId}>
      <p className="muted objectMembersHint">
        Участники объекта и доступ к разделам СС/ЭОМ. Если отмечены оба раздела — полный доступ.
      </p>
      {draft.length ? (
        <div className="objectMembersList">
          {draft.map((member) => {
            const user = userById.get(member.userId);
            const { ss, eom } = memberSections(member);
            return (
              <div key={`member-${objectId}-${member.userId}`} className="objectMemberRow">
                <div className="objectMemberUser">
                  <span className="objectMemberName">{user?.fullName || member.userId}</span>
                  <span className="objectMemberScope muted">{sectionLabel(member)}</span>
                </div>
                <div className="objectMemberSections" role="group" aria-label="Разделы доступа">
                  <label className="objectMemberSectionCheck">
                    <input
                      type="checkbox"
                      checked={ss}
                      onChange={(e) => updateMember(member.userId, e.target.checked, eom)}
                    />
                    СС
                  </label>
                  <label className="objectMemberSectionCheck">
                    <input
                      type="checkbox"
                      checked={eom}
                      onChange={(e) => updateMember(member.userId, ss, e.target.checked)}
                    />
                    ЭОМ
                  </label>
                </div>
                <button
                  type="button"
                  className="ghostBtn objectMemberRemove"
                  onClick={() => removeMember(member.userId)}
                  aria-label="Убрать из объекта"
                >
                  Убрать
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">Пока нет привязанных пользователей</p>
      )}
      <div className="toolbar objectMembersToolbar">
        <select value={pickUserId} onChange={(e) => setPickUserId(e.target.value)}>
          <option value="">Добавить пользователя…</option>
          {availableToAdd.map((u) => (
            <option key={`add-${objectId}-${u.id}`} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </select>
        <button type="button" disabled={!pickUserId} onClick={() => addMember(pickUserId)}>
          Добавить
        </button>
        <button type="button" disabled={!dirty || busy} onClick={() => void handleSave()}>
          {busy ? "Сохранение…" : "Сохранить доступ"}
        </button>
      </div>
      {error ? <p className="formError">{error}</p> : null}
    </div>
  );
}
