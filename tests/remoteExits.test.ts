import { describe, expect, test, vi, afterEach } from "vitest";
import {
  listExitRooms,
  pickFirstExitRoom,
  pickSecondExitRoom,
} from "../src/earlyGame/remotePlan";

describe("exit room helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("lists N/E/S/W exits in order", () => {
    vi.stubGlobal("Game", {
      map: {
        describeExits: () => ({
          "1": "W0N1",
          "3": "W1N0",
          "5": "W0N-1",
          "7": "W-1N0",
        }),
      },
    });
    expect(listExitRooms("W0N0")).toEqual([
      "W0N1",
      "W1N0",
      "W0N-1",
      "W-1N0",
    ]);
    expect(pickFirstExitRoom("W0N0")).toBe("W0N1");
    expect(pickSecondExitRoom("W0N0", "W0N1")).toBe("W1N0");
  });
});
