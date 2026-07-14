import type { Object3D, Vector3 } from "three";
import type { ModelAssetId } from "@engine/assets/AssetManifest";
import type {
  ProceduralWalkConfig,
  WalkStyle,
} from "@engine/animation/procedural/ProceduralWalk";
import type { RagdollConfig } from "@engine/animation/ragdoll/RagdollDefinition";
import type { Faction } from "@engine/ai/Faction";
import type { PerceptionDetectionConfig } from "@engine/ai/perception/PerceptionSystem";

export type CharacterType = "humanoid" | "creature" | "robot" | "prop";
export type CharacterId = string;

/**
 * Identifica la familia de comportamiento del NPC. La factory de game lo
 * mapea a un preset v2 (`game/npc/presets/`).
 */
export type CharacterAIProfileId =
  | "combineSoldier"
  | "zombieMelee"
  | "alyxSupport"
  | "rebelAlly"
  | "rebelMedic"
  | "passiveHumanoid"
  | "headcrabMelee"
  | "blobCreature"
  | "manhackFlyer"
  | "floorTurret"
  | "gunshipBoss"
  | "striderBoss";

/** Configuracion de sentidos declarada por el personaje. */
export interface CharacterPerceptionConfig {
  viewDistance: number;
  viewConeRadians: number;
  hearingRadius: number;
  memoryDuration: number;
  eyeHeight: number;
  /** Deteccion no-binaria opt-in; sin esto la vision es instantanea. */
  detection?: PerceptionDetectionConfig;
}

export interface CharacterMovementConfig {
  maxSpeed: number;
  acceleration: number;
  turnSpeed: number;
  rotationSmoothing: number;
  faceTargetDeadzone: number;
  turnBeforeMoveAngle: number;
  minMoveFacingDot: number;
  gravity: number;
  linearDamping: number;
  angularDamping: number;
}

export interface CharacterColliderConfig {
  height: number;
  radius: number;
  mass: number;
  stepOffset: number;
  snapToGround: number;
}

/**
 * Vida runtime de los perfiles HUMANOIDES (combineSoldier, alyxSupport,
 * zombieMelee, passiveHumanoid y derivados): la factory la aplica sobre el
 * `NpcPreset` via `applyDefinitionStats`. Para creatures/bosses la vida sigue
 * saliendo del builder en `game/npc/presets/*`.
 */
export interface CharacterHealthConfig {
  maxHealth: number;
}

/** Opt-in explícito para que el Blob pueda seleccionar y consumir al actor. */
export interface BlobPreyDefinition {
  biomass: number;
  /** Tiempo que el cadáver debe permanecer envuelto antes de conceder biomasa. */
  consumeSeconds?: number;
}

export type BoneAxis = "x" | "y" | "z";
export type RestPoseType = "none" | "tpose_to_relaxed" | "zombie";
export type ArmsMode = "relaxed" | "zombieForward" | "weaponAim";

export interface BoneRotationOffset {
  x?: number;
  y?: number;
  z?: number;
}

export interface HumanoidRestPoseConfig {
  type: RestPoseType;
  leftUpperArm?: BoneRotationOffset;
  rightUpperArm?: BoneRotationOffset;
  leftForearm?: BoneRotationOffset;
  rightForearm?: BoneRotationOffset;
  spine?: BoneRotationOffset;
  chest?: BoneRotationOffset;
  head?: BoneRotationOffset;
}

export interface HumanoidBoneAxesConfig {
  legSwingAxis: BoneAxis;
  armSwingAxis: BoneAxis;
  kneeBendAxis: BoneAxis;
  elbowBendAxis: BoneAxis;
  spineLeanAxis: BoneAxis;
  headYawAxis: BoneAxis;
}

export interface CharacterAnimationConfig {
  mode: "procedural";
  ignoreBakedAnimations: boolean;
  restPose: HumanoidRestPoseConfig;
  armsMode: ArmsMode;
  boneAxes: HumanoidBoneAxesConfig;
  walkStyle: WalkStyle;
  useLookAt: boolean;
  useStumble: boolean;
  walk: Partial<ProceduralWalkConfig>;
  maxHeadYaw: number;
  maxHeadPitch: number;
}

