import { describe, expect, test } from "vitest";
import { memoryApiUrl, screepsHeaders } from "../ops/screepsApi";

describe("screepsHeaders", () => {
  test("sets X-Token", () => {
    expect(screepsHeaders("abc")["X-Token"]).toBe("abc");
  });

  test("sets shard header when provided", () => {
    expect(screepsHeaders("abc", "shard3")["X-Shard"]).toBe("shard3");
  });

  test("omits shard header when empty", () => {
    expect(screepsHeaders("abc", "")["X-Shard"]).toBeUndefined();
  });
});

describe("memoryApiUrl", () => {
  test("includes path and shard as query params", () => {
    const url = memoryApiUrl("https://screeps.com", "ags", "shard3");
    expect(url).toContain("path=ags");
    expect(url).toContain("shard=shard3");
  });

  test("omits shard query when undefined", () => {
    const url = memoryApiUrl("https://screeps.com", "", undefined);
    expect(url).toContain("path=");
    expect(url).not.toContain("shard=");
  });
});
