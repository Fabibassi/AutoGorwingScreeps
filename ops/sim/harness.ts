/**
 * Shared mockup helpers for parallel sim scenarios.
 */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadDistModules, simServerDir } from "./loadModules";

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
        progressTotal: opts.progressTotal ?? (opts.rcl <= 1 ? 200 : 45000),
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

export async function readRoomSummary(server: SimServer): Promise<RoomSummary> {
  const gameTime = Number(await server.world.gameTime);
  const objects = await server.common.storage.db["rooms.objects"].find({
    room: ROOM,
  });
  let creeps = 0;
  let spawnEnergy = 0;
  let storageEnergy = 0;
  const roles: Record<string, number> = {};
  for (const o of objects) {
    if (o.type === "creep") {
      creeps++;
      const name = String(o.name ?? "");
      const role = name.split("-")[0] || "creep";
      roles[role] = (roles[role] ?? 0) + 1;
    } else if (o.type === "spawn") {
      const store = o.store as Record<string, number> | undefined;
      spawnEnergy += store?.energy ?? (o.energy as number) ?? 0;
    } else if (o.type === "storage") {
      const store = o.store as Record<string, number> | undefined;
      storageEnergy += store?.energy ?? 0;
    }
  }
  return { gameTime, creeps, spawnEnergy, storageEnergy, roles };
}

export async function runTicks(
  server: SimServer,
  instance: string,
  ticks: number,
  check: (summary: RoomSummary, tickIndex: number) => string | null,
): Promise<SimResult> {
  await server.start();
  await server.tick();
  console.log(`[sim|${instance}] t0`, await readRoomSummary(server));

  let final = await readRoomSummary(server);
  for (let i = 0; i < ticks; i++) {
    await server.tick();
    final = await readRoomSummary(server);
    if (i < 3 || i % 10 === 0) {
      console.log(`[sim|${instance}] t${i + 1}`, final);
    }
    const reason = check(final, i);
    if (reason) {
      return { ok: true, ticksRun: i + 1, final, reason };
    }
  }
  return {
    ok: false,
    ticksRun: ticks,
    final,
    reason:
      final.creeps === 0
        ? "still 0 creeps after ticks"
        : "success criteria not met",
  };
}

export function stopServer(server: SimServer): void {
  try {
    server.stop();
  } catch {
    /* ignore */
  }
}
