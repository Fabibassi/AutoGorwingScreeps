import { maybeArmFillerPlanPostHub } from "./earlyGame/fillerPlan";
import {
  maybeArmRcl5AftercareMode,
  maybeArmRcl5PostHubMode,
  maybeArmRcl5PostHubPlan,
  maybeArmRcl6SpendMode,
  maybeDisarmRcl6SpendMode,
} from "./earlyGame/rcl5Mode";
import {
  estimateRemotePathFromMap,
  measureRemotePathLength,
  maybeArmRemotePlanPostRcl6,
  parseRemotePlan,
  remotePlanIsActive,
} from "./earlyGame/remotePlan";
import { hubRampartsReady } from "./earlyGame/wallArm";
import { applyParsedMemoryReuse } from "./loop/memHack";
import { runConstruction } from "./construction";
import { tickRemoteThreat } from "./defense/remoteThreat";
import { maybeActivateSafeMode } from "./defense/safeMode";
import { tickHomeProbe } from "./defense/scoutProbe";
import { runTowers } from "./defense/towers";
import { runLinks } from "./links";
import { runLabs } from "./labs/run";
import { runMarket } from "./market/run";
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
  const remoteRoom2Sticky = Memory.ags?.remoteRoom2;
  const remotePathLengthSticky = Memory.ags?.remotePathLength;
  const remotePathLength2Sticky = Memory.ags?.remotePathLength2;
  const expandRoomSticky = Memory.ags?.expandRoom;
  const remoteVariantSticky = Memory.ags?.remoteVariant;
  const idleBuilderUpgradeSticky = Memory.ags?.idleBuilderUpgrade;
  const storageBlackoutReserveSticky = Memory.ags?.storageBlackoutReserve;
  const haulerCapSticky = Memory.ags?.haulerCap;
  const haulerBudgetSticky = Memory.ags?.haulerBudget;
  const upgraderSeatsSticky = Memory.ags?.upgraderSeats;
  const upgradeStyleSticky = Memory.ags?.upgradeStyle;
  const wallPolicySticky = Memory.ags?.wallPolicy;
  const wallsArmedSticky = Memory.ags?.wallsArmed;
  const wallArmReasonSticky = Memory.ags?.wallArmReason;

  try {
    applyParsedMemoryReuse();
    clearDeadCreepMemory();
    healCreepRoles();

    // Before spawn/creeps: arm remote threat sticky from vision (any remote).
    {
      const remotes = [Memory.ags?.remoteRoom, Memory.ags?.remoteRoom2].filter(
        Boolean,
      ) as string[];
      let hostilesNow: number | null = null;
      let sawVision = false;
      for (const rn of remotes) {
        const remote = Game.rooms[rn];
        if (!remote) continue;
        sawVision = true;
        hostilesNow = (hostilesNow ?? 0) + remote.find(FIND_HOSTILE_CREEPS).length;
      }
      if (remotes.length > 0 && Memory.ags) {
        tickRemoteThreat(Memory.ags, {
          tick: Game.time,
          hostilesNow: sawVision ? hostilesNow ?? 0 : null,
        });
      }
    }

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
        if (Memory.ags) {
          tickHomeProbe(Memory.ags, {
            tick: Game.time,
            hostiles: room.find(FIND_HOSTILE_CREEPS),
          });
        }
      } catch (e) {
        errorsThisTick++;
        console.log(`scoutProbe ${name} error`, e);
      }
      try {
        maybeActivateSafeMode(room);
      } catch (e) {
        errorsThisTick++;
        console.log(`safeMode ${name} error`, e);
      }
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
      try {
        runMarket(room);
      } catch (e) {
        errorsThisTick++;
        console.log(`market ${name} error`, e);
      }
      try {
        runLabs(room);
      } catch (e) {
        errorsThisTick++;
        console.log(`labs ${name} error`, e);
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
    // containersAtSources (live false 1/2 while W0N0 already had both seats).
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
    const remoteRoom2Now = Memory.ags?.remoteRoom2 ?? remoteRoom2Sticky;
    if (remoteRoom2Now) Memory.ags.remoteRoom2 = remoteRoom2Now;
    const remotePathNow =
      Memory.ags?.remotePathLength ?? remotePathLengthSticky;
    if (remotePathNow != null) Memory.ags.remotePathLength = remotePathNow;
    const remotePath2Now =
      Memory.ags?.remotePathLength2 ?? remotePathLength2Sticky;
    if (remotePath2Now != null) Memory.ags.remotePathLength2 = remotePath2Now;
    const expandRoomNow = Memory.ags?.expandRoom ?? expandRoomSticky;
    if (expandRoomNow) Memory.ags.expandRoom = expandRoomNow;
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
      // Keep remotePathLength sticky even when spawn is busy with home roles.
      if (remotePlanIsActive(parseRemotePlan(Memory.ags?.remotePlan))) {
        const remoteName =
          Memory.ags.remoteRoom ??
          (undefined as string | undefined);
        if (remoteName) {
          const measured = measureRemotePathLength(room, remoteName);
          if (measured != null) Memory.ags.remotePathLength = measured;
          else if (Memory.ags.remotePathLength == null) {
            const estimate = estimateRemotePathFromMap(room.name, remoteName);
            if (estimate != null) Memory.ags.remotePathLength = estimate;
          }
        }
      }
      // rcl6-spend: upgrade_rush only after hub ramparts exist; disarm under
      // floor or while defense CAPEX is unfinished.
      const storageEnergy = room.storage?.store[RESOURCE_ENERGY] ?? 0;
      const defenseReady = hubRampartsReady(room);
      const rcl6Spend = maybeArmRcl6SpendMode(rcl, Memory.ags?.rcl5Mode, {
        remotePlan: Memory.ags?.remotePlan,
        storageEnergy,
        hubDefenseReady: defenseReady,
      });
      if (rcl6Spend) Memory.ags.rcl5Mode = rcl6Spend;
      const rcl6Disarm = maybeDisarmRcl6SpendMode(rcl, Memory.ags?.rcl5Mode, {
        remotePlan: Memory.ags?.remotePlan,
        storageEnergy,
        hubDefenseReady: defenseReady,
      });
      if (rcl6Disarm) Memory.ags.rcl5Mode = rcl6Disarm;
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
    if (haulerCapSticky !== undefined) {
      Memory.ags.haulerCap = haulerCapSticky;
    }
    if (haulerBudgetSticky !== undefined) {
      Memory.ags.haulerBudget = haulerBudgetSticky;
    }
    if (upgraderSeatsSticky !== undefined) {
      Memory.ags.upgraderSeats = upgraderSeatsSticky;
    }
    if (upgradeStyleSticky) Memory.ags.upgradeStyle = upgradeStyleSticky;
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
    const remoteRoom2Keep = Memory.ags?.remoteRoom2 ?? remoteRoom2Sticky;
    if (remoteRoom2Keep) Memory.ags.remoteRoom2 = remoteRoom2Keep;
    const remotePathKeep =
      Memory.ags?.remotePathLength ?? remotePathLengthSticky;
    if (remotePathKeep != null) Memory.ags.remotePathLength = remotePathKeep;
    const remotePath2Keep =
      Memory.ags?.remotePathLength2 ?? remotePathLength2Sticky;
    if (remotePath2Keep != null) Memory.ags.remotePathLength2 = remotePath2Keep;
    const expandRoomKeep = Memory.ags?.expandRoom ?? expandRoomSticky;
    if (expandRoomKeep) Memory.ags.expandRoom = expandRoomKeep;
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
    if (haulerCapSticky !== undefined) {
      Memory.ags.haulerCap = haulerCapSticky;
    }
    if (haulerBudgetSticky !== undefined) {
      Memory.ags.haulerBudget = haulerBudgetSticky;
    }
    if (upgraderSeatsSticky !== undefined) {
      Memory.ags.upgraderSeats = upgraderSeatsSticky;
    }
    if (upgradeStyleSticky) Memory.ags.upgradeStyle = upgradeStyleSticky;

    logPlanStatusIfDue(room, Memory.ags);
  } catch (e) {
    console.log("main loop error", e);
    const recovered = recoverTelemetryOnLoopError(Memory.ags);
    if (!Memory.ags) Memory.ags = recovered;
    else Object.assign(Memory.ags, recovered);
  }
}
