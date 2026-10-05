/**
 * Soft-lock recovery scenario on screeps-server-mockup.
 *
 * Setup: spawn nearly empty, storage full + adjacent, 0 creeps.
 * Expect within N ticks: a mobile hauler (CARRY+MOVE) or spawn energy rising
 * toward miner affordability — proving recovery without Live World.
 *
 * Parallel: unique --instance + port so several farms can run at once.
 */
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { loadDistModules, simServerDir } from "./loadModules";

const require = createRequire(import.meta.url);
// CJS package
const { ScreepsServer, TerrainMatrix } = require("screeps-server-mockup") as {
  ScreepsServer: new (opts?: {
    path?: string;
    logdir?: string;
    port?: number;
  }) => {
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
      }) => Promise<{
        id: string;
        memory: Promise<string>;
        on: (ev: string, cb: (...args: unknown[]) => void) => void;
      }>;
      gameTime: Promise<number>;
    };
    start: () => Promise<void>;
    tick: () => Promise<void>;
    stop: () => void;
  };
  TerrainMatrix: new () => { set: (x: number, y: number, t: string) => void };
};

const ROOM = "W0N1";
const SPAWN_X = 25;
const SPAWN_Y = 25;
/** Adjacent east of spawn — stationary CARRY can only work if directions land here. */
const STORAGE_X = 26;
const STORAGE_Y = 25;

function parseArgs(argv: string[]) {
  let instance = "softlock-0";
  let ticks = 50;
  let port = 21025;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
  }
  return { instance, ticks, port };
}

async function readRoomSummary(
  server: InstanceType<typeof ScreepsServer>,
): Promise<{
  gameTime: number;
  creeps: number;
  spawnEnergy: number;
  storageEnergy: number;
  roles: Record<string, number>;
}> {
  const gameTime = Number(await server.world.gameTime);
  const { db } = (
    server as unknown as {
      common: {
        storage: {
          db: {
            "rooms.objects": {
              find: (q: object) => Promise<Array<Record<string, unknown>>>;
            };
          };
        };
      };
    }
  ).common.storage;
  const objects = await db["rooms.objects"].find({ room: ROOM });
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

export async function runSoftLockScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
}): Promise<{
  ok: boolean;
  ticksRun: number;
  final: Awaited<ReturnType<typeof readRoomSummary>>;
  reason: string;
}> {
  const dir = simServerDir(opts.instance);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "logs"), { recursive: true });

  const modules = loadDistModules();
  const server = new ScreepsServer({
    path: dir,
    logdir: path.join(dir, "logs"),
    port: opts.port,
  });

  try {
    await server.world.reset();
    const terrain = new TerrainMatrix();
    await server.world.addRoom(ROOM);
    await server.world.setTerrain(ROOM, terrain);
    await server.world.addRoomObject(ROOM, "controller", 10, 10, {
      level: 4,
      progress: 0,
      progressTotal: 45000,
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

    const bot = await server.world.addBot({
      username: `ags-${opts.instance}`,
      room: ROOM,
      x: SPAWN_X,
      y: SPAWN_Y,
      modules,
    });

    // addBot forces controller level 1 — restore RCL4 so hauler quotas exist.
    const { db } = (
      server as unknown as {
        common: {
          storage: {
            db: {
              "rooms.objects": {
                update: (q: object, u: object) => Promise<unknown>;
                insert: (doc: object) => Promise<unknown>;
              };
            };
          };
        };
      }
    ).common.storage;

    await db["rooms.objects"].update(
      { room: ROOM, type: "controller" },
      {
        $set: {
          level: 4,
          progress: 0,
          progressTotal: 45000,
        },
      },
    );
    await db["rooms.objects"].update(
      { room: ROOM, type: "spawn" },
      { $set: { store: { energy: 50 }, storeCapacityResource: { energy: 300 } } },
    );
    await server.world.addRoomObject(ROOM, "storage", STORAGE_X, STORAGE_Y, {
      store: { energy: 2000 },
      storeCapacityResource: { energy: 1000000 },
      user: bot.id,
    });

    bot.on("console", (logs: unknown) => {
      if (Array.isArray(logs)) {
        for (const line of logs) {
          console.log(`[sim|${opts.instance}]`, line);
        }
      }
    });

    await server.start();
    // One warm-up tick so modules load / Memory init
    await server.tick();
    console.log(`[sim|${opts.instance}] t0`, await readRoomSummary(server));

    let final = await readRoomSummary(server);
    for (let i = 0; i < opts.ticks; i++) {
      await server.tick();
      final = await readRoomSummary(server);
      if (i < 3 || i % 10 === 0) {
        console.log(`[sim|${opts.instance}] t${i + 1}`, final);
      }
      // Recovered: mobile hauler moved energy OR economy workers exist.
      const storageDrained = final.storageEnergy < 2000;
      const economyUp =
        (final.roles.miner ?? 0) + (final.roles.harvester ?? 0) > 0;
      const haulerWorking =
        (final.roles.hauler ?? 0) > 0 &&
        (final.spawnEnergy > 50 || storageDrained);
      if (economyUp || (storageDrained && final.spawnEnergy >= 100) || haulerWorking) {
        return {
          ok: true,
          ticksRun: i + 1,
          final,
          reason: economyUp
            ? "economy creeps present"
            : storageDrained
              ? "storage drained into spawn"
              : "hauler active",
        };
      }
    }

    return {
      ok: false,
      ticksRun: opts.ticks,
      final,
      reason:
        final.creeps === 0
          ? "still 0 creeps after ticks"
          : final.storageEnergy >= 2000
            ? "creeps present but storage not drained"
            : "partial recovery",
    };
  } finally {
    try {
      server.stop();
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] softlock instance=${args.instance} port=${args.port} ticks=${args.ticks}`,
  );
  const result = await runSoftLockScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
