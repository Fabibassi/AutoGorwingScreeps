/**
 * Post-storage hub pipeline gate.
 *
 * Start at RCL3 with tower + stamped extensions + both source containers banked
 * (≥3k energy, with hits so mockup keeps them). Fast-forward to RCL4 once
 * economy is alive, then require:
 *   1) storage structure
 *   2) filler ≥ 1
 *   3) hub flow (storageEnergy ≥ 200 or upgrader ≥ 2)
 *
 * Usage: npx tsx ops/sim/storageHub.ts --ticks 12000 --port 27200
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
  setBotExperiment,
  stopServer,
  writeLiveStatus,
  type SimResult,
  type SimServer,
} from "./harness";

const SOURCES: Array<[number, number]> = [
  [10, 40],
  [40, 10],
];

/** Mirror of HUB_EXTENSION_STAMP pockets (never hub road corridors). */
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

function parseArgs(argv: string[]) {
  let instance = "storageHub-0";
  let ticks = 12_000;
  let port = 27200;
  let progressPerTick = 30_000;
  let storageBlackoutReserve: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (a === "--progress-per-tick" && argv[i + 1]) {
      progressPerTick = Number(argv[++i]);
    } else if (a === "--storage-blackout-reserve" && argv[i + 1]) {
      storageBlackoutReserve = Number(argv[++i]);
    }
  }
  return { instance, ticks, port, progressPerTick, storageBlackoutReserve };
}

async function countType(server: SimServer, type: string): Promise<number> {
  const objects = await server.common.storage.db["rooms.objects"].find({
    room: ROOM,
    type,
  });
  return objects.length;
}

async function sumContainerEnergy(server: SimServer): Promise<number> {
  const objects = await server.common.storage.db["rooms.objects"].find({
    room: ROOM,
    type: "container",
  });
  let total = 0;
  for (const o of objects) {
    const store = o.store as Record<string, number> | undefined;
    total += store?.energy ?? 0;
  }
  return total;
}

/** Keep source-container bank ≥3k so surplus priority stays active. */
async function topUpContainers(
  server: SimServer,
  perContainer = 1800,
): Promise<void> {
  const objects = await server.common.storage.db["rooms.objects"].find({
    room: ROOM,
    type: "container",
  });
  for (const o of objects) {
    await server.common.storage.db["rooms.objects"].update(
      { _id: o._id },
      {
        $set: {
          store: { energy: perContainer },
          storeCapacityResource: { energy: 2000 },
          hits: 250_000,
          hitsMax: 250_000,
        },
      },
    );
  }
}

async function writeController(
  server: SimServer,
  level: number,
  progress: number,
  progressTotal: number,
): Promise<void> {
  await server.common.storage.db["rooms.objects"].update(
    { room: ROOM, type: "controller" },
    { $set: { level, progress, progressTotal } },
  );
}

