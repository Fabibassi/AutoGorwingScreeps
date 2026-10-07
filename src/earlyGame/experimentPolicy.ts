/**
 * Early-game A/B experiment knobs (Memory.ags.abKnob / abVariant).
 * Unset → baseline profile (current production defaults).
 */

export const AB_KNOBS = [
  "containerTiming",
  "upgraderQuota",
  "extensionBootstrap",
  "builderCount",
  "minerBody",
  "haulerCap",
  "controllerContainer",
  "spawnBuffer",
  "bootstrapStrategy",
] as const;

export type AbKnob = (typeof AB_KNOBS)[number];

/**
 * Composite early-game strategies for 9×N benches:
 * 1 control + 4 Overmind-like (B) + 4 universal-like (C).
 */
export const BOOTSTRAP_STRATEGIES = [
  "control",
  "b_drop",
  "b_cap550",
  "b_chain",
  "b_wait3w",
  "c_universal",
  "c_hybrid",
  "c_build",
  "c_lean",
] as const;

export type BootstrapStrategy = (typeof BOOTSTRAP_STRATEGIES)[number];

export const AB_VARIANTS: Record<AbKnob, readonly string[]> = {
  containerTiming: ["immediate", "one_source", "later"],
  upgraderQuota: ["1", "2", "3"],
  extensionBootstrap: ["0", "2", "5"],
  builderCount: ["1", "2", "4"],
  minerBody: ["early_1w", "wait_2w", "wait_3w"],
  haulerCap: ["thin", "fat"],
  controllerContainer: ["early", "after_sources", "defer_rcl4"],
  spawnBuffer: ["50", "200", "300"],
  bootstrapStrategy: BOOTSTRAP_STRATEGIES,
};

export type ContainerTiming = "immediate" | "one_source" | "later";
export type ControllerContainerTiming = "early" | "after_sources" | "defer_rcl4";

/** Resolved knobs applied by construction / spawn / bodies. */
export interface ExperimentProfile {
  containerTiming: ContainerTiming;
  upgraderQuotaClimb: number;
  extensionBootstrap: number;
  builderInfra: number;
  minerMinWork: number;
  /** Cap hauler body cost; undefined = spend full energyAvailable. */
  haulerMaxCost: number | undefined;
  controllerContainer: ControllerContainerTiming;
  /** Spawn energy reserved before roads / non-critical spend. */
  spawnBuffer: number;
  /**
   * Allow static miners before every source has a container (drop mining).
   * Overmind-style early mode.
   */
  allowDropMiners: boolean;
  /**
   * Prefer mobile harvesters (universal-style) until room capacity reaches this.
   * 0 = off.
   */
  universalUntilCapacity: number;
  /**
   * Do not enqueue source containers until this many extensions are finished.
   * 0 = use containerTiming only.
   */
  containersAfterExtensions: number;
  /** Prefer miner → hauler spawn order when economy is healthy. */
  spawnChain: "default" | "miner_hauler";
}

/**
 * Production defaults = strategy-bench winner `b_chain`
 * (6/6 OK, median rcl3@19426; see `.sim-learn/strategy-bench.json`).
 */
export const BASELINE_PROFILE: ExperimentProfile = {
  containerTiming: "one_source",
  upgraderQuotaClimb: 3,
  extensionBootstrap: 5,
  builderInfra: 2,
  minerMinWork: 2,
  haulerMaxCost: undefined,
  controllerContainer: "after_sources",
  spawnBuffer: 200,
  allowDropMiners: true,
  universalUntilCapacity: 0,
  containersAfterExtensions: 0,
  spawnChain: "miner_hauler",
};

export function isAbKnob(raw: string | undefined): raw is AbKnob {
  return !!raw && (AB_KNOBS as readonly string[]).includes(raw);
}

export function parseAbVariant(
  knob: AbKnob,
  raw: string | undefined,
): string {
  const variants = AB_VARIANTS[knob];
  if (raw && (variants as readonly string[]).includes(raw)) return raw;
  // Baseline variant per knob.
  const baseline: Record<AbKnob, string> = {
    containerTiming: "one_source",
    upgraderQuota: "3",
    extensionBootstrap: "5",
    builderCount: "2",
    minerBody: "wait_2w",
    haulerCap: "fat",
    controllerContainer: "after_sources",
    spawnBuffer: "200",
    bootstrapStrategy: "b_chain",
  };
  return baseline[knob];
}

