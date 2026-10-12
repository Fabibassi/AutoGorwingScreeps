# Autonomous Screeps Cloud Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript Screeps World bot in one GitHub repo with CI/deploy to Screeps, telemetry export, and a full-auto Issue → Cursor Cloud Agent → PR → merge → deploy → metrics loop (including rollback).

**Architecture:** GitHub is the orchestrator (Actions, Issues, PRs). The bot runs on Screeps World and writes metrics into Memory. Ops scripts pull metrics via Screeps API, open Issues on stagnation/crash, and start Cursor Cloud Agents (`@cursor/sdk`, `cloud` + `autoCreatePR`). Green CI auto-merges to `main` and deploys bundled JS to Screeps branch `default`. Home PC is never required at runtime.

**Tech Stack:** TypeScript, Node 22+, esbuild (bundle to `dist/main.js`), `@types/screeps`, Vitest, GitHub Actions, Screeps HTTP API, `@cursor/sdk` (Cursor Cloud Agents), `gh` CLI where useful in workflows.

**Spec / ADR:**
- `docs/superpowers/specs/2026-09-07-autonomous-screeps-bot-design.md`
- `docs/adr/0001-autonomous-screeps-cloud-loop.md`

## Global Constraints

- Target: Screeps World (`screeps.com`); private server optional later, not in this plan.
- One repo only; layout: `src/`, `ops/`, `.github/workflows/`, `docs/`.
- Bot + ops tooling in TypeScript; workflows in YAML.
- Coding agent: Cursor Cloud via `CURSOR_API_KEY` (never home-PC runtime).
- Manual and auto Issues share the same evolve workflow.
- Deploy policy: green PR → auto-merge `main` → immediate Screeps `default`.
- Metrics minimum: energy income + error rate; composite score later.
- Safety: CI gate, rollback workflow, scoped Issues, rate limit **4 agent runs / hour**.
- Defaults locked here: metrics cron `*/15 * * * *`; stagnation = `|Δ energyIncomePerTick| < 5%` over **4** consecutive pulls and no open blocking condition listed in Task 8; rollback if energyIncome drops **≥ 30%** vs `Memory.ags.baseline.energyIncomePerTick` or `errorCount ≥ 10` in last window.
- Secrets: `CURSOR_API_KEY`, `SCREEPS_TOKEN`; vars: `SCREEPS_BRANCH=default`, ``SCREEPS_SHARD` secret (set at setup; empty string means omit shard header), `GITHUB_REPO` full name for cloud agent (e.g. `owner/AutoGorwingScreeps`).
- Do not commit secrets. Do not use `git commit --amend` unless the plan step explicitly says so.
- Prefer small commits per task. German or English commit messages are fine; prefer English conventional commits: `feat:`, `fix:`, `ci:`, `docs:`, `test:`, `chore:`.

---

## File map (create unless noted)

| Path | Responsibility |
|---|---|
| `package.json` | Scripts: `build`, `test`, `deploy`, `metrics:pull`, `agent:evolve` |
| `tsconfig.json` | Bot + ops TypeScript config |
| `esbuild.config.mjs` | Bundle `src/main.ts` → `dist/main.js` (IIFE/CJS Screeps module) |
| `src/main.ts` | Loop entry: error boundary, roles, spawn, metrics tick |
| `src/roles/harvester.ts` | Harvest → deliver/upgrade |
| `src/roles/upgrader.ts` | Upgrade controller |
| `src/spawn.ts` | Maintain harvester/upgrader counts |
| `src/telemetry.ts` | Write `Memory.ags` metrics |
| `src/types.ts` | Memory typings for AGS |
| `ops/screepsApi.ts` | Shared Screeps HTTP client (code upload, memory read) |
| `ops/deploy.ts` | Upload `dist/main.js` as module `main` |
| `ops/metricsPull.ts` | Pull Memory.ags, compare baselines, open Issues |
| `ops/evolveAgent.ts` | Start Cursor Cloud Agent from Issue payload |
| `ops/rateLimit.ts` | Enforce ≤4 agent runs/hour via GitHub Actions cache/artifact or repo variable stamp |
| `tests/telemetry.test.ts` | Pure metric window / stagnation helpers |
| `tests/spawn.test.ts` | Spawn body/count decisions (pure functions) |
| `.github/workflows/ci.yml` | PR + main: install, test, build |
| `.github/workflows/deploy.yml` | On push `main`: build + deploy |
| `.github/workflows/metrics.yml` | Cron every 15m + workflow_dispatch |
| `.github/workflows/evolve.yml` | On Issues labeled `evolve` / `rollback` |
| `.github/workflows/rollback.yml` | Revert to last good tag/sha and redeploy (callable) |
| `.github/ISSUE_TEMPLATE/evolve.yml` | Handy-friendly issue form |
| `README.md` | Setup: secrets, first deploy, phone Issue test |

---

### Task 1: Scaffold package, TypeScript, esbuild, Vitest

**Files:**
- Create: `package.json`, `tsconfig.json`, `esbuild.config.mjs`, `vitest.config.ts`, `.gitignore`
- Modify: `README.md` (stub only; full docs in Task 10)

**Interfaces:**
- Produces: `npm run build` → `dist/main.js`; `npm test` runs Vitest; `npm run typecheck`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
coverage/
.env
*.log
.DS_Store
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "auto-growing-screeps",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "node esbuild.config.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "deploy": "npm run build && tsx ops/deploy.ts",
    "metrics:pull": "tsx ops/metricsPull.ts",
    "agent:evolve": "tsx ops/evolveAgent.ts"
  },
  "devDependencies": {
    "@types/node": "^22.13.10",
    "@types/screeps": "^3.3.8",
    "esbuild": "^0.25.1",
    "tsx": "^4.19.3",
    "typescript": "^5.8.2",
    "vitest": "^3.0.9"
  },
  "dependencies": {
    "@cursor/sdk": "^1.0.0"
  }
}
```

