/**
 * Post-RCL6 spend bakeoff: home_only vs remotes vs walls arm, under fat_first / upgrade_rush.
 *
 * Metrics: netStoragePerTick, minStorage (floor 20k), controller progress gain.
 *
 * Usage:
 *   npx tsx ops/sim/rcl6Spend.ts --mode fat_first --remote reserved_drop --walls off --ticks 12000
 */
import { pathToFileURL } from "node:url";
import {
  ROOM,
  SPAWN_X,
  SPAWN_Y,
  REMOTE_ROOM,
  PROGRESS_TOTAL,
  addBotWithModules,
  addRemoteRoom,
  createMockupServer,
  liveFromSummary,
  patchControllerAndSpawn,
  readRoomSummary,
  resetEmptyRoom,
  setBotRemotePlan,
  setBotRcl5Mode,
  setBotRcl5Plan,
  setBotWallPolicy,
  stopServer,
  writeLiveStatus,
  type SimResult,
} from "./harness";

const EXT_STAMP: Array<[number, number]> = [
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
  [1, 2],
  [1, -2],
  [-1, 2],
  [-1, -2],
  [2, 2],
  [2, -2],
  [-2, 2],
  [-2, -2],
  [3, 1],
  [3, -1],
  [-3, 1],
  [-3, -1],
  [3, 2],
  [3, -2],
  [-3, 2],
  [-3, -2],
  [4, 1],
  [4, -1],
  [-4, 1],
  [-4, -1],
  [1, 3],
  [1, -3],
  [-1, 3],
  [-1, -3],
  [2, 3],
  [2, -3],
];

const START_STORAGE = 90_000;
const STORAGE_FLOOR = 20_000;

function parseArgs(argv: string[]) {
  let instance = "rcl6Spend-0";
  let ticks = 12_000;
  let port = 29_600;
  let mode = "fat_first";
  let remote = "off";
  let walls = "off";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (a === "--mode" && argv[i + 1]) mode = argv[++i];
    else if (a === "--remote" && argv[i + 1]) remote = argv[++i];
    else if (a === "--walls" && argv[i + 1]) walls = argv[++i];
  }
  return { instance, ticks, port, mode, remote, walls };
}

