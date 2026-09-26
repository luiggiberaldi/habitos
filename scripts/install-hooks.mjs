#!/usr/bin/env node
// Instala el hook pre-commit del repo en .git/hooks.
// Se ejecuta solo vía `npm install` (script "prepare" en package.json).
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

let gitDir;
try {
  gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
} catch {
  console.log("install-hooks: sin repo git, nada que instalar");
  process.exit(0);
}

const hooksDir = join(root, gitDir, "hooks");
mkdirSync(hooksDir, { recursive: true });
const src = join(root, "scripts", "pre-commit");
const dest = join(hooksDir, "pre-commit");
if (!existsSync(src)) {
  console.log("install-hooks: no existe scripts/pre-commit");
  process.exit(1);
}
copyFileSync(src, dest);
chmodSync(dest, 0o755);
console.log("install-hooks: hook pre-commit instalado");