If `@cursor/sdk` version resolution fails, install the current published version from npm (`npm view @cursor/sdk version`) and pin that exact version.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["screeps", "node"],
    "rootDir": ".",
    "outDir": "dist-types",
    "noEmit": true,
    "resolveJsonModule": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*", "ops/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Create `esbuild.config.mjs`**

```js
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "neutral",
  format: "cjs",
  target: "es2019",
  sourcemap: false,
  legalComments: "none",
});

console.log("built dist/main.js");
```

- [ ] **Step 5: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Install and verify toolchain**

Run: `npm install`
Run: `npx vitest run`
Expected: PASS with `No test files found` **or** zero tests — if Vitest exits non-zero on no tests, add `tests/smoke.test.ts`:

```ts
import { expect, test } from "vitest";
test("smoke", () => expect(true).toBe(true));
```

Then re-run `npm test` → PASS.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json esbuild.config.mjs vitest.config.ts tests/smoke.test.ts
git commit -m "chore: scaffold TypeScript, esbuild, and Vitest"
```

---

### Task 2: Memory types + pure telemetry helpers (TDD)

**Files:**
- Create: `src/types.ts`, `src/telemetry.ts`, `tests/telemetry.test.ts`

**Interfaces:**
- Produces:
  - `interface AgsMetrics { tick: number; rcl: number; energyIncomePerTick: number; errorCount: number; cpuUsedAvg: number; updatedAt: number }`
  - `interface AgsMemory { metrics: AgsMetrics; baseline?: { energyIncomePerTick: number; updatedAt: number }; incomeSamples: number[]; lastErrors: number }`
  - `function recordEnergySample(samples: number[], sample: number, maxSamples: number): number[]`
  - `function average(samples: number[]): number`
  - `function isStagnant(windows: number[], thresholdPct: number): boolean`
  - `function shouldRollback(currentIncome: number, baselineIncome: number, errorCount: number): boolean`
  - Constants: `MAX_SAMPLES = 100`, `STAGNATION_THRESHOLD_PCT = 0.05`, `ROLLBACK_INCOME_DROP = 0.30`, `ROLLBACK_ERROR_COUNT = 10`

- [ ] **Step 1: Write failing tests in `tests/telemetry.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import {
  average,
  isStagnant,
  recordEnergySample,
  shouldRollback,
} from "../src/telemetry";

describe("recordEnergySample", () => {
  test("appends and trims to max", () => {
    const next = recordEnergySample([1, 2, 3], 4, 3);
    expect(next).toEqual([2, 3, 4]);
  });
});

describe("average", () => {
  test("returns 0 for empty", () => {
    expect(average([])).toBe(0);
  });
  test("averages numbers", () => {
    expect(average([2, 4, 6])).toBe(4);
  });
});

describe("isStagnant", () => {
  test("true when four windows within 5%", () => {
    expect(isStagnant([100, 101, 99, 100], 0.05)).toBe(true);
  });
  test("false when swing exceeds 5%", () => {
    expect(isStagnant([100, 120, 100, 100], 0.05)).toBe(false);
  });
  test("false when fewer than 4 windows", () => {
    expect(isStagnant([100, 100, 100], 0.05)).toBe(false);
  });
});

