import type { CharacterAIProfile, CharacterAIProfileId } from "./CharacterAIProfile";

const soldierSchedules = [
  { id: "Dead", priority: 1000, tasks: ["Wait"], required: ["EnemyDead"] },
  { id: "Reload", priority: 900, tasks: ["ReloadWeapon"], required: ["NeedsReload"] },
  { id: "TakeCover", priority: 760, tasks: ["MoveToCover"], required: ["LowHealth"], blockedBy: ["HasCover"] },
  { id: "CoverFire", priority: 740, tasks: ["Aim", "FireBurst"], required: ["HasCover", "SeeEnemy"] },
  { id: "Suppress", priority: 650, tasks: ["Aim", "SuppressFire"], required: ["LostEnemy"] },
  { id: "Flank", priority: 620, tasks: ["MoveToFlank", "Aim"], required: ["SquadOrder"] },
  { id: "CombatStand", priority: 560, tasks: ["FaceThreat", "Aim", "FireBurst"], required: ["SeeEnemy"] },
  { id: "InvestigateLastKnown", priority: 420, tasks: ["MoveToTarget", "Scan"], required: ["LostEnemy"] },
  { id: "InvestigateSound", priority: 350, tasks: ["MoveToTarget", "Scan"], required: ["HeardDanger"] },
  { id: "Patrol", priority: 120, tasks: ["MoveToTarget", "Wait"] },
  { id: "Idle", priority: 0, tasks: ["Wait"] },
] satisfies CharacterAIProfile["schedules"];

const zombieSchedules = [
  { id: "Dead", priority: 1000, tasks: ["Wait"], required: ["EnemyDead"] },
  { id: "MeleeAttack", priority: 800, tasks: ["MeleeWindup", "MeleeStrike"], required: ["InMeleeRange"] },
  { id: "MeleeChase", priority: 600, tasks: ["MoveToTarget"], required: ["SeeEnemy"] },
  { id: "InvestigateSound", priority: 360, tasks: ["MoveToTarget", "Scan"], required: ["HeardDanger"] },
  { id: "Idle", priority: 0, tasks: ["Wait"] },
] satisfies CharacterAIProfile["schedules"];

const alyxSchedules = [
  { id: "Dead", priority: 1000, tasks: ["Wait"], required: ["EnemyDead"] },
  { id: "Reload", priority: 850, tasks: ["ReloadWeapon"], required: ["NeedsReload"] },
  { id: "TakeCover", priority: 760, tasks: ["MoveToCover"], required: ["LowHealth"], blockedBy: ["HasCover"] },
  { id: "CoverFire", priority: 720, tasks: ["Aim", "FireBurst"], required: ["HasCover", "SeeEnemy"] },
  { id: "CombatSupport", priority: 560, tasks: ["FaceThreat", "Aim", "FireBurst"], required: ["SeeEnemy"] },
  { id: "Regroup", priority: 460, tasks: ["FollowLeader"], required: ["TooFarFromLeader"] },
  { id: "FollowPlayer", priority: 100, tasks: ["FollowLeader"] },
  { id: "Idle", priority: 0, tasks: ["Wait"] },
] satisfies CharacterAIProfile["schedules"];

export const CHARACTER_AI_PROFILES: Record<CharacterAIProfileId, CharacterAIProfile> = {
  combineSoldier: {
    id: "combineSoldier",
    archetype: "soldier",
    senses: {
      visionInterval: 0.12,
      hearingInterval: 0.18,
      memorySeconds: 8,
      dangerRadius: 8,
    },
    combat: {
      preferredRange: 18,
      coverHealthThreshold: 0.7,
      retreatHealthThreshold: 0.28,
      suppressMemorySeconds: 3.2,
      grenadeChance: 0.28,
    },
    locomotion: {
      repathInterval: 0.75,
      repathDistance: 2.6,
      arriveDistance: 1.35,
      stuckSeconds: 2.1,
    },
    morale: {
      painSuppressionGain: 0.6,
      suppressionDecayPerSecond: 0.5,
      noCoverRetrySeconds: 4,
    },
    schedules: soldierSchedules,
    defaultSchedule: "Idle",
    squad: {
      enabled: true,
      preferredRoles: ["leader", "suppressor", "flanker", "cover", "assault", "grenadier"],
    },
  },
  zombieMelee: {
    id: "zombieMelee",
    archetype: "meleeCreature",
    senses: {
      visionInterval: 0.2,
      hearingInterval: 0.12,
      memorySeconds: 6,
      dangerRadius: 4,
    },
    combat: {
      preferredRange: 1.4,
      coverHealthThreshold: 0,
      retreatHealthThreshold: 0,
      suppressMemorySeconds: 0,
      grenadeChance: 0,
    },
    locomotion: {
      repathInterval: 1.2,
      repathDistance: 3,
      arriveDistance: 1.2,
      stuckSeconds: 2,
    },
    morale: {
      painSuppressionGain: 0.2,
      suppressionDecayPerSecond: 0.8,
      noCoverRetrySeconds: 0,
    },
    schedules: zombieSchedules,
    defaultSchedule: "Idle",
    squad: { enabled: false, preferredRoles: [] },
  },
  alyxSupport: {
    id: "alyxSupport",
    archetype: "friendlyRanged",
    senses: {
      visionInterval: 0.12,
      hearingInterval: 0.16,
      memorySeconds: 5,
      dangerRadius: 7,
    },
    combat: {
      preferredRange: 14,
      coverHealthThreshold: 0.4,
      retreatHealthThreshold: 0.2,
      suppressMemorySeconds: 1.6,
      grenadeChance: 0,
    },
    locomotion: {
      repathInterval: 0.8,
      repathDistance: 2.5,
      arriveDistance: 1.4,
      stuckSeconds: 2.2,
    },
    morale: {
      painSuppressionGain: 0.4,
      suppressionDecayPerSecond: 0.55,
      noCoverRetrySeconds: 3.5,
    },
    schedules: alyxSchedules,
    defaultSchedule: "FollowPlayer",
    squad: { enabled: false, preferredRoles: [] },
  },
  passiveHumanoid: {
    id: "passiveHumanoid",
    archetype: "passive",
    senses: {
      visionInterval: 0.5,
      hearingInterval: 0.5,
      memorySeconds: 2,
      dangerRadius: 4,
    },
    combat: {
      preferredRange: 0,
      coverHealthThreshold: 0,
      retreatHealthThreshold: 0,
      suppressMemorySeconds: 0,
      grenadeChance: 0,
    },
    locomotion: {
      repathInterval: 1,
      repathDistance: 3,
      arriveDistance: 1.5,
      stuckSeconds: 2.5,
    },
    morale: {
      painSuppressionGain: 0,
      suppressionDecayPerSecond: 1,
      noCoverRetrySeconds: 0,
    },
    schedules: [{ id: "Idle", priority: 0, tasks: ["Wait"] }],
    defaultSchedule: "Idle",
    squad: { enabled: false, preferredRoles: [] },
  },
};

export function getCharacterAIProfile(id: CharacterAIProfileId): CharacterAIProfile {
  return CHARACTER_AI_PROFILES[id] ?? CHARACTER_AI_PROFILES.passiveHumanoid;
}
