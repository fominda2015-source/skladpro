/** Лимит API: dataUrl max 500_000 символов — оставляем запас под base64. */
export const CHAT_ATTACHMENT_MAX_CHARS = 480_000;

export const CHAT_FILE_ACCEPT = "image/*,.pdf,application/pdf";

export function isChatFileAllowed(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  if (t.startsWith("image/")) return true;
  if (t === "application/pdf" || t === "application/x-pdf") return true;
  if (!t && /\.(png|jpe?g|gif|webp|bmp|pdf)$/i.test(file.name)) return true;
  return false;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("file_read_error"));
    reader.readAsDataURL(file);
  });
}

export async function fileToChatAttachmentPayload(file: File): Promise<{
  fileName: string;
  mimeType: string;
  dataUrl: string;
}> {
  const dataUrl = await readFileAsDataUrl(file);
  if (dataUrl.length > CHAT_ATTACHMENT_MAX_CHARS) {
    throw new Error("FILE_TOO_LARGE");
  }
  return {
    fileName: file.name || "file",
    mimeType: file.type || "application/octet-stream",
    dataUrl
  };
}

export function pickFilesFromClipboard(clipboard: DataTransfer | null): File[] {
  if (!clipboard) return [];
  const out: File[] = [];
  const items = clipboard.items;
  if (items?.length) {
    for (const item of items) {
      if (item.kind !== "file") continue;
      const f = item.getAsFile();
      if (f && isChatFileAllowed(f)) out.push(f);
    }
  }
  if (!out.length && clipboard.files?.length) {
    for (const f of Array.from(clipboard.files)) {
      if (isChatFileAllowed(f)) out.push(f);
    }
  }
  return out;
}

export function mergeChatFiles(current: File[], incoming: File[]): File[] {
  const seen = new Set(current.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
  const next = [...current];
  for (const f of incoming) {
    const key = `${f.name}:${f.size}:${f.lastModified}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(f);
  }
  return next;
}

export function isImageAttachment(mimeType?: string | null, fileName?: string): boolean {
  if (mimeType?.startsWith("image/")) return true;
  return Boolean(fileName && /\.(png|jpe?g|gif|webp|bmp)$/i.test(fileName));
}
