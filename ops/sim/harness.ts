/**
 * Shared mockup helpers for parallel sim scenarios.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadDistModules, simServerDir } from "./loadModules";

/** Controller progressTotal mirrors (approx Screeps World). */
export const PROGRESS_TOTAL: Record<number, number> = {
  1: 200,
  2: 45_000,
  3: 135_000,
  4: 405_000,
  5: 1_215_000,
  6: 3_645_000,
  7: 10_935_000,
  8: 0,
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIVE_DIR = path.join(ROOT, ".sim-learn", "live");

export type LiveStatus = {
  instance: string;
  tick: number;
  ticksCap: number;
  creeps: number;
  spawnEnergy: number;
  storageEnergy: number;
  roles: Record<string, number>;
  rcl?: number;
  progress?: number;
  progressTotal?: number;
  containers?: number;
  roads?: number;
  sites?: number;
  extensions?: number;
  towers?: number;
  done?: boolean;
  ok?: boolean;
  reason?: string;
  updatedAt: string;
};

/** Write per-instance snapshot for `npm run sim:watch`. */
export function writeLiveStatus(status: LiveStatus): void {
  try {
    mkdirSync(LIVE_DIR, { recursive: true });
    writeFileSync(
      path.join(LIVE_DIR, `${status.instance}.json`),
      JSON.stringify(status),
    );
  } catch {
    /* ignore watch I/O errors */
  }
}

const require = createRequire(import.meta.url);
const { ScreepsServer, TerrainMatrix } = require("screeps-server-mockup") as {
  ScreepsServer: new (opts?: {
    path?: string;
    logdir?: string;
    port?: number;
  }) => SimServer;
  TerrainMatrix: new () => { set: (x: number, y: number, t: string) => void };
};

export type SimBot = {
  id: string;
  on: (ev: string, cb: (...args: unknown[]) => void) => void;
  console: (cmd: string) => Promise<unknown>;
  memory: Promise<string>;
};

export type SimServer = {
  world: {
    reset: () => Promise<void>;
    addRoom: (room: string) => Promise<void>;
    setTerrain: (room: string, terrain: unknown) => Promise<void>;
    addRoomObject: (
      room: string,
      type: string,
      x: number,
      y: number,
      attrs?: Record<string, unknown>,
    ) => Promise<unknown>;
    addBot: (opts: {
      username: string;
      room: string;
      x: number;
      y: number;
      modules: Record<string, string>;
    }) => Promise<SimBot>;
    gameTime: Promise<number>;
  };
  start: () => Promise<void>;
  tick: () => Promise<void>;
  stop: () => void;
  common: {
    storage: {
      db: {
        "rooms.objects": {
          find: (q: object) => Promise<Array<Record<string, unknown>>>;
          update: (q: object, u: object) => Promise<unknown>;
          insert: (doc: object) => Promise<unknown>;
        };
      };
    };
  };
};

export const ROOM = "W0N1";
export const SPAWN_X = 25;
export const SPAWN_Y = 25;

export type RoomSummary = {
  gameTime: number;
  creeps: number;
  spawnEnergy: number;
  storageEnergy: number;
  roles: Record<string, number>;
  rcl: number;
  progress: number;
  progressTotal: number;
  containers: number;
  roads: number;
  sites: number;
  extensions: number;
  towers: number;
};

export type SimResult = {
  ok: boolean;
  ticksRun: number;
  final: RoomSummary;
  reason: string;
};

export function createMockupServer(instance: string, port: number): SimServer {
  const dir = simServerDir(instance);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "logs"), { recursive: true });
  return new ScreepsServer({
    path: dir,
    logdir: path.join(dir, "logs"),
    port,
  }) as unknown as SimServer;
}

export async function resetEmptyRoom(
  server: SimServer,
  opts: { rcl: number; progressTotal?: number },
): Promise<void> {
  await server.world.reset();
  const terrain = new TerrainMatrix();
  await server.world.addRoom(ROOM);
  await server.world.setTerrain(ROOM, terrain);
  await server.world.addRoomObject(ROOM, "controller", 10, 10, {
    level: opts.rcl,
    progress: 0,
    progressTotal: opts.progressTotal ?? (opts.rcl <= 1 ? 200 : 45000),
  });
  await server.world.addRoomObject(ROOM, "source", 10, 40, {
    energy: 3000,
    energyCapacity: 3000,
    ticksToRegeneration: 300,
  });
  await server.world.addRoomObject(ROOM, "source", 40, 10, {
    energy: 3000,
    energyCapacity: 3000,
    ticksToRegeneration: 300,
  });
}

