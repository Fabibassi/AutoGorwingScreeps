/**
 * Empty-room bootstrap: RCL2, full spawn, 0 creeps, 2 sources.
 * Expect a harvester within N ticks (prove spawn path without soft-lock bank).
 */
import { pathToFileURL } from "node:url";
import {
  addBotWithModules,
  createMockupServer,
  patchControllerAndSpawn,
  resetEmptyRoom,
  runTicks,
  stopServer,
  type SimResult,
} from "./harness";

function parseArgs(argv: string[]) {
  let instance = "boot-0";
  let ticks = 80;
  let port = 21026;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
  }
  return { instance, ticks, port };
}

export async function runBootScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
}): Promise<SimResult> {
  const server = createMockupServer(opts.instance, opts.port);

  try {
    await resetEmptyRoom(server, { rcl: 2, progressTotal: 45000 });
    await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: 2,
      spawnEnergy: 300,
      progressTotal: 45000,
    });

    return await runTicks(server, opts.instance, opts.ticks, (final) => {
      const harvesters = final.roles.harvester ?? 0;
      if (harvesters >= 1) return "harvester spawned";
      return null;
    });
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] boot instance=${args.instance} port=${args.port} ticks=${args.ticks}`,
  );
  const result = await runBootScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
