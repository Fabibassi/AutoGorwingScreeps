import { isIncomeStalled } from "../telemetry";
import { canWithdrawFromSpawn } from "./builder";

export function runUpgrader(creep: Creep): void {
  if (creep.store[RESOURCE_ENERGY] === 0) {
    const controller = creep.room.controller;
    if (controller) {
      const container = controller.pos.findInRange(FIND_STRUCTURES, 3, {
        filter: (s): s is StructureContainer =>
          s.structureType === STRUCTURE_CONTAINER &&
          s.store[RESOURCE_ENERGY] > 0,
      })[0];
      if (container) {
        if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(container);
        }
        return;
      }
    }

    const spawn = creep.room.find(FIND_MY_SPAWNS)[0];
    if (spawn) {
      const capacity = spawn.store.getCapacity(RESOURCE_ENERGY) ?? 0;
      const energy = spawn.store.getUsedCapacity(RESOURCE_ENERGY) ?? 0;
      let economyCreeps = 0;
      for (const name in Game.creeps) {
        const role = Game.creeps[name].memory.role;
        if (role === "harvester" || role === "miner") economyCreeps++;
      }
      if (canWithdrawFromSpawn(energy, capacity, economyCreeps > 0)) {
        if (creep.withdraw(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
          creep.moveTo(spawn);
        }
        return;
      }
    }

    const storage = creep.room.storage;
    const income = Memory.ags?.metrics.energyIncomePerTick ?? 0;
    const baseline = Memory.ags?.baseline?.energyIncomePerTick;
    if (
      storage &&
      storage.store[RESOURCE_ENERGY] > 0 &&
      isIncomeStalled(income, baseline)
    ) {
      if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage);
      }
    }
    return;
  }
  const controller = creep.room.controller;
  if (!controller) return;
  if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
    creep.moveTo(controller);
  }
}
