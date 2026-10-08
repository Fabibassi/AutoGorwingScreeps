/**
 * Real RCL climb: no progress injection. Bot must upgrade / build for real.
 *
 * Success (overnight goal):
 *   RCL>=3, containers>=2, miners>=1, roads>=1,
 *   then economy stays alive for SUSTAIN_TICKS (one creep generation).
 *
 * Usage:
 *   npx tsx ops/sim/realClimb.ts --ticks 50000 --road-policy parallel
 *   npx tsx ops/sim/realClimb.ts --ticks 50000 --ab-knob extensionBootstrap --ab-variant 0
 */
import { pathToFileURL } from "node:url";
import {
  addBotWithModules,
  createMockupServer,
  liveFromSummary,
  patchControllerAndSpawn,
  readRoomSummary,
  resetEmptyRoom,
  setBotExperiment,
  setBotRoadPolicy,
  stopServer,
  syncControllerProgress,
  writeLiveStatus,
  type SimResult,
} from "./harness";

/** One creep generation after unlock — TTL stress. */
export const SUSTAIN_TICKS = 1500;

export function unlockMet(summary: {
  rcl: number;
  containers: number;
  roads: number;
  roles: Record<string, number>;
}): boolean {
  const miners = summary.roles.miner ?? 0;
  return (
    summary.rcl >= 3 &&
    summary.containers >= 2 &&
    miners >= 1 &&
    summary.roads >= 1
  );
}

function parseArgs(argv: string[]) {
  let instance = "real-0";
  let ticks = 50_000;
  let port = 23000;
  let sustain = SUSTAIN_TICKS;
  let roadPolicy = "parallel";
  let abKnob = "";
  let abVariant = "";
  let profile = "";
  let idleBuilderUpgrade: boolean | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (a === "--sustain" && argv[i + 1]) sustain = Number(argv[++i]);
    else if (a === "--road-policy" && argv[i + 1]) roadPolicy = argv[++i];
    else if (a === "--ab-knob" && argv[i + 1]) abKnob = argv[++i];
    else if (a === "--ab-variant" && argv[i + 1]) abVariant = argv[++i];
    else if (a === "--profile" && argv[i + 1]) profile = argv[++i];
    else if (a === "--idle-builder-upgrade" && argv[i + 1]) {
      idleBuilderUpgrade = argv[++i] !== "false";
    }
  }
  return {
    instance,
    ticks,
    port,
    sustain,
    roadPolicy,
    abKnob,
    abVariant,
    profile,
    idleBuilderUpgrade,
  };
}

function policyTag(opts: {
  roadPolicy: string;
  abKnob?: string;
  abVariant?: string;
  profile?: string;
}): string {
  if (opts.abKnob) {
    return `ab=${opts.abKnob}:${opts.abVariant || "?"}`;
  }
  if (opts.profile) return `profile=${opts.profile}`;
  return `policy=${opts.roadPolicy}`;
}

