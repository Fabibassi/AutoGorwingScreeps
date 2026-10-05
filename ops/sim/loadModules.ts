import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIST_ROOT } from "../buildModules";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function walkJs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkJs(full));
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Load built Screeps modules from dist/ as { moduleName: source }. */
export function loadDistModules(
  distRoot = DIST_ROOT,
): Record<string, string> {
  if (!existsSync(distRoot)) {
    throw new Error(`dist missing — run npm run build first (${distRoot})`);
  }
  const modules: Record<string, string> = {};
  for (const file of walkJs(distRoot)) {
    const rel = path.relative(distRoot, file).replace(/\\/g, "/");
    const moduleName = rel.replace(/\.js$/, "").replace(/\//g, ".");
    modules[moduleName] = readFileSync(file, "utf8");
  }
  if (!modules.main) {
    throw new Error("dist/main.js missing after build");
  }
  return modules;
}

export function simServerDir(instanceId: string): string {
  return path.join(ROOT, ".sim-servers", instanceId);
}