describe("shouldRollback", () => {
  test("true on 30%+ income drop", () => {
    expect(shouldRollback(69, 100, 0)).toBe(true);
  });
  test("true on error spike", () => {
    expect(shouldRollback(100, 100, 10)).toBe(true);
  });
  test("false when healthy", () => {
    expect(shouldRollback(95, 100, 2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- tests/telemetry.test.ts`
Expected: FAIL (module or exports missing)

- [ ] **Step 3: Implement `src/types.ts` and `src/telemetry.ts`**

```ts
// src/types.ts
export interface AgsMetrics {
  tick: number;
  rcl: number;
  energyIncomePerTick: number;
  errorCount: number;
  cpuUsedAvg: number;
  updatedAt: number;
}

export interface AgsMemory {
  metrics: AgsMetrics;
  baseline?: { energyIncomePerTick: number; updatedAt: number };
  incomeSamples: number[];
  incomeWindows: number[];
  lastErrors: number;
}

declare global {
  interface Memory {
    ags?: AgsMemory;
  }
}
export {};
```

```ts
// src/telemetry.ts
export const MAX_SAMPLES = 100;
export const STAGNATION_THRESHOLD_PCT = 0.05;
export const ROLLBACK_INCOME_DROP = 0.3;
export const ROLLBACK_ERROR_COUNT = 10;

export function recordEnergySample(
  samples: number[],
  sample: number,
  maxSamples: number = MAX_SAMPLES,
): number[] {
  const next = samples.concat(sample);
  return next.length > maxSamples ? next.slice(next.length - maxSamples) : next;
}

export function average(samples: number[]): number {
  if (samples.length === 0) return 0;
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

/** Last N window averages; stagnant if length>=4 and max/min within threshold of mean. */
export function isStagnant(windows: number[], thresholdPct: number): boolean {
  if (windows.length < 4) return false;
  const recent = windows.slice(-4);
  const avg = average(recent);
  if (avg === 0) return true;
  const max = Math.max(...recent);
  const min = Math.min(...recent);
  return (max - min) / avg <= thresholdPct;
}

export function shouldRollback(
  currentIncome: number,
  baselineIncome: number,
  errorCount: number,
): boolean {
  if (errorCount >= ROLLBACK_ERROR_COUNT) return true;
  if (baselineIncome <= 0) return false;
  return currentIncome <= baselineIncome * (1 - ROLLBACK_INCOME_DROP);
}

export function tickTelemetry(opts: {
  tick: number;
  rcl: number;
  energyHarvestedThisTick: number;
  errorsThisTick: number;
  cpuUsed: number;
  memory: import("./types").AgsMemory | undefined;
}): import("./types").AgsMemory {
  const prev = opts.memory ?? {
    metrics: {
      tick: 0,
      rcl: 0,
      energyIncomePerTick: 0,
      errorCount: 0,
      cpuUsedAvg: 0,
      updatedAt: 0,
    },
    incomeSamples: [],
    incomeWindows: [],
    lastErrors: 0,
  };

  const incomeSamples = recordEnergySample(
    prev.incomeSamples,
    opts.energyHarvestedThisTick,
  );
  const energyIncomePerTick = average(incomeSamples);
  const errorCount = prev.lastErrors + opts.errorsThisTick;
  const cpuUsedAvg = average([prev.metrics.cpuUsedAvg || opts.cpuUsed, opts.cpuUsed]);

  let incomeWindows = prev.incomeWindows;
  if (opts.tick > 0 && opts.tick % 100 === 0) {
    incomeWindows = recordEnergySample(incomeWindows, energyIncomePerTick, 20);
  }

  const metrics = {
    tick: opts.tick,
    rcl: opts.rcl,
    energyIncomePerTick,
    errorCount,
    cpuUsedAvg,
    updatedAt: opts.tick,
  };

  const baseline =
    prev.baseline ??
    (opts.tick >= 500
      ? { energyIncomePerTick, updatedAt: opts.tick }
      : undefined);

  return {
    metrics,
    baseline,
    incomeSamples,
    incomeWindows,
    lastErrors: errorCount,
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- tests/telemetry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/telemetry.ts tests/telemetry.test.ts
git commit -m "feat: add telemetry helpers and AGS memory types"
```

---

### Task 3: Minimal bot kernel (harvester, upgrader, spawn)

**Files:**
- Create: `src/roles/harvester.ts`, `src/roles/upgrader.ts`, `src/spawn.ts`, `src/main.ts`, `tests/spawn.test.ts`

**Interfaces:**
- Produces:
  - `export function desiredCreeps(rcl: number): { harvester: number; upgrader: number }`
  - `export function runHarvester(creep: Creep): void`
  - `export function runUpgrader(creep: Creep): void`
  - `export function runSpawn(spawn: StructureSpawn): void`
  - `main` loop calls roles + `tickTelemetry`, wraps loop in try/catch incrementing errors

- [ ] **Step 1: Write failing spawn tests**

```ts
import { describe, expect, test } from "vitest";
import { desiredCreeps } from "../src/spawn";

describe("desiredCreeps", () => {
  test("rcl1 wants 3 harvesters and 1 upgrader", () => {
    expect(desiredCreeps(1)).toEqual({ harvester: 3, upgrader: 1 });
  });
  test("rcl2+ wants 4 harvesters and 2 upgraders", () => {
    expect(desiredCreeps(2)).toEqual({ harvester: 4, upgrader: 2 });
    expect(desiredCreeps(3)).toEqual({ harvester: 4, upgrader: 2 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- tests/spawn.test.ts`

- [ ] **Step 3: Implement spawn + roles + main**

```ts
// src/spawn.ts
export function desiredCreeps(rcl: number): {
  harvester: number;
  upgrader: number;
} {
  if (rcl <= 1) return { harvester: 3, upgrader: 1 };
  return { harvester: 4, upgrader: 2 };
}

const BODY: BodyPartConstant[] = [WORK, CARRY, MOVE];

export function runSpawn(spawn: StructureSpawn): void {
  if (spawn.spawning) return;
  const room = spawn.room;
  const rcl = room.controller?.level ?? 1;
  const want = desiredCreeps(rcl);
  const counts = { harvester: 0, upgrader: 0 };
  for (const name in Game.creeps) {
    const role = Game.creeps[name].memory.role as keyof typeof counts;
    if (role in counts) counts[role]++;
  }
  const order: Array<keyof typeof want> = ["harvester", "upgrader"];
  for (const role of order) {
    if (counts[role] < want[role]) {
      const name = `${role}-${Game.time}`;
      spawn.spawnCreep(BODY, name, { memory: { role } });
      return;
    }
  }
}
```

```ts
// src/roles/harvester.ts
export function runHarvester(creep: Creep): void {
  if (creep.store.getFreeCapacity() > 0) {
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (!source) return;
    if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
    }
    return;
  }
  const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
  if (spawn && spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
      creep.moveTo(spawn);
    }
    return;
  }
  const controller = creep.room.controller;
  if (controller) {
    if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller);
    }
  }
}
```

```ts
// src/roles/upgrader.ts
export function runUpgrader(creep: Creep): void {
  if (creep.store[RESOURCE_ENERGY] === 0) {
    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (!spawn) return;
    if (spawn.store[RESOURCE_ENERGY] > 0) {
      if (creep.withdraw(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(spawn);
      }
    }
    return;
  }
  const controller = creep.room.controller;
  if (!controller) return;
  if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller);
  }
}
```

```ts
// src/main.ts
import { runHarvester } from "./roles/harvester";
import { runUpgrader } from "./roles/upgrader";
import { runSpawn } from "./spawn";
import { tickTelemetry } from "./telemetry";

export function loop(): void {
  let errorsThisTick = 0;
  let energyHarvestedThisTick = 0;

  try {
    for (const name in Game.spawns) {
      runSpawn(Game.spawns[name]);
    }

    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      try {
        if (creep.memory.role === "harvester") {
          const before = creep.store[RESOURCE_ENERGY] || 0;
          runHarvester(creep);
          const after = creep.store[RESOURCE_ENERGY] || 0;
          if (after > before) energyHarvestedThisTick += after - before;
        } else if (creep.memory.role === "upgrader") {
          runUpgrader(creep);
        }
      } catch (e) {
        errorsThisTick++;
        console.log(`creep ${name} error`, e);
      }
    }

    // crude harvest proxy: also count HARVEST intents via memory counter if needed
    const room = Object.values(Game.rooms)[0];
    const rcl = room?.controller?.level ?? 1;
    Memory.ags = tickTelemetry({
      tick: Game.time,
      rcl,
      energyHarvestedThisTick,
      errorsThisTick,
      cpuUsed: Game.cpu.getUsed(),
      memory: Memory.ags,
    });
  } catch (e) {
    console.log("main loop error", e);
    if (!Memory.ags) {
      Memory.ags = {
        metrics: {
          tick: Game.time,
          rcl: 1,
          energyIncomePerTick: 0,
          errorCount: 1,
          cpuUsedAvg: Game.cpu.getUsed(),
          updatedAt: Game.time,
        },
        incomeSamples: [],
        incomeWindows: [],
        lastErrors: 1,
      };
    } else {
      Memory.ags.lastErrors += 1;
      Memory.ags.metrics.errorCount = Memory.ags.lastErrors;
    }
  }
}
```

Also extend Creep memory in `src/types.ts`:

```ts
declare global {
  interface CreepMemory {
    role?: string;
  }
  interface Memory {
    ags?: AgsMemory;
  }
}
```

- [ ] **Step 4: Fix harvest energy accounting (important)**

`runHarvester` energy delta is unreliable the same tick. Change approach: in `runHarvester`, when `harvest` returns `OK`, add `HARVEST_POWER * workParts` to a module-level or return value. Simpler approach for v1: in `main.ts` set `energyHarvestedThisTick` from `Memory.ags` previous sample using spawn energy + creep carry changes **or** count successful harvest:

Update `runHarvester` to return harvested amount:

```ts
export function runHarvester(creep: Creep): number {
  let harvested = 0;
  if (creep.store.getFreeCapacity() > 0) {
    const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (!source) return 0;
    const code = creep.harvest(source);
    if (code === OK) {
      const work = creep.getActiveBodyparts(WORK);
      harvested = work * 2; // HARVEST_POWER
    } else if (code === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: "#ffaa00" } });
    }
    return harvested;
  }
  // ... transfer/upgrade unchanged ...
  return 0;
}
```

Wire returned value into `energyHarvestedThisTick` in `main.ts`.

- [ ] **Step 5: Run unit tests + build**

Run: `npm test`
Expected: PASS  
Run: `npm run build`
Expected: `built dist/main.js` and file exists  
Run: `npm run typecheck`
Expected: exit 0 (fix CreepMemory / Memory globals if needed)

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "feat: add minimal RCL1/2 harvester-upgrader kernel"
```

---

### Task 4: Screeps API client + deploy script

**Files:**
- Create: `ops/screepsApi.ts`, `ops/deploy.ts`, `tests/screepsApi.test.ts` (URL/header helpers only)

**Interfaces:**
- Produces:
  - `export function screepsHeaders(token: string, shard?: string): Record<string, string>`
  - `export async function uploadCode(opts: { token: string; branch: string; modules: Record<string, string>; shard?: string; hostname?: string }): Promise<void>`
  - `export async function fetchMemory(opts: { token: string; shard?: string; hostname?: string }): Promise<unknown>`
  - `ops/deploy.ts` reads `dist/main.js`, uploads as `{ main: content }`

- [ ] **Step 1: Write header helper tests**

```ts
import { describe, expect, test } from "vitest";
import { screepsHeaders } from "../ops/screepsApi";

test("sets X-Token", () => {
  expect(screepsHeaders("abc")["X-Token"]).toBe("abc");
});

test("sets shard header when provided", () => {
  expect(screepsHeaders("abc", "shard3")["X-Shard"]).toBe("shard3");
});

test("omits shard header when empty", () => {
  expect(screepsHeaders("abc", "")["X-Shard"]).toBeUndefined();
});
```

- [ ] **Step 2: Implement `ops/screepsApi.ts`**

```ts
const DEFAULT_HOST = "https://screeps.com";

export function screepsHeaders(
  token: string,
  shard?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Token": token,
  };
  if (shard) headers["X-Shard"] = shard;
  return headers;
}

export async function uploadCode(opts: {
  token: string;
  branch: string;
  modules: Record<string, string>;
  shard?: string;
  hostname?: string;
}): Promise<void> {
  const host = opts.hostname ?? DEFAULT_HOST;
  const res = await fetch(`${host}/api/user/code`, {
    method: "POST",
    headers: screepsHeaders(opts.token, opts.shard),
    body: JSON.stringify({ branch: opts.branch, modules: opts.modules }),
  });
  if (!res.ok) {
    throw new Error(`uploadCode failed: ${res.status} ${await res.text()}`);
  }
}

export async function fetchMemory(opts: {
  token: string;
  shard?: string;
  hostname?: string;
}): Promise<unknown> {
  const host = opts.hostname ?? DEFAULT_HOST;
  const res = await fetch(`${host}/api/user/memory?path=`, {
    headers: screepsHeaders(opts.token, opts.shard),
  });
  if (!res.ok) {
    throw new Error(`fetchMemory failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { data?: string; ok?: number };
  // Screeps returns gzip+base64 in data for full memory; for path queries may differ.
  // Prefer memory path API: /api/user/memory?path=ags
  return data;
}

export async function fetchMemoryPath(opts: {
  token: string;
  path: string;
  shard?: string;
  hostname?: string;
}): Promise<unknown> {
  const host = opts.hostname ?? DEFAULT_HOST;
  const url = `${host}/api/user/memory?path=${encodeURIComponent(opts.path)}`;
  const res = await fetch(url, {
    headers: screepsHeaders(opts.token, opts.shard),
  });
  if (!res.ok) {
    throw new Error(`fetchMemoryPath failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}
```

If live API returns gzipped payloads for empty path, **always use** `path=ags` in metrics pull (Task 6). Document decoding only if needed after first live test; do not block deploy on full-memory decode.

- [ ] **Step 3: Implement `ops/deploy.ts`**

```ts
import { readFileSync, existsSync } from "node:fs";
import { uploadCode } from "./screepsApi";

const token = process.env.SCREEPS_TOKEN;
const branch = process.env.SCREEPS_BRANCH || "default";
const shard = process.env.SCREEPS_SHARD || undefined;

if (!token) {
  console.error("SCREEPS_TOKEN missing");
  process.exit(1);
}

const file = "dist/main.js";
if (!existsSync(file)) {
  console.error("dist/main.js missing — run npm run build");
  process.exit(1);
}

const main = readFileSync(file, "utf8");
await uploadCode({ token, branch, shard, modules: { main } });
console.log(`deployed to Screeps branch=${branch} shard=${shard ?? "(default)"}`);
```

- [ ] **Step 4: Tests + dry build**

Run: `npm test -- tests/screepsApi.test.ts` → PASS  
Run: `npm run build` → PASS  

- [ ] **Step 5: Commit**

```bash
git add ops/screepsApi.ts ops/deploy.ts tests/screepsApi.test.ts
git commit -m "feat: add Screeps API client and deploy script"
```

---

### Task 5: CI + deploy GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`

**Interfaces:**
- Produces: PR checks; push to `main` deploys using secrets

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
```

- [ ] **Step 2: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy Screeps
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm run build
      - name: Deploy
        env:
          SCREEPS_TOKEN: ${{ secrets.SCREEPS_TOKEN }}
          SCREEPS_BRANCH: ${{ vars.SCREEPS_BRANCH || 'default' }}
          SCREEPS_SHARD: ${{ secrets.SCREEPS_SHARD }}
        run: npx tsx ops/deploy.ts
```

- [ ] **Step 3: Document required secrets in README section (draft)**

Repo Settings → Secrets: `SCREEPS_TOKEN`, `CURSOR_API_KEY`  
Vars: `SCREEPS_BRANCH=default`; Secrets: `SCREEPS_SHARD`, `SCREEPS_ROOM`, `REPO_FULL_NAME=owner/name`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/deploy.yml
git commit -m "ci: add test and Screeps deploy workflows"
```

- [ ] **Step 5: Push when credentials exist (human or agent with remote access)**

```bash
git push -u origin HEAD
```

Verify Actions: CI green; Deploy succeeds only if `SCREEPS_TOKEN` set. If secret missing, Deploy fails loudly — acceptable until user adds secret.

---

### Task 6: Metrics pull + Issue creation

**Files:**
- Create: `ops/metricsPull.ts`, `ops/githubIssues.ts`, `tests/metricsDecision.test.ts`

**Interfaces:**
- Produces:
  - `export function decideIssue(input: { stagnant: boolean; rollback: boolean; metrics: AgsMetrics; openEvolveCount: number }): { action: "none" | "evolve" | "rollback"; title: string; body: string } | null`
  - CLI `metrics:pull` reads Memory path `ags`, decides, creates Issue via `gh api` or `fetch` to GitHub API with `GITHUB_TOKEN`

- [ ] **Step 1: Failing decision tests**

```ts
import { describe, expect, test } from "vitest";
import { decideIssue } from "../ops/metricsPull";

const metrics = {
  tick: 1000,
  rcl: 1,
  energyIncomePerTick: 10,
  errorCount: 0,
  cpuUsedAvg: 1,
  updatedAt: 1000,
};

test("rollback wins over evolve", () => {
  const d = decideIssue({
    stagnant: true,
    rollback: true,
    metrics,
    openEvolveCount: 0,
  });
  expect(d?.action).toBe("rollback");
});

test("evolve when stagnant and no open evolve issues", () => {
  const d = decideIssue({
    stagnant: true,
    rollback: false,
    metrics,
    openEvolveCount: 0,
  });
  expect(d?.action).toBe("evolve");
});

test("none when stagnant but evolve already open", () => {
  const d = decideIssue({
    stagnant: true,
    rollback: false,
    metrics,
    openEvolveCount: 1,
  });
  expect(d).toBeNull();
});

test("none when healthy", () => {
  expect(
    decideIssue({
      stagnant: false,
      rollback: false,
      metrics,
      openEvolveCount: 0,
    }),
  ).toBeNull();
});
```

- [ ] **Step 2: Implement decision + pull script**

Export `decideIssue` from `ops/metricsPull.ts` with Issue body including JSON metrics snapshot. Use labels `evolve` / `rollback`.

`ops/githubIssues.ts`:

```ts
export async function createIssue(opts: {
  token: string;
  repo: string; // owner/name
  title: string;
  body: string;
  labels: string[];
}): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${opts.repo}/issues`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      title: opts.title,
      body: opts.body,
      labels: opts.labels,
    }),
  });
  if (!res.ok) {
    throw new Error(`createIssue failed: ${res.status} ${await res.text()}`);
  }
}

export async function countOpenIssuesWithLabel(opts: {
  token: string;
  repo: string;
  label: string;
}): Promise<number> {
  const q = encodeURIComponent(
    `repo:${opts.repo} is:issue is:open label:${opts.label}`,
  );
  const res = await fetch(`https://api.github.com/search/issues?q=${q}`, {
    headers: {
      Authorization: `Bearer ${opts.token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!res.ok) throw new Error(await res.text());
  const data = (await res.json()) as { total_count: number };
  return data.total_count;
}
```

In `metricsPull.ts` main: fetch `ags` memory, compute `isStagnant(incomeWindows)`, `shouldRollback(...)`, `decideIssue`, create issue if needed. Parse Screeps memory API JSON carefully — if `data` is a stringified JSON for path queries, `JSON.parse` it; if gzip, document and use a small decode helper after first live failure (implement decode with `zlib.gunzipSync` + base64 if response indicates).

- [ ] **Step 3: Tests PASS + commit**

```bash
git add ops/metricsPull.ts ops/githubIssues.ts tests/metricsDecision.test.ts
git commit -m "feat: pull Screeps metrics and open evolve/rollback issues"
```

---

### Task 7: Cursor Cloud evolve agent + rate limit

**Files:**
- Create: `ops/evolveAgent.ts`, `ops/rateLimit.ts`, `tests/rateLimit.test.ts`

**Interfaces:**
- Produces:
  - `export function allowAgentRun(timestamps: number[], now: number, maxPerHour: number): { ok: boolean; nextTimestamps: number[] }` with `maxPerHour = 4`
  - `evolveAgent.ts` reads env `ISSUE_TITLE`, `ISSUE_BODY`, `ISSUE_NUMBER`, `CURSOR_API_KEY`, `REPO_URL` — starts cloud agent with `autoCreatePR: true`, `skipReviewerRequest: true`

- [ ] **Step 1: Rate limit tests**

```ts
import { describe, expect, test } from "vitest";
import { allowAgentRun } from "../ops/rateLimit";

test("allows under cap", () => {
  const now = 1_000_000;
  const r = allowAgentRun([now - 1000], now, 4);
  expect(r.ok).toBe(true);
  expect(r.nextTimestamps).toHaveLength(2);
});

test("blocks at 4 in last hour", () => {
  const now = 3_600_000;
  const stamps = [1, 2, 3, 4].map((i) => now - i * 1000);
  expect(allowAgentRun(stamps, now, 4).ok).toBe(false);
});
```

- [ ] **Step 2: Implement rate limit + agent launcher**

```ts
// ops/rateLimit.ts
const HOUR = 60 * 60 * 1000;
export function allowAgentRun(
  timestamps: number[],
  now: number,
  maxPerHour: number,
): { ok: boolean; nextTimestamps: number[] } {
  const recent = timestamps.filter((t) => now - t < HOUR);
  if (recent.length >= maxPerHour) return { ok: false, nextTimestamps: recent };
  return { ok: true, nextTimestamps: recent.concat(now) };
}
```

```ts
// ops/evolveAgent.ts
import { Agent, CursorAgentError } from "@cursor/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { allowAgentRun } from "./rateLimit";

const stampFile = ".ags-agent-timestamps.json";

function loadStamps(): number[] {
  if (!existsSync(stampFile)) return [];
  return JSON.parse(readFileSync(stampFile, "utf8")) as number[];
}

const apiKey = process.env.CURSOR_API_KEY!;
const repoUrl = process.env.REPO_URL!; // https://github.com/owner/repo
const issueTitle = process.env.ISSUE_TITLE || "evolve";
const issueBody = process.env.ISSUE_BODY || "";
const issueNumber = process.env.ISSUE_NUMBER || "";

if (!apiKey || !repoUrl) {
  console.error("CURSOR_API_KEY and REPO_URL required");
  process.exit(1);
}

const now = Date.now();
const decision = allowAgentRun(loadStamps(), now, 4);
if (!decision.ok) {
  console.error("rate limit: max 4 agent runs / hour");
  process.exit(0); // soft exit — do not fail the whole Actions minute budget angrily
}
writeFileSync(stampFile, JSON.stringify(decision.nextTimestamps));

const prompt = `You are the AutoGrowingScreeps evolution agent.
Work ONLY on this GitHub issue scope. Open/update a PR with focused changes.
Issue #${issueNumber}: ${issueTitle}

${issueBody}

Constraints:
- TypeScript bot lives in src/; ops in ops/
- Keep changes small and testable; run npm test && npm run build
- Do not commit secrets
- Follow docs/superpowers/specs/2026-09-07-autonomous-screeps-bot-design.md
`;

try {
  const result = await Agent.prompt(prompt, {
    apiKey,
    model: { id: "composer-2.5" },
    cloud: {
      repos: [{ url: repoUrl, startingRef: "main" }],
      autoCreatePR: true,
      skipReviewerRequest: true,
    },
  });
  console.log(result.status, result.result);
  if (result.status === "error") process.exit(2);
} catch (err) {
  if (err instanceof CursorAgentError) {
    console.error("startup failed", err.message, err.isRetryable);
    process.exit(1);
  }
  throw err;
}
```

Note: Persist rate-limit stamps across jobs via Actions cache key `ags-agent-timestamps` (restore before run, save after) in the workflow (Task 8). The file approach alone is insufficient on ephemeral runners without cache.

- [ ] **Step 3: Tests + commit**

```bash
git add ops/evolveAgent.ts ops/rateLimit.ts tests/rateLimit.test.ts
git commit -m "feat: Cursor Cloud evolve agent with hourly rate limit"
```

---

### Task 8: Metrics + evolve + rollback workflows; auto-merge

**Files:**
- Create: `.github/workflows/metrics.yml`, `.github/workflows/evolve.yml`, `.github/workflows/rollback.yml`
- Create: `.github/ISSUE_TEMPLATE/evolve.yml`
- Modify: repo settings instructions in README for allow auto-merge

- [ ] **Step 1: `metrics.yml`**

```yaml
name: Metrics
on:
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch:
jobs:
  pull:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - name: Pull metrics / open issues
        env:
          SCREEPS_TOKEN: ${{ secrets.SCREEPS_TOKEN }}
          SCREEPS_SHARD: ${{ secrets.SCREEPS_SHARD }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GITHUB_REPO: ${{ github.repository }}
        run: npx tsx ops/metricsPull.ts
```

- [ ] **Step 2: `evolve.yml`**

```yaml
name: Evolve
on:
  issues:
    types: [opened, labeled, reopened]
  workflow_dispatch:
    inputs:
      issue_number:
        required: true
jobs:
  agent:
    if: >
      github.event_name == 'workflow_dispatch' ||
      contains(github.event.issue.labels.*.name, 'evolve') ||
      contains(github.event.issue.labels.*.name, 'rollback')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - uses: actions/cache@v4
        with:
          path: .ags-agent-timestamps.json
          key: ags-agent-timestamps-${{ github.repository }}
          restore-keys: ags-agent-timestamps-
      - name: Run Cursor Cloud Agent
        env:
          CURSOR_API_KEY: ${{ secrets.CURSOR_API_KEY }}
          REPO_URL: https://github.com/${{ github.repository }}
          ISSUE_TITLE: ${{ github.event.issue.title }}
          ISSUE_BODY: ${{ github.event.issue.body }}
          ISSUE_NUMBER: ${{ github.event.issue.number }}
        run: npx tsx ops/evolveAgent.ts
```

For `rollback` label: agent prompt should prefer revert of last deploy commit; additionally `rollback.yml` can hard-revert:

```yaml
name: Rollback
on:
  workflow_dispatch:
    inputs:
      sha:
        description: "Known good SHA"
        required: true
jobs:
  revert:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - run: |
          git config user.name "ags-bot"
          git config user.email "ags-bot@users.noreply.github.com"
          git revert --no-edit ${{ inputs.sha }}..HEAD || git reset --hard ${{ inputs.sha }}
          git push origin HEAD:main
```

Prefer `git revert` range carefully — for v1 document: tag each successful deploy as `deploy/<sha>` and rollback resets to previous tag via forced workflow_dispatch. Implement safest v1:

```yaml
- run: |
    git config user.name "ags-bot"
    git config user.email "ags-bot@users.noreply.github.com"
    git revert --no-edit -m 1 HEAD
    git push
```

only when metrics opened `rollback` and evolve agent did not already fix — keep both paths: agent-first, manual workflow_dispatch fallback.

- [ ] **Step 3: Issue template**

```yaml
name: Evolve request
description: Trigger the autonomous Screeps evolution agent
title: "evolve: "
labels: ["evolve"]
body:
  - type: textarea
    id: goal
    attributes:
      label: What should change?
      description: Be specific. One evolution unit.
    validations:
      required: true
  - type: textarea
    id: metrics
    attributes:
      label: Optional metrics / context
```

- [ ] **Step 4: Enable auto-merge instructions**

In README: enable branch protection optional; use `gh pr merge --auto --squash` in a small workflow `automerge.yml` on `pull_request_target`/`pull_request` when `github.actor` is the cloud agent bot **or** label `automerge`. Simpler v1: in evolve agent prompt require the agent to enable auto-merge on its PR; plus workflow:

```yaml
name: Automerge
on:
  pull_request:
    types: [opened, synchronize, reopened]
jobs:
  automerge:
    if: contains(github.event.pull_request.labels.*.name, 'automerge') || startsWith(github.head_ref, 'cursor/')
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - name: Enable auto-merge
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh pr merge ${{ github.event.pull_request.number }} --auto --squash
```

May need a PAT with permission if `GITHUB_TOKEN` cannot auto-merge — document `AGS_GH_TOKEN` secret fallback.

- [ ] **Step 5: Commit**

```bash
git add .github
git commit -m "ci: add metrics, evolve, rollback, and automerge workflows"
```

---

### Task 9: End-to-end hardening + README

**Files:**
- Modify: `README.md`
- Modify: any broken API parsing discovered in dry runs
- Create: `docs/superpowers/plans/` already has this plan

- [ ] **Step 1: Write README with exact setup**

Must include:
1. Create Screeps auth token  
2. Set GitHub secrets/vars  
3. Push `main` → first deploy  
4. In Screeps UI, active branch `default`  
5. Phone test: open Issue with template `evolve` → wait for PR → merge → deploy  
6. Confirm `Memory.ags` in Screeps console: `Memory.ags`  
7. Metrics workflow_dispatch test  

- [ ] **Step 2: Add `npm run typecheck` fixes until clean**

- [ ] **Step 3: Tag baseline**

```bash
git tag baseline-v0
# push tag when remote available
```

- [ ] **Step 4: Commit README**

```bash
git add README.md
git commit -m "docs: setup guide for cloud deploy and evolve loop"
```

---

### Task 10: Verification checklist (Definition of Done)

Do not claim complete until all checked:

- [ ] `npm test` PASS locally/CI
- [ ] `npm run build` produces `dist/main.js`
- [ ] Deploy Action uploads to Screeps (or dry-run logs clearly if token absent — then user adds token and re-runs)
- [ ] Manual Issue with label `evolve` triggers Evolve workflow
- [ ] Cursor Cloud Agent opens a PR without needing home PC
- [ ] Automerge + Deploy path documented and attempted
- [ ] Metrics script can read `Memory.ags` (or creates clear error if empty before first ticks)
- [ ] Rate limit soft-exits on 5th run within hour
- [ ] Rollback path documented and workflow_dispatch present

---

## Spec coverage (self-review)

| Spec item | Task |
|---|---|
| TS bot + ops | 1–3 |
| GitHub → Screeps deploy | 4–5 |
| Telemetry Energy + Errors | 2–3, 6 |
| Unified Issue pipeline | 6–8 |
| Cursor Cloud agent | 7–8 |
| Auto-merge + immediate default deploy | 5, 8 |
| Rollback + rate limit | 7–8 |
| Handy Issue / no home PC | 8–9 |
| 24/7 cron | 8 (`*/15`) |
| Phase overnight base | Tasks 1–9 |

## Placeholder scan

Locked defaults for previously open params (cron, thresholds, rate limit, model id). Shard remains a repo variable set at setup (cannot know account shard in advance).

---

## Execution notes for overnight Goal

1. Implement Tasks 1→9 in order.
2. If `SCREEPS_TOKEN` / `CURSOR_API_KEY` are missing, finish all code/workflows and leave a short `SETUP_SECRETS.md` checklist — do not block the whole Goal on secrets.
3. Prefer subagent-driven execution per task with commits after each task.
4. Do not expand into Arena, private server, or Canary deploy.
