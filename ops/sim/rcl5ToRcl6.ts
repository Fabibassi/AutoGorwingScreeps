/**
 * Post-hub RCL5 → RCL6: hub-ready seed, compare rcl5Mode until RCL6 or tick cap.
 *
 * Primary: ticks_to_rcl6. Gate: minStorage ≥ 20k.
 *
 * Usage:
 *   npx tsx ops/sim/rcl5ToRcl6.ts --mode upgrade_rush --ticks 40000 --port 27800
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
  setBotRcl5Mode,
  stopServer,
  syncControllerProgress,
  writeLiveStatus,
  type SimResult,
} from "./harness";
import { RCL5_MODES, parseRcl5Mode } from "../../src/earlyGame/rcl5Mode";

const SOURCES: Array<[number, number]> = [
  [10, 40],
  [40, 10],
];

/** Full RCL5 extension stamp (30). */
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
const RCL6_TARGET = 6;

function parseArgs(argv: string[]) {
  let instance = "rcl5to6-0";
  let ticks = 40_000;
  let port = 27_800;
  let mode = "upgrade_rush";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (a === "--mode" && argv[i + 1]) mode = argv[++i];
  }
  return { instance, ticks, port, mode: parseRcl5Mode(mode) };
}

export async function runRcl5ToRcl6Scenario(opts: {
  instance: string;
  ticks: number;
  port: number;
  mode: string;
}): Promise<SimResult> {
  const mode = parseRcl5Mode(opts.mode);
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
    await setBotRcl5Mode(bot, mode);
    await server.tick();

    let final = await readRoomSummary(server, bot);
    let rcl6Tick: number | null = null;
    let minStorage = final.storageEnergy;
    let peakProgress = final.progress;
    let peakRcl = final.rcl;

    const publish = (extra?: Parameters<typeof liveFromSummary>[3]) => {
      writeLiveStatus(
        liveFromSummary(opts.instance, opts.ticks, final, {
          ...extra,
          roles: {
            ...final.roles,
            _mode: RCL5_MODES.indexOf(mode),
          },
        }),
      );
    };
    publish({
      reason: `rcl5to6 mode=${mode} hubReady seed storage=${START_STORAGE}`,
    });

    for (let i = 0; i < opts.ticks; i++) {
      await server.tick();
      await syncControllerProgress(server);
      final = await readRoomSummary(server, bot);
      peakProgress = Math.max(peakProgress, final.progress);
      peakRcl = Math.max(peakRcl, final.rcl);
      minStorage = Math.min(minStorage, final.storageEnergy);

      if (rcl6Tick == null && final.rcl >= RCL6_TARGET) {
        rcl6Tick = i + 1;
      }

      if (i < 3 || i % 500 === 0) {
        const rate =
          i + 1 > 0
            ? (
                (final.rcl >= RCL6_TARGET
                  ? PROGRESS_TOTAL[5]
                  : final.progress) /
                (i + 1)
              ).toFixed(2)
            : "0";
        console.log(`[sim|${opts.instance}] t${i + 1}`, {
          mode,
          rcl: final.rcl,
          progress: final.progress,
          rate,
          storageEnergy: final.storageEnergy,
          roles: final.roles,
          rcl6: rcl6Tick,
        });
        publish({
          reason:
            `mode=${mode} t${i + 1} rcl=${final.rcl} p=${final.progress} ` +
            `rate=${rate} rcl6@${rcl6Tick ?? "-"} minStorage=${minStorage}`,
        });
      }

      if (i > 0 && i % 250 === 0) {
        await setBotRcl5Mode(bot, mode);
      }

      if (rcl6Tick != null) break;
    }

    const ticksRun = rcl6Tick ?? opts.ticks;
    const progressForRate =
      rcl6Tick != null ? PROGRESS_TOTAL[5] : Math.max(0, peakProgress);
    const progressRate =
      ticksRun > 0 ? Math.round((progressForRate / ticksRun) * 100) / 100 : 0;
    const eta =
      rcl6Tick != null
        ? rcl6Tick
        : progressRate > 0
          ? Math.ceil(PROGRESS_TOTAL[5] / progressRate)
          : null;

    const reason =
      `rcl5to6 mode=${mode} rcl6@${rcl6Tick ?? "-"} eta=${eta ?? "-"} ` +
      `p=${final.progress} peakRcl=${peakRcl} rate=${progressRate} ` +
      `minStorage=${minStorage} upg=${final.roles.upgrader ?? 0} ` +
      `bld=${final.roles.builder ?? 0}`;
    const ok =
      minStorage >= STORAGE_FLOOR &&
      (rcl6Tick != null || (peakRcl >= 5 && progressRate > 0));
    publish({ done: true, ok, reason });
    return { ok, ticksRun, final, reason };
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] rcl5ToRcl6 mode=${args.mode} instance=${args.instance} port=${args.port} ticks=${args.ticks}`,
  );
  const result = await runRcl5ToRcl6Scenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
