/**
 * Soft-lock → full economy: spawn empty, storage full, 0 creeps.
 * Success only when a harvester or miner exists (hauler alone is not enough).
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

function parseArgs(argv: string[]) {
  let instance = "economy-0";
  let ticks = 200;
  let port = 21027;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
  }
  return { instance, ticks, port };
}

export async function runEconomyScenario(opts: {
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
      spawnEnergy: 50,
      progressTotal: 45000,
    });
    await server.world.addRoomObject(ROOM, "storage", 26, 25, {
      store: { energy: 2000 },
      storeCapacityResource: { energy: 1000000 },
      user: bot.id,
    });

    return await runTicks(server, opts.instance, opts.ticks, (final) => {
      const economy =
        (final.roles.harvester ?? 0) + (final.roles.miner ?? 0) > 0;
      if (economy) return "economy creeps after soft-lock";
      return null;
    });
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] economy instance=${args.instance} port=${args.port} ticks=${args.ticks}`,
  );
  const result = await runEconomyScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
