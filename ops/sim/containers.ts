/**
 * Multi-phase early-game: RCL4, full spawn + storage bank, no source containers.
 * Success: at least one dedicated miner after the bot builds containers,
 * or both source containers finished within the tick budget.
 */
import { pathToFileURL } from "node:url";
import {
  ROOM,
  addBotWithModules,
  createMockupServer,
  liveFromSummary,
  patchControllerAndSpawn,
  readRoomSummary,
  resetEmptyRoom,
  stopServer,
  writeLiveStatus,
  type SimResult,
  type SimServer,
} from "./harness";

const SOURCES: Array<[number, number]> = [
  [10, 40],
  [40, 10],
];

function parseArgs(argv: string[]) {
  let instance = "containers-0";
  let ticks = 2000;
  let port = 21030;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
  }
  return { instance, ticks, port };
}

async function countSourceContainers(server: SimServer): Promise<number> {
  const objects = await server.common.storage.db["rooms.objects"].find({
    room: ROOM,
  });
  let n = 0;
  for (const o of objects) {
    if (o.type !== "container") continue;
    const x = Number(o.x);
    const y = Number(o.y);
    for (const [sx, sy] of SOURCES) {
      if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) <= 1) {
        n++;
        break;
      }
    }
  }
  return n;
}

export async function runContainersScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
}): Promise<SimResult> {
  const server = createMockupServer(opts.instance, opts.port);
  try {
    await resetEmptyRoom(server, { rcl: 4, progressTotal: 45000 });
    const bot = await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: 4,
      spawnEnergy: 300,
      progressTotal: 45000,
    });
    await server.world.addRoomObject(ROOM, "storage", 27, 25, {
      store: { energy: 5000 },
      storeCapacityResource: { energy: 1000000 },
      user: bot.id,
    });

    await server.start();
    await server.tick();
    let final = await readRoomSummary(server);
    writeLiveStatus(liveFromSummary(opts.instance, opts.ticks, final));

    for (let i = 0; i < opts.ticks; i++) {
      await server.tick();
      final = await readRoomSummary(server);
      if (i < 3 || i % 25 === 0) {
        console.log(`[sim|${opts.instance}] t${i + 1}`, final);
        writeLiveStatus(liveFromSummary(opts.instance, opts.ticks, final));
      }

      const miners = final.roles.miner ?? 0;
      if (miners >= 1) {
        const reason = "miner after container unlock";
        writeLiveStatus(
          liveFromSummary(opts.instance, opts.ticks, final, {
            done: true,
            ok: true,
            reason,
          }),
        );
        return { ok: true, ticksRun: i + 1, final, reason };
      }

      const containers = await countSourceContainers(server);
      if (containers >= 2) {
        const reason = "both source containers built";
        writeLiveStatus(
          liveFromSummary(opts.instance, opts.ticks, final, {
            done: true,
            ok: true,
            reason,
          }),
        );
        return { ok: true, ticksRun: i + 1, final, reason };
      }
    }

    const containers = await countSourceContainers(server);
    const reason = `no unlock; sourceContainers=${containers}`;
    writeLiveStatus(
      liveFromSummary(opts.instance, opts.ticks, final, {
        done: true,
        ok: false,
        reason,
      }),
    );
    return { ok: false, ticksRun: opts.ticks, final, reason };
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] containers instance=${args.instance} port=${args.port} ticks=${args.ticks}`,
  );
  const result = await runContainersScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
