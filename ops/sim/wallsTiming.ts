/**
 * Walls timing bakeoff: are hub ramparts useful only if built BEFORE a smash,
 * or is arming after hostiles appear still early enough?
 *
 * Isolates walls by seeding NO towers (towers would one-shot the mild catalog).
 * Hard smash dismantlers spawn adjacent to the spawn.
 *
 * Modes:
 *   pre  — finished rampart on spawn before raid
 *   post — wallPolicy=raid_only (arm + place sites only after hostiles)
 *   off  — wallPolicy=off
 *
 * Usage:
 *   npx tsx ops/sim/wallsTiming.ts --mode pre --ticks 600 --port 29000
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
  patchControllerAndSpawn,
  readRoomSummary,
  resetEmptyRoom,
  setBotWallPolicy,
  stopServer,
  writeLiveStatus,
  type SimServer,
} from "./harness";
import { ensureRaiderUser, nudgeRaiders } from "./raidAi";

const WARMUP = 40;
const RAID_WINDOW = 400;

export type WallsTimingMode = "pre" | "post" | "off";

const HARD_SMASH_BODIES: string[][] = [
  ["tough", "tough", "work", "work", "work", "work", "move", "move"],
  ["tough", "tough", "work", "work", "work", "work", "move", "move"],
  ["tough", "work", "work", "work", "move", "move"],
];

function parseArgs(argv: string[]) {
  let instance = "wallsTiming-0";
  let ticks = 600;
  let port = 29_000;
  let mode: WallsTimingMode = "post";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--instance" && argv[i + 1]) instance = argv[++i];
    else if (a === "--ticks" && argv[i + 1]) ticks = Number(argv[++i]);
    else if (a === "--port" && argv[i + 1]) port = Number(argv[++i]);
    else if (a === "--mode" && argv[i + 1]) {
      mode = argv[++i] as WallsTimingMode;
    }
  }
  if (mode !== "pre" && mode !== "post" && mode !== "off") {
    throw new Error(`invalid --mode ${mode}`);
  }
  return { instance, ticks, port, mode };
}

async function seedHub(server: SimServer, botId: string): Promise<void> {
  const rcl = 5;
  await server.common.storage.db["rooms.objects"].update(
    { room: ROOM, type: "controller" },
    {
      $set: {
        level: rcl,
        progress: 0,
        progressTotal: PROGRESS_TOTAL[rcl],
        safeModeAvailable: 0,
      },
    },
  );
  // No towers — isolate rampart timing.
  await server.world.addRoomObject(ROOM, "storage", SPAWN_X + 2, SPAWN_Y - 2, {
    store: { energy: 80_000 },
    storeCapacityResource: { energy: 1_000_000 },
    hits: 10_000,
    hitsMax: 10_000,
    user: botId,
  });
  for (const [sx, sy] of [
    [10, 40],
    [40, 10],
  ] as Array<[number, number]>) {
    await server.world.addRoomObject(ROOM, "container", sx + 1, sy, {
      store: { energy: 1800 },
      storeCapacityResource: { energy: 2000 },
      hits: 250_000,
      hitsMax: 250_000,
      user: botId,
    });
  }
}

async function seedSpawnRampart(
  server: SimServer,
  botId: string,
): Promise<void> {
  // Enough hits to outlast RAID_WINDOW at ~550 dismantle dmg/tick.
  await server.world.addRoomObject(ROOM, "rampart", SPAWN_X, SPAWN_Y, {
    user: botId,
    hits: 300_000,
    hitsMax: 300_000_000,
    isPublic: false,
  });
}

async function countRamparts(server: SimServer): Promise<number> {
  const objs = await server.common.storage.db["rooms.objects"].find({
    room: ROOM,
    type: "rampart",
  });
  return objs.length;
}

async function spawnHits(server: SimServer): Promise<number> {
  const objs = await server.common.storage.db["rooms.objects"].find({
    room: ROOM,
    type: "spawn",
  });
  return Number(objs[0]?.hits ?? 0);
}

/**
 * Mockup raider AI often fails to dismantle — apply WORK-based smash damage
 * when a hostile is adjacent to the spawn. Rampart on the spawn tile absorbs
 * first (same tile protection model).
 */
