/**
 * Post-RCL6 remote income bakeoff arm.
 *
 * Usage:
 *   npx tsx ops/sim/remoteIncome.ts --plan drop_unreserved --haul-range short --ticks 20000
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
  stopServer,
  writeLiveStatus,
  type SimResult,
} from "./harness";
import { parseRemotePlan } from "../../src/earlyGame/remotePlan";

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
  let instance = "remoteIncome-0";
  let ticks = 20_000;
  let port = 28_500;
  let plan = "off";
  let haulRange: "short" | "mid" = "short";
  let variant = "baseline";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (a === "--plan" && argv[i + 1]) plan = argv[++i];
    else if (a === "--variant" && argv[i + 1]) variant = argv[++i];
    else if (a === "--haul-range" && argv[i + 1]) {
      const v = argv[++i];
      haulRange = v === "mid" ? "mid" : "short";
    }
  }
  return {
    instance,
    ticks,
    port,
    plan: parseRemotePlan(plan),
    haulRange,
    variant,
  };
}

export async function runRemoteIncomeScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
  plan: string;
  haulRange: "short" | "mid";
  variant?: string;
}): Promise<SimResult> {
  const plan = parseRemotePlan(opts.plan);
  const variant = opts.variant ?? "baseline";
  const pathLength = opts.haulRange === "short" ? 30 : 90;
  const server = createMockupServer(opts.instance, opts.port);

  try {
    await resetEmptyRoom(server, {
      rcl: 6,
      progressTotal: PROGRESS_TOTAL[6] ?? 1_215_000,
    });
    await addRemoteRoom(server, { haulRange: opts.haulRange });

    const bot = await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: 6,
      spawnEnergy: 300,
      progressTotal: PROGRESS_TOTAL[6] ?? 1_215_000,
    });
    await server.common.storage.db["rooms.objects"].update(
      { room: ROOM, type: "controller" },
      {
        $set: {
          level: 6,
          progress: 0,
          progressTotal: PROGRESS_TOTAL[6] ?? 1_215_000,
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
    // Seed finished links so home is "pipeline ready".
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
      const key = `${x},${y}`;
      if (reserved.has(key)) continue;
      await server.world.addRoomObject(ROOM, "extension", x, y, {
        store: { energy: 50 },
        storeCapacityResource: { energy: 50 },
        hits: 1000,
        hitsMax: 1000,
        user: bot.id,
      });
      reserved.add(key);
      extPlaced++;
    }

    await server.start();
    await setBotRcl5Mode(bot, "fat_first");
    await setBotRcl5Plan(bot, "link_boost");
    await setBotRemotePlan(bot, {
      plan,
      room: REMOTE_ROOM,
      pathLength,
      variant,
    });

    let minStorage = START_STORAGE;
    let spawnBusy = 0;
    const startStorage = START_STORAGE;

    for (let t = 0; t < opts.ticks; t++) {
      await server.tick();
      if (t % 500 === 0 || t === opts.ticks - 1) {
        const summary = await readRoomSummary(server);
        minStorage = Math.min(minStorage, summary.storageEnergy);
        const objects = await server.common.storage.db["rooms.objects"].find({
          room: ROOM,
          type: "spawn",
        });
        if (objects[0]?.spawning) spawnBusy++;
        writeLiveStatus(
          liveFromSummary(opts.instance, opts.ticks, summary, {
            reason: `plan=${plan} variant=${variant} range=${opts.haulRange} t${t} storage=${summary.storageEnergy} minStorage=${minStorage}`,
          }),
        );
        if (t % 2000 === 0) {
          console.log(`[sim|${opts.instance}] t${t}`, {
            plan,
            variant,
            storage: summary.storageEnergy,
            minStorage,
            roles: summary.roles,
          });
        }
      }
    }

    const final = await readRoomSummary(server);
    minStorage = Math.min(minStorage, final.storageEnergy);
    const netDelta = final.storageEnergy - startStorage;
    const netPerTick = netDelta / Math.max(1, opts.ticks);
    const floorOk = minStorage >= STORAGE_FLOOR;
    const ok = floorOk;
    const reason =
      `remoteIncome plan=${plan} variant=${variant} range=${opts.haulRange} ` +
      `netDelta=${netDelta} netPerTick=${netPerTick.toFixed(3)} ` +
      `minStorage=${minStorage} spawnBusySamples=${spawnBusy} ` +
      `storage=${final.storageEnergy}`;

    writeLiveStatus(
      liveFromSummary(opts.instance, opts.ticks, final, {
        ok,
        done: true,
        reason,
      }),
    );

    console.log(`[sim] ${reason}`);
    return { ok, ticksRun: opts.ticks, final, reason };
  } finally {
    await stopServer(server);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] remoteIncome plan=${opts.plan} variant=${opts.variant} ` +
      `range=${opts.haulRange} instance=${opts.instance} port=${opts.port} ticks=${opts.ticks}`,
  );
  const result = await runRemoteIncomeScenario(opts);
  process.exit(result.ok ? 0 : 1);
}

const isDirect =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
