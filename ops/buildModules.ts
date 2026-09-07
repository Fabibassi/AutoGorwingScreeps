import * as esbuild from "esbuild";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SRC_ROOT = path.join(ROOT, "src");
export const DIST_ROOT = path.join(ROOT, "dist");

/**
 * Map a TypeScript source path under `src/` to a Screeps module name.
 * `src/main.ts` → `main`
 * `src/roles/harvester.ts` → `roles.harvester`
 * `src/roles/index.ts` → `roles`
 */
export function pathToModuleName(filePath: string, srcRoot = SRC_ROOT): string {
  const abs = path.resolve(filePath);
  const rel = path.relative(srcRoot, abs).replace(/\\/g, "/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`not under src: ${filePath}`);
  }
  let withoutExt = rel.replace(/\.tsx?$/, "");
  if (withoutExt.endsWith("/index")) {
    withoutExt = withoutExt.slice(0, -"/index".length);
  }
  if (!withoutExt) {
    throw new Error(`cannot map index at src root: ${filePath}`);
  }
  return withoutExt.split("/").filter(Boolean).join(".");
}

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkTsFiles(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

export function discoverEntries(
  srcRoot = SRC_ROOT,
): { file: string; moduleName: string }[] {
  return walkTsFiles(srcRoot)
    .map((file) => ({ file, moduleName: pathToModuleName(file, srcRoot) }))
    .sort((a, b) => a.moduleName.localeCompare(b.moduleName));
}

/** Resolve a relative import to an absolute `.ts` file under src, if any. */
export function resolveSrcImport(
  importer: string,
  importPath: string,
  srcRoot = SRC_ROOT,
): string | null {
  if (!importPath.startsWith(".")) return null;
  const base = path.resolve(path.dirname(importer), importPath);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    const rel = path.relative(srcRoot, candidate);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) continue;
    if (!candidate.endsWith(".ts") && !candidate.endsWith(".tsx")) continue;
    return candidate;
  }
  return null;
}

function screepsExternalPlugin(
  entryModuleName: string,
  srcRoot: string,
): esbuild.Plugin {
  return {
    name: "screeps-external-modules",
    setup(build) {
      build.onResolve({ filter: /^\.\.?(\/|$)/ }, (args) => {
        if (!args.importer) return null;
        const resolved = resolveSrcImport(args.importer, args.path, srcRoot);
        if (!resolved) return null;
        const moduleName = pathToModuleName(resolved, srcRoot);
        if (moduleName === entryModuleName) return null;
        return { path: moduleName, external: true };
      });
    },
  };
}

export async function buildAllModules(opts?: {
  srcRoot?: string;
  distRoot?: string;
}): Promise<string[]> {
  const srcRoot = opts?.srcRoot ?? SRC_ROOT;
  const distRoot = opts?.distRoot ?? DIST_ROOT;
  const entries = discoverEntries(srcRoot);

  rmSync(distRoot, { recursive: true, force: true });
  mkdirSync(distRoot, { recursive: true });

  await Promise.all(
    entries.map(({ file, moduleName }) =>
      esbuild.build({
        entryPoints: [file],
        outfile: path.join(distRoot, `${moduleName}.js`),
        bundle: true,
        platform: "neutral",
        format: "cjs",
        target: "es2019",
        sourcemap: false,
        legalComments: "none",
        plugins: [screepsExternalPlugin(moduleName, srcRoot)],
      }),
    ),
  );

  return entries.map((e) => e.moduleName);
}

/** Read every `*.js` in dist as Screeps moduleName → source. */
export function loadDistModules(distRoot = DIST_ROOT): Record<string, string> {
  if (!existsSync(distRoot)) {
    throw new Error(`${distRoot} missing — run npm run build`);
  }
  const modules: Record<string, string> = {};
  for (const name of readdirSync(distRoot)) {
    if (!name.endsWith(".js")) continue;
    const moduleName = name.slice(0, -".js".length);
    modules[moduleName] = readFileSync(path.join(distRoot, name), "utf8");
  }
  return modules;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const names = await buildAllModules();
  console.log(`built ${names.length} modules: ${names.join(", ")}`);
}
