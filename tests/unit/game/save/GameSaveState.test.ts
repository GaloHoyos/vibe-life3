import { describe, expect, it } from "vitest";
import {
  readPlayerRuntimeSaveState,
  toJsonObject,
  toJsonValue,
} from "@game/save/GameSaveState";

describe("GameSaveState", () => {
  it("round-trips a complete player snapshot", () => {
    const encoded = toJsonObject({
      position: [1, 2, 3],
      velocity: [4, 5, 6],
      yaw: 0.8,
      pitch: -0.2,
      health: 73,
      armor: 18,
      weapons: [{ id: "pistol", magazine: 9, reserve: 24 }],
      ammo: [{ id: "pistol", amount: 24 }],
      activeWeaponId: "pistol",
      stamina: {
        current: 61,
        depleted: false,
        timeSinceDrain: 0.4,
      },
    });

    expect(readPlayerRuntimeSaveState(encoded)).toEqual({
      position: [1, 2, 3],
      velocity: [4, 5, 6],
      yaw: 0.8,
      pitch: -0.2,
      health: 73,
      armor: 18,
      weapons: [{ id: "pistol", magazine: 9, reserve: 24 }],
      ammo: [{ id: "pistol", amount: 24 }],
      activeWeaponId: "pistol",
      stamina: {
        current: 61,
        depleted: false,
        timeSinceDrain: 0.4,
      },
    });
  });

  it("rejects an unknown weapon before mutating the world", () => {
    const encoded = toJsonObject({
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      yaw: 0,
      pitch: 0,
      health: 100,
      armor: 0,
      weapons: [{ id: "future-gun", magazine: 1, reserve: 0 }],
      ammo: [],
      activeWeaponId: null,
      stamina: {
        current: 100,
        depleted: false,
        timeSinceDrain: 0,
      },
    });

    expect(() => readPlayerRuntimeSaveState(encoded)).toThrow(
      /future-gun/,
    );
  });

  it("normalizes undefined fields through JSON before hashing custom maps", () => {
    expect(toJsonValue({ id: "map", optional: undefined })).toEqual({
      id: "map",
    });
  });
});