/** Apply a composite bootstrap strategy (B/C family) onto a profile. */
export function applyBootstrapStrategy(
  p: ExperimentProfile,
  strategy: BootstrapStrategy,
): ExperimentProfile {
  switch (strategy) {
    case "control":
      // Frozen pre-bench baseline — keep A/B contrast against strategy winners.
      p.allowDropMiners = false;
      p.containerTiming = "immediate";
      p.extensionBootstrap = 2;
      p.containersAfterExtensions = 0;
      p.spawnChain = "default";
      p.minerMinWork = 1;
      p.builderInfra = 4;
      p.universalUntilCapacity = 0;
      return p;
    case "b_drop":
      // Overmind-like: drop-mine early, containers after first ext, cap at 5W gate.
      p.allowDropMiners = true;
      p.containerTiming = "later";
      p.extensionBootstrap = 5;
      p.containersAfterExtensions = 1;
      p.spawnChain = "miner_hauler";
      p.minerMinWork = 1;
      p.builderInfra = 2;
      p.universalUntilCapacity = 0;
      return p;
    case "b_cap550":
      // Wait for full 5W capacity before source containers.
      p.allowDropMiners = true;
      p.containerTiming = "later";
      p.extensionBootstrap = 5;
      p.containersAfterExtensions = 5;
      p.spawnChain = "miner_hauler";
      p.minerMinWork = 3;
      p.builderInfra = 2;
      p.universalUntilCapacity = 0;
      return p;
    case "b_chain":
      // Drop miners + serialize one container at a time + strict spawn chain.
      p.allowDropMiners = true;
      p.containerTiming = "one_source";
      p.extensionBootstrap = 5;
      p.containersAfterExtensions = 0;
      p.spawnChain = "miner_hauler";
      p.minerMinWork = 2;
      p.builderInfra = 2;
      p.universalUntilCapacity = 0;
      return p;
    case "b_wait3w":
      // Drop miners, but refuse thin bodies until 3W is fundable.
      p.allowDropMiners = true;
      p.containerTiming = "later";
      p.extensionBootstrap = 5;
      p.containersAfterExtensions = 1;
      p.spawnChain = "miner_hauler";
      p.minerMinWork = 3;
      p.builderInfra = 2;
      p.universalUntilCapacity = 0;
      return p;
    case "c_universal":
      // TooAngel-like: harvester/universal until capacity funds 5W.
      p.allowDropMiners = false;
      p.containerTiming = "later";
      p.extensionBootstrap = 5;
      p.containersAfterExtensions = 1;
      p.spawnChain = "default";
      p.minerMinWork = 1;
      p.builderInfra = 4;
      p.universalUntilCapacity = 550;
      return p;
    case "c_hybrid":
      // Short universal window, then Overmind drop mining.
      p.allowDropMiners = true;
      p.containerTiming = "later";
      p.extensionBootstrap = 5;
      p.containersAfterExtensions = 1;
      p.spawnChain = "miner_hauler";
      p.minerMinWork = 1;
      p.builderInfra = 3;
      p.universalUntilCapacity = 350;
      return p;
    case "c_build":
      // Universal longer + heavy builders (infra-first climb).
      p.allowDropMiners = false;
      p.containerTiming = "later";
      p.extensionBootstrap = 5;
      p.containersAfterExtensions = 1;
      p.spawnChain = "default";
      p.minerMinWork = 1;
      p.builderInfra = 4;
      p.upgraderQuotaClimb = 2;
      p.universalUntilCapacity = 550;
      return p;
    case "c_lean":
      // Universal with thin logistics — fewer builders, capped haulers.
      p.allowDropMiners = false;
      p.containerTiming = "later";
      p.extensionBootstrap = 5;
      p.containersAfterExtensions = 1;
      p.spawnChain = "default";
      p.minerMinWork = 1;
      p.builderInfra = 2;
      p.haulerMaxCost = 200;
      p.universalUntilCapacity = 550;
      return p;
  }
}

