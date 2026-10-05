/**
 * Spawn-exit regression: 6/8 adjacent tiles blocked by extensions, spawn full.
 * Expect harvester still lands on a free exit (Screeps basics).
 */
import { pathToFileURL } from "node:url";
import {
  ROOM,
  SPAWN_X,
  SPAWN_Y,
  addBotWithModules,
  createMockupServer,
  patchControllerAndSpawn,
  resetEmptyRoom,
  runTicks,
  stopServer,
  type SimResult,
} from "./harness";

const RING: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  // leave [-1,1] and [-1,-1] open as spawn exits
];

function parseArgs(argv: string[]) {
  let instance = "surround-0";
  let ticks = 80;
  let port = 21028;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
  }
  return { instance, ticks, port };
}

export async function runSurroundScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
}): Promise<SimResult> {
  const server = createMockupServer(opts.instance, opts.port);

  try {
    await resetEmptyRoom(server, { rcl: 2, progressTotal: 45000 });
    const bot = await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: 2,
      spawnEnergy: 300,
      progressTotal: 45000,
    });

    for (const [dx, dy] of RING) {
      await server.world.addRoomObject(
        ROOM,
        "extension",
        SPAWN_X + dx,
        SPAWN_Y + dy,
        {
          store: { energy: 0 },
          storeCapacityResource: { energy: 50 },
          user: bot.id,
        },
      );
    }

    return await runTicks(server, opts.instance, opts.ticks, (final) => {
      if ((final.roles.harvester ?? 0) >= 1) return "harvester on free spawn exit";
      return null;
    });
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] surround instance=${args.instance} port=${args.port} ticks=${args.ticks}`,
  );
  const result = await runSurroundScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
