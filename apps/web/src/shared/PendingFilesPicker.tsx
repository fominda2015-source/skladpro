import { useRef, type ReactNode } from "react";
import { fileIdentityKey, mergeFiles, removeFileAt } from "./mergeFiles";

type Props = {
  files: File[];
  onChange: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  addLabel?: string;
  hint?: ReactNode;
  className?: string;
  listClassName?: string;
};

export function PendingFilesPicker({
  files,
  onChange,
  accept,
  multiple = true,
  disabled,
  addLabel = "Добавить файлы",
  hint,
  className,
  listClassName
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files?.length) return;
    onChange(mergeFiles(files, Array.from(e.target.files)));
    e.target.value = "";
  }

  return (
    <div className={className}>
      {hint}
      <div className="toolbar" style={{ flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: hint ? 6 : 0 }}>
        <button type="button" className="ghostBtn" disabled={disabled} onClick={() => inputRef.current?.click()}>
          {addLabel}
        </button>
        <input
          ref={inputRef}
          type="file"
          className="chatHiddenFile"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={onPick}
        />
      </div>
      {files.length > 0 ? (
        <ul className={listClassName ?? "plainList"} style={{ marginTop: 6 }}>
          {files.map((file, index) => (
            <li
              key={`${fileIdentityKey(file)}-${index}`}
              className="muted"
              style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
            >
              <span>
                📎 {file.name} ({Math.max(1, Math.ceil(file.size / 1024))} КБ)
              </span>
              {!disabled ? (
                <button type="button" className="ghostBtn" onClick={() => onChange(removeFileAt(files, index))}>
                  Убрать
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
