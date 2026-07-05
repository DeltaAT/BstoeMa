// Bundles the Fastify API into a single ESM file so it can run under a private
// Node runtime inside the Tauri app — no system Node, no source tree needed.
//
// Everything is inlined EXCEPT:
//   - better-sqlite3      → native .node addon, cannot be bundled; shipped in
//                           node_modules alongside the bundle.
//   - @fastify/swagger-ui → loads its static UI assets from disk at runtime,
//                           so it must keep its real package layout.
// Those externals are copied next to the bundle by build-runtime.mjs.

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  entryPoints: [join(apiRoot, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: join(apiRoot, "build/server.mjs"),
  external: ["better-sqlite3", "@fastify/swagger-ui"],
  // ESM output needs CJS interop shims for dependencies that reach for
  // require()/__dirname/__filename at runtime.
  banner: {
    js: [
      "import { createRequire as __bstoema_cr } from 'node:module';",
      "import { fileURLToPath as __bstoema_fu } from 'node:url';",
      "import { dirname as __bstoema_dn } from 'node:path';",
      "const require = __bstoema_cr(import.meta.url);",
      "const __filename = __bstoema_fu(import.meta.url);",
      "const __dirname = __bstoema_dn(__filename);",
    ].join("\n"),
  },
  logLevel: "info",
});

console.log("Bundled API → apps/api/build/server.mjs");
