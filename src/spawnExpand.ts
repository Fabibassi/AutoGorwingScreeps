/**
 * GCL expand: spawn a claimer when Wave-E gates say so.
 */
import {
  listExitRooms,
  pickSecondExitRoom,
} from "./earlyGame/remotePlan";
import { shouldPrepGclExpand } from "./earlyGame/nextLeaps";
import { STORAGE_FLOOR_ENERGY } from "./earlyGame/storageFloor";

export function countClaimers(homeRoom: string): number {
  let n = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (c.memory.role !== "claimer") continue;
    if (c.memory.homeRoom && c.memory.homeRoom !== homeRoom) continue;
    n++;
  }
  return n;
}

export function buildClaimerBody(energyAvailable: number): BodyPartConstant[] {
  // 1 CLAIM + 1 MOVE = 650; optional 2nd MOVE if energy allows.
  if (energyAvailable < 650) return [];
  if (energyAvailable >= 700) return ["claim", "move", "move"];
  return ["claim", "move"];
}

export function pickExpandRoom(homeName: string): string | undefined {
  if (Memory.ags?.expandRoom) return Memory.ags.expandRoom;
  const remotes = new Set(
    [Memory.ags?.remoteRoom, Memory.ags?.remoteRoom2].filter(Boolean) as string[],
  );
  const exits = listExitRooms(homeName);
  for (const name of exits) {
    if (remotes.has(name)) continue;
    const room = Game.rooms[name];
    if (room?.controller?.my) continue;
    if (room?.controller?.owner) continue;
    return name;
  }
  // No vision: pick an exit that isn't a remote.
  return (
    exits.find((n) => !remotes.has(n)) ??
    pickSecondExitRoom(homeName, Memory.ags?.remoteRoom)
  );
}

export function trySpawnClaimer(spawn: StructureSpawn): boolean {
  if (spawn.spawning) return false;
  const room = spawn.room;
  const labs = room.find(FIND_MY_STRUCTURES, {
    filter: (s) => s.structureType === STRUCTURE_LAB,
  }).length;
  const roomsOwned = Object.keys(Game.rooms).filter(
    (n) => Game.rooms[n].controller?.my,
  ).length;
  // Also count owned rooms we don't have vision for via Game.gcl
  const gcl = Game.gcl?.level ?? 1;

  if (
    !shouldPrepGclExpand({
      gcl,
      roomsOwned: Math.max(roomsOwned, 1),
      labs,
      storageEnergy: room.storage?.store[RESOURCE_ENERGY] ?? 0,
      floor: STORAGE_FLOOR_ENERGY,
    })
  ) {
    return false;
  }
  if (countClaimers(room.name) >= 1) return false;

  const expandRoom = pickExpandRoom(room.name);
  if (!expandRoom) return false;
  if (Memory.ags) Memory.ags.expandRoom = expandRoom;

  const body = buildClaimerBody(room.energyAvailable);
  if (body.length === 0) return false;

  const name = `claimer-${Game.time}-${Math.floor(Math.random() * 1_000_000)}`;
  return (
    spawn.spawnCreep(body, name, {
      memory: {
        role: "claimer",
        targetRoom: expandRoom,
        homeRoom: room.name,
      },
    }) === OK
  );
}