async function applyAdjacentSmashDamage(
  server: SimServer,
  hostileUserId: string,
): Promise<void> {
  const objs = await server.common.storage.db["rooms.objects"].find({
    room: ROOM,
  });
  const spawn = objs.find((o) => o.type === "spawn");
  if (!spawn) return;
  const sx = Number(spawn.x);
  const sy = Number(spawn.y);

  let workParts = 0;
  for (const o of objs) {
    if (o.type !== "creep") continue;
    if (String(o.user ?? "") !== hostileUserId) continue;
    const x = Number(o.x);
    const y = Number(o.y);
    if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) > 1) continue;
    const body = o.body as Array<{ type?: string }> | undefined;
    if (!body) continue;
    for (const p of body) {
      if (p.type === "work") workParts++;
    }
  }
  if (workParts <= 0) return;
  // Screeps dismantle ≈ 50 hits / WORK / tick.
  const dmg = workParts * 50;

  const rampart = objs.find(
    (o) =>
      o.type === "rampart" && Number(o.x) === sx && Number(o.y) === sy,
  );
  if (rampart) {
    const hits = Math.max(0, Number(rampart.hits ?? 0) - dmg);
    if (hits <= 0) {
      await server.common.storage.db["rooms.objects"].update(
        { _id: rampart._id },
        { $set: { hits: 0 } },
      );
      // Remove dead rampart so next ticks hit the spawn.
      const { db } = server.common.storage as {
        db: {
          "rooms.objects": {
            remove?: (q: object) => Promise<unknown>;
            update: (q: object, u: object) => Promise<unknown>;
          };
        };
      };
      if (typeof db["rooms.objects"].remove === "function") {
        await db["rooms.objects"].remove({ _id: rampart._id });
      } else {
        await server.common.storage.db["rooms.objects"].update(
          { _id: rampart._id },
          { $set: { type: "tombstone", hits: 0 } },
        );
      }
    } else {
      await server.common.storage.db["rooms.objects"].update(
        { _id: rampart._id },
        { $set: { hits } },
      );
    }
    return;
  }

  const hits = Math.max(0, Number(spawn.hits ?? 0) - dmg);
  if (hits <= 0) {
    await server.common.storage.db["rooms.objects"].update(
      { _id: spawn._id },
      { $set: { hits: 0, type: "ruin" } },
    );
  } else {
    await server.common.storage.db["rooms.objects"].update(
      { _id: spawn._id },
      { $set: { hits } },
    );
  }
}

export type WallsTimingResult = {
  ok: boolean;
  mode: WallsTimingMode;
  spawnAlive: boolean;
  minSpawnHits: number;
  rampartsEnd: number;
  spawnDeadAt: number | null;
  hostilesClearedAt: number | null;
  ticksRun: number;
  reason: string;
};

