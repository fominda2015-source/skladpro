import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export function resolveActsDir(): string {
  if (process.env.ACTS_DIR) {
    return path.resolve(process.env.ACTS_DIR);
  }
  return path.resolve(process.cwd(), config.uploadsDir, "acts");
}

function seedSourceDirs(): string[] {
  const cwd = process.cwd();
  return [
    path.resolve(cwd, "seed/acts"),
    path.resolve(cwd, "../web/public/acts"),
    path.resolve(moduleDir, "../../seed/acts")
  ];
}

function legacyActsDir(): string {
  return path.resolve(process.cwd(), "../web/public/acts");
}

function copySeedFiles(targetDir: string): number {
  let copied = 0;
  const sources = [...seedSourceDirs(), legacyActsDir()];
  for (const sourceDir of sources) {
    if (!fs.existsSync(sourceDir)) continue;
    for (const name of fs.readdirSync(sourceDir)) {
      if (!/\.(xlsx|xls)$/i.test(name)) continue;
      const src = path.join(sourceDir, name);
      const dest = path.join(targetDir, name);
      if (fs.existsSync(dest)) continue;
      try {
        fs.copyFileSync(src, dest);
        copied += 1;
      } catch {
        // skip unreadable entries
      }
    }
  }
  return copied;
}

let ensured = false;

/** Persistent acts dir (uploads volume in Docker) + one-time copy of bundled templates. */
export function ensureActsStorage(): string {
  const actsDir = resolveActsDir();
  if (!fs.existsSync(actsDir)) {
    fs.mkdirSync(actsDir, { recursive: true });
  }
  if (!ensured) {
    copySeedFiles(actsDir);
    ensured = true;
  }
  return actsDir;
}
