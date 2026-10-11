/**
 * Single-cell attack-raid scenario: seeded hub @ RCL → warmup → raid → score.
 *
 * Usage:
 *   npx tsx ops/sim/attackRaid.ts --rcl 5 --threat probe --ticks 1200 --port 28800
 */
import { pathToFileURL } from "node:url";
import {
  ROOM,
  SPAWN_X,
  SPAWN_Y,
  PROGRESS_TOTAL,
  addBotWithModules,
  countHostiles,
  countSpawns,
  createMockupServer,
  injectInvaderCreeps,
  liveFromSummary,
  minTowerEnergy,
  patchControllerAndSpawn,
  readRoomSummary,
  resetEmptyRoom,
  stopServer,
  writeLiveStatus,
  type SimResult,
  type SimServer,
} from "./harness";
import { ensureRaiderUser, nudgeRaiders } from "./raidAi";
import {
  buildThreatBodies,
  expectedPass,
  hubSeedSpec,
  isRaidThreatId,
  isRclLevel,
  type RaidThreatId,
  type RclLevel,
} from "./raidThreats";

const SOURCES: Array<[number, number]> = [
  [10, 40],
  [40, 10],
];

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
  [3, 2],
  [3, -2],
  [-3, 2],
  [-3, -2],
  [1, 3],
  [1, -3],
  [-1, 3],
  [-1, -3],
  [2, 3],
  [2, -3],
  [-2, 3],
  [-2, -3],
  [4, 1],
  [4, -1],
];

const WARMUP_TICKS = 80;
const RECOVERY_DEAD = 80;
const DEFAULT_RAID_WINDOW = 900;
const DEFAULT_RECOVERY = 400;

export type AttackRaidResult = SimResult & {
  expectedPass: boolean;
  matchExpectation: boolean;
  rcl: RclLevel;
  threat: RaidThreatId;
  spawnAlive: boolean;
  rclHeld: boolean;
  hostilesClearedAt: number | null;
  recoveredAt: number | null;
  minTowerEnergy: number;
  friendlyStart: number;
  friendlyEnd: number;
  safeModeFired: boolean;
};

function parseArgs(argv: string[]) {
  let instance = "attackRaid-0";
  let ticks = 1_400;
  let port = 28_800;
  let rcl = 5;
  let threat = "probe";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (a === "--rcl" && argv[i + 1]) rcl = Number(argv[++i]);
    else if (a === "--threat" && argv[i + 1]) threat = argv[++i];
  }
  if (!isRclLevel(rcl)) throw new Error(`invalid --rcl ${rcl}`);
  if (!isRaidThreatId(threat)) throw new Error(`invalid --threat ${threat}`);
  return { instance, ticks, port, rcl, threat };
}

async function seedHub(
  server: SimServer,
  botId: string,
  rcl: RclLevel,
): Promise<void> {
  const seed = hubSeedSpec(rcl);
  const progressTotal = PROGRESS_TOTAL[rcl] ?? 45_000;

  await server.common.storage.db["rooms.objects"].update(
    { room: ROOM, type: "controller" },
    {
      $set: {
        level: rcl,
        progress: 0,
        progressTotal,
        safeModeAvailable: 1,
        safeMode: null,
        safeModeCooldown: null,
      },
    },
  );

  for (const [sx, sy] of SOURCES) {
    await server.world.addRoomObject(ROOM, "container", sx + 1, sy, {
      store: { energy: seed.containerEnergy },
      storeCapacityResource: { energy: 2000 },
      hits: 250_000,
      hitsMax: 250_000,
      user: botId,
    });
  }

  const towerSpots: Array<[number, number]> = [
    [SPAWN_X + 2, SPAWN_Y + 2],
    [SPAWN_X - 2, SPAWN_Y + 2],
  ];
  for (let i = 0; i < seed.towers; i++) {
    const [x, y] = towerSpots[i];
    await server.world.addRoomObject(ROOM, "tower", x, y, {
      store: { energy: 1000 },
      storeCapacityResource: { energy: 1000 },
      hits: 3000,
      hitsMax: 3000,
      user: botId,
    });
  }

  if (seed.storageEnergy > 0) {
    await server.world.addRoomObject(ROOM, "storage", SPAWN_X + 2, SPAWN_Y - 2, {
      store: { energy: seed.storageEnergy },
      storeCapacityResource: { energy: 1_000_000 },
      hits: 10_000,
      hitsMax: 10_000,
      user: botId,
    });
  }

  const reserved = new Set(
    towerSpots.slice(0, seed.towers).map(([x, y]) => `${x},${y}`),
  );
  reserved.add(`${SPAWN_X + 2},${SPAWN_Y - 2}`);
  let extPlaced = 0;
  for (const [dx, dy] of EXT_STAMP) {
    if (extPlaced >= seed.extensions) break;
    const x = SPAWN_X + dx;
    const y = SPAWN_Y + dy;
    if (reserved.has(`${x},${y}`)) continue;
    await server.world.addRoomObject(ROOM, "extension", x, y, {
      store: { energy: 50 },
      storeCapacityResource: { energy: 50 },
      hits: 1000,
      hitsMax: 1000,
      user: botId,
    });
    extPlaced++;
  }
}