/** Apply a single knob/variant on top of baseline. */
export function profileForVariant(
  knob: AbKnob,
  variant: string,
): ExperimentProfile {
  const v = parseAbVariant(knob, variant);
  const p: ExperimentProfile = { ...BASELINE_PROFILE };
  switch (knob) {
    case "containerTiming":
      p.containerTiming = v as ContainerTiming;
      break;
    case "upgraderQuota":
      p.upgraderQuotaClimb = Number(v);
      break;
    case "extensionBootstrap":
      p.extensionBootstrap = Number(v);
      break;
    case "builderCount":
      p.builderInfra = Number(v);
      break;
    case "minerBody":
      p.minerMinWork = v === "wait_3w" ? 3 : v === "wait_2w" ? 2 : 1;
      break;
    case "haulerCap":
      p.haulerMaxCost = v === "thin" ? 200 : undefined;
      break;
    case "controllerContainer":
      p.controllerContainer = v as ControllerContainerTiming;
      break;
    case "spawnBuffer":
      p.spawnBuffer = Number(v);
      break;
    case "bootstrapStrategy":
      return applyBootstrapStrategy(p, v as BootstrapStrategy);
  }
  return p;
}

export function resolveExperiment(ags?: {
  abKnob?: string;
  abVariant?: string;
  profile?: string;
}): ExperimentProfile {
  if (ags?.profile === "optimized" && ags.abKnob == null) {
    return OPTIMIZED_PROFILE;
  }
  if (!isAbKnob(ags?.abKnob)) return { ...BASELINE_PROFILE };
  return profileForVariant(ags.abKnob, ags.abVariant ?? "");
}

/**
 * Selective merge after full-winner stack lost rcl3@ to baseline
 * (see `.sim-learn/overnight-report.md`). Keep only the strongest
 * single-knob win (builderInfra=4); full-merge kept as FULL_MERGE_PROFILE.
 */
export const FULL_MERGE_PROFILE: ExperimentProfile = {
  containerTiming: "one_source",
  upgraderQuotaClimb: 2,
  extensionBootstrap: 2,
  builderInfra: 4,
  minerMinWork: 1,
  haulerMaxCost: 200,
  controllerContainer: "defer_rcl4",
  spawnBuffer: 200,
  allowDropMiners: false,
  universalUntilCapacity: 0,
  containersAfterExtensions: 0,
  spawnChain: "default",
};

export const OPTIMIZED_PROFILE: ExperimentProfile = {
  ...BASELINE_PROFILE,
};

/** Tag for GUI / live reason strings. */
export function experimentTag(ags?: {
  abKnob?: string;
  abVariant?: string;
  profile?: string;
}): string {
  if (isAbKnob(ags?.abKnob)) {
    return `ab=${ags.abKnob}:${parseAbVariant(ags.abKnob, ags.abVariant)}`;
  }
  if (ags?.profile === "optimized") return "profile=optimized";
  return "profile=baseline";
}

/**
 * How many source-container sites to enqueue this tick.
 * @param missing finished+sites already counted separately by caller via missing count
 * @param openSites unfinished source-container construction sites
 * @param extensionBuilt finished extensions (for "later")
 */
export function sourceContainerQueueCount(
  profile: ExperimentProfile,
  missing: number,
  openSites: number,
  extensionBuilt: number,
): number {
  if (missing <= 0) return 0;
  if (profile.containerTiming === "one_source") {
    return openSites > 0 ? 0 : 1;
  }
  if (profile.containersAfterExtensions > 0) {
    if (extensionBuilt < profile.containersAfterExtensions) return 0;
  }
  if (profile.containerTiming === "later") {
    // Extensions-first: wait for one finished bootstrap extension, then containers.
    // Requiring 2 often never finishes under parallel-road builder contention
    // (bench: later timed out at 50k with 0 containers).
    const need =
      profile.containersAfterExtensions > 0
        ? 0
        : profile.extensionBootstrap <= 0
          ? 0
          : 1;
    if (extensionBuilt < need) return 0;
    return missing;
  }
  return missing;
}

/** RCL2 extension cap under experiment (0 / 2 / 5). */
export function extensionBootstrapCap(
  profile: ExperimentProfile,
  rcl: number,
  fullQuota: number,
): number {
  if (rcl >= 3) return fullQuota;
  return Math.min(profile.extensionBootstrap, fullQuota);
}

export function allowControllerContainer(
  profile: ExperimentProfile,
  rcl: number,
  missingSourceContainers: number,
): boolean {
  if (profile.controllerContainer === "defer_rcl4") return rcl >= 4;
  if (profile.controllerContainer === "early") return true;
  return missingSourceContainers === 0;
}

/** Min energy before placing roads / non-critical construction. */
export function minEnergyForRoads(profile: ExperimentProfile): number {
  return profile.spawnBuffer;
}
