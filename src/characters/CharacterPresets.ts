import { Vector3 } from 'three';
import type { CharacterDefinition, CharacterId } from './CharacterDefinition';

const baseHumanoid = {
  type: 'humanoid',
  height: 1.75,
  radius: 0.35,
  mass: 60,
  visualScale: 1,
  visualRotationY: 0,
  visualOffset: new Vector3(0, -0.875, 0),
  movement: {
    maxSpeed: 2.2,
    acceleration: 10,
    turnSpeed: 6,
    rotationSmoothing: 0.15,
    faceTargetDeadzone: 0.08,
    gravity: 28,
    linearDamping: 4,
    angularDamping: 8,
  },
  health: {
    maxHealth: 100,
  },
  animation: {
    mode: 'procedural',
    ignoreBakedAnimations: true,
    walkStyle: 'normal',
    useLookAt: true,
    useStumble: true,
    walk: {},
    maxHeadYaw: 0.65,
    maxHeadPitch: 0.35,
  },
  ragdoll: {
    enabled: true,
    mode: 'passiveOnDeath',
    impulseScale: 0.5,
    maxDeathLinearVelocity: 3,
    maxDeathAngularVelocity: 4,
    initialDampingDuration: 0.5,
    linearDamping: 2.5,
    angularDamping: 4,
    density: 0.75,
    colliderScale: 0.78,
    enableJoints: false,
    debug: false,
  },
  collider: {
    height: 1.75,
    radius: 0.35,
    mass: 60,
    stepOffset: 0.4,
    snapToGround: 0.45,
  },
  ai: {
    detectionRange: 13,
    attackRange: 1.8,
    attackCooldown: 1.1,
  },
  stumble: {
    stumbleImpulseThreshold: 0.2,
    stumbleDuration: 0.75,
    fallAngleThreshold: 0.78,
    getUpDelay: 0.75,
    recoverDuration: 0.65,
  },
  debug: false,
} satisfies Omit<CharacterDefinition, 'id' | 'modelId'>;

export const CharacterPresets: Record<CharacterId, CharacterDefinition> = {
  zombie: {
    ...baseHumanoid,
    id: 'zombie',
    modelId: 'zombie',
    visualOffset: new Vector3(0, -0.875, 0),
    movement: {
      ...baseHumanoid.movement,
      maxSpeed: 2.05,
      acceleration: 8.5,
      turnSpeed: 5.2,
    },
    animation: {
      ...baseHumanoid.animation,
      walkStyle: 'staggered',
      walk: {
        stepFrequency: 3.6,
        strideLength: 0.34,
        armSwing: 0.32,
        torsoBob: 0.035,
        torsoLean: 0.18,
      },
    },
    ragdoll: {
      ...baseHumanoid.ragdoll,
      impulseScale: 0.45,
      debug: false,
    },
  },
  placeholderHumanoid: {
    ...baseHumanoid,
    id: 'placeholderHumanoid',
    modelId: undefined,
  },
};
