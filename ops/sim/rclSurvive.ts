/**
 * RCL survive gate: room already at --rcl N with basic infra.
 * Success: within ticks, at least one economy creep (harvester|miner) is alive
 * and controller level is still N (no downgrade / wipe).
 *
 * Usage: npx tsx ops/sim/rclSurvive.ts --rcl 5 --ticks 150
 */
import { pathToFileURL } from "node:url";
import {
  ROOM,
  PROGRESS_TOTAL,
  addBotWithModules,
  createMockupServer,
  patchControllerAndSpawn,
  resetEmptyRoom,
  runTicks,
  stopServer,
  type SimResult,
} from "./harness";

/** @deprecated import from harness — kept for existing sim imports. */
export { PROGRESS_TOTAL } from "./harness";

const SOURCES: Array<[number, number]> = [
  [10, 40],
  [40, 10],
];

function parseArgs(argv: string[]) {
  let instance = "rcl-0";
  let ticks = 150;
  let port = 21040;
  let rcl = 1;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (a === "--rcl" && argv[i + 1]) rcl = Number(argv[++i]);
  }
  return { instance, ticks, port, rcl: Math.max(1, Math.min(8, rcl)) };
}

export async function runRclSurviveScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
  rcl: number;
}): Promise<SimResult> {
  const server = createMockupServer(opts.instance, opts.port);
  const progressTotal = PROGRESS_TOTAL[opts.rcl] ?? 45_000;

  try {
    await resetEmptyRoom(server, { rcl: opts.rcl, progressTotal });
    const bot = await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: opts.rcl,
      spawnEnergy: 300,
      progressTotal,
    });

    if (opts.rcl >= 2) {
      for (const [sx, sy] of SOURCES) {
        await server.world.addRoomObject(ROOM, "container", sx + 1, sy, {
          store: { energy: 500 },
          storeCapacityResource: { energy: 2000 },
          user: bot.id,
        });
      }
    }
    if (opts.rcl >= 4) {
      await server.world.addRoomObject(ROOM, "storage", 27, 25, {
        store: { energy: 5000 },
        storeCapacityResource: { energy: 1_000_000 },
        user: bot.id,
      });
    }

    let economyStreak = 0;
    return await runTicks(server, opts.instance, opts.ticks, (final) => {
      const economy =
        (final.roles.harvester ?? 0) + (final.roles.miner ?? 0) > 0;
      economyStreak = economy ? economyStreak + 1 : 0;
      if (economyStreak >= 15) {
        return `rcl${opts.rcl} economy stable`;
      }
      return null;
    });
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const instance =
    args.instance === "rcl-0" ? `rcl${args.rcl}-0` : args.instance;
  console.log(
    `[sim] rclSurvive rcl=${args.rcl} instance=${instance} port=${args.port} ticks=${args.ticks}`,
  );
  const result = await runRclSurviveScenario({ ...args, instance });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
