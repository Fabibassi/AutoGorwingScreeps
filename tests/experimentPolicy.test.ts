import { describe, expect, test } from "vitest";
import {
  BASELINE_PROFILE,
  constructionPriority,
  desiredCreeps,
  extensionBootstrapCap,
  extensionQuota,
  parseAbVariant,
  profileForVariant,
  resolveExperiment,
  sourceContainerQueueCount,
} from "../src/earlyGame";

describe("experimentPolicy", () => {
  test("defaults to baseline when Memory unset", () => {
    expect(resolveExperiment(undefined)).toEqual(BASELINE_PROFILE);
    expect(resolveExperiment({})).toEqual(BASELINE_PROFILE);
  });

  test("extensionBootstrap variants set RCL2 cap", () => {
    expect(parseAbVariant("extensionBootstrap", "0")).toBe("0");
    expect(
      extensionBootstrapCap(profileForVariant("extensionBootstrap", "0"), 2, 5),
    ).toBe(0);
    expect(
      extensionBootstrapCap(profileForVariant("extensionBootstrap", "2"), 2, 5),
    ).toBe(2);
    expect(
      extensionBootstrapCap(profileForVariant("extensionBootstrap", "5"), 2, 5),
    ).toBe(5);
    expect(
      extensionBootstrapCap(profileForVariant("extensionBootstrap", "5"), 3, 10),
    ).toBe(10);
  });

  test("constructionPriority respects extensionBootstrap=0", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
      experiment: profileForVariant("extensionBootstrap", "0"),
    });
    expect(queue.filter((s) => s === "extension")).toHaveLength(0);
  });

  test("constructionPriority queues 5 extensions when bootstrap=5", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: true,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
      experiment: profileForVariant("extensionBootstrap", "5"),
    });
    expect(queue.filter((s) => s === "extension")).toHaveLength(5);
  });

  test("baseline still caps RCL2 extensions at 2", () => {
    const queue = constructionPriority(2, {
      sourceContainerCount: 2,
      sourceCount: 2,
      hasControllerContainer: false,
      hasStorage: false,
      roadSitesAllowed: false,
      extensionCount: 0,
    });
    expect(queue.filter((s) => s === "extension")).toHaveLength(2);
    expect(extensionQuota(2)).toBe(5);
  });

  test("one_source container timing serializes sites", () => {
    const p = profileForVariant("containerTiming", "one_source");
    expect(sourceContainerQueueCount(p, 2, 0, 0)).toBe(1);
    expect(sourceContainerQueueCount(p, 1, 1, 0)).toBe(0);
  });

  test("later container timing waits for extensions", () => {
    const p = profileForVariant("containerTiming", "later");
    expect(sourceContainerQueueCount(p, 2, 0, 0)).toBe(0);
    expect(sourceContainerQueueCount(p, 2, 0, 2)).toBe(2);
  });

  test("upgraderQuota climb overrides desiredCreeps", () => {
    const q1 = desiredCreeps(
      2,
      2,
      2,
      false,
      undefined,
      profileForVariant("upgraderQuota", "1"),
    );
    expect(q1.upgrader).toBe(1);
    const q3 = desiredCreeps(
      2,
      2,
      2,
      false,
      undefined,
      profileForVariant("upgraderQuota", "3"),
    );
    expect(q3.upgrader).toBe(3);
  });

  test("builderCount changes infra push builders", () => {
    const q = desiredCreeps(
      2,
      2,
      0,
      true,
      undefined,
      profileForVariant("builderCount", "4"),
    );
    expect(q.builder).toBe(4);
  });
});