export async function runWallsTimingScenario(opts: {
  instance: string;
  ticks: number;
  port: number;
  mode: WallsTimingMode;
}): Promise<WallsTimingResult> {
  const server = createMockupServer(opts.instance, opts.port);
  try {
    await resetEmptyRoom(server, {
      rcl: 5,
      progressTotal: PROGRESS_TOTAL[5],
    });
    const bot = await addBotWithModules(server, opts.instance);
    await patchControllerAndSpawn(server, {
      rcl: 5,
      spawnEnergy: 300,
      progressTotal: PROGRESS_TOTAL[5],
    });
    await seedHub(server, bot.id);
    if (opts.mode === "pre") {
      await seedSpawnRampart(server, bot.id);
    }

    const raider = await ensureRaiderUser(server, "smash", `raider-${opts.mode}`);
    await server.start();

    if (opts.mode === "off") {
      await setBotWallPolicy(bot, "off", { wallsArmed: false });
    } else if (opts.mode === "post") {
      await setBotWallPolicy(bot, "raid_only", { wallsArmed: false });
    } else {
      await setBotWallPolicy(bot, "force", { wallsArmed: true });
    }
    await server.tick();

    let final = await readRoomSummary(server, bot);
    let minHits = await spawnHits(server);
    let hostilesClearedAt: number | null = null;
    let raidAt = 0;
    let phase: "warmup" | "raid" = "warmup";

    const publish = (extra?: Parameters<typeof liveFromSummary>[3]) => {
      writeLiveStatus(
        liveFromSummary(opts.instance, opts.ticks, final, extra),
      );
    };
    publish({ reason: `wallsTiming mode=${opts.mode} warmup` });

    for (let i = 0; i < opts.ticks; i++) {
      await server.tick();
      if (phase === "raid") {
        await nudgeRaiders(server, raider.userId);
        await applyAdjacentSmashDamage(server, raider.userId);
      }
      final = await readRoomSummary(server, bot);
      const hits = await spawnHits(server);
      if (hits > 0 && hits < minHits) minHits = hits;
      if (hits === 0 && minHits > 0) minHits = 0;

      const spawnAlive = (await countSpawns(server)) > 0;
      if (!spawnAlive) {
        const deadAt = i + 1;
        const reason =
          `wallsTiming mode=${opts.mode} FAIL spawnDeadAt=${deadAt} ` +
          `raidAt=${raidAt || WARMUP} lived=${deadAt - (raidAt || WARMUP)}t ` +
          `minHits=${minHits} ramparts=${await countRamparts(server)}`;
        publish({ done: true, ok: false, reason });
        return {
          ok: false,
          mode: opts.mode,
          spawnAlive: false,
          minSpawnHits: minHits,
          rampartsEnd: await countRamparts(server),
          spawnDeadAt: deadAt,
          hostilesClearedAt,
          ticksRun: i + 1,
          reason,
        };
      }

      if (phase === "warmup" && i + 1 >= WARMUP) {
        await injectInvaderCreeps(server, {
          bodies: HARD_SMASH_BODIES,
          x: SPAWN_X - 1,
          y: SPAWN_Y,
          userId: raider.userId,
          namePrefix: "smash",
        });
        raidAt = i + 1;
        phase = "raid";
        console.log(
          `[sim|${opts.instance}] smash inject t${raidAt} mode=${opts.mode}`,
        );
        continue;
      }

      if (phase === "raid") {
        const hostiles = await countHostiles(server, {
          excludeUserId: bot.id,
        });
        if (hostiles === 0 && hostilesClearedAt == null && i + 1 > raidAt) {
          hostilesClearedAt = i + 1;
        }
        // No towers in this isolation — success = spawn survives the raid window.
        if (i + 1 - raidAt >= RAID_WINDOW) {
          const ramparts = await countRamparts(server);
          const reason =
            `wallsTiming mode=${opts.mode} ok survived=${RAID_WINDOW}t ` +
            `minHits=${minHits} ramparts=${ramparts} hostilesLeft=${hostiles}`;
          publish({ done: true, ok: true, reason });
          return {
            ok: true,
            mode: opts.mode,
            spawnAlive: true,
            minSpawnHits: minHits,
            rampartsEnd: ramparts,
            spawnDeadAt: null,
            hostilesClearedAt,
            ticksRun: i + 1,
            reason,
          };
        }
      }

      if (i < 3 || i % 50 === 0) {
        console.log(
          `[sim|${opts.instance}] t${i + 1} phase=${phase} hits=${hits}`,
          final,
        );
        publish();
      }
    }

    const reason = `wallsTiming mode=${opts.mode} ticksExhausted`;
    publish({ done: true, ok: false, reason });
    return {
      ok: false,
      mode: opts.mode,
      spawnAlive: (await countSpawns(server)) > 0,
      minSpawnHits: minHits,
      rampartsEnd: await countRamparts(server),
      spawnDeadAt: null,
      hostilesClearedAt,
      ticksRun: opts.ticks,
      reason,
    };
  } finally {
    stopServer(server);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const result = await runWallsTimingScenario(opts);
  console.log(
    `[wallsTiming] mode=${result.mode} ok=${result.ok} minHits=${result.minSpawnHits} ` +
      `ramparts=${result.rampartsEnd} reason=${result.reason}`,
  );
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
