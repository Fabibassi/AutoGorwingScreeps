/**
 * Wipe-recovery gate: climb to RCL3, kill every creep, then require the bot
 * to restore a working economy without downgrading.
 *
 * Success after wipe:
 *   - RCL stays ≥ wipeRcl
 *   - economy creeps (harvester|miner) return
 *   - spawn pipeline alive (spawnEnergy ≥ 200) for RECOVERY_SUSTAIN ticks
 *
 * Usage: npx tsx ops/sim/wipeRecovery.ts --ticks 50000 --port 27000
 */
import { pathToFileURL } from "node:url";
import {
  addBotWithModules,
  createMockupServer,
  liveFromSummary,
  patchControllerAndSpawn,
  readRoomSummary,
  resetEmptyRoom,
  setBotRoadPolicy,
  stopServer,
  syncControllerProgress,
  wipeAllCreeps,
  writeLiveStatus,
  type SimResult,
} from "./harness";
import { unlockMet } from "./realClimb";

const RECOVERY_SUSTAIN = 500;

function parseArgs(argv: string[]) {
  let instance = "wipe-0";
  let ticks = 50_000;
  let port = 27000;
  let recoveryTicks = 8_000;
  let roadPolicy = "parallel";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (a === "--recovery-ticks" && argv[i + 1]) {
      recoveryTicks = Number(argv[++i]);
    } else if (a === "--road-policy" && argv[i + 1]) roadPolicy = argv[++i];
  }
  return { instance, ticks, port, recoveryTicks, roadPolicy };
}

function economyAlive(roles: Record<string, number>): boolean {
  return (roles.harvester ?? 0) + (roles.miner ?? 0) > 0;
}

export async function runWipeRecoveryScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
  recoveryTicks?: number;
  roadPolicy?: string;
}): Promise<SimResult> {
  const recoveryBudget = opts.recoveryTicks ?? 8_000;
  const roadPolicy = opts.roadPolicy ?? "parallel";
  const server = createMockupServer(opts.instance, opts.port);

  try {
    await resetEmptyRoom(server, { rcl: 1, progressTotal: 200 });
    const bot = await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: 1,
      spawnEnergy: 300,
      progressTotal: 200,
    });

    await server.start();
    await setBotRoadPolicy(bot, roadPolicy);
    await server.tick();

    let final = await readRoomSummary(server);
    let phase: "climb" | "wiped" | "recover" = "climb";
    let wipeAt: number | null = null;
    let wipeRcl = 1;
    let recoverSustain = 0;
    let deadStreak = 0;
    let rcl3Tick: number | null = null;

    const publish = (extra?: Parameters<typeof liveFromSummary>[3]) => {
      writeLiveStatus(
        liveFromSummary(opts.instance, opts.ticks, final, {
          ...extra,
          roles: {
            ...final.roles,
            _phase: phase === "climb" ? 0 : phase === "wiped" ? 1 : 2,
            _recover: recoverSustain,
          },
          reason: extra?.reason,
        }),
      );
    };
    publish({ reason: `wipeRecovery climb policy=${roadPolicy}` });

    for (let i = 0; i < opts.ticks; i++) {
      if (i % 100 === 0) await setBotRoadPolicy(bot, roadPolicy);
      await server.tick();
      await syncControllerProgress(server);
      final = await readRoomSummary(server);

      if (rcl3Tick == null && final.rcl >= 3) rcl3Tick = i + 1;

      if (phase === "climb") {
        const economy = economyAlive(final.roles);
        if (!economy) deadStreak++;
        else deadStreak = 0;
        if (deadStreak >= 80) {
          const reason = `wipeRecovery climb dead ${deadStreak}t @RCL${final.rcl}`;
          publish({ done: true, ok: false, reason });
          return { ok: false, ticksRun: i + 1, final, reason };
        }

        if (i < 5 || i % 50 === 0) {
          console.log(`[sim|${opts.instance}] climb t${i + 1}`, final);
          publish({
            reason: `wipeRecovery climb rcl3@${rcl3Tick ?? "-"}`,
          });
        }

        if (unlockMet(final) && final.rcl >= 3) {
          wipeRcl = final.rcl;
          await wipeAllCreeps(bot);
          await server.tick();
          final = await readRoomSummary(server);
          phase = "wiped";
          wipeAt = i + 1;
          console.log(
            `[sim|${opts.instance}] WIPE at t${wipeAt} rcl=${wipeRcl} creeps=${final.creeps}`,
            final,
          );
          publish({
            reason: `wipeRecovery wiped@${wipeAt} rcl=${wipeRcl}`,
          });
        }
        continue;
      }

      // Recovery window starts the tick after wipe.
      if (phase === "wiped") phase = "recover";
      const elapsed = wipeAt == null ? 0 : i + 1 - wipeAt;
      if (elapsed > recoveryBudget) {
        const reason = `wipeRecovery timeout after wipe@${wipeAt} sustain=${recoverSustain}/${RECOVERY_SUSTAIN} rcl=${final.rcl} creeps=${final.creeps}`;
        publish({ done: true, ok: false, reason });
        return { ok: false, ticksRun: i + 1, final, reason };
      }

      if (final.rcl < wipeRcl) {
        const reason = `wipeRecovery downgraded RCL${wipeRcl}→${final.rcl} after wipe@${wipeAt}`;
        publish({ done: true, ok: false, reason });
        return { ok: false, ticksRun: i + 1, final, reason };
      }

      const healthy =
        economyAlive(final.roles) &&
        final.creeps >= 2 &&
        final.spawnEnergy >= 200;
      if (healthy) recoverSustain++;
      else recoverSustain = 0;

      if (elapsed < 5 || elapsed % 25 === 0) {
        console.log(`[sim|${opts.instance}] recover +${elapsed}`, {
          ...final,
          recoverSustain,
        });
        publish({
          reason: `wipeRecovery recover +${elapsed} sustain=${recoverSustain}`,
        });
      }

      if (recoverSustain >= RECOVERY_SUSTAIN) {
        const reason = `wipeRecovery OK wipe@${wipeAt} recover=${elapsed} sustain=${recoverSustain} rcl=${final.rcl} creeps=${final.creeps} spawn=${final.spawnEnergy}`;
        publish({ done: true, ok: true, reason });
        return { ok: true, ticksRun: i + 1, final, reason };
      }
    }

    const reason =
      wipeAt == null
        ? `wipeRecovery timeout no-rcl3 peakRCL=${final.rcl}`
        : `wipeRecovery timeout wipe@${wipeAt} sustain=${recoverSustain}/${RECOVERY_SUSTAIN}`;
    publish({ done: true, ok: false, reason });
    return { ok: false, ticksRun: opts.ticks, final, reason };
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] wipeRecovery instance=${args.instance} port=${args.port} ticks=${args.ticks} recovery=${args.recoveryTicks}`,
  );
  const result = await runWipeRecoveryScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
