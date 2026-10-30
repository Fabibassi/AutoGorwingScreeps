/**
 * Lab tick: boost adjacent creeps that need WORK/ATTACK boosts.
 * No reaction chain yet — compounds must already sit in lab/terminal.
 */
import { STORAGE_FLOOR_ENERGY } from "../earlyGame/storageFloor";
import {
  bodyPartForBoost,
  creepNeedsBoost,
  pickAvailableBoost,
  shouldOfferBoosts,
  type BoostKind,
} from "./boosts";

function kindForRole(role: string | undefined): BoostKind | null {
  if (role === "upgrader") return "upgrade";
  if (role === "builder") return "build";
  if (role === "attacker") return "attack";
  return null;
}

function findBoostLab(
  room: Room,
  mineral: string,
): StructureLab | null {
  const labs = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureLab => s.structureType === STRUCTURE_LAB,
  });
  for (const lab of labs) {
    if ((lab.store[mineral as ResourceConstant] ?? 0) >= 30) return lab;
    const mt = lab.mineralType;
    if (mt && (mt as string) === mineral && lab.store.getUsedCapacity(mt) >= 30) {
      return lab;
    }
  }
  return labs[0] ?? null;
}

/** Move mineral from terminal into an empty/matching lab when needed. */
function feedLabFromTerminal(
  room: Room,
  mineral: string,
  lab: StructureLab,
): void {
  const terminal = room.terminal;
  if (!terminal) return;
  if ((terminal.store[mineral as ResourceConstant] ?? 0) < 30) return;
  if (lab.mineralType && lab.mineralType !== mineral) return;
  // Creeps must transfer — without a dedicated lab tech, skip auto-feed.
  void terminal;
  void lab;
}

export function runLabs(room: Room): void {
  const labs = room.find(FIND_MY_STRUCTURES, {
    filter: (s): s is StructureLab => s.structureType === STRUCTURE_LAB,
  });
  if (
    !shouldOfferBoosts({
      labCount: labs.length,
      storageEnergy: room.storage?.store[RESOURCE_ENERGY] ?? 0,
      floor: STORAGE_FLOOR_ENERGY,
    })
  ) {
    return;
  }

  const stores: Array<{ [key: string]: number | undefined }> = labs.map(
    (lab) => lab.store as unknown as { [key: string]: number | undefined },
  );
  if (room.terminal) {
    stores.push(
      room.terminal.store as unknown as { [key: string]: number | undefined },
    );
  }

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.room.name !== room.name) continue;
    const kind = kindForRole(creep.memory.role);
    if (!kind || !creepNeedsBoost(creep, kind)) continue;

    const mineral = pickAvailableBoost(kind, stores);
    if (!mineral) continue;

    const lab = findBoostLab(room, mineral);
    if (!lab) continue;
    feedLabFromTerminal(room, mineral, lab);

    if (!creep.pos.isNearTo(lab)) {
      creep.moveTo(lab, { reusePath: 10 });
      continue;
    }

    if ((lab.store[mineral as ResourceConstant] ?? 0) < 30) continue;
    if ((lab.store[RESOURCE_ENERGY] ?? 0) < 20) continue;

    // Typings use numeric BodyPartConstant; string parts work at runtime.
    lab.boostCreep(creep, bodyPartForBoost(kind) as unknown as number);
  }
}
