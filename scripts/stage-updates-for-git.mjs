import { existsSync, mkdirSync, readdirSync, copyFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const bundleDir = path.join(root, "release", "install-bundle");
const gitUpdatesDir = path.join(root, "updates", "win", "x64");

if (!existsSync(bundleDir)) {
  throw new Error(`Install bundle not found: ${bundleDir}. Run "npm run release:bundle" first.`);
}

mkdirSync(gitUpdatesDir, { recursive: true });

for (const name of readdirSync(gitUpdatesDir)) {
  if (name === ".gitkeep") continue;
  rmSync(path.join(gitUpdatesDir, name), { recursive: true, force: true });
}

const files = readdirSync(bundleDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => /\.(exe|blockmap|yml|yaml|txt)$/i.test(name));

for (const name of files) {
  copyFileSync(path.join(bundleDir, name), path.join(gitUpdatesDir, name));
}

console.log(`[release:git-channel] files staged: ${files.length}`);
console.log(`[release:git-channel] path: ${gitUpdatesDir}`);
