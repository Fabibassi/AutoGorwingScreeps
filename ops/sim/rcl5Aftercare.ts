/**
 * Early RCL5 aftercare: live-like hub seed (just hit RCL5), compare rcl5Mode
 * for first ~48h window (default 50k ticks ≈ wall-clock at ~3.2s/tick).
 *
 * Score milestones: tower#2, extensions→30, RCL6 progress, storage floor.
 *
 * Usage:
 *   npx tsx ops/sim/rcl5Aftercare.ts --mode hub_spend --ticks 20000 --port 27600
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

/** Match live home-ish footprint (~15 ext under climb pause). */
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
];

const START_STORAGE = 100_000;
const START_EXTENSIONS = 15;
const HUB_EXT_TARGET = 30;
const HUB_TOWER_TARGET = 2;

function parseArgs(argv: string[]) {
  let instance = "rcl5ac-0";
  let ticks = 50_000;
  let port = 27600;
  let mode = "hub_spend";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (a === "--mode" && argv[i + 1]) mode = argv[++i];
  }
  return { instance, ticks, port, mode: parseRcl5Mode(mode) };
}

export async function runRcl5AftercareScenario(opts: {
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

    // live home already has a controller container — seed it so aftercare
    // WORK is not diluted across new container sites while finishing ext→30.
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

    await server.world.addRoomObject(ROOM, "storage", SPAWN_X + 2, SPAWN_Y - 2, {
      store: { energy: START_STORAGE },
      storeCapacityResource: { energy: 1_000_000 },
      hits: 10_000,
      hitsMax: 10_000,
      user: bot.id,
    });

    let extPlaced = 0;
    for (const [dx, dy] of EXT_STAMP) {
      if (extPlaced >= START_EXTENSIONS) break;
      const x = SPAWN_X + dx;
      const y = SPAWN_Y + dy;
      if (x === SPAWN_X + 2 && y === SPAWN_Y + 2) continue;
      if (x === SPAWN_X + 2 && y === SPAWN_Y - 2) continue;
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
    let tower2Tick: number | null = null;
    let ext30Tick: number | null = null;
    let hubReadyTick: number | null = null;
    let minStorage = final.storageEnergy;
    let peakProgress = final.progress;

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
      reason: `rcl5Aftercare mode=${mode} startExt=${START_EXTENSIONS} storage=${START_STORAGE}`,
    });

    for (let i = 0; i < opts.ticks; i++) {
      await server.tick();
      await syncControllerProgress(server);
      final = await readRoomSummary(server, bot);
      peakProgress = Math.max(peakProgress, final.progress);
      minStorage = Math.min(minStorage, final.storageEnergy);

      if (tower2Tick == null && final.towers >= HUB_TOWER_TARGET) {
        tower2Tick = i + 1;
      }
      if (ext30Tick == null && final.extensions >= HUB_EXT_TARGET) {
        ext30Tick = i + 1;
      }
      if (
        hubReadyTick == null &&
        final.towers >= HUB_TOWER_TARGET &&
        final.extensions >= HUB_EXT_TARGET
      ) {
        hubReadyTick = i + 1;
      }

      if (i < 3 || i % 250 === 0) {
        console.log(`[sim|${opts.instance}] t${i + 1}`, {
          mode,
          rcl: final.rcl,
          progress: final.progress,
          towers: final.towers,
          extensions: final.extensions,
          sites: final.sites,
          roles: final.roles,
          storageEnergy: final.storageEnergy,
          hub: hubReadyTick,
          tower2: tower2Tick,
          ext30: ext30Tick,
        });
        publish({
          reason:
            `mode=${mode} t${i + 1} tw=${final.towers} ext=${final.extensions} ` +
            `p=${final.progress} hub@${hubReadyTick ?? "-"} tower2@${tower2Tick ?? "-"} ext30@${ext30Tick ?? "-"}`,
        });
      }

      if (i > 0 && i % 250 === 0) {
        await setBotRcl5Mode(bot, mode);
      }

      // Early exit once hub is complete and we have a short progress sample.
      if (hubReadyTick != null && i + 1 >= hubReadyTick + 2_000) {
        break;
      }
    }

    const gained = Math.max(0, peakProgress);
    const reason =
      `aftercare mode=${mode} hub@${hubReadyTick ?? "-"} tower2@${tower2Tick ?? "-"} ` +
      `ext30@${ext30Tick ?? "-"} p=${final.progress} gained=${gained} ` +
      `minStorage=${minStorage} tw=${final.towers} ext=${final.extensions} ` +
      `upg=${final.roles.upgrader ?? 0} bld=${final.roles.builder ?? 0}`;
    const ok =
      (hubReadyTick != null && minStorage >= 2_000) ||
      (final.towers >= HUB_TOWER_TARGET &&
        final.extensions >= 20 &&
        minStorage >= 2_000);
    publish({ done: true, ok, reason });
    return { ok, ticksRun: final.gameTime || opts.ticks, final, reason };
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] rcl5Aftercare mode=${args.mode} instance=${args.instance} port=${args.port} ticks=${args.ticks}`,
  );
  const result = await runRcl5AftercareScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