export interface CharacterRagdollConfig extends Partial<RagdollConfig> {
  enabled: boolean;
  mode: "passiveOnDeath";
  maxDeathLinearVelocity: number;
  maxDeathAngularVelocity: number;
}

export interface CharacterAIConfig {
  detectionRange: number;
}

export type CharacterAttackType = "melee" | "ranged";

export interface CharacterRangedAttackConfig {
  /** Id del weapon en la tabla de weapons del juego. La capa game lo resuelve. */
  weaponId: string;
  /** Cantidad de disparos por rÃ¡faga. HL2 combine ~3-5. */
  burstSize: number;
  /** Pausa (s) entre rÃ¡fagas. */
  pauseBetweenBursts: number;
  /** Error angular mÃ¡ximo al primer disparo (cuando aÃºn no asentÃ³ la mira). */
  aimError: number;
  /** Error angular mÃ­nimo despuÃ©s de asentar la mira por `aimSettleDuration` segundos. */
  aimErrorSettled: number;
  /** CuÃ¡nto tarda (s) la mira en asentarse del max al min. */
  aimSettleDuration: number;
  /** Tiempo (s) que mira al target antes de empezar a disparar (telegraph). */
  aimTime: number;
  /** Reaction time al detectar primero. */
  reactionTime: number;
}

export interface CharacterGrenadeTacticConfig {
  enabled: boolean;
  cooldown: number;
  minRange: number;
  maxRange: number;
  damage: number;
  radius: number;
  impulse: number;
  fuseSeconds: number;
  launchSpeed: number;
  launchLift: number;
  flushAfterMemoryAge: number;
}

export interface CharacterAttackConfig {
  enabled: boolean;
  type: CharacterAttackType;
  damage: number;
  range: number;
  cooldown: number;
  windup: number;
  hitWindow: number;
  knockback: number;
  requireLineOfSight: boolean;
  facingDotThreshold: number;
  /** SÃ³lo presente para `type: 'ranged'`. */
  ranged?: CharacterRangedAttackConfig;
  grenade?: CharacterGrenadeTacticConfig;
}

/**
 * Flinch al recibir daño: `duration` corta el avance ese tiempo y `cooldown`
 * impide re-flinch continuo (anti-stunlock bajo fuego sostenido). Sin esto el
 * preset usa su default (zombies: cooldown 0 = frenarlos a tiros, intencional).
 */
export interface CharacterFlinchConfig {
  duration: number;
  cooldown: number;
}

export interface CharacterStumbleConfig {
  stumbleImpulseThreshold: number;
  stumbleDuration: number;
  fallAngleThreshold: number;
  getUpDelay: number;
  recoverDuration: number;
}

export interface CharacterDefinition {
  id: CharacterId;
  modelId?: ModelAssetId;
  type: CharacterType;
  /** Bando lÃ³gico â€” controla quiÃ©n ataca a quiÃ©n. */
  faction: Faction;
  /** Opt-in como presa orgánica del Blob. Ausente excluye al actor. */
  blobPrey?: BlobPreyDefinition;
  /** Familia de comportamiento — la factory lo mapea a un preset v2. */
  aiProfileId: CharacterAIProfileId;
  height: number;
  radius: number;
  mass: number;
  visualScale: number;
  visualRotationY: number;
  visualOffset: Vector3;
  movement: CharacterMovementConfig;
  health: CharacterHealthConfig;
  animation: CharacterAnimationConfig;
  ragdoll: CharacterRagdollConfig;
  collider: CharacterColliderConfig;
  ai: CharacterAIConfig;
  /**
   * Vision + LOS + memoria. Para perfiles humanoides es la fuente del
   * `NpcPreset.perception` (via `applyDefinitionStats`). `eyeHeight` es offset
   * desde el CENTRO de la capsula.
   */
  perception: CharacterPerceptionConfig;
  attack: CharacterAttackConfig;
  stumble: CharacterStumbleConfig;
  flinch?: CharacterFlinchConfig;
  debug: boolean;
}

export interface CharacterBuildResult {
  id: string;
  definition: CharacterDefinition;
  visualRoot: Object3D;
}
