import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const desktopReleaseDir = path.join(root, "apps", "desktop", "release");
const bundleDir = path.join(root, "release", "install-bundle");

if (!existsSync(desktopReleaseDir)) {
  throw new Error(`Desktop release dir not found: ${desktopReleaseDir}`);
}

rmSync(bundleDir, { recursive: true, force: true });
mkdirSync(bundleDir, { recursive: true });

const releaseFiles = readdirSync(desktopReleaseDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => /\.(exe|blockmap|yml|yaml|zip)$/i.test(name));

for (const file of releaseFiles) {
  copyFileSync(path.join(desktopReleaseDir, file), path.join(bundleDir, file));
}

const readmePath = path.join(bundleDir, "INSTALL-README.txt");
const lines = [
  "SkladPro Windows installer bundle",
  "",
  "Что внутри:",
  "- *.exe: инсталлер",
  "- latest*.yml: metadata обновлений",
  "- *.blockmap / *.zip: служебные файлы обновлений",
  "",
  "Установка:",
  "1) Запустите .exe",
  "2) Следуйте шагам мастера установки",
  "",
  "Если SmartScreen предупреждает, нажмите 'Подробнее' -> 'Выполнить в любом случае'."
];

writeFileSync(readmePath, lines.join("\n"), "utf8");
console.log(`[release:bundle] files copied: ${releaseFiles.length}`);
console.log(`[release:bundle] output: ${bundleDir}`);
