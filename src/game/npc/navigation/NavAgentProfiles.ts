import type { NavAgentProfile } from "@engine/ai/navigation/NavigationTypes";
import type { NpcPreset } from "@game/npc/presets/NpcPreset";

const BASE_AREA_COSTS = {
  ground: 1,
  stairs: 1.08,
  crouch: 1.25,
  door: 1.12,
  hazard: 8,
  costly: 2,
} as const;

export const NavigationProfiles = {
  humanoid: profile({
    id: "humanoid",
    domain: "ground",
    radius: 0.35,
    standingHeight: 1.8,
    navigationHeight: 1.3,
    maxSlopeDegrees: 46,
    stepHeight: 0.4,
    maxSpeed: 6.2,
    acceleration: 10,
    canJump: true,
    canCrouch: true,
    canDrop: true,
    canOpenDoors: true,
    canUsePortals: true,
    jumpSpeed: 9.2,
    maxJumpDistance: 3.6,
    safeDropHeight: 3.2,
    standingProfileId: "humanoid-limited",
  }),
  humanoidLimited: profile({
    id: "humanoid-limited",
    domain: "ground",
    radius: 0.35,
    standingHeight: 1.75,
    navigationHeight: 1.75,
    maxSlopeDegrees: 46,
    stepHeight: 0.4,
    maxSpeed: 3.2,
    acceleration: 8,
    canJump: false,
    canCrouch: false,
    canDrop: true,
    canOpenDoors: false,
    canUsePortals: true,
    jumpSpeed: 0,
    maxJumpDistance: 1.8,
    safeDropHeight: 2.2,
  }),
  headcrab: profile({
    id: "headcrab",
    domain: "smallGround",
    radius: 0.3,
    standingHeight: 0.55,
    navigationHeight: 0.55,
    maxSlopeDegrees: 50,
    stepHeight: 0.25,
    maxSpeed: 4.2,
    acceleration: 12,
    canJump: true,
    canCrouch: false,
    canDrop: true,
    canOpenDoors: false,
    canUsePortals: true,
    jumpSpeed: 7.5,
    maxJumpDistance: 4,
    safeDropHeight: 4,
    maxTraversalLinks: 96,
  }),
  manhack: profile({
    id: "manhack",
    domain: "air",
    radius: 0.3,
    standingHeight: 0.6,
    navigationHeight: 0.6,
    maxSlopeDegrees: 89,
    stepHeight: 0,
    maxSpeed: 6.5,
    acceleration: 5,
    canJump: false,
    canCrouch: false,
    canDrop: false,
    canOpenDoors: false,
    canUsePortals: true,
    jumpSpeed: 0,
    maxJumpDistance: 0,
    safeDropHeight: 0,
    airCellSize: 1.2,
  }),
  gunship: profile({
    id: "gunship",
    domain: "air",
    radius: 0.95,
    standingHeight: 2.4,
    navigationHeight: 2.4,
    maxSlopeDegrees: 89,
    stepHeight: 0,
    maxSpeed: 11,
    acceleration: 3.8,
    canJump: false,
    canCrouch: false,
    canDrop: false,
    canOpenDoors: false,
    canUsePortals: false,
    jumpSpeed: 0,
    maxJumpDistance: 0,
    safeDropHeight: 0,
    airCellSize: 3,
  }),
  strider: profile({
    id: "strider",
    domain: "largeGround",
    radius: 1.35,
    standingHeight: 9.5,
    navigationHeight: 9.5,
    maxSlopeDegrees: 32,
    stepHeight: 0.35,
    maxSpeed: 6.2,
    acceleration: 3.2,
    canJump: false,
    canCrouch: false,
    canDrop: false,
    canOpenDoors: false,
    canUsePortals: false,
    jumpSpeed: 0,
    maxJumpDistance: 0,
    safeDropHeight: 0,
  }),
  stationary: profile({
    id: "stationary",
    domain: "stationary",
    radius: 0.3,
    standingHeight: 1.2,
    navigationHeight: 1.2,
    maxSlopeDegrees: 0,
    stepHeight: 0,
    maxSpeed: 0,
    acceleration: 0,
    canJump: false,
    canCrouch: false,
    canDrop: false,
    canOpenDoors: false,
    canUsePortals: false,
    jumpSpeed: 0,
    maxJumpDistance: 0,
    safeDropHeight: 0,
  }),
} satisfies Record<string, NavAgentProfile>;

export function navigationProfileForPreset(preset: NpcPreset): NavAgentProfile {
  switch (preset.id) {
    case "manhack":
      return NavigationProfiles.manhack;
    case "gunship":
      return NavigationProfiles.gunship;
    case "strider":
      return NavigationProfiles.strider;
    case "floorTurret":
      return NavigationProfiles.stationary;
    case "headcrab":
      return NavigationProfiles.headcrab;
    case "zombie":
    case "passive":
      return NavigationProfiles.humanoidLimited;
    default:
      return preset.movement.canJump
        ? NavigationProfiles.humanoid
        : NavigationProfiles.humanoidLimited;
  }
}

function profile(
  value: Omit<NavAgentProfile, "areaCosts"> & {
    areaCosts?: NavAgentProfile["areaCosts"];
  },
): NavAgentProfile {
  return {
    ...value,
    areaCosts: { ...BASE_AREA_COSTS, ...value.areaCosts },
  };
}
