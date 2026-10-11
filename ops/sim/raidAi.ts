/**
 * Raider bot for attack-raid sims: move to spawn, attack/dismantle/heal.
 * Registered as a second user (does not claim the controller).
 */
import type { RaidThreatId } from "./raidThreats";
import type { SimServer } from "./harness";
import { ROOM, SPAWN_X, SPAWN_Y } from "./harness";

export type RaiderHandle = {
  userId: string;
  username: string;
};

function raiderMainSource(threat: RaidThreatId): string {
  const mode =
    threat === "drain"
      ? "drain"
      : threat === "smash"
        ? "smash"
        : threat === "swarm"
          ? "swarm"
          : "probe";
  return `module.exports.loop = function () {
  var MODE = ${JSON.stringify(mode)};
  var SPAWN_X = ${SPAWN_X};
  var SPAWN_Y = ${SPAWN_Y};
  for (var name in Game.creeps) {
    var c = Game.creeps[name];
    if (!c || c.spawning) continue;
    var room = c.room;
    if (!room) continue;
    var spawn = room.find(FIND_HOSTILE_SPAWNS)[0];
    var towers = room.find(FIND_HOSTILE_STRUCTURES, {
      filter: function (s) { return s.structureType === STRUCTURE_TOWER; }
    });
    var targetStruct = spawn || towers[0];
    if (MODE === "drain") {
      if (c.hits < c.hitsMax && c.getActiveBodyparts(HEAL) > 0) c.heal(c);
      if (targetStruct) {
        var range = c.pos.getRangeTo(targetStruct);
        if (range > 3) c.moveTo(targetStruct);
        else if (range < 2) c.moveTo(SPAWN_X, 5);
      } else {
        c.moveTo(SPAWN_X, SPAWN_Y);
      }
      continue;
    }
    if (MODE === "smash") {
      if (targetStruct) {
        if (c.pos.isNearTo(targetStruct)) {
          if (c.getActiveBodyparts(WORK) > 0) c.dismantle(targetStruct);
          else c.attack(targetStruct);
        } else {
          c.moveTo(targetStruct);
        }
      }
      continue;
    }
    // probe / swarm: attack nearest hostile creep else spawn
    var foes = room.find(FIND_HOSTILE_CREEPS);
    var foe = c.pos.findClosestByRange(foes);
    if (foe) {
      if (c.pos.isNearTo(foe)) c.attack(foe);
      else c.moveTo(foe);
      continue;
    }
    if (targetStruct) {
      if (c.pos.isNearTo(targetStruct)) c.attack(targetStruct);
      else c.moveTo(targetStruct);
    } else {
      c.moveTo(SPAWN_X, SPAWN_Y);
    }
  }
};`;
}

/**
 * Insert an active raider user + code. Creeps must be injected with this userId.
 */
export async function ensureRaiderUser(
  server: SimServer,
  threat: RaidThreatId,
  username = "raider",
): Promise<RaiderHandle> {
  const db = server.common.storage.db as {
    users: {
      find: (q: object) => Promise<Array<Record<string, unknown>>>;
      insert: (doc: object) => Promise<Record<string, unknown>>;
    };
    "users.code": { insert: (doc: object) => Promise<unknown> };
  };
  const env = server.common.storage.env as {
    keys: { MEMORY: string };
    set: (k: string, v: string) => Promise<unknown>;
  };

  const existing = await db.users.find({ username });
  if (existing[0]?._id) {
    const userId = String(existing[0]._id);
    // Refresh code for current threat mode.
    await db["users.code"].insert({
      user: userId,
      branch: "default",
      modules: { main: raiderMainSource(threat) },
      activeWorld: true,
    });
    return { userId, username };
  }

  const user = await db.users.insert({
    username,
    cpu: 100,
    cpuAvailable: 10_000,
    gcl: 1,
    active: 10_000,
  });
  const userId = String(user._id);
  await env.set(env.keys.MEMORY + userId, "{}");
  await db["users.code"].insert({
    user: userId,
    branch: "default",
    modules: { main: raiderMainSource(threat) },
    activeWorld: true,
  });
  return { userId, username };
}

/** Keep hostiles advancing if their AI stalls (fatigue / pathing quirks). */
export async function nudgeRaiders(
  server: SimServer,
  raiderUserId: string,
): Promise<void> {
  const { driveHostilesToward } = await import("./harness");
  await driveHostilesToward(server, {
    targetX: SPAWN_X,
    targetY: SPAWN_Y,
    room: ROOM,
    hostileUserId: raiderUserId,
  });
}