export async function addBotWithModules(
  server: SimServer,
  instance: string,
): Promise<SimBot> {
  const modules = loadDistModules();
  const bot = await server.world.addBot({
    username: `ags-${instance}`,
    room: ROOM,
    x: SPAWN_X,
    y: SPAWN_Y,
    modules,
  });
  bot.on("console", (logs: unknown) => {
    if (Array.isArray(logs)) {
      for (const line of logs) {
        console.log(`[sim|${instance}]`, line);
      }
    }
  });
  return bot;
}

function ensureAgsPreamble(): string {
  return `Memory.ags = Memory.ags || { metrics: { tick: 0, rcl: 1, energyIncomePerTick: 0, errorCount: 0, cpuUsedAvg: 0, updatedAt: 0 }, incomeSamples: [], incomeWindows: [], errorSamples: [], lastErrors: 0 };`;
}

/** Inject road-policy experiment knob into bot Memory (survives via main sticky). */
export async function setBotRoadPolicy(
  bot: SimBot,
  policy: string,
): Promise<void> {
  const safe = policy.replace(/[^a-z0-9_]/gi, "");
  await bot.console(
    `${ensureAgsPreamble()} Memory.ags.roadPolicy = "${safe}";`,
  );
}

/** Inject RCL4→5 spend mode (survives via main sticky). */
export async function setBotRcl5Mode(
  bot: SimBot,
  mode: string,
): Promise<void> {
  const safe = mode.replace(/[^a-z0-9_]/gi, "");
  await bot.console(
    `${ensureAgsPreamble()} Memory.ags.rcl5Mode = "${safe}";`,
  );
}

/** Inject post-hub RCL5 plan (link_boost | none). */
export async function setBotRcl5Plan(
  bot: SimBot,
  plan: string,
): Promise<void> {
  const safe = plan.replace(/[^a-z0-9_]/gi, "");
  await bot.console(
    `${ensureAgsPreamble()} Memory.ags.rcl5Plan = "${safe}";`,
  );
}

/** Kill every live creep and clear haul reservations (wipe-recovery sims). */
export async function wipeAllCreeps(bot: SimBot): Promise<void> {
  await bot.console(
    [
      "for (const n in Game.creeps) Game.creeps[n].suicide();",
      "for (const n in Memory.creeps) delete Memory.creeps[n];",
      "if (Memory.ags) { Memory.ags.haulOrders = {}; }",
    ].join(" "),
  );
}

/** Inject early-game A/B knob+variant (and optional named profile). */
export async function setBotExperiment(
  bot: SimBot,
  opts: {
    knob?: string;
    variant?: string;
    profile?: string;
    roadPolicy?: string;
    /** Explicit false disables surplus builder→upgrader (sim control). */
    idleBuilderUpgrade?: boolean;
    /** Absolute storage energy floor; 0 disables blackout reserve. */
    storageBlackoutReserve?: number;
  },
): Promise<void> {
  const parts = [ensureAgsPreamble()];
  if (opts.roadPolicy) {
    const safe = opts.roadPolicy.replace(/[^a-z0-9_]/gi, "");
    parts.push(`Memory.ags.roadPolicy = "${safe}";`);
  }
  if (opts.knob) {
    const safe = opts.knob.replace(/[^a-zA-Z0-9_]/g, "");
    parts.push(`Memory.ags.abKnob = "${safe}";`);
  }
  if (opts.variant != null) {
    const safe = String(opts.variant).replace(/[^a-zA-Z0-9_]/g, "");
    parts.push(`Memory.ags.abVariant = "${safe}";`);
  }
  if (opts.profile) {
    const safe = opts.profile.replace(/[^a-zA-Z0-9_]/g, "");
    parts.push(`Memory.ags.profile = "${safe}";`);
  }
  if (opts.idleBuilderUpgrade !== undefined) {
    parts.push(
      `Memory.ags.idleBuilderUpgrade = ${opts.idleBuilderUpgrade ? "true" : "false"};`,
    );
  }
  if (opts.storageBlackoutReserve !== undefined) {
    parts.push(
      `Memory.ags.storageBlackoutReserve = ${Number(opts.storageBlackoutReserve)};`,
    );
  }
  await bot.console(parts.join(" "));
}