export async function runRcl6SpendScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
  mode: string;
  remote: string;
  walls: string;
}): Promise<SimResult> {
  const server = createMockupServer(opts.instance, opts.port);
  const pathLength = 90;
  try {
    await resetEmptyRoom(server, {
      rcl: 6,
      progressTotal: PROGRESS_TOTAL[6],
    });
    if (opts.remote !== "off") {
      await addRemoteRoom(server, { haulRange: "mid" });
    }
    const bot = await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: 6,
      spawnEnergy: 300,
      progressTotal: PROGRESS_TOTAL[6],
    });
    await server.common.storage.db["rooms.objects"].update(
      { room: ROOM, type: "controller" },
      {
        $set: {
          level: 6,
          progress: 0,
          progressTotal: PROGRESS_TOTAL[6],
        },
      },
    );

    for (const [sx, sy] of [
      [10, 40],
      [40, 10],
    ] as Array<[number, number]>) {
      await server.world.addRoomObject(ROOM, "container", sx + 1, sy, {
        store: { energy: 1800 },
        storeCapacityResource: { energy: 2000 },
        hits: 250_000,
        hitsMax: 250_000,
        user: bot.id,
      });
    }
    await server.world.addRoomObject(ROOM, "tower", SPAWN_X + 2, SPAWN_Y + 2, {
      store: { energy: 1000 },
      storeCapacityResource: { energy: 1000 },
      hits: 3000,
      hitsMax: 3000,
      user: bot.id,
    });
    await server.world.addRoomObject(ROOM, "tower", SPAWN_X - 2, SPAWN_Y + 2, {
      store: { energy: 1000 },
      storeCapacityResource: { energy: 1000 },
      hits: 3000,
      hitsMax: 3000,
      user: bot.id,
    });
    await server.world.addRoomObject(ROOM, "storage", SPAWN_X + 2, SPAWN_Y - 2, {
      store: { energy: START_STORAGE },
      storeCapacityResource: { energy: 1_000_000 },
      hits: 10_000,
      hitsMax: 10_000,
      user: bot.id,
    });
    await server.world.addRoomObject(ROOM, "link", SPAWN_X + 3, SPAWN_Y - 2, {
      store: { energy: 0 },
      storeCapacityResource: { energy: 800 },
      hits: 1000,
      hitsMax: 1000,
      user: bot.id,
    });
    await server.world.addRoomObject(ROOM, "link", 12, 12, {
      store: { energy: 0 },
      storeCapacityResource: { energy: 800 },
      hits: 1000,
      hitsMax: 1000,
      user: bot.id,
    });

    const reserved = new Set([
      `${SPAWN_X + 2},${SPAWN_Y + 2}`,
      `${SPAWN_X - 2},${SPAWN_Y + 2}`,
      `${SPAWN_X + 2},${SPAWN_Y - 2}`,
      `${SPAWN_X + 3},${SPAWN_Y - 2}`,
    ]);
    let extPlaced = 0;
    for (const [dx, dy] of EXT_STAMP) {
      if (extPlaced >= 30) break;
      const x = SPAWN_X + dx;
      const y = SPAWN_Y + dy;
      if (reserved.has(`${x},${y}`)) continue;
      await server.world.addRoomObject(ROOM, "extension", x, y, {
        store: { energy: 50 },
        storeCapacityResource: { energy: 50 },
        hits: 1000,
        hitsMax: 1000,
        user: bot.id,
      });
      reserved.add(`${x},${y}`);
      extPlaced++;
    }

    await server.start();
    await setBotRcl5Mode(bot, opts.mode);
    await setBotRcl5Plan(bot, "link_boost");
    if (opts.remote !== "off") {
      await setBotRemotePlan(bot, {
        plan: opts.remote,
        room: REMOTE_ROOM,
        pathLength,
        variant: "baseline",
      });
    } else {
      await setBotRemotePlan(bot, {
        plan: "off",
        room: REMOTE_ROOM,
        pathLength,
        variant: "baseline",
      });
    }
    if (opts.walls === "force") {
      await setBotWallPolicy(bot, "force", { wallsArmed: true });
    } else {
      await setBotWallPolicy(bot, "off", { wallsArmed: false });
    }

    let minStorage = START_STORAGE;
    let startProgress = 0;
    for (let t = 0; t < opts.ticks; t++) {
      await server.tick();
      if (t % 500 === 0 || t === opts.ticks - 1) {
        const summary = await readRoomSummary(server, bot);
        if (t === 0) startProgress = summary.progress;
        minStorage = Math.min(minStorage, summary.storageEnergy);
        writeLiveStatus(
          liveFromSummary(opts.instance, opts.ticks, summary, {
            reason:
              `rcl6Spend mode=${opts.mode} remote=${opts.remote} walls=${opts.walls} ` +
              `t${t} storage=${summary.storageEnergy} min=${minStorage}`,
          }),
        );
      }
    }

    const final = await readRoomSummary(server, bot);
    minStorage = Math.min(minStorage, final.storageEnergy);
    const netDelta = final.storageEnergy - START_STORAGE;
    const netPerTick = netDelta / Math.max(1, opts.ticks);
    const progressGain = final.progress - startProgress;
    const floorOk = minStorage >= STORAGE_FLOOR;
    const reason =
      `rcl6Spend mode=${opts.mode} remote=${opts.remote} walls=${opts.walls} ` +
      `netPerTick=${netPerTick.toFixed(3)} minStorage=${minStorage} ` +
      `progressGain=${progressGain} floorOk=${floorOk ? 1 : 0}`;
    writeLiveStatus(
      liveFromSummary(opts.instance, opts.ticks, final, {
        ok: floorOk,
        done: true,
        reason,
      }),
    );
    console.log(`[sim] ${reason}`);
    return { ok: floorOk, ticksRun: opts.ticks, final, reason };
  } finally {
    stopServer(server);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const result = await runRcl6SpendScenario(opts);
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
