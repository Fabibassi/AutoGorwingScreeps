import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  buildAllModules,
  discoverEntries,
  loadDistModules,
  pathToModuleName,
  resolveSrcImport,
  SRC_ROOT,
} from "../ops/buildModules";

describe("pathToModuleName", () => {
  test("maps main and nested files", () => {
    expect(pathToModuleName(path.join(SRC_ROOT, "main.ts"))).toBe("main");
    expect(
      pathToModuleName(path.join(SRC_ROOT, "roles", "harvester.ts")),
    ).toBe("roles.harvester");
    expect(pathToModuleName(path.join(SRC_ROOT, "roles", "index.ts"))).toBe(
      "roles",
    );
    expect(
      pathToModuleName(path.join(SRC_ROOT, "loop", "recoverTelemetry.ts")),
    ).toBe("loop.recoverTelemetry");
  });
});

describe("resolveSrcImport", () => {
  test("resolves folder index and sibling files", () => {
    const main = path.join(SRC_ROOT, "main.ts");
    expect(resolveSrcImport(main, "./roles")).toBe(
      path.join(SRC_ROOT, "roles", "index.ts"),
    );
    expect(resolveSrcImport(main, "./spawn")).toBe(
      path.join(SRC_ROOT, "spawn.ts"),
    );
    const rolesIndex = path.join(SRC_ROOT, "roles", "index.ts");
    expect(resolveSrcImport(rolesIndex, "./harvester")).toBe(
      path.join(SRC_ROOT, "roles", "harvester.ts"),
    );
  });
});

describe("discoverEntries", () => {
  test("includes expected Screeps modules", () => {
    const names = discoverEntries().map((e) => e.moduleName);
    expect(names).toContain("main");
    expect(names).toContain("roles");
    expect(names).toContain("roles.harvester");
    expect(names).toContain("spawn");
    expect(names).toContain("telemetry");
    expect(names.length).toBeGreaterThan(1);
  });
});

describe("buildAllModules + loadDistModules", () => {
  const tmp = path.join(os.tmpdir(), `ags-build-modules-${process.pid}`);

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("emits multiple CJS modules with Screeps require names", async () => {
    const names = await buildAllModules({ distRoot: tmp });
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain("main");

    const modules = loadDistModules(tmp);
    expect(Object.keys(modules).sort()).toEqual([...names].sort());
    // esbuild CJS named exports: module.exports = __toCommonJS({ loop: ... })
    expect(modules.main).toMatch(/module\.exports\s*=/);
    expect(modules.main).toMatch(/loop:\s*\(\)\s*=>\s*loop/);
    expect(modules.main).toMatch(/require\(["']roles["']\)/);
    expect(modules.main).toMatch(/require\(["']spawn["']\)/);
    expect(modules.main).toMatch(/require\(["']telemetry["']\)/);
    expect(modules.roles).toMatch(/require\(["']roles\.harvester["']\)/);
  });

  test("loadDistModules reads flat *.js as deploy payload keys", () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(path.join(tmp, "main.js"), "exports.loop=function(){}");
    writeFileSync(path.join(tmp, "roles.harvester.js"), "exports.run=1");
    const modules = loadDistModules(tmp);
    expect(Object.keys(modules).sort()).toEqual(["main", "roles.harvester"]);
    expect(modules.main).toContain("loop");
  });
});
