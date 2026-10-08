/**
 * RCL4→5 home climb: seeded hub (containers + tower + storage + extensions),
 * real controller upgrade (no progress injection). Compare Memory.ags.rcl5Mode.
 *
 * Remotes intentionally out of scope — home sink first.
 *
 * Usage:
 *   npx tsx ops/sim/rcl5Climb.ts --mode upgrade_rush --ticks 20000 --port 27400
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
];

/** Start partway through RCL4 so relative ranking finishes in a useful wall-time. */
const START_PROGRESS = 320_000;

function parseArgs(argv: string[]) {
  let instance = "rcl5-0";
  let ticks = 20_000;
  let port = 27400;
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

export async function runRcl5ClimbScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
  mode: string;
}): Promise<SimResult> {
  const mode = parseRcl5Mode(opts.mode);
  const server = createMockupServer(opts.instance, opts.port);

  try {
    await resetEmptyRoom(server, {
      rcl: 4,
      progressTotal: PROGRESS_TOTAL[4],
    });
    const bot = await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: 4,
      spawnEnergy: 300,
      progressTotal: PROGRESS_TOTAL[4],
    });
    await server.common.storage.db["rooms.objects"].update(
      { room: ROOM, type: "controller" },
      {
        $set: {
          level: 4,
          progress: START_PROGRESS,
          progressTotal: PROGRESS_TOTAL[4],
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

    await server.world.addRoomObject(ROOM, "tower", SPAWN_X + 2, SPAWN_Y + 2, {
      store: { energy: 800 },
      storeCapacityResource: { energy: 1000 },
      hits: 3000,
      hitsMax: 3000,
      user: bot.id,
    });

    // Stamp pocket (2,-2) — not on spawn exit ring / N-S-E-W corridor rays.
    await server.world.addRoomObject(ROOM, "storage", SPAWN_X + 2, SPAWN_Y - 2, {
      store: { energy: 8000 },
      storeCapacityResource: { energy: 1_000_000 },
      hits: 10_000,
      hitsMax: 10_000,
      user: bot.id,
    });

    let extPlaced = 0;
    for (const [dx, dy] of EXT_STAMP) {
      if (extPlaced >= 15) break;
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
    let peakProgress = final.progress;
    let economyReadyTick: number | null = null;

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
    publish({ reason: `rcl5Climb mode=${mode} startProgress=${START_PROGRESS}` });

    for (let i = 0; i < opts.ticks; i++) {
      await server.tick();
      await syncControllerProgress(server);
      final = await readRoomSummary(server, bot);
      peakProgress = Math.max(peakProgress, final.progress);

      const economy =
        (final.roles.miner ?? 0) >= 1 && (final.roles.upgrader ?? 0) >= 1;
      if (economy && economyReadyTick == null) economyReadyTick = i + 1;

      if (i < 3 || i % 200 === 0) {
        console.log(`[sim|${opts.instance}] t${i + 1}`, {
          mode,
          rcl: final.rcl,
          progress: final.progress,
          roles: final.roles,
          storageEnergy: final.storageEnergy,
          spawnEnergy: final.spawnEnergy,
        });
        publish({ reason: `mode=${mode} rcl=${final.rcl} p=${final.progress}` });
      }

      // Re-assert mode occasionally (sticky should hold; belt-and-suspenders).
      if (i > 0 && i % 200 === 0) {
        await setBotRcl5Mode(bot, mode);
      }

      if (final.rcl >= 5) {
        const reason = `rcl5@${i + 1} mode=${mode} economy@${economyReadyTick ?? "-"} peakP=${peakProgress}`;
        publish({ done: true, ok: true, reason });
        return { ok: true, ticksRun: i + 1, final, reason };
      }
    }

    const gained = Math.max(0, peakProgress - START_PROGRESS);
    const reason = `timeout mode=${mode} rcl=${final.rcl} progress=${final.progress} gained=${gained} economy@${economyReadyTick ?? "-"} upg=${final.roles.upgrader ?? 0}`;
    // Partial credit: more progress is a ranked success for the bench aggregator.
    const ok = gained >= 40_000;
    publish({ done: true, ok, reason });
    return { ok, ticksRun: opts.ticks, final, reason };
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] rcl5Climb mode=${args.mode} instance=${args.instance} port=${args.port} ticks=${args.ticks}`,
  );
  const result = await runRcl5ClimbScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
