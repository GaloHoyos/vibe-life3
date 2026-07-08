import type { NpcPreset } from "@game/npc/presets/NpcPreset";

export function testNpcPreset(overrides: Partial<NpcPreset> = {}): NpcPreset {
  return {
    id: "test-npc",
    perception: {
      visionRange: 20,
      visionConeRadians: Math.PI,
      hearingRadius: 5,
      memoryTime: 2,
      eyeHeight: 1.5,
    },
    maxHealth: 100,
    radius: 0.4,
    meleeRange: 1.5,
    tooCloseRange: 0.5,
    lowHealthRatio: 0.25,
    weaponAim: "none",
    movement: {
      walkSpeed: 2,
      sprintSpeed: 4,
      acceleration: 10,
      turnSpeed: 8,
      stepOffset: 0.35,
      snapToGround: 0.5,
      canJump: false,
    },
    schedules: [],
    ...overrides,
  };
}
