// Assembles a self-contained API runtime that the Tauri app ships and launches
// — no system Node, no source tree required on the target machine.
//
// Output: apps/admin-desktop/src-tauri/resources/
//   api/
//     node.exe        ← private Node runtime (copied from the build machine)
//     server.mjs      ← the esbuild bundle (all JS deps inlined)
//     node_modules/   ← portable install of the non-bundlable externals
//                       (better-sqlite3 native addon + @fastify/swagger-ui assets)
//   waiter/           ← waiter-web production build, served by the API at /waiter
//
// tauri.conf.json copies both folders into the app's resource dir; lib.rs spawns
// `api/node.exe api/server.mjs` with WAITER_DIST_PATH pointed at `waiter/`.

import {
  rmSync,
  mkdirSync,
  mkdtempSync,
  cpSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(apiRoot, "..", "..");
const resDir = join(repoRoot, "apps", "admin-desktop", "src-tauri", "resources");
const apiOut = join(resDir, "api");
const waiterOut = join(resDir, "waiter");

const installedVersion = (pkg) =>
  JSON.parse(readFileSync(join(apiRoot, "node_modules", pkg, "package.json"), "utf8")).version;

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit" });

// 1. Fresh staging dir
rmSync(resDir, { recursive: true, force: true });
mkdirSync(apiOut, { recursive: true });

// 2. Bundle the API and copy it in
run("node scripts/build-bundle.mjs", apiRoot);
copyFileSync(join(apiRoot, "build", "server.mjs"), join(apiOut, "server.mjs"));

// 3. Portable install of the externals that can't be bundled. A clean `npm
//    install` produces a flat, copy-safe node_modules (unlike pnpm's symlinks)
//    and fetches/builds the better-sqlite3 native binary for this platform.
//    It MUST run outside the repo: the root package.json has an npm-style
//    "workspaces" field, so npm run anywhere inside the tree would treat it as
//    a workspace root and clobber pnpm's node_modules. Install in an OS temp
//    dir, then copy the result into staging.
const runtimePkg = {
  name: "serva-api-runtime",
  private: true,
  version: "1.0.0",
  dependencies: {
    "better-sqlite3": installedVersion("better-sqlite3"),
    "@fastify/swagger-ui": installedVersion("@fastify/swagger-ui"),
  },
};
const tmp = mkdtempSync(join(tmpdir(), "serva-api-deps-"));
try {
  writeFileSync(join(tmp, "package.json"), JSON.stringify(runtimePkg, null, 2));
  run("npm install --omit=dev --no-audit --no-fund --no-package-lock --no-workspaces", tmp);
  cpSync(join(tmp, "node_modules"), join(apiOut, "node_modules"), { recursive: true });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
writeFileSync(join(apiOut, "package.json"), JSON.stringify(runtimePkg, null, 2));

// 4. Private Node runtime (same version/arch as the build machine)
copyFileSync(process.execPath, join(apiOut, "node.exe"));

// 5. waiter-web production build → resources/waiter. Use `exec vite build`
//    (not the package's `build` script) to mirror the root build:server path —
//    waiter-web's `tsc -b` step is skipped there too.
run("pnpm --filter waiter-web exec vite build", repoRoot);
cpSync(join(repoRoot, "apps", "waiter-web", "dist"), waiterOut, { recursive: true });

console.log(`\nAPI runtime staged at ${resDir}`);
