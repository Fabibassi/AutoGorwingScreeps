import { describe, expect, test } from "vitest";
import { resolveHostname } from "../ops/screepsEnv";

describe("resolveHostname", () => {
  test("defaults to official World", () => {
    const prev = process.env.SCREEPS_HOSTNAME;
    delete process.env.SCREEPS_HOSTNAME;
    expect(resolveHostname()).toBe("https://screeps.com");
    expect(resolveHostname("")).toBe("https://screeps.com");
    if (prev !== undefined) process.env.SCREEPS_HOSTNAME = prev;
  });

  test("strips trailing slashes", () => {
    expect(resolveHostname("http://127.0.0.1:21025/")).toBe(
      "http://127.0.0.1:21025",
    );
  });

  test("keeps private server host", () => {
    expect(resolveHostname("http://127.0.0.1:21025")).toBe(
      "http://127.0.0.1:21025",
    );
  });
});
