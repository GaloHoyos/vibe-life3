import { describe, expect, it } from "vitest";
import type { Faction } from "@engine/ai/Faction";
import {
  canUseVehicleRole,
  evaluateVehicleRoleAccess,
  isManualPlayerExitAllowed,
  type VehicleAccessActor,
} from "@game/gameplay/vehicles/VehicleAccessPolicy";
import type {
  VehicleAccessPolicy,
  VehicleDefinition,
} from "@game/levels/LevelDefinition";

const PLAYER = { kind: "player" } as const satisfies VehicleAccessActor;

describe("VehicleAccessPolicy", () => {
  it.each([
    ["player", "driver"],
    ["resistance", "pilot"],
    ["combine", "gunner"],
  ] as const)(
    "permite al jugador ocupar %s como %s",
    (policy, role) => {
      expect(canUseVehicleRole(PLAYER, vehicle(policy), role)).toBe(true);
    },
  );

  it.each([
    ["driver", true],
    ["pilot", true],
    ["commander", true],
    ["gunner", true],
    ["passenger", true],
  ] as const)(
    "permite a Resistance usar un vehículo resistance como %s",
    (role, expected) => {
      expect(canUseVehicleRole(npc("resistance", true), vehicle("resistance"), role))
        .toBe(expected);
    },
  );

  it.each([
    ["driver", false],
    ["pilot", false],
    ["commander", true],
    ["gunner", true],
    ["passenger", true],
  ] as const)(
    "reserva los controles player y deja acompañar a Resistance como %s",
    (role, expected) => {
      expect(canUseVehicleRole(npc("resistance", true), vehicle("player"), role))
        .toBe(expected);
    },
  );

  it("no mezcla Resistance y Combine", () => {
    expect(canUseVehicleRole(
      npc("resistance", true),
      vehicle("combine"),
      "passenger",
    )).toBe(false);
    expect(canUseVehicleRole(
      npc("combine", true),
      vehicle("resistance"),
      "gunner",
    )).toBe(false);
    expect(canUseVehicleRole(
      npc("combine", true),
      vehicle("player"),
      "passenger",
    )).toBe(false);
  });

  it("permite a Combine ocupar y conducir sólo vehículos combine", () => {
    const combine = npc("combine", true);
    expect(canUseVehicleRole(combine, vehicle("combine"), "driver")).toBe(true);
    expect(canUseVehicleRole(combine, vehicle("combine"), "gunner")).toBe(true);
  });

  it("permite acompañar pero no conducir cuando la capacidad lo prohíbe", () => {
    const nonDriver = npc("resistance", false);
    expect(canUseVehicleRole(nonDriver, vehicle("resistance"), "passenger")).toBe(true);
    expect(evaluateVehicleRoleAccess(
      nonDriver,
      vehicle("resistance"),
      "driver",
    )).toEqual({
      allowed: false,
      policy: "resistance",
      reason: "cannot-drive",
    });
  });

  it("rechaza NPCs sin capacidad cognitiva vehicular", () => {
    expect(evaluateVehicleRoleAccess(
      { kind: "npc", faction: "resistance" },
      vehicle("player"),
      "passenger",
    )).toEqual({
      allowed: false,
      policy: "player",
      reason: "no-vehicle-capability",
    });
  });

  it.each([
    "zombies",
    "blob",
    "neutral",
    "player",
  ] as const)("rechaza la facción NPC no compatible %s", (faction) => {
    expect(canUseVehicleRole(
      npc(faction, true),
      vehicle("resistance"),
      "passenger",
    )).toBe(false);
  });

  it("usa el fallback compatible de faction cuando falta accessPolicy", () => {
    expect(evaluateVehicleRoleAccess(
      npc("combine", true),
      { faction: "combine" },
      "driver",
    )).toMatchObject({ allowed: true, policy: "combine" });
    expect(evaluateVehicleRoleAccess(
      npc("resistance", true),
      { faction: "resistance" },
      "driver",
    )).toMatchObject({ allowed: true, policy: "resistance" });
    expect(evaluateVehicleRoleAccess(
      npc("resistance", true),
      {},
      "passenger",
    )).toMatchObject({ allowed: true, policy: "player" });
  });

  it("expone el motivo específico cuando Resistance intenta conducir un player", () => {
    expect(evaluateVehicleRoleAccess(
      npc("resistance", true),
      vehicle("player"),
      "pilot",
    )).toEqual({
      allowed: false,
      policy: "player",
      reason: "controls-reserved-for-player",
    });
  });

  it("permite bajar siempre salvo en helicópteros que no lo autoricen", () => {
    expect(isManualPlayerExitAllowed({
      presetId: "buggy",
      allowPlayerExit: false,
    })).toBe(true);
    expect(isManualPlayerExitAllowed({
      presetId: "helicopter",
    })).toBe(false);
    expect(isManualPlayerExitAllowed({
      presetId: "helicopter",
      allowPlayerExit: true,
    })).toBe(true);
  });
});

function npc(faction: Faction, canDrive: boolean): VehicleAccessActor {
  return {
    kind: "npc",
    faction,
    vehicleCapability: { canDrive },
  };
}

function vehicle(
  accessPolicy: VehicleAccessPolicy,
): Pick<VehicleDefinition, "accessPolicy" | "faction"> {
  return { accessPolicy };
}
