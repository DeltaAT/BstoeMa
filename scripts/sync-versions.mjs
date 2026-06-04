// Single source of truth for the version is the root package.json.
// This script copies that version into every workspace package.json and the
// Tauri Rust crate (Cargo.toml). The desktop installer/app version is read
// directly from the root package.json by tauri.conf.json, so this script only
// keeps the *other* manifests aligned. Run it via `pnpm version:sync`; it is
// also run automatically before `pnpm build` and `pnpm tauri:build`.
//
// To cut a release: bump "version" in the root package.json, nothing else.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const readJson = (path) => readFileSync(path, "utf8").replace(/^﻿/, "");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readJson(join(root, "package.json")));

const updated = [];

// Every apps/* and packages/* package.json
for (const ws of ["apps", "packages"]) {
  const base = join(root, ws);
  if (!existsSync(base)) continue;
  for (const name of readdirSync(base)) {
    const pkgPath = join(base, name, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readJson(pkgPath));
    if (pkg.version === version) continue;
    pkg.version = version;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    updated.push(`${ws}/${name}/package.json`);
  }
}

// Tauri Rust crate — Cargo needs a version and cannot read JSON itself.
const cargoPath = join(root, "apps", "admin-desktop", "src-tauri", "Cargo.toml");
if (existsSync(cargoPath)) {
  const cargo = readFileSync(cargoPath, "utf8");
  const next = cargo.replace(/^version = ".*"$/m, `version = "${version}"`);
  if (next !== cargo) {
    writeFileSync(cargoPath, next);
    updated.push("apps/admin-desktop/src-tauri/Cargo.toml");
  }
}

console.log(
  updated.length
    ? `Synced version ${version} to:\n  ${updated.join("\n  ")}`
    : `All manifests already at version ${version}`,
);
