import type { NpcScheduleDefinition, NpcScheduleId } from "./NpcSchedules";

export type CharacterAIProfileId =
  | "combineSoldier"
  | "zombieMelee"
  | "alyxSupport"
  | "passiveHumanoid";

export type CharacterAIArchetype =
  | "soldier"
  | "meleeCreature"
  | "friendlyRanged"
  | "passive";

export interface CharacterAISensesProfile {
  visionInterval: number;
  hearingInterval: number;
  memorySeconds: number;
  dangerRadius: number;
}

export interface CharacterAICombatProfile {
  preferredRange: number;
  coverHealthThreshold: number;
  retreatHealthThreshold: number;
  suppressMemorySeconds: number;
  grenadeChance: number;
}

export interface CharacterAILocomotionProfile {
  repathInterval: number;
  repathDistance: number;
  arriveDistance: number;
  stuckSeconds: number;
}

export interface CharacterAIMoraleProfile {
  painSuppressionGain: number;
  suppressionDecayPerSecond: number;
  noCoverRetrySeconds: number;
}

export interface CharacterAISquadProfile {
  enabled: boolean;
  preferredRoles: string[];
}

export interface CharacterAIProfile {
  id: CharacterAIProfileId;
  archetype: CharacterAIArchetype;
  senses: CharacterAISensesProfile;
  combat: CharacterAICombatProfile;
  locomotion: CharacterAILocomotionProfile;
  morale: CharacterAIMoraleProfile;
  schedules: NpcScheduleDefinition[];
  defaultSchedule: NpcScheduleId;
  squad: CharacterAISquadProfile;
}
