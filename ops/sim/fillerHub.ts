/**
 * Hub-ready RCL5: compare fillerPlan thin | fat | duo_fat.
 *
 * Primary: starveTicks (hub energyAvailable < 200).
 * Secondary: meanHubEnergy, minHubEnergy; gate minStorage ≥ 20k.
 *
 * Usage:
 *   npx tsx ops/sim/fillerHub.ts --plan thin --ticks 20000 --port 28300
 */
import { pathToFileURL } from "node:url";
import {
  ROOM,
  SPAWN_X,
  SPAWN_Y,
  PROGRESS_TOTAL,
  addBotWithModules,
  createMockupServer,
  liveFromSummary,
  patchControllerAndSpawn,
  readRoomSummary,
  resetEmptyRoom,
  setBotFillerPlan,
  setBotRcl5Mode,
  setBotRcl5Plan,
  stopServer,
  syncControllerProgress,
  writeLiveStatus,
  type SimResult,
  type SimServer,
} from "./harness";
import { FILLER_PLANS, parseFillerPlan } from "../../src/earlyGame/fillerPlan";

const SOURCES: Array<[number, number]> = [
  [10, 40],
  [40, 10],
];

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

const START_STORAGE = 100_000;
const HUB_EXT = 30;
const STORAGE_FLOOR = 20_000;
const STARVE_BELOW = 200;

function parseArgs(argv: string[]) {
  let instance = "fillerHub-0";
  let ticks = 20_000;
  let port = 28_300;
  let plan = "thin";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (a === "--plan" && argv[i + 1]) plan = argv[++i];
  }
  return { instance, ticks, port, plan: parseFillerPlan(plan) };
}

async function hubEnergyAvailable(server: SimServer): Promise<number> {
  const objects = await server.common.storage.db["rooms.objects"].find({
    room: ROOM,
  });
  let energy = 0;
  for (const o of objects) {
    if (o.type !== "spawn" && o.type !== "extension") continue;
    const store = o.store as Record<string, number> | undefined;
    energy += store?.energy ?? (o.energy as number) ?? 0;
  }
  return energy;
}

export async function runFillerHubScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
  plan: string;
}): Promise<SimResult> {
  const plan = parseFillerPlan(opts.plan);
  const server = createMockupServer(opts.instance, opts.port);

  try {
    await resetEmptyRoom(server, {
      rcl: 5,
      progressTotal: PROGRESS_TOTAL[5],
    });
    const bot = await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: 5,
      spawnEnergy: 300,
      progressTotal: PROGRESS_TOTAL[5],
    });
    await server.common.storage.db["rooms.objects"].update(
      { room: ROOM, type: "controller" },
      {
        $set: {
          level: 5,
          progress: 0,
          progressTotal: PROGRESS_TOTAL[5],
        },
      },
    );

    for (const [sx, sy] of SOURCES) {
      await server.world.addRoomObject(ROOM, "container", sx + 1, sy, {
        store: { energy: 1800 },
        storeCapacityResource: { energy: 2000 },
        hits: 250_000,
        hitsMax: 250_000,
        user: bot.id,
      });
    }
    await server.world.addRoomObject(ROOM, "container", SPAWN_X, SPAWN_Y - 4, {
      store: { energy: 500 },
      storeCapacityResource: { energy: 2000 },
      hits: 250_000,
      hitsMax: 250_000,
      user: bot.id,
    });
    await server.world.addRoomObject(ROOM, "tower", SPAWN_X + 2, SPAWN_Y + 2, {
      store: { energy: 800 },
      storeCapacityResource: { energy: 1000 },
      hits: 3000,
      hitsMax: 3000,
      user: bot.id,
    });
    await server.world.addRoomObject(ROOM, "tower", SPAWN_X - 2, SPAWN_Y + 2, {
      store: { energy: 800 },
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

    const reserved = new Set([
      `${SPAWN_X + 2},${SPAWN_Y + 2}`,
      `${SPAWN_X - 2},${SPAWN_Y + 2}`,
      `${SPAWN_X + 2},${SPAWN_Y - 2}`,
    ]);
    let extPlaced = 0;
    for (const [dx, dy] of EXT_STAMP) {
      if (extPlaced >= HUB_EXT) break;
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
      extPlaced++;
    }

    await server.start();
    await setBotRcl5Mode(bot, "fat_first");
    await setBotRcl5Plan(bot, "link_boost");
    await setBotFillerPlan(bot, plan);
    await server.tick();

    let final = await readRoomSummary(server, bot);
    let minStorage = final.storageEnergy;
    let minHub = await hubEnergyAvailable(server);
    let hubSum = 0;
    let starveTicks = 0;
    let samples = 0;

    const publish = (extra?: Parameters<typeof liveFromSummary>[3]) => {
      writeLiveStatus(
        liveFromSummary(opts.instance, opts.ticks, final, {
          ...extra,
          roles: {
            ...final.roles,
            _plan: FILLER_PLANS.indexOf(plan),
          },
        }),
      );
    };
    publish({ reason: `fillerHub plan=${plan} hubReady seed` });

    for (let i = 0; i < opts.ticks; i++) {
      await server.tick();
      await syncControllerProgress(server);
      final = await readRoomSummary(server, bot);
      const hub = await hubEnergyAvailable(server);
      minStorage = Math.min(minStorage, final.storageEnergy);
      minHub = Math.min(minHub, hub);
      hubSum += hub;
      samples++;
      if (hub < STARVE_BELOW) starveTicks++;

      if (i > 0 && i % 250 === 0) {
        await setBotRcl5Mode(bot, "fat_first");
        await setBotRcl5Plan(bot, "link_boost");
        await setBotFillerPlan(bot, plan);
      }

      if (i < 3 || i % 1000 === 0) {
        const meanHub = samples > 0 ? Math.round(hubSum / samples) : 0;
        console.log(`[sim|${opts.instance}] t${i + 1}`, {
          plan,
          hub,
          meanHub,
          starveTicks,
          storageEnergy: final.storageEnergy,
          roles: final.roles,
          progress: final.progress,
        });
        publish({
          reason:
            `plan=${plan} t${i + 1} hub=${hub} meanHub=${meanHub} ` +
            `starve=${starveTicks} minHub=${minHub} minStorage=${minStorage} ` +
            `p=${final.progress}`,
        });
      }
    }

    const meanHub = samples > 0 ? Math.round(hubSum / samples) : 0;
    const reason =
      `fillerHub plan=${plan} starve=${starveTicks} meanHub=${meanHub} ` +
      `minHub=${minHub} minStorage=${minStorage} p=${final.progress} ` +
      `filler=${final.roles.filler ?? 0}`;
    const ok = minStorage >= STORAGE_FLOOR && meanHub > 0;
    publish({ done: true, ok, reason });
    return { ok, ticksRun: opts.ticks, final, reason };
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] fillerHub plan=${args.plan} instance=${args.instance} port=${args.port} ticks=${args.ticks}`,
  );
  const result = await runFillerHubScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
