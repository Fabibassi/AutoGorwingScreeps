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
] as const;

export type AbKnob = (typeof AB_KNOBS)[number];

export const AB_VARIANTS: Record<AbKnob, readonly string[]> = {
  containerTiming: ["immediate", "one_source", "later"],
  upgraderQuota: ["1", "2", "3"],
  extensionBootstrap: ["0", "2", "5"],
  builderCount: ["1", "2", "4"],
  minerBody: ["early_1w", "wait_2w", "wait_3w"],
  haulerCap: ["thin", "fat"],
  controllerContainer: ["early", "after_sources", "defer_rcl4"],
  spawnBuffer: ["50", "200", "300"],
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
}

/** Current production defaults (parallel roads assumed elsewhere). */
export const BASELINE_PROFILE: ExperimentProfile = {
  containerTiming: "immediate",
  upgraderQuotaClimb: 3,
  extensionBootstrap: 2,
  builderInfra: 4,
  minerMinWork: 1,
  haulerMaxCost: undefined,
  controllerContainer: "after_sources",
  spawnBuffer: 200,
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
    containerTiming: "immediate",
    upgraderQuota: "3",
    extensionBootstrap: "2",
    builderCount: "2",
    minerBody: "early_1w",
    haulerCap: "fat",
    controllerContainer: "after_sources",
    spawnBuffer: "200",
  };
  return baseline[knob];
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
  return profileForVariant(ags.abKnob, ags.abVariant);
}

/**
 * Merged A/B winners. Until the suite finishes this matches baseline;
 * update after writing `.sim-learn/bench-summary.json`.
 */
export const OPTIMIZED_PROFILE: ExperimentProfile = { ...BASELINE_PROFILE };

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
  if (profile.containerTiming === "later") {
    // Extensions-first: wait until at least one extension exists, then containers.
    if (extensionBuilt < 1) return 0;
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
