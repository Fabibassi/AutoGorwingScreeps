/**
 * Thin wrapper so `node esbuild.config.mjs` still works.
 * Multi-module Screeps build lives in ops/buildModules.ts.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const result = spawnSync(
  process.execPath,
  [tsxCli, path.join(root, "ops", "buildModules.ts")],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
