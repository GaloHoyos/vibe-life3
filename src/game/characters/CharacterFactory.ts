import { Bone, BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import type { AssetManager } from '@engine/assets/AssetManager';
import type { INpc } from '@game/npc/core/INpc';
import { attachWeaponToHand } from '@game/npc/combat/NpcWeaponAttachment';
import { Npc } from '@game/npc/Npc';
import { NpcAnimationBridge } from '@game/npc/animation/NpcAnimationBridge';
import { CreatureAnimator } from '@game/npc/animation/CreatureAnimator';
import type { CreatureAnimConfig } from '@game/npc/animation/CreatureAnimator';
import type { NpcAnimator } from '@game/npc/animation/NpcAnimator';
import { TurretAnimator } from '@game/npc/animation/TurretAnimator';
import { GunshipAnimator } from '@game/npc/animation/GunshipAnimator';
import { StriderAnimator } from '@game/npc/animation/StriderAnimator';
import { createManhackVisual } from '@game/characters/visuals/ManhackVisual';
import { createTurretVisual } from '@game/characters/visuals/TurretVisual';
import { createGunshipVisual } from '@game/characters/visuals/GunshipVisual';
import { createStriderVisual } from '@game/characters/visuals/StriderVisual';
import { buildAlyxPreset } from '@game/npc/presets/alyxPreset';
import { buildCombinePreset } from '@game/npc/presets/combinePreset';
import { buildZombiePreset } from '@game/npc/presets/zombiePreset';
import { buildHeadcrabPreset } from '@game/npc/presets/headcrabPreset';
import { buildManhackPreset } from '@game/npc/presets/manhackPreset';
import { buildTurretPreset } from '@game/npc/presets/turretPreset';
import { buildGunshipPreset } from '@game/npc/presets/gunshipPreset';
import { buildStriderPreset } from '@game/npc/presets/striderPreset';
import type { NpcPreset, NpcPresetOptions } from '@game/npc/presets/NpcPreset';
import { NpcCombat } from '@game/npc/combat/NpcCombat';
import { NpcMeleeCombat } from '@game/npc/combat/NpcMeleeCombat';
import { NpcRangedCombat } from '@game/npc/combat/NpcRangedCombat';
import { RealRangedCombat } from '@game/npc/combat/RealRangedCombat';
import { TurretCombat } from '@game/npc/combat/TurretCombat';
import { TurretAimState } from '@game/npc/combat/TurretAimState';
import { GunshipCannonCombat } from '@game/npc/combat/GunshipCannonCombat';
import { StriderCombat } from '@game/npc/combat/StriderCombat';
import type { NpcCombatHandle } from '@game/npc/brain/NpcBrainContext';
import type { ModelAssetId } from '@engine/assets/AssetManifest';
import type { GameEventBus } from "@game/GameEvents";
import type { PhysicsMetadata, PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { Raycast, type RaycastSource } from '@engine/physics/Raycast';
import { CharacterMotor } from '@engine/physics/character/CharacterMotor';
import { DynamicFlyerMotor } from '@engine/physics/character/DynamicFlyerMotor';
import { KinematicFlyerMotor } from '@engine/physics/character/KinematicFlyerMotor';
import { StriderWalkerMotor } from '@engine/physics/character/StriderWalkerMotor';
import { StationaryDynamicMotor } from '@engine/physics/character/StationaryDynamicMotor';
import type { NpcMotor } from '@engine/physics/character/NpcMotor';
import type { NavSpace } from '@engine/ai/nav/NavSpace';
import type { PathRequestQueue } from '@engine/ai/nav/PathRequestQueue';
import type { BuildingRegistry } from '@game/levels/buildings/BuildingRegistry';
import type { TacticalMap } from '@game/npc/ai/TacticalMap';
import type { SquadDirector } from '@game/npc/ai/SquadDirector';
import { getMaterial } from '@engine/render/material/Materials';
import { CharacterPresets } from './CharacterPresets';
import type { CharacterDefinition, CharacterId } from '@engine/characters/CharacterDefinition';

export interface NpcRuntimeServices {
  navSpace: NavSpace;
  pathQueue: PathRequestQueue;
  buildingRegistry: BuildingRegistry;
  raycast: Raycast;
  /**
   * Raycast para línea de visión y disparos. Portal-aware cuando hay portales:
   * los NPCs ven y disparan a través del par linked. La locomoción sigue
   * usando `raycast` plano (los probes de suelo no deben cruzar portales).
   */
  losRaycast?: RaycastSource;
  tacticalMap: TacticalMap;
  squadDirector: SquadDirector;
}

/**
 * Instancia NPCs a partir de un `CharacterId`. El `aiProfileId` decide el
 * preset de comportamiento (`game/npc/presets/`): `zombieMelee`,
 * `combineSoldier` o `alyxSupport`. Todos corren sobre el runtime `Npc`
 * unificado.
 *
 * Carga el modelo del manifest si tiene `modelId`, o cae a un humanoid
 * placeholder bone-rigged que cumple la interfaz `ProceduralCharacterAnimator`.
 */
export class CharacterFactory {
  constructor(
    private readonly assets: AssetManager,
    private readonly physics: PhysicsWorld,
    private readonly eventBus: GameEventBus,
  ) {}

  async createNPC(
    characterId: CharacterId,
    instanceId: string,
    position: Vector3,
    patrolPoints: Vector3[] = [],
    services?: NpcRuntimeServices,
  ): Promise<INpc> {
    const definition = CharacterPresets[characterId] ?? CharacterPresets.placeholderHumanoid;
    const isGunship = definition.aiProfileId === 'gunshipBoss';
    const model = definition.modelId ? await this.assets.instantiateModel(definition.modelId) : null;
    const visualRoot = model?.root ?? proceduralVisuals[characterId]?.() ?? createPlaceholderHumanoid();

    visualRoot.scale.multiplyScalar(definition.visualScale);
    visualRoot.rotation.y += definition.visualRotationY;
    visualRoot.position.copy(definition.visualOffset);

    const rangedWeaponId = isGunship ? undefined : definition.attack.ranged?.weaponId;
    if (rangedWeaponId) {
      try {
        const weapon = await this.assets.instantiateModel(
          rangedWeaponId as ModelAssetId,
        );
        attachWeaponToHand(
          visualRoot,
          weapon?.root ?? null,
          rangedWeaponId,
          instanceId,
        );
      } catch (error) {
        console.warn(
          `[CharacterFactory] No se pudo cargar weapon '${rangedWeaponId}' para NPC '${instanceId}'`,
          error,
        );
      }
    }

    if (!services) {
      throw new Error(
        `[CharacterFactory] NPC '${instanceId}' requiere NpcRuntimeServices (nivel sin cargar?)`,
      );
    }
    return this.buildV2Npc(instanceId, definition, position, visualRoot, services, patrolPoints);
  }

  private buildV2Npc(
    instanceId: string,
    definition: CharacterDefinition,
    position: Vector3,
    visualRoot: Object3D,
    services: NpcRuntimeServices,
    patrolPoints: Vector3[],
  ): Npc {
    const preset = resolvePresetFor(definition, { hasPatrol: patrolPoints.length > 0 });
    const visualGroup = wrapVisualRoot(visualRoot);
    const ownerProxy: {
      applyDamage: (amount: number, dir?: Vector3, part?: string, attackerId?: string, point?: Vector3) => void;
      isAlive: () => boolean;
    } = {
      applyDamage: () => {},
      isAlive: () => true,
    };
    const metadata: PhysicsMetadata = {
      id: instanceId,
      kind: 'npc',
      damageable: ownerProxy,
      characterId: definition.id,
      faction: definition.faction,
    };
    // Torreta de piso = cuerpo dinamico estacionario (no navega; se la tumba). El
    // `aimState` se comparte entre su combat (lo escribe) y su animator (lo lee).
    const isTurret = definition.aiProfileId === 'floorTurret';
    const isGunship = definition.aiProfileId === 'gunshipBoss';
    const isStrider = definition.aiProfileId === 'striderBoss';
    const turretAim = isTurret ? new TurretAimState() : null;
    let striderMotor: StriderWalkerMotor | null = null;
    // Voladores (manhack) = rigid body dinamico real: lo agarra la gravity gun,
    // lo voltea una caja, se rompe contra la pared. Terrestres = cinematico.
    const motor: NpcMotor = isTurret
      ? new StationaryDynamicMotor(this.physics, {
          id: instanceId,
          position,
          size: new Vector3(
            definition.collider.radius * 2,
            definition.collider.height,
            definition.collider.radius * 2,
          ),
          mass: definition.collider.mass,
          // El primer punto de `patrol` define hacia donde mira (direccion de montaje).
          mountYaw: computeMountYaw(position, patrolPoints),
          metadata,
        })
      : isGunship
      ? new KinematicFlyerMotor(this.physics, {
          id: instanceId,
          position,
          height: definition.collider.height,
          radius: definition.collider.radius,
          mass: definition.collider.mass,
          maxSpeed: preset.movement.walkSpeed,
          acceleration: preset.movement.acceleration,
          turnSpeed: preset.movement.turnSpeed,
          metadata,
        })
      : isStrider
      ? (striderMotor = new StriderWalkerMotor(this.physics, {
          id: instanceId,
          position,
          height: definition.collider.height,
          radius: definition.collider.radius,
          mass: definition.collider.mass,
          maxSpeed: preset.movement.walkSpeed,
          acceleration: preset.movement.acceleration,
          turnSpeed: preset.movement.turnSpeed,
          metadata,
          raycast: services.raycast,
        }))
      : preset.movement.flying
      ? new DynamicFlyerMotor(this.physics, {
          id: instanceId,
          position,
          height: definition.collider.height,
          radius: definition.collider.radius,
          maxSpeed: preset.movement.walkSpeed,
          acceleration: preset.movement.acceleration,
          turnSpeed: preset.movement.turnSpeed,
          metadata,
        })
      : new CharacterMotor(this.physics, {
          id: instanceId,
          position,
          height: definition.collider.height,
          radius: definition.collider.radius,
          mass: definition.collider.mass,
          maxSpeed: preset.movement.walkSpeed,
          acceleration: preset.movement.acceleration,
          turnSpeed: preset.movement.turnSpeed,
          rotationSmoothing: definition.movement.rotationSmoothing,
          faceTargetDeadzone: definition.movement.faceTargetDeadzone,
          turnBeforeMoveAngle: definition.movement.turnBeforeMoveAngle,
          minMoveFacingDot: definition.movement.minMoveFacingDot,
          gravity: definition.movement.gravity,
          stepOffset: preset.movement.stepOffset,
          snapToGround: preset.movement.snapToGround,
          debug: definition.debug,
          metadata,
        });
    const striderAnimator =
      isStrider && striderMotor ? new StriderAnimator(visualRoot, striderMotor) : null;
    const animation: NpcAnimator =
      isTurret && turretAim
        ? new TurretAnimator(visualRoot, turretAim)
        : isGunship
        ? new GunshipAnimator(visualRoot)
        : striderAnimator
        ? striderAnimator
        : definition.type === 'humanoid'
        ? new NpcAnimationBridge(instanceId, definition, visualRoot, this.physics, ownerProxy)
        : new CreatureAnimator(
            visualRoot,
            creatureAnimConfigs[definition.id] ?? DEFAULT_CREATURE_ANIM,
          );
    const ranged = definition.attack.ranged;
    let combat: NpcCombatHandle;
    if (isTurret && turretAim) {
      combat = new TurretCombat({
        id: instanceId,
        characterId: definition.id,
        faction: definition.faction,
        body: motor.body,
        raycast: services.raycast,
        eventBus: this.eventBus,
        aimState: turretAim,
        // Pivote del cañon sobre el centro del cuerpo (coincide con el `turret-barrel`).
        eyeHeight: 0.42,
        // El cañon bascula dentro del mismo cono que ve la percepcion (no 360).
        coneHalfAngle: preset.perception.visionConeRadians / 2,
        onShot: () => animation.notifyShot(),
      });
    } else if (isGunship) {
      combat = new GunshipCannonCombat({
        id: instanceId,
        characterId: definition.id,
        faction: definition.faction,
        body: motor.body,
        raycast: services.raycast,
        eventBus: this.eventBus,
        eyeHeight: definition.perception.eyeHeight,
        onShot: () => animation.notifyShot(),
      });
    } else if (isStrider) {
      combat = new StriderCombat({
        id: instanceId,
        characterId: definition.id,
        faction: definition.faction,
        body: motor.body,
        physics: this.physics,
        eventBus: this.eventBus,
        onMinigunShot: () => animation.notifyShot(),
        onCannonCharge: () => striderAnimator?.notifyCannonCharge(),
        onCannonShot: () => striderAnimator?.notifyCannonShot(),
        onStomp: () => animation.notifyAttack(),
      });
    } else if (ranged) {
      const losRaycast = services.losRaycast ?? services.raycast;
      const realCombat = new NpcRangedCombat(
        instanceId,
        definition.faction,
        ranged,
        losRaycast,
        this.eventBus,
        () => animation.notifyShot(),
      );
      combat = new RealRangedCombat({
        combat: realCombat,
        ownerId: instanceId,
        ownerBody: motor.body,
        faction: definition.faction,
        eyeHeight: definition.perception.eyeHeight,
        effectiveRange: definition.ai.detectionRange,
        rangedConfig: ranged,
        raycast: losRaycast,
        onReload: (duration) => animation.notifyReload(duration),
      });
    } else {
      const melee = new NpcCombat(instanceId, definition, this.eventBus, services.raycast);
      combat = new NpcMeleeCombat(melee, definition.attack.range, () => animation.notifyAttack());
    }
    const npc = new Npc({
      id: instanceId,
      faction: definition.faction,
      position,
      visualRoot: visualGroup,
      height: definition.collider.height,
      motor,
      combat,
      preset,
      sliceDamage: definition.aiProfileId === 'manhackFlyer' ? definition.attack.damage : undefined,
      navSpace: services.navSpace,
      buildingRegistry: services.buildingRegistry,
      pathQueue: services.pathQueue,
      raycast: services.raycast,
      losRaycast: services.losRaycast,
      eventBus: this.eventBus,
      animation,
      patrolRoute: patrolPoints,
      tacticalMap: services.tacticalMap,
      squadDirector: services.squadDirector,
    });
    ownerProxy.applyDamage = npc.applyDamage.bind(npc);
    ownerProxy.isAlive = npc.isAlive.bind(npc);
    return npc;
  }
}

function resolvePresetFor(definition: CharacterDefinition, options: NpcPresetOptions): NpcPreset {
  switch (definition.aiProfileId) {
    case 'alyxSupport':
      return buildAlyxPreset();
    case 'zombieMelee':
      return buildZombiePreset();
    case 'headcrabMelee':
      return buildHeadcrabPreset();
    case 'manhackFlyer':
      return buildManhackPreset();
    case 'floorTurret':
      return buildTurretPreset();
    case 'gunshipBoss':
      return buildGunshipPreset(options);
    case 'striderBoss':
      return buildStriderPreset(options);
    case 'combineSoldier':
    default:
      return buildCombinePreset(options);
  }
}

/** Yaw de montaje de la torreta: encara el primer punto de `patrol`, o +Z si no hay. */
function computeMountYaw(position: Vector3, patrol: Vector3[]): number {
  if (patrol.length === 0) return 0;
  const dx = patrol[0].x - position.x;
  const dz = patrol[0].z - position.z;
  if (dx * dx + dz * dz < 1e-4) return 0;
  return Math.atan2(dx, dz);
}

/** Visuales procedurales para NPCs sin GLB (registrar uno nuevo = una entrada). */
const proceduralVisuals: Record<string, () => Object3D> = {
  manhack: createManhackVisual,
  floorTurret: createTurretVisual,
  gunship: createGunshipVisual,
  strider: createStriderVisual,
};

/**
 * Config del `CreatureAnimator` por NPC no-humanoide. Agregar una criatura =
 * una entrada (o cae al default). Acoplada al visual (el `childName` del spin
 * coincide con el nombre del mesh de la cuchilla del manhack).
 */
const creatureAnimConfigs: Record<string, CreatureAnimConfig> = {
  headcrab: { bobAmplitude: 0.03, bobFrequency: 7, bankStrength: 0.04, death: 'tumble' },
  // El manhack es un body dinamico: el motor le da posicion/rotacion/tumbo y la
  // caida de muerte (fisica). El animador solo gira la cuchilla.
  manhack: {
    bobAmplitude: 0,
    bobFrequency: 1,
    bankStrength: 0,
    spin: { childName: 'manhack-blade', axis: 'y', speed: 34 },
    death: 'none',
  },
};

const DEFAULT_CREATURE_ANIM: CreatureAnimConfig = {
  bobAmplitude: 0.04,
  bobFrequency: 2,
  bankStrength: 0.06,
  death: 'drop',
};

function wrapVisualRoot(root: Object3D): Group {
  const group = new Group();
  group.add(root);
  return group;
}

function createPlaceholderHumanoid(): Object3D {
  const root = new Group();
  root.name = 'placeholder-humanoid';
  const material = getMaterial('npc');
  const hips = createBone('Hips', 0, 0.55, 0);
  const spine = createBone('Spine', 0, 0.25, 0);
  const chest = createBone('Chest', 0, 0.36, 0);
  const neck = createBone('Neck', 0, 0.28, 0);
  const head = createBone('Head', 0, 0.2, 0);
  const leftUpperArm = createBone('LeftArm', -0.42, 0.14, 0);
  const leftForearm = createBone('LeftForeArm', 0, -0.45, 0);
  const leftHand = createBone('LeftHand', 0, -0.38, 0);
  const rightUpperArm = createBone('RightArm', 0.42, 0.14, 0);
  const rightForearm = createBone('RightForeArm', 0, -0.45, 0);
  const rightHand = createBone('RightHand', 0, -0.38, 0);
  const leftThigh = createBone('LeftUpLeg', -0.22, -0.08, 0);
  const leftShin = createBone('LeftLeg', 0, -0.54, 0);
  const leftFoot = createBone('LeftFoot', 0, -0.46, 0.12);
  const rightThigh = createBone('RightUpLeg', 0.22, -0.08, 0);
  const rightShin = createBone('RightLeg', 0, -0.54, 0);
  const rightFoot = createBone('RightFoot', 0, -0.46, 0.12);

  root.add(hips);
  hips.add(spine, leftThigh, rightThigh);
  spine.add(chest);
  chest.add(neck, leftUpperArm, rightUpperArm);
  neck.add(head);
  leftUpperArm.add(leftForearm);
  leftForearm.add(leftHand);
  rightUpperArm.add(rightForearm);
  rightForearm.add(rightHand);
  leftThigh.add(leftShin);
  leftShin.add(leftFoot);
  rightThigh.add(rightShin);
  rightShin.add(rightFoot);

  hips.add(createBoxPart('hips-mesh', [0.45, 0.24, 0.3], [0, 0, 0], material));
  chest.add(createBoxPart('chest-mesh', [0.62, 0.62, 0.34], [0, 0.04, 0], material));
  head.add(createHeadPart(material));
  leftUpperArm.add(createBoxPart('left-upper-arm-mesh', [0.16, 0.42, 0.16], [0, -0.22, 0], material));
  leftForearm.add(createBoxPart('left-forearm-mesh', [0.14, 0.36, 0.14], [0, -0.2, 0], material));
  rightUpperArm.add(createBoxPart('right-upper-arm-mesh', [0.16, 0.42, 0.16], [0, -0.22, 0], material));
  rightForearm.add(createBoxPart('right-forearm-mesh', [0.14, 0.36, 0.14], [0, -0.2, 0], material));
  leftThigh.add(createBoxPart('left-thigh-mesh', [0.18, 0.48, 0.18], [0, -0.26, 0], material));
  leftShin.add(createBoxPart('left-shin-mesh', [0.16, 0.44, 0.16], [0, -0.24, 0], material));
  leftFoot.add(createBoxPart('left-foot-mesh', [0.18, 0.1, 0.32], [0, -0.03, 0.08], material));
  rightThigh.add(createBoxPart('right-thigh-mesh', [0.18, 0.48, 0.18], [0, -0.26, 0], material));
  rightShin.add(createBoxPart('right-shin-mesh', [0.16, 0.44, 0.16], [0, -0.24, 0], material));
  rightFoot.add(createBoxPart('right-foot-mesh', [0.18, 0.1, 0.32], [0, -0.03, 0.08], material));

  return root;
}

function createBone(name: string, x: number, y: number, z: number): Bone {
  const bone = new Bone();
  bone.name = name;
  bone.position.set(x, y, z);
  return bone;
}

function createBoxPart(
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  material: MeshStandardMaterial,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), material);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createHeadPart(material: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(new SphereGeometry(0.24, 12, 10), material);
  mesh.name = 'head-mesh';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
