import { maybeArmFillerPlanPostHub } from "./earlyGame/fillerPlan";
import {
  maybeArmRcl5AftercareMode,
  maybeArmRcl5PostHubMode,
  maybeArmRcl5PostHubPlan,
  maybeArmRcl6SpendMode,
} from "./earlyGame/rcl5Mode";
import { maybeArmRemotePlanPostRcl6 } from "./earlyGame/remotePlan";
import { applyParsedMemoryReuse } from "./loop/memHack";
import { runConstruction } from "./construction";
import { runTowers } from "./defense/towers";
import { runLinks } from "./links";
import { recoverTelemetryOnLoopError } from "./loop/recoverTelemetry";
import { runRemoteConstruction } from "./remote/run";
import { healCreepRoles, pickHomeRoom } from "./room/queries";
import { runCreep } from "./roles";
import { maybeUpdateHealthCheck } from "./selfCheck";
import { runSpawn } from "./spawn";
import { logPlanStatusIfDue } from "./status";
import { tickTelemetry } from "./telemetry";
import { showCreepJob } from "./visuals";

function clearDeadCreepMemory(): void {
  for (const name in Memory.creeps) {
    if (!(name in Game.creeps)) {
      delete Memory.creeps[name];
    }
  }
}

export function loop(): void {
  let errorsThisTick = 0;
  let energyHarvestedThisTick = 0;
  const roadPolicySticky = Memory.ags?.roadPolicy;
  const abKnobSticky = Memory.ags?.abKnob;
  const abVariantSticky = Memory.ags?.abVariant;
  const profileSticky = Memory.ags?.profile;
  const rcl5ModeSticky = Memory.ags?.rcl5Mode;
  const rcl5PlanSticky = Memory.ags?.rcl5Plan;
  const fillerPlanSticky = Memory.ags?.fillerPlan;
  const remotePlanSticky = Memory.ags?.remotePlan;
  const remoteRoomSticky = Memory.ags?.remoteRoom;
  const remotePathLengthSticky = Memory.ags?.remotePathLength;
  const remoteVariantSticky = Memory.ags?.remoteVariant;
  const idleBuilderUpgradeSticky = Memory.ags?.idleBuilderUpgrade;
  const storageBlackoutReserveSticky = Memory.ags?.storageBlackoutReserve;
  const wallPolicySticky = Memory.ags?.wallPolicy;
  const wallsArmedSticky = Memory.ags?.wallsArmed;
  const wallArmReasonSticky = Memory.ags?.wallArmReason;

  try {
    applyParsedMemoryReuse();
    clearDeadCreepMemory();
    healCreepRoles();

    for (const name in Game.rooms) {
      const room = Game.rooms[name];
      if (room.controller?.my) {
        try {
          runConstruction(room);
        } catch (e) {
          errorsThisTick++;
          console.log(`construction ${name} error`, e);
        }
      }
    }

    for (const name in Game.spawns) {
      try {
        runSpawn(Game.spawns[name]);
      } catch (e) {
        errorsThisTick++;
        console.log(`spawn ${name} error`, e);
      }
    }

    for (const name in Game.rooms) {
      const room = Game.rooms[name];
      if (!room.controller?.my) continue;
      try {
        runTowers(room);
      } catch (e) {
        errorsThisTick++;
        console.log(`towers ${name} error`, e);
      }
      try {
        runLinks(room);
      } catch (e) {
        errorsThisTick++;
        console.log(`links ${name} error`, e);
      }
    }

    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      try {
        energyHarvestedThisTick += runCreep(creep);
        showCreepJob(creep);
      } catch (e) {
        errorsThisTick++;
        console.log(`creep ${name} error`, e);
      }
    }

    // Never use Game.rooms[0] — adjacent vision can make health report another room's
    // containersAtSources (live false 1/2 while W21N35 already had both seats).
    const room = pickHomeRoom(Game.rooms, Game.spawns);
    const rcl = room?.controller?.level ?? 1;
    const nextAgs = tickTelemetry({
      tick: Game.time,
      rcl,
      energyHarvestedThisTick,
      errorsThisTick,
      cpuUsed: Game.cpu.getUsed(),
      memory: Memory.ags,
    });
    // Mutate in place so memHack's cached Memory identity keeps ags writes.
    if (!Memory.ags) Memory.ags = nextAgs;
    else Object.assign(Memory.ags, nextAgs);
    // Preserve experiment knobs across telemetry rewrites.
    if (roadPolicySticky) Memory.ags.roadPolicy = roadPolicySticky;
    if (abKnobSticky) Memory.ags.abKnob = abKnobSticky;
    if (abVariantSticky) Memory.ags.abVariant = abVariantSticky;
    if (profileSticky) Memory.ags.profile = profileSticky;
    // Prefer mid-tick console injections over the tick-start snapshot.
    const rcl5ModeNow = Memory.ags?.rcl5Mode ?? rcl5ModeSticky;
    if (rcl5ModeNow) Memory.ags.rcl5Mode = rcl5ModeNow;
    const rcl5PlanNow = Memory.ags?.rcl5Plan ?? rcl5PlanSticky;
    if (rcl5PlanNow) Memory.ags.rcl5Plan = rcl5PlanNow;
    const fillerPlanNow = Memory.ags?.fillerPlan ?? fillerPlanSticky;
    if (fillerPlanNow) Memory.ags.fillerPlan = fillerPlanNow;
    const remotePlanNow = Memory.ags?.remotePlan ?? remotePlanSticky;
    if (remotePlanNow) Memory.ags.remotePlan = remotePlanNow;
    const remoteRoomNow = Memory.ags?.remoteRoom ?? remoteRoomSticky;
    if (remoteRoomNow) Memory.ags.remoteRoom = remoteRoomNow;
    if (Memory.ags?.remotePathLength == null && remotePathLengthSticky != null) {
      Memory.ags.remotePathLength = remotePathLengthSticky;
    }
    const remoteVariantNow = Memory.ags?.remoteVariant ?? remoteVariantSticky;
    if (remoteVariantNow) Memory.ags.remoteVariant = remoteVariantNow;
    // Auto-arm aftercare winner once at RCL≥5 (sticky; skip explicit non-default modes).
    const armed = maybeArmRcl5AftercareMode(rcl, Memory.ags?.rcl5Mode);
    if (armed) Memory.ags.rcl5Mode = armed;
    // After hub-ready, switch to RCL5→RCL6 bench winner (fat_first) + link plan.
    if (room?.controller?.my) {
      const extensions = room
        .find(FIND_MY_STRUCTURES, {
          filter: (s) => s.structureType === STRUCTURE_EXTENSION,
        })
        .length;
      const towers = room
        .find(FIND_MY_STRUCTURES, {
          filter: (s) => s.structureType === STRUCTURE_TOWER,
        })
        .length;
      const postHub = maybeArmRcl5PostHubMode(rcl, Memory.ags?.rcl5Mode, {
        extensions,
        towers,
      });
      if (postHub) Memory.ags.rcl5Mode = postHub;
      // Gameplan confirm (160k): link_boost → RCL6 @132k; encode for live.
      const postHubPlan = maybeArmRcl5PostHubPlan(rcl, Memory.ags?.rcl5Plan, {
        extensions,
        towers,
      });
      if (postHubPlan) Memory.ags.rcl5Plan = postHubPlan;
      // Live softlock: thin leaves hub ~empty with fat storage → arm fat.
      const fillerArmed = maybeArmFillerPlanPostHub(
        rcl,
        Memory.ags?.fillerPlan,
        { extensions, towers },
      );
      if (fillerArmed) Memory.ags.fillerPlan = fillerArmed;
      const remoteArmed = maybeArmRemotePlanPostRcl6(
        rcl,
        Memory.ags?.remotePlan,
        { storageEnergy: room.storage?.store[RESOURCE_ENERGY] ?? 0 },
      );
      if (remoteArmed) Memory.ags.remotePlan = remoteArmed;
      // rcl6-spend bench: fat_first → upgrade_rush once remotes are in play.
      const rcl6Spend = maybeArmRcl6SpendMode(rcl, Memory.ags?.rcl5Mode, {
        remotePlan: Memory.ags?.remotePlan,
      });
      if (rcl6Spend) Memory.ags.rcl5Mode = rcl6Spend;
      try {
        runRemoteConstruction(room);
      } catch (e) {
        console.log("remote construction error", e);
        errorsThisTick++;
      }
    }
    if (idleBuilderUpgradeSticky !== undefined) {
      Memory.ags.idleBuilderUpgrade = idleBuilderUpgradeSticky;
    }
    if (storageBlackoutReserveSticky !== undefined) {
      Memory.ags.storageBlackoutReserve = storageBlackoutReserveSticky;
    }
    const withHealth = maybeUpdateHealthCheck(room, Memory.ags);
    if (withHealth && withHealth !== Memory.ags) {
      Object.assign(Memory.ags, withHealth);
    }
    if (roadPolicySticky) Memory.ags.roadPolicy = roadPolicySticky;
    if (abKnobSticky) Memory.ags.abKnob = abKnobSticky;
    if (abVariantSticky) Memory.ags.abVariant = abVariantSticky;
    if (profileSticky) Memory.ags.profile = profileSticky;
    const rcl5ModeKeep = Memory.ags?.rcl5Mode ?? rcl5ModeSticky;
    if (rcl5ModeKeep) Memory.ags.rcl5Mode = rcl5ModeKeep;
    const rcl5PlanKeep = Memory.ags?.rcl5Plan ?? rcl5PlanSticky;
    if (rcl5PlanKeep) Memory.ags.rcl5Plan = rcl5PlanKeep;
    const fillerPlanKeep = Memory.ags?.fillerPlan ?? fillerPlanSticky;
    if (fillerPlanKeep) Memory.ags.fillerPlan = fillerPlanKeep;
    const remotePlanKeep = Memory.ags?.remotePlan ?? remotePlanSticky;
    if (remotePlanKeep) Memory.ags.remotePlan = remotePlanKeep;
    const remoteRoomKeep = Memory.ags?.remoteRoom ?? remoteRoomSticky;
    if (remoteRoomKeep) Memory.ags.remoteRoom = remoteRoomKeep;
    if (Memory.ags?.remotePathLength == null && remotePathLengthSticky != null) {
      Memory.ags.remotePathLength = remotePathLengthSticky;
    }
    const remoteVariantKeep = Memory.ags?.remoteVariant ?? remoteVariantSticky;
    if (remoteVariantKeep) Memory.ags.remoteVariant = remoteVariantKeep;
    const wallPolicyKeep = Memory.ags?.wallPolicy ?? wallPolicySticky;
    if (wallPolicyKeep) Memory.ags.wallPolicy = wallPolicyKeep;
    if (Memory.ags?.wallsArmed || wallsArmedSticky) {
      Memory.ags.wallsArmed = true;
    }
    const wallArmReasonKeep =
      Memory.ags?.wallArmReason ?? wallArmReasonSticky;
    if (wallArmReasonKeep) Memory.ags.wallArmReason = wallArmReasonKeep;
    if (idleBuilderUpgradeSticky !== undefined) {
      Memory.ags.idleBuilderUpgrade = idleBuilderUpgradeSticky;
    }
    if (storageBlackoutReserveSticky !== undefined) {
      Memory.ags.storageBlackoutReserve = storageBlackoutReserveSticky;
    }

    logPlanStatusIfDue(room, Memory.ags);
  } catch (e) {
    console.log("main loop error", e);
    const recovered = recoverTelemetryOnLoopError(Memory.ags);
    if (!Memory.ags) Memory.ags = recovered;
    else Object.assign(Memory.ags, recovered);
  }
}
