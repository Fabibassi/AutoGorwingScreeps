/**
 * Static mining unlock: RCL4, full spawn, finished containers at both sources.
 * Expect dedicated miners (and ideally haulers) — proves container→miner path.
 */
import { pathToFileURL } from "node:url";
import {
  ROOM,
  addBotWithModules,
  createMockupServer,
  patchControllerAndSpawn,
  resetEmptyRoom,
  runTicks,
  stopServer,
  type SimResult,
} from "./harness";

/** Must match harness source coords. */
const SOURCES: Array<[number, number]> = [
  [10, 40],
  [40, 10],
];

function parseArgs(argv: string[]) {
  let instance = "miners-0";
  let ticks = 120;
  let port = 21029;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
  }
  return { instance, ticks, port };
}

export async function runMinersScenario(opts: {
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

    for (const [sx, sy] of SOURCES) {
      // Container adjacent east of source (walkable mining seat).
      // hits required — mockup drops containers without them.
      await server.world.addRoomObject(ROOM, "container", sx + 1, sy, {
        store: { energy: 0 },
        storeCapacityResource: { energy: 2000 },
        hits: 250_000,
        hitsMax: 250_000,
        user: bot.id,
      });
    }

    return await runTicks(server, opts.instance, opts.ticks, (final) => {
      const miners = final.roles.miner ?? 0;
      if (miners >= 1) return "miner spawned at containered source";
      return null;
    });
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] miners instance=${args.instance} port=${args.port} ticks=${args.ticks}`,
  );
  const result = await runMinersScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