export async function runRealClimbScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
  sustain?: number;
  roadPolicy?: string;
  abKnob?: string;
  abVariant?: string;
  profile?: string;
  idleBuilderUpgrade?: boolean;
}): Promise<SimResult> {
  const sustainNeed = opts.sustain ?? SUSTAIN_TICKS;
  const roadPolicy = opts.roadPolicy ?? "parallel";
  const tag = [
    policyTag({
      roadPolicy,
      abKnob: opts.abKnob,
      abVariant: opts.abVariant,
      profile: opts.profile,
    }),
    opts.idleBuilderUpgrade === undefined
      ? ""
      : `idleBuilder=${opts.idleBuilderUpgrade ? "on" : "off"}`,
  ]
    .filter(Boolean)
    .join(" ");
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
    if (opts.abKnob || opts.profile || opts.idleBuilderUpgrade !== undefined) {
      await setBotExperiment(bot, {
        knob: opts.abKnob,
        variant: opts.abVariant,
        profile: opts.profile,
        roadPolicy,
        idleBuilderUpgrade: opts.idleBuilderUpgrade,
      });
    } else {
      await setBotRoadPolicy(bot, roadPolicy);
    }
    await server.tick();
    let final = await readRoomSummary(server, bot);
    let deadStreak = 0;
    let peakRcl = final.rcl;
    let peakContainers = final.containers;
    let peakRoads = final.roads;
    let peakSites = final.sites;
    let unlockTick: number | null = null;
    let sustainAlive = 0;
    let firstRoadTick: number | null = null;
    let containers2Tick: number | null = null;
    let rcl3Tick: number | null = null;

    const publish = (extra?: Parameters<typeof liveFromSummary>[3]) => {
      writeLiveStatus(
        liveFromSummary(opts.instance, opts.ticks, final, {
          ...extra,
          roles: {
            ...final.roles,
            _unlock: unlockTick == null ? 0 : 1,
            _sustain: sustainAlive,
          },
          reason: extra?.reason,
        }),
      );
    };
    publish({ reason: tag });

    for (let i = 0; i < opts.ticks; i++) {
      // Re-assert experiment knobs every 100 ticks (console applies next tick).
      if (i % 100 === 0) {
        if (opts.abKnob || opts.profile) {
          await setBotExperiment(bot, {
            knob: opts.abKnob,
            variant: opts.abVariant,
            profile: opts.profile,
            roadPolicy,
          });
        } else {
          await setBotRoadPolicy(bot, roadPolicy);
        }
      }
      await server.tick();
      await syncControllerProgress(server);
      final = await readRoomSummary(server, bot);
      peakRcl = Math.max(peakRcl, final.rcl);
      peakContainers = Math.max(peakContainers, final.containers);
      peakRoads = Math.max(peakRoads, final.roads);
      peakSites = Math.max(peakSites, final.sites);

      if (firstRoadTick == null && final.roads >= 1) firstRoadTick = i + 1;
      if (containers2Tick == null && final.containers >= 2) {
        containers2Tick = i + 1;
      }
      if (rcl3Tick == null && final.rcl >= 3) rcl3Tick = i + 1;

      const economy =
        (final.roles.harvester ?? 0) + (final.roles.miner ?? 0) > 0;
      if (!economy) deadStreak++;
      else deadStreak = 0;

      if (i < 5 || i % 25 === 0) {
        console.log(`[sim|${opts.instance}] t${i + 1}`, {
          ...final,
          roadPolicy,
          abKnob: opts.abKnob,
          abVariant: opts.abVariant,
          firstRoadTick,
          containers2Tick,
          rcl3Tick,
          unlockTick,
          sustainAlive,
        });
        publish({
          reason: `${tag} road@${firstRoadTick ?? "-"} c2@${containers2Tick ?? "-"} rcl3@${rcl3Tick ?? "-"}`,
        });
      }

      if (deadStreak >= 80) {
        const reason = `${tag} economy dead ${deadStreak}t @RCL${final.rcl} cont=${final.containers} roads=${final.roads}`;
        publish({ done: true, ok: false, reason });
        return { ok: false, ticksRun: i + 1, final, reason };
      }

      if (unlockTick == null && unlockMet(final)) {
        unlockTick = i + 1;
        console.log(`[sim|${opts.instance}] UNLOCK at t${unlockTick}`, final);
      }

      if (unlockTick != null) {
        if (economy && unlockMet(final)) sustainAlive++;
        else sustainAlive = 0;

        if (sustainAlive >= sustainNeed) {
          const reason = `${tag} OK RCL${final.rcl} cont=${final.containers} roads=${final.roads} miners=${final.roles.miner ?? 0} sustain=${sustainAlive} firstRoad=${firstRoadTick} c2=${containers2Tick} rcl3=${rcl3Tick}`;
          publish({ done: true, ok: true, reason });
          return { ok: true, ticksRun: i + 1, final, reason };
        }
      }
    }

    const reason =
      unlockTick == null
        ? `${tag} timeout no-unlock peakRCL=${peakRcl} peakCont=${peakContainers} peakRoads=${peakRoads} firstRoad=${firstRoadTick} c2=${containers2Tick} rcl3=${rcl3Tick}`
        : `${tag} timeout unlock@${unlockTick} sustain=${sustainAlive}/${sustainNeed} firstRoad=${firstRoadTick} c2=${containers2Tick} rcl3=${rcl3Tick}`;
    publish({ done: true, ok: false, reason });
    return { ok: false, ticksRun: opts.ticks, final, reason };
  } finally {
    stopServer(server);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[sim] realClimb instance=${args.instance} port=${args.port} ticks=${args.ticks} sustain=${args.sustain} roadPolicy=${args.roadPolicy}` +
      (args.abKnob ? ` ab=${args.abKnob}:${args.abVariant}` : "") +
      (args.profile ? ` profile=${args.profile}` : "") +
      (args.idleBuilderUpgrade === undefined
        ? ""
        : ` idleBuilderUpgrade=${args.idleBuilderUpgrade}`),
  );
  const result = await runRealClimbScenario(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