/** Inject A/B knob + variant (or named profile) into bot Memory. */
export async function setBotAbExperiment(
  bot: SimBot,
  opts: { abKnob?: string; abVariant?: string; profile?: string },
): Promise<void> {
  return setBotExperiment(bot, {
    knob: opts.abKnob,
    variant: opts.abVariant,
    profile: opts.profile,
  });
}

/** Mockup often leaves progressTotal stuck after natural level-ups — repair it. */
export async function syncControllerProgress(server: SimServer): Promise<void> {
  const objects = await server.common.storage.db["rooms.objects"].find({
    room: ROOM,
    type: "controller",
  });
  const c = objects[0];
  if (!c) return;
  let level = Number(c.level ?? 1);
  let progress = Number(c.progress ?? 0);
  let progressTotal = Number(c.progressTotal ?? 0);
  let changed = false;

  const expected = PROGRESS_TOTAL[level];
  if (level < 8 && expected != null && progressTotal !== expected) {
    progressTotal = expected;
    changed = true;
  }

  while (level < 8 && progressTotal > 0 && progress >= progressTotal) {
    progress -= progressTotal;
    level += 1;
    progressTotal = PROGRESS_TOTAL[level] ?? 0;
    changed = true;
    if (level >= 8) {
      level = 8;
      progress = 0;
      progressTotal = 0;
      break;
    }
  }

  if (!changed) return;
  await server.common.storage.db["rooms.objects"].update(
    { room: ROOM, type: "controller" },
    { $set: { level, progress, progressTotal } },
  );
}

/** addBot forces RCL1 — restore controller level + spawn energy. */
export async function patchControllerAndSpawn(
  server: SimServer,
  opts: { rcl: number; spawnEnergy: number; progressTotal?: number },
): Promise<void> {
  const { db } = server.common.storage;
  await db["rooms.objects"].update(
    { room: ROOM, type: "controller" },
    {
      $set: {
        level: opts.rcl,
        progress: 0,
        progressTotal:
          opts.progressTotal ??
          PROGRESS_TOTAL[opts.rcl] ??
          (opts.rcl <= 1 ? 200 : 45000),
      },
    },
  );
  await db["rooms.objects"].update(
    { room: ROOM, type: "spawn" },
    {
      $set: {
        store: { energy: opts.spawnEnergy },
        storeCapacityResource: { energy: 300 },
      },
    },
  );
}

function parseBotMemory(raw: unknown): {
  creeps?: Record<string, { role?: string }>;
  ags?: { _roles?: Record<string, string> };
} | null {
  try {
    let mem: unknown = raw;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("gz:")) return null;
      mem = JSON.parse(trimmed);
    }
    return mem as {
      creeps?: Record<string, { role?: string }>;
      ags?: { _roles?: Record<string, string> };
    };
  } catch {
    return null;
  }
}

