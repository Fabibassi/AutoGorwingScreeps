/**
 * RCL climb: start RCL1, inject controller progress while economy is healthy
 * (mockup fast-forward). Success when controller reaches RCL8 and economy
 * creeps are still alive.
 *
 * Usage: npx tsx ops/sim/rclClimb.ts --ticks 2000
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
import { PROGRESS_TOTAL } from "./rclSurvive";

function parseArgs(argv: string[]) {
  let instance = "climb-0";
  let ticks = 2500;
  let port = 21050;
  /** Progress injected per tick while economy healthy (accelerates RCL). */
  let progressPerTick = 50_000;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (a === "--progress-per-tick" && argv[i + 1])
      progressPerTick = Number(argv[++i]);
  }
  return { instance, ticks, port, progressPerTick };
}

async function readController(
  server: SimServer,
): Promise<{ level: number; progress: number; progressTotal: number }> {
  const objects = await server.common.storage.db["rooms.objects"].find({
    room: ROOM,
    type: "controller",
  });
  const c = objects[0] ?? {};
  return {
    level: Number(c.level ?? 1),
    progress: Number(c.progress ?? 0),
    progressTotal: Number(c.progressTotal ?? 200),
  };
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

export async function runRclClimbScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
  progressPerTick: number;
}): Promise<SimResult> {
  const server = createMockupServer(opts.instance, opts.port);
  try {
    await resetEmptyRoom(server, { rcl: 1, progressTotal: 200 });
    await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: 1,
      spawnEnergy: 300,
      progressTotal: 200,
    });

    await server.start();
    await server.tick();
    let final = await readRoomSummary(server);
    let stableAt8 = 0;

    for (let i = 0; i < opts.ticks; i++) {
      await server.tick();
      final = await readRoomSummary(server);
      const ctrl = await readController(server);
      const economy =
        (final.roles.harvester ?? 0) + (final.roles.miner ?? 0) > 0;

      if (economy && ctrl.level < 8) {
        let { level, progress, progressTotal } = ctrl;
        progress += opts.progressPerTick;
        while (level < 8 && progressTotal > 0 && progress >= progressTotal) {
          progress -= progressTotal;
          level += 1;
          progressTotal = PROGRESS_TOTAL[level] ?? 0;
          if (level >= 8) {
            level = 8;
            progress = 0;
            progressTotal = 0;
          }
        }
        await writeController(server, level, progress, progressTotal);
      }

      const after = await readController(server);
      if (i < 3 || i % 50 === 0) {
        console.log(`[sim|${opts.instance}] t${i + 1}`, {
          ...final,
          rcl: after.level,
          progress: after.progress,
        });
        writeLiveStatus(
          liveFromSummary(opts.instance, opts.ticks, final, {
            rcl: after.level,
            progress: after.progress,
            progressTotal: after.progressTotal,
            roles: { ...final.roles },
          }),
        );
      }

      if (after.level >= 8 && economy) {
        stableAt8++;
        if (stableAt8 >= 20) {
          const reason = "RCL8 reached with healthy economy";
          writeLiveStatus(
            liveFromSummary(opts.instance, opts.ticks, final, {
              rcl: after.level,
              progress: after.progress,
              progressTotal: after.progressTotal,
              done: true,
              ok: true,
              reason,
            }),
          );
          return { ok: true, ticksRun: i + 1, final, reason };
        }
      } else {
        stableAt8 = 0;
      }
    }

    const ctrl = await readController(server);
    const reason = `stopped at RCL${ctrl.level}; economy=${
      (final.roles.harvester ?? 0) + (final.roles.miner ?? 0)
    }`;
    return { ok: false, ticksRun: opts.ticks, final, reason };
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] rclClimb instance=${args.instance} port=${args.port} ticks=${args.ticks} ppt=${args.progressPerTick}`,
  );
  const result = await runRclClimbScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