export async function runStorageHubScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
  progressPerTick?: number;
  storageBlackoutReserve?: number;
}): Promise<SimResult> {
  const ppt = opts.progressPerTick ?? 30_000;
  const server = createMockupServer(opts.instance, opts.port);

  try {
    await resetEmptyRoom(server, {
      rcl: 3,
      progressTotal: PROGRESS_TOTAL[3],
    });
    const bot = await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: 3,
      spawnEnergy: 300,
      progressTotal: PROGRESS_TOTAL[3],
    });

    // Surplus bank at sources (≥3k). hits required — mockup drops containers without them.
    for (const [sx, sy] of SOURCES) {
      await server.world.addRoomObject(ROOM, "container", sx + 1, sy, {
        store: { energy: 1800 },
        storeCapacityResource: { energy: 2000 },
        hits: 250_000,
        hitsMax: 250_000,
        user: bot.id,
      });
    }

    // Tower done — storage may lead after surplus (defense first).
    await server.world.addRoomObject(ROOM, "tower", SPAWN_X + 2, SPAWN_Y + 2, {
      store: { energy: 500 },
      storeCapacityResource: { energy: 1000 },
      hits: 3000,
      hitsMax: 3000,
      user: bot.id,
    });

    let extPlaced = 0;
    for (const [dx, dy] of EXT_STAMP) {
      if (extPlaced >= 10) break;
      const x = SPAWN_X + dx;
      const y = SPAWN_Y + dy;
      if (x === SPAWN_X + 2 && y === SPAWN_Y + 2) continue;
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
    if (opts.storageBlackoutReserve !== undefined) {
      await setBotExperiment(bot, {
        storageBlackoutReserve: opts.storageBlackoutReserve,
      });
    }
    await server.tick();

    let final = await readRoomSummary(server, bot);
    let storageTick: number | null = null;
    let fillerTick: number | null = null;
    let hubFlowTick: number | null = null;
    let peakStorage = 0;
    let minStorageAfterHub = Number.POSITIVE_INFINITY;
    let minSpawnAfterHub = Number.POSITIVE_INFINITY;

    const publish = (extra?: Parameters<typeof liveFromSummary>[3]) => {
      writeLiveStatus(
        liveFromSummary(opts.instance, opts.ticks, final, {
          ...extra,
          roles: {
            ...final.roles,
            _storage: storageTick == null ? 0 : 1,
            _filler: fillerTick == null ? 0 : 1,
            _hub: hubFlowTick == null ? 0 : 1,
          },
        }),
      );
    };
    publish({ reason: "storageHub rcl3 surplus → rcl4 storage hub" });

    for (let i = 0; i < opts.ticks; i++) {
      await server.tick();
      final = await readRoomSummary(server, bot);

      const economy =
        (final.roles.harvester ?? 0) + (final.roles.miner ?? 0) > 0;

      if (economy && final.rcl < 4) {
        let level = final.rcl;
        let progress = final.progress + ppt;
        let progressTotal =
          final.progressTotal > 0
            ? final.progressTotal
            : (PROGRESS_TOTAL[level] ?? 45_000);
        while (level < 4 && progressTotal > 0 && progress >= progressTotal) {
          progress -= progressTotal;
          level += 1;
          progressTotal = PROGRESS_TOTAL[level] ?? 0;
        }
        await writeController(server, level, progress, progressTotal);
        final = await readRoomSummary(server, bot);
      }

      // Hold surplus while storage is missing so queue stays storage-first.
      if (final.containers >= 2 && storageTick == null) {
        await topUpContainers(server, 1800);
      }

      const storages = await countType(server, "storage");
      const hasStorage = storages > 0;
      if (hasStorage && storageTick == null) storageTick = i + 1;

      const fillers = final.roles.filler ?? 0;
      if (hasStorage && fillers >= 1 && fillerTick == null) {
        fillerTick = i + 1;
      }

      peakStorage = Math.max(peakStorage, final.storageEnergy);
      const upgraders = final.roles.upgrader ?? 0;
      if (
        hasStorage &&
        fillers >= 1 &&
        (final.storageEnergy >= 200 || upgraders >= 2) &&
        hubFlowTick == null
      ) {
        hubFlowTick = i + 1;
      }
      // Floor metrics only after hub is online and storage has been filled once
      // (ignore the empty brand-new STRUCTURE_STORAGE tick).
      if (hubFlowTick != null && final.storageEnergy > 0) {
        minStorageAfterHub = Math.min(minStorageAfterHub, final.storageEnergy);
        minSpawnAfterHub = Math.min(minSpawnAfterHub, final.spawnEnergy);
      }

      if (i < 5 || i % 100 === 0) {
        const containerEnergy = await sumContainerEnergy(server);
        console.log(`[sim|${opts.instance}] t${i + 1}`, {
          rcl: final.rcl,
          creeps: final.creeps,
          spawnEnergy: final.spawnEnergy,
          containers: final.containers,
          containerEnergy,
          storages,
          storageEnergy: final.storageEnergy,
          sites: final.sites,
          extensions: final.extensions,
          roles: final.roles,
          storageTick,
          fillerTick,
          hubFlowTick,
        });
        publish({
          reason: `c=${final.containers} storage=${hasStorage} filler=${fillers} upg=${upgraders}`,
        });
      }

      if (storageTick != null && fillerTick != null && hubFlowTick != null) {
        // Keep running a bit to measure blackout floor under load.
        if (i + 1 < Math.min(opts.ticks, hubFlowTick + 2000)) {
          /* continue */
        } else {
          const minS =
            minStorageAfterHub === Number.POSITIVE_INFINITY
              ? 0
              : minStorageAfterHub;
          const minSp =
            minSpawnAfterHub === Number.POSITIVE_INFINITY
              ? 0
              : minSpawnAfterHub;
          const reason = `storage hub online @${hubFlowTick} (storage@${storageTick} filler@${fillerTick} peakStorage=${peakStorage} minStorage=${minS} minSpawn=${minSp} reserve=${opts.storageBlackoutReserve ?? "default"})`;
          publish({ done: true, ok: true, reason });
          return { ok: true, ticksRun: i + 1, final, reason };
        }
      }
    }

    const storages = await countType(server, "storage");
    const containerEnergy = await sumContainerEnergy(server);
    const minS =
      minStorageAfterHub === Number.POSITIVE_INFINITY ? 0 : minStorageAfterHub;
    const minSp =
      minSpawnAfterHub === Number.POSITIVE_INFINITY ? 0 : minSpawnAfterHub;
    const reason = `timeout c=${final.containers} storage=${storages} filler=${final.roles.filler ?? 0} upg=${final.roles.upgrader ?? 0} storageE=${final.storageEnergy} containerE=${containerEnergy} peakStorage=${peakStorage} minStorage=${minS} minSpawn=${minSp}`;
    publish({ done: true, ok: false, reason });
    return { ok: false, ticksRun: opts.ticks, final, reason };
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] storageHub instance=${args.instance} port=${args.port} ticks=${args.ticks} ppt=${args.progressPerTick}` +
      (args.storageBlackoutReserve === undefined
        ? ""
        : ` reserve=${args.storageBlackoutReserve}`),
  );
  const result = await runStorageHubScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
