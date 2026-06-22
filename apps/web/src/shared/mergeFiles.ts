export function fileIdentityKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

/** Добавляет новые файлы к списку без дубликатов (по имени, размеру и дате изменения). */
export function mergeFiles(current: File[], incoming: File[]): File[] {
  const seen = new Set(current.map(fileIdentityKey));
  const next = [...current];
  for (const file of incoming) {
    const key = fileIdentityKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(file);
  }
  return next;
}

export function removeFileAt(files: File[], index: number): File[] {
  return files.filter((_, i) => i !== index);
}