function economyAlive(roles: Record<string, number>): boolean {
  return (
    (roles.harvester ?? 0) + (roles.miner ?? 0) + (roles.filler ?? 0) > 0
  );
}

function countFriendlyCreeps(
  objects: Array<Record<string, unknown>>,
  botId: string,
): number {
  let n = 0;
  for (const o of objects) {
    if (o.type === "creep" && String(o.user ?? "") === botId) n++;
  }
  return n;
}

export async function runAttackRaidScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
  rcl: RclLevel;
  threat: RaidThreatId;
}): Promise<AttackRaidResult> {
  const expect = expectedPass(opts.rcl, opts.threat);
  const seed = hubSeedSpec(opts.rcl);
  const progressTotal = PROGRESS_TOTAL[opts.rcl] ?? 45_000;
  const server = createMockupServer(opts.instance, opts.port);

  const fail = (
    partial: Partial<AttackRaidResult> & {
      reason: string;
      final: Awaited<ReturnType<typeof readRoomSummary>>;
      ticksRun: number;
    },
  ): AttackRaidResult => {
    const ok = false;
    return {
      ok,
      expectedPass: expect,
      matchExpectation: ok === expect,
      rcl: opts.rcl,
      threat: opts.threat,
      spawnAlive: partial.spawnAlive ?? false,
      rclHeld: partial.rclHeld ?? false,
      hostilesClearedAt: partial.hostilesClearedAt ?? null,
      recoveredAt: partial.recoveredAt ?? null,
      minTowerEnergy: partial.minTowerEnergy ?? 0,
      friendlyStart: partial.friendlyStart ?? 0,
      friendlyEnd: partial.friendlyEnd ?? 0,
      safeModeFired: partial.safeModeFired ?? false,
      ticksRun: partial.ticksRun,
      final: partial.final,
      reason: partial.reason,
    };
  };

  try {
    await resetEmptyRoom(server, { rcl: opts.rcl, progressTotal });
    const bot = await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: opts.rcl,
      spawnEnergy: seed.spawnEnergy,
      progressTotal,
    });
    await seedHub(server, bot.id, opts.rcl);

    const raider = await ensureRaiderUser(server, opts.threat);
    await server.start();
    await server.tick();

    let final = await readRoomSummary(server, bot);
    let minTw = await minTowerEnergy(server);
    let hostilesClearedAt: number | null = null;
    let recoveredAt: number | null = null;
    let safeModeFired = false;
    let raidInjected = false;
    let raidAt = 0;
    let deadStreak = 0;
    let phase: "warmup" | "raid" | "recovery" = "warmup";

    const objects0 = await server.common.storage.db["rooms.objects"].find({
      room: ROOM,
    });
    const friendlyStart = countFriendlyCreeps(objects0, bot.id);

    const publish = (extra?: Parameters<typeof liveFromSummary>[3]) => {
      writeLiveStatus(
        liveFromSummary(opts.instance, opts.ticks, final, {
          ...extra,
          roles: {
            ...final.roles,
            _rcl: opts.rcl,
            _threat: ["probe", "drain", "smash", "swarm"].indexOf(opts.threat),
          },
        }),
      );
    };
    publish({
      reason: `attackRaid rcl=${opts.rcl} threat=${opts.threat} warmup`,
    });

    for (let i = 0; i < opts.ticks; i++) {
      await server.tick();
      // Nudge raiders every tick during raid (AI + fallback).
      if (phase === "raid") {
        await nudgeRaiders(server, raider.userId);
      }
      final = await readRoomSummary(server, bot);
      const tw = await minTowerEnergy(server);
      if (tw < minTw) minTw = tw;

      const ctrl = (
        await server.common.storage.db["rooms.objects"].find({
          room: ROOM,
          type: "controller",
        })
      )[0];
      if (ctrl && Number(ctrl.safeMode ?? 0) > 0) safeModeFired = true;

      const spawnAlive = (await countSpawns(server)) > 0;
      const rclHeld = final.rcl >= opts.rcl;
      const hostiles = await countHostiles(server, {
        excludeUserId: bot.id,
      });

      if (!spawnAlive || !rclHeld) {
        const reason = !spawnAlive
          ? `spawn destroyed @t${i + 1}`
          : `rcl dropped to ${final.rcl} @t${i + 1}`;
        publish({ done: true, ok: false, reason });
        return fail({
          reason,
          final,
          ticksRun: i + 1,
          spawnAlive,
          rclHeld,
          hostilesClearedAt,
          recoveredAt,
          minTowerEnergy: minTw,
          friendlyStart,
          friendlyEnd: 0,
          safeModeFired,
        });
      }

      if (phase === "warmup" && i + 1 >= WARMUP_TICKS) {
        const bodies = buildThreatBodies(opts.rcl, opts.threat);
        await injectInvaderCreeps(server, {
          bodies,
          x: 12,
          y: 25,
          userId: raider.userId,
          namePrefix: opts.threat,
        });
        raidInjected = true;
        raidAt = i + 1;
        phase = "raid";
        // Recount after inject — prior `hostiles` is pre-raid and would false-clear.
        const after = await countHostiles(server, { excludeUserId: bot.id });
        console.log(
          `[sim|${opts.instance}] raid inject t${raidAt} threat=${opts.threat} n=${bodies.length} hostiles=${after}`,
        );
        publish({
          reason: `attackRaid raid t=${raidAt} threat=${opts.threat}`,
        });
        continue;
      }

      if (phase === "raid" && raidInjected) {
        if (hostiles === 0 && hostilesClearedAt == null && i + 1 > raidAt) {
          hostilesClearedAt = i + 1;
          phase = "recovery";
          deadStreak = 0;
          console.log(
            `[sim|${opts.instance}] hostiles cleared @t${hostilesClearedAt}`,
          );
        } else if (i + 1 - raidAt >= DEFAULT_RAID_WINDOW) {
          const reason = `raid timeout hostiles=${hostiles} @t${i + 1}`;
          publish({ done: true, ok: false, reason });
          const objs = await server.common.storage.db["rooms.objects"].find({
            room: ROOM,
          });
          return fail({
            reason,
            final,
            ticksRun: i + 1,
            spawnAlive: true,
            rclHeld: true,
            hostilesClearedAt,
            recoveredAt,
            minTowerEnergy: minTw,
            friendlyStart,
            friendlyEnd: countFriendlyCreeps(objs, bot.id),
            safeModeFired,
          });
        }
      }

      if (phase === "recovery") {
        if (economyAlive(final.roles)) {
          deadStreak = 0;
          if (recoveredAt == null) recoveredAt = i + 1;
          if (i + 1 - (hostilesClearedAt ?? i) >= 40) {
            // Sustained recovery.
            const objs = await server.common.storage.db["rooms.objects"].find({
              room: ROOM,
            });
            const friendlyEnd = countFriendlyCreeps(objs, bot.id);
            const reason =
              `attackRaid ok rcl=${opts.rcl} threat=${opts.threat} ` +
              `clear@${hostilesClearedAt} recover@${recoveredAt} ` +
              `minTower=${minTw} safeMode=${safeModeFired ? 1 : 0} ` +
              `friendly=${friendlyStart}->${friendlyEnd}`;
            publish({ done: true, ok: true, reason });
            const ok = true;
            return {
              ok,
              expectedPass: expect,
              matchExpectation: ok === expect,
              rcl: opts.rcl,
              threat: opts.threat,
              spawnAlive: true,
              rclHeld: true,
              hostilesClearedAt,
              recoveredAt,
              minTowerEnergy: minTw,
              friendlyStart,
              friendlyEnd,
              safeModeFired,
              ticksRun: i + 1,
              final,
              reason,
            };
          }
        } else {
          deadStreak++;
          if (deadStreak >= RECOVERY_DEAD) {
            const reason = `recovery dead ${deadStreak}t after clear@${hostilesClearedAt}`;
            publish({ done: true, ok: false, reason });
            return fail({
              reason,
              final,
              ticksRun: i + 1,
              spawnAlive: true,
              rclHeld: true,
              hostilesClearedAt,
              recoveredAt,
              minTowerEnergy: minTw,
              friendlyStart,
              friendlyEnd: 0,
              safeModeFired,
            });
          }
        }
        if (
          hostilesClearedAt != null &&
          i + 1 - hostilesClearedAt >= DEFAULT_RECOVERY
        ) {
          const reason = `recovery timeout after clear@${hostilesClearedAt}`;
          publish({ done: true, ok: false, reason });
          return fail({
            reason,
            final,
            ticksRun: i + 1,
            spawnAlive: true,
            rclHeld: true,
            hostilesClearedAt,
            recoveredAt,
            minTowerEnergy: minTw,
            friendlyStart,
            friendlyEnd: 0,
            safeModeFired,
          });
        }
      }

      if (i < 5 || i % 50 === 0) {
        console.log(
          `[sim|${opts.instance}] t${i + 1} phase=${phase} hostiles=${hostiles}`,
          final,
        );
        publish();
      }
    }

    const reason = `ticks exhausted phase=${phase}`;
    publish({ done: true, ok: false, reason });
    return fail({
      reason,
      final,
      ticksRun: opts.ticks,
      spawnAlive: (await countSpawns(server)) > 0,
      rclHeld: final.rcl >= opts.rcl,
      hostilesClearedAt,
      recoveredAt,
      minTowerEnergy: minTw,
      friendlyStart,
      friendlyEnd: 0,
      safeModeFired,
    });
  } finally {
    stopServer(server);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const result = await runAttackRaidScenario(opts);
  console.log(
    `[attackRaid] ok=${result.ok} expected=${result.expectedPass} match=${result.matchExpectation} ` +
      `rcl=${result.rcl} threat=${result.threat} reason=${result.reason}`,
  );
  // Mockup storage keeps the event loop alive — hard-exit like other sims.
  process.exit(result.matchExpectation ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