async function memoryRolesFromBot(
  bot: SimBot | undefined,
  creepCount: number,
): Promise<Record<string, string>> {
  if (!bot) return {};
  try {
    let mem = parseBotMemory(await bot.memory);
    let out: Record<string, string> = {};
    const snap = mem?.ags?._roles;
    if (snap && typeof snap === "object") {
      out = { ...snap };
    }
    const creepsMem = mem?.creeps;
    if (creepsMem && typeof creepsMem === "object") {
      for (const [name, m] of Object.entries(creepsMem)) {
        if (m?.role) out[name] = String(m.role);
      }
    }
    // Exported Memory.creeps is often incomplete in mockup — snapshot via console.
    if (creepCount > 0 && Object.keys(out).length < creepCount) {
      await bot.console(
        `Memory.ags=Memory.ags||{};Memory.ags._roles={};for(const n in Game.creeps)Memory.ags._roles[n]=Game.creeps[n].memory.role;`,
      );
      mem = parseBotMemory(await bot.memory);
      const refreshed = mem?.ags?._roles;
      if (refreshed && typeof refreshed === "object") {
        out = { ...out, ...refreshed };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Room snapshot for sim watchers.
 * Pass `bot` so roles come from Memory.creeps[].role (name prefixes go stale
 * after builder→upgrader reassign — overnight false "upgrader=0").
 */
export async function readRoomSummary(
  server: SimServer,
  bot?: SimBot,
): Promise<RoomSummary> {
  const gameTime = Number(await server.world.gameTime);
  const objects = await server.common.storage.db["rooms.objects"].find({
    room: ROOM,
  });
  let creeps = 0;
  for (const o of objects) {
    if (o.type === "creep") creeps++;
  }
  const memRoles = await memoryRolesFromBot(bot, creeps);
  creeps = 0;
  let spawnEnergy = 0;
  let storageEnergy = 0;
  let rcl = 1;
  let progress = 0;
  let progressTotal = 0;
  let containers = 0;
  let roads = 0;
  let sites = 0;
  let extensions = 0;
  let towers = 0;
  const roles: Record<string, number> = {};
  for (const o of objects) {
    if (o.type === "creep") {
      creeps++;
      const name = String(o.name ?? "");
      const role = memRoles[name] || name.split("-")[0] || "creep";
      roles[role] = (roles[role] ?? 0) + 1;
    } else if (o.type === "spawn") {
      const store = o.store as Record<string, number> | undefined;
      spawnEnergy += store?.energy ?? (o.energy as number) ?? 0;
    } else if (o.type === "storage") {
      const store = o.store as Record<string, number> | undefined;
      storageEnergy += store?.energy ?? 0;
    } else if (o.type === "controller") {
      rcl = Number(o.level ?? 1);
      progress = Number(o.progress ?? 0);
      progressTotal = Number(o.progressTotal ?? 0);
    } else if (o.type === "container") {
      containers++;
    } else if (o.type === "road") {
      roads++;
    } else if (o.type === "extension") {
      extensions++;
    } else if (o.type === "tower") {
      towers++;
    } else if (o.type === "constructionSite") {
      sites++;
    }
  }
  if (bot && gameTime > 0 && gameTime % 500 < 2) {
    console.log(
      `[memRoles] t=${gameTime} memEntries=${Object.keys(memRoles).length}`,
      roles,
    );
  }
  return {
    gameTime,
    creeps,
    spawnEnergy,
    storageEnergy,
    roles,
    rcl,
    progress,
    progressTotal,
    containers,
    roads,
    sites,
    extensions,
    towers,
  };
}

/** Map room summary fields onto a live-status publish payload. */
export function liveFromSummary(
  instance: string,
  ticksCap: number,
  final: RoomSummary,
  extra?: Partial<LiveStatus>,
): LiveStatus {
  return {
    instance,
    tick: final.gameTime,
    ticksCap,
    creeps: final.creeps,
    spawnEnergy: final.spawnEnergy,
    storageEnergy: final.storageEnergy,
    roles: final.roles,
    rcl: final.rcl,
    progress: final.progress,
    progressTotal: final.progressTotal,
    containers: final.containers,
    roads: final.roads,
    sites: final.sites,
    extensions: final.extensions,
    towers: final.towers,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
}

export async function runTicks(
  server: SimServer,
  instance: string,
  ticks: number,
  check: (summary: RoomSummary, tickIndex: number) => string | null,
): Promise<SimResult> {
  await server.start();
  await server.tick();
  let final = await readRoomSummary(server);
  const publish = (extra?: Partial<LiveStatus>) => {
    writeLiveStatus(liveFromSummary(instance, ticks, final, extra));
  };
  console.log(`[sim|${instance}] t0`, final);
  publish();

  for (let i = 0; i < ticks; i++) {
    await server.tick();
    final = await readRoomSummary(server);
    if (i < 3 || i % 5 === 0) {
      console.log(`[sim|${instance}] t${i + 1}`, final);
      publish();
    }
    const reason = check(final, i);
    if (reason) {
      publish({ done: true, ok: true, reason });
      return { ok: true, ticksRun: i + 1, final, reason };
    }
  }
  const failReason =
    final.creeps === 0
      ? "still 0 creeps after ticks"
      : "success criteria not met";
  publish({ done: true, ok: false, reason: failReason });
  return {
    ok: false,
    ticksRun: ticks,
    final,
    reason: failReason,
  };
}

export function stopServer(server: SimServer): void {
  try {
    server.stop();
  } catch {
    /* ignore */
  }
}
