import { Bone, BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import { Quaternion } from 'three';
import type { AssetManager } from '@engine/assets/AssetManager';
import type { ActorSnapshot, INpc } from '@game/npc/core/INpc';
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
import { buildPassivePreset } from '@game/npc/presets/passivePreset';
import { buildRebelPreset } from '@game/npc/presets/rebelPreset';
import { buildZombiePreset } from '@game/npc/presets/zombiePreset';
import { buildHeadcrabPreset } from '@game/npc/presets/headcrabPreset';
import { buildBlobPreset } from '@game/npc/presets/blobPreset';
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
import {
  BlobOrganismController,
  type BlobOrganismEvent,
} from '@engine/blob/v2';
import { BlobV2Animator } from '@game/npc/blob/v2/BlobV2Animator';
import { BlobV2Audio } from '@game/npc/blob/v2/BlobV2Audio';
import { BlobV2Combat } from '@game/npc/blob/v2/BlobV2Combat';
import { BlobV2Control } from '@game/npc/blob/v2/BlobV2Control';
import { BlobV2Hitboxes } from '@game/npc/blob/v2/BlobV2Hitboxes';
import { BlobV2PropConsumption } from '@game/npc/blob/v2/BlobV2PropConsumption';
import { blobV2Runtimes } from '@game/npc/blob/v2/BlobV2RuntimeRegistry';
import type { NpcCombatHandle } from '@game/npc/brain/NpcBrainContext';
import type { ModelAssetId } from '@engine/assets/AssetManifest';
import type { GameEventBus } from "@game/GameEvents";
import type { PhysicsMetadata, PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { Raycast, type RaycastSource } from '@engine/physics/Raycast';
import { CharacterMotor } from '@engine/physics/character/CharacterMotor';
import { BlobV2Motor } from '@engine/physics/character/BlobV2Motor';
import { DynamicFlyerMotor } from '@engine/physics/character/DynamicFlyerMotor';
import { KinematicFlyerMotor } from '@engine/physics/character/KinematicFlyerMotor';
import { StriderWalkerMotor } from '@engine/physics/character/StriderWalkerMotor';
import { StationaryDynamicMotor } from '@engine/physics/character/StationaryDynamicMotor';
import type { NpcMotor } from '@engine/physics/character/NpcMotor';
import type { PortalPairState } from '@engine/portals/PortalFrame';
import type { NavigationService } from '@engine/ai/navigation/NavigationService';
import type { NavigationRequestQueue } from '@engine/ai/navigation/NavigationRequestQueue';
import type { NavigationActionLink } from '@engine/ai/navigation/NavigationTypes';
import type { BuildingRegistry } from '@game/levels/buildings/BuildingRegistry';
import { navigationProfileForPreset } from '@game/npc/navigation/NavAgentProfiles';
import type { TacticalMap } from '@game/npc/ai/TacticalMap';
import type { SquadDirector } from '@game/npc/ai/SquadDirector';
import { getMaterial } from '@engine/render/material/Materials';
import { CharacterPresets } from './CharacterPresets';
import { applyDefinitionStats } from './CharacterStats';
import type { CharacterDefinition, CharacterId } from '@engine/characters/CharacterDefinition';
import type { DifficultyProvider } from '@game/config/difficulty.config';
import type { Damageable } from '@shared/types/lifecycle';
import { BlobConfig } from '@game/config/blob.config';

export interface NpcRuntimeServices {
  navigation: NavigationService;
  navigationRequests: NavigationRequestQueue;
  buildingRegistry: BuildingRegistry;
  raycast: Raycast;
  /**
   * Raycast para línea de visión y disparos. Portal-aware: los NPCs ven y
   * disparan a través del par linked. La locomoción sigue usando `raycast`
   * plano (los probes de suelo no deben cruzar portales). REQUERIDO a
   * propósito: cuando era opcional, LevelLoader lo omitió y ningún NPC del
   * nivel veía por los portales.
   */
  losRaycast: RaycastSource;
  /** Par de portales linked: los flyers (manhack) cruzan con su propio motor. */
  portals: PortalPairState;
  /** Cruce de portal de un flyer (para emitir `portal.teleported`). */
  onFlyerPortalTeleport?: (npcId: string, exitPosition: Vector3) => void;
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
    private readonly difficulty?: DifficultyProvider,
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
    const preset = resolvePresetFor(definition, {
      hasPatrol: patrolPoints.length > 0,
      ...(definition.flinch ? { flinch: definition.flinch } : {}),
    });
    const visualGroup = wrapVisualRoot(visualRoot);
    const ownerProxy: Damageable = {
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
    const isBlob = definition.aiProfileId === 'blobCreature';
    const blobSpawnPosition = position.clone();
    const turretAim = isTurret ? new TurretAimState() : null;
    const blobV2Events: BlobOrganismEvent[] = [];
    const blobV2Controller = isBlob
      ? new BlobOrganismController({
          center: position,
          initialBiomass: BlobConfig.v2.initialBiomass,
          maximumBiomass: BlobConfig.v2.maximumBiomass,
          particleRadius: BlobConfig.v2.particleRadius,
          coreHealth: BlobConfig.v2.coreHealth,
          coreRadius: BlobConfig.v2.coreRadius,
          fragmentReturnSpeed: BlobConfig.v2.fragmentReturnSpeed,
          fragmentReattachDistance: BlobConfig.v2.fragmentReattachDistance,
        })
      : null;
    const blobV2Control = blobV2Controller
      ? new BlobV2Control({
          controller: blobV2Controller,
          onEvents: (events) => {
            blobV2Events.push(...events);
            if (blobV2Events.length > 256) {
              blobV2Events.splice(0, blobV2Events.length - 256);
            }
            for (const event of events) {
              this.eventBus.emit('blob.event', { id: instanceId, event });
            }
          },
        })
      : null;
    let blobNpcForFeedback: Npc | null = null;
    let unregisterBlobV2Runtime = () => {};
    const blobV2EnvelopedProps = new Set<string>();
    const blobV2Audio = blobV2Controller
      ? new BlobV2Audio({
          ownerId: instanceId,
          characterId: definition.id,
          eventBus: this.eventBus,
        })
      : null;
    const blobV2PropConsumption = blobV2Controller
      ? new BlobV2PropConsumption(blobV2Controller, this.physics, {
          ownerId: instanceId,
          fallbackConsumeSeconds: BlobConfig.v2.consumeSeconds,
          fallbackBiomass: 4,
          onProgress: ({ propId }) => {
            if (blobV2EnvelopedProps.has(propId)) return;
            blobV2EnvelopedProps.add(propId);
            blobV2Controller.recordPreyEnveloped(propId);
          },
          onConsumed: ({ propId, position: consumedAt, biomass, result }) => {
            blobV2Controller.recordPreyConsumed(propId, biomass);
            blobNpcForFeedback?.health.set(blobV2Controller.core.health);
            this.eventBus.emit('blob.prey.consumed', {
              id: instanceId,
              preyId: propId,
              biomass,
            });
            if (result.coreHealing > 0) {
              this.eventBus.emit('npc.heal', {
                medicId: instanceId,
                characterId: definition.id,
                targetId: instanceId,
                amount: result.coreHealing,
                position: new Vector3(consumedAt.x, consumedAt.y, consumedAt.z),
              });
            }
          },
        })
      : null;
    const navigationProfile = navigationProfileForPreset(preset);
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
      : blobV2Controller
      ? new BlobV2Motor(this.physics, blobV2Controller, {
          id: instanceId,
          maxSpeed: preset.movement.walkSpeed,
          acceleration: preset.movement.acceleration,
          turnSpeed: preset.movement.turnSpeed,
          metadata: { ...metadata, selfPortalTraversal: true },
          gravity: BlobConfig.v2.gravity,
          stepUpHeight: BlobConfig.v2.climb.normalStep,
          climbSpeed: BlobConfig.v2.climb.speed,
          flowSpeed: BlobConfig.v2.flow.speed,
          fragmentReturnSpeed: BlobConfig.v2.fragmentReturnSpeed,
          propPushMaxDeltaV: BlobConfig.v2.propPushMaxDeltaV,
          portals: services.portals,
          navigationRequests: services.navigationRequests,
          navigationProfile,
          particleTargetProvider: (deltaSeconds) => {
            const pose = blobV2Control?.update(deltaSeconds);
            return pose
              ? {
                  particleTargets: pose.targets,
                  particleTargetStrength:
                    pose.strength * BlobConfig.v2.poseStrength,
                }
              : {};
          },
          onAfterStep: (deltaSeconds, snapshot) => {
            blobV2Audio?.tick(deltaSeconds, snapshot);
            blobV2PropConsumption?.tick(deltaSeconds, snapshot);
          },
        })
      : preset.movement.flying
      ? new DynamicFlyerMotor(this.physics, {
          id: instanceId,
          position,
          height: definition.collider.height,
          radius: definition.collider.radius,
          maxSpeed: preset.movement.walkSpeed,
          acceleration: preset.movement.acceleration,
          turnSpeed: preset.movement.turnSpeed,
          // El motor cruza portales por su cuenta (sweep predictivo): el
          // traveller de props debe ignorar este cuerpo (flag en metadata).
          metadata: { ...metadata, selfPortalTraversal: true },
          portals: services.portals,
          onPortalTeleport: (exitPosition) =>
            services.onFlyerPortalTeleport?.(instanceId, exitPosition),
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
          // Misma fuente que el clearance del navmesh: si el planner rutea por
          // un hueco bajo, la cápsula agachada tiene que caber ahí.
          crouchHeight: navigationProfile.canCrouch ? navigationProfile.navigationHeight : undefined,
          debug: definition.debug,
          metadata,
        });
    const striderAnimator =
      isStrider && striderMotor ? new StriderAnimator(visualRoot, striderMotor) : null;
    const blobV2Hitboxes = blobV2Controller
      ? new BlobV2Hitboxes({
          physics: this.physics,
          ownerId: instanceId,
          controller: blobV2Controller,
          characterId: definition.id,
          faction: definition.faction,
          isAlive: () => blobNpcForFeedback?.isAlive() ?? true,
          onMassImpact: (impact) => {
            blobNpcForFeedback?.applyAuthoritativeDamage(
              0,
              impact.direction,
              'blob-mass',
              impact.attackerId,
              impact.point,
              impact.damageType,
            );
          },
          onCoreDamage: (impact) => {
            blobNpcForFeedback?.applyAuthoritativeDamage(
              impact.coreDamage,
              impact.direction,
              'blob-core',
              impact.attackerId,
              impact.point,
              impact.damageType,
            );
            blobNpcForFeedback?.health.set(blobV2Controller.core.health);
          },
        })
      : null;
    const blobV2Animator = blobV2Controller
      ? new BlobV2Animator(visualRoot, {
          ownerId: instanceId,
          snapshotProvider: () => blobV2Controller.snapshot(),
          telemetry: blobV2Controller.telemetry,
          onSnapshot: (snapshot) => blobV2Hitboxes?.sync(snapshot),
          onDisable: () => {
            blobV2Audio?.dispose();
            blobV2Hitboxes?.remove();
            blobV2PropConsumption?.dispose();
          },
          onDispose: () => {
            blobV2Audio?.dispose();
            blobV2Hitboxes?.dispose();
            blobV2PropConsumption?.dispose();
            unregisterBlobV2Runtime();
          },
        })
      : null;
    const animation: NpcAnimator = blobV2Animator
      ? blobV2Animator
      : isTurret && turretAim
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
    let blobV2ClaimedPrey: ActorSnapshot | null = null;
    const blobV2Combat = blobV2Controller
      ? new BlobV2Combat({
          id: instanceId,
          controller: blobV2Controller,
          raycast: services.losRaycast,
          eventBus: this.eventBus,
          characterId: definition.id,
          eyeHeight: definition.perception.eyeHeight,
          onPreyClaimed: (prey) => {
            blobV2ClaimedPrey = prey;
            prey.setBlobDigestProgress?.(0);
            blobV2Control?.setGameplayEnvelope(
              prey.id,
              prey.position,
              prey.radius,
            );
          },
          onEnveloping: (prey) => {
            blobV2Control?.setGameplayEnvelope(
              prey.id,
              prey.position,
              prey.radius,
            );
          },
          onPreyEnveloped: (prey) => {
            const biomass = prey.blobPrey?.biomass ?? 12;
            blobV2Controller.recordPreyEnveloped(prey.id);
            this.eventBus.emit('blob.prey.enveloped', {
              id: instanceId,
              preyId: prey.id,
              biomass,
            });
          },
          onPreyReleased: (prey) => {
            blobV2Control?.resetGameplayEnvelope(prey.id);
            prey.setBlobDigestProgress?.(0);
            if (blobV2ClaimedPrey?.id === prey.id) blobV2ClaimedPrey = null;
          },
          onDigestProgress: ({ preyId, progress }) => {
            if (blobV2ClaimedPrey?.id === preyId) {
              blobV2ClaimedPrey.setBlobDigestProgress?.(progress);
            }
          },
          onPreyConsumed: (prey, biomass, result) => {
            blobV2Control?.resetGameplayEnvelope(prey.id);
            prey.setBlobDigestProgress?.(1);
            blobV2Controller.recordPreyConsumed(prey.id, biomass);
            blobNpcForFeedback?.health.set(blobV2Controller.core.health);
            this.eventBus.emit('blob.prey.consumed', {
              id: instanceId,
              preyId: prey.id,
              biomass,
            });
            if (result.coreHealing > 0) {
              this.eventBus.emit('npc.heal', {
                medicId: instanceId,
                characterId: definition.id,
                targetId: instanceId,
                amount: result.coreHealing,
                position: prey.position.clone(),
              });
            }
            if (blobV2ClaimedPrey?.id === prey.id) blobV2ClaimedPrey = null;
          },
        })
      : null;
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
    } else if (blobV2Combat) {
      combat = blobV2Combat;
    } else if (ranged) {
      const losRaycast = services.losRaycast;
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
        effectiveRange: definition.attack.range,
        rangedConfig: ranged,
        raycast: losRaycast,
        onReload: (duration) => animation.notifyReload(duration),
      });
    } else {
      // El impacto melee respeta paredes y portales abiertos usando el mismo
      // raycast portal-aware que la percepción.
      const melee = new NpcCombat(instanceId, definition, this.eventBus, services.losRaycast);
      combat = new NpcMeleeCombat(melee, definition.attack.range, () => animation.notifyAttack());
    }
    const npc = new Npc({
      id: instanceId,
      characterId: definition.id,
      blobPrey: definition.blobPrey ?? null,
      faction: definition.faction,
      position,
      visualRoot: visualGroup,
      height: definition.collider.height,
      motor,
      combat,
      preset,
      sliceDamage: definition.aiProfileId === 'manhackFlyer' ? definition.attack.damage : undefined,
      navigation: services.navigation,
      buildingRegistry: services.buildingRegistry,
      navigationRequests: services.navigationRequests,
      raycast: services.raycast,
      losRaycast: services.losRaycast,
      eventBus: this.eventBus,
      difficulty: this.difficulty,
      animation,
      blobControl: blobV2Control,
      patrolRoute: patrolPoints,
      tacticalMap: services.tacticalMap,
      squadDirector: services.squadDirector,
    });
    blobNpcForFeedback = npc;
    ownerProxy.applyDamage = npc.applyDamage.bind(npc);
    ownerProxy.isAlive = npc.isAlive.bind(npc);
    if (blobV2Controller) {
      const debugMotor = motor instanceof BlobV2Motor ? motor : null;
      const debugMotion: BlobV2DebugMotion = { target: null, wantsMove: false };
      unregisterBlobV2Runtime = blobV2Runtimes.register({
        id: instanceId,
        controller: blobV2Controller,
        events: blobV2Events,
        diagnostics: () => ({
          motion: {
            target: debugMotion.target?.toArray() ?? null,
            wantsMove: debugMotion.wantsMove,
          },
          traversal: debugMotor?.getTraversalDebugSnapshot() ?? null,
          pose: blobV2Control?.getDebugSnapshot() ?? null,
          presentation: blobV2Animator
            ? {
                frozen: blobV2Animator.presenter.isFrozen,
                disposed: blobV2Animator.presenter.isDisposed,
                activeSurfaceCount: blobV2Animator.presenter.activeSurfaceCount,
                fallbackCellCount: blobV2Animator.presenter.fallbackCellCount,
                visibleTendonCount: blobV2Animator.presenter.visibleTendonCount,
                surfaces: blobV2Controller.snapshot().islands.map((island) => ({
                  islandId: island.id,
                  ...blobV2Animator.presenter.getSurfaceInfo(island.id),
                  mesh: undefined,
                })),
              }
            : null,
        }),
        fixedStep: (steps) => {
          debugMotor?.setDeterministicEvidenceStepping(true);
          try {
            for (let index = 0; index < steps; index += 1) {
              if (debugMotor) {
                debugMotor.update(
                  BlobConfig.v2.fixedStep,
                  debugMotion.target,
                  debugMotion.wantsMove,
                  debugMotion.target,
                );
              } else {
                blobV2Controller.step(BlobConfig.v2.fixedStep);
              }
            }
          } finally {
            debugMotor?.setDeterministicEvidenceStepping(false);
          }
          const snapshot = blobV2Controller.snapshot();
          blobV2Hitboxes?.sync(snapshot);
          return snapshot;
        },
        scenario: (name) => runBlobV2DebugScenario(
          blobV2Controller,
          name,
          debugMotion,
          debugMotor,
          blobV2Control,
          blobV2Animator,
        ),
        prepareEvidence: () => {
          debugMotor?.prepareDeterministicEvidenceAction();
          return blobV2Animator?.prepareDeterministicEvidenceFrame();
        },
        resetEvidence: () => {
          blobV2Events.length = 0;
          blobV2Control?.resetPose();
          debugMotion.target = null;
          debugMotion.wantsMove = false;
          return debugMotor
            ? debugMotor.resetForEvidence(blobSpawnPosition)
            : blobV2Controller.resetForEvidence(blobSpawnPosition);
        },
      });
    }
    return npc;
  }
}

interface BlobV2DebugMotion {
  target: Vector3 | null;
  wantsMove: boolean;
}

function runBlobV2DebugScenario(
  controller: BlobOrganismController,
  name: string,
  motion: BlobV2DebugMotion,
  motor: BlobV2Motor | null,
  control: BlobV2Control | null,
  animator: BlobV2Animator | null,
): unknown {
  const snapshot = controller.snapshot();
  const core = new Vector3(
    snapshot.core.position.x,
    snapshot.core.position.y,
    snapshot.core.position.z,
  );
  motion.target = null;
  motion.wantsMove = false;
  switch (name) {
    case 'idle':
      controller.setOrganismState('Idle');
      controller.setTraversalState('Ground');
      return controller.snapshot();
    case 'hunt':
    case 'movement':
      controller.setOrganismState('Hunt');
      controller.setTraversalState('Ground');
      if (name === 'movement') {
        motion.target = core.clone().add(new Vector3(0, 0, 2.4));
        motion.wantsMove = true;
      }
      return controller.snapshot();
    case 'climb': {
      const end = core.clone().add(new Vector3(0, 1.25, 1.4));
      const link: NavigationActionLink = {
        id: 'blob-debug-climb',
        kind: 'climb',
        start: core.clone(),
        end,
        bidirectional: true,
        cost: 1,
        width: 3,
        profileIds: ['blob'],
        climbHeight: 1.25,
      };
      motor?.beginNavigationAction(link);
      motion.target = end;
      motion.wantsMove = true;
      return controller.snapshot();
    }
    case 'flow': {
      const end = core.clone().add(new Vector3(0, 0, 2.4));
      motor?.beginNavigationAction({
        id: 'blob-debug-flow',
        kind: 'flow',
        start: core.clone(),
        end,
        bidirectional: true,
        cost: 1,
        width: 3.4,
        profileIds: ['blob'],
        flowOpenings: [
          { offset: -1.05, width: 0.72, bottom: -0.28, height: 0.82 },
          { offset: 0, width: 1.12, bottom: -0.18, height: 1.05 },
          { offset: 1.08, width: 0.78, bottom: -0.25, height: 0.9 },
        ],
        brainCrossFraction: 0.6,
      });
      motion.target = end;
      motion.wantsMove = true;
      return controller.snapshot();
    }
    case 'digest':
      controller.setOrganismState('Digest');
      control?.setPose({
        id: 'blob-debug-digest',
        kind: 'hemisphere',
        center: core,
        target: core.clone().add(new Vector3(0, 1.8, 0)),
        radius: 1.65,
        height: 2.1,
        duration: 0.45,
      });
      return controller.snapshot();
    case 'growth':
      controller.consumeBiomass(58);
      controller.setOrganismState('Idle');
      return controller.snapshot();
    case 'breach':
      return detachDebugFragment(controller, 16, { x: 5, y: 1.5, z: 0 });
    case 'core-exposed': {
      const opening = detachDebugFragment(controller, 16, { x: -4, y: 1.2, z: 0 });
      if (opening.fragmentId !== null) {
        controller.applyImpact({
          point: { x: core.x + snapshot.core.radius, y: core.y, z: core.z },
          direction: { x: -1, y: 0, z: 0 },
          damage: 120,
          fragmentId: opening.fragmentId,
        });
      }
      return controller.snapshot();
    }
    case 'split-return':
      return detachDebugFragment(controller, 16, { x: 7.5, y: 3.2, z: 0 });
    case 'reattach': {
      const opening = detachDebugFragment(controller, 12, { x: -2, y: 0.3, z: 0 });
      const fragment = controller.snapshot().fragments.find(
        (candidate) => candidate.id === opening.fragmentId,
      );
      if (fragment) {
        const target = core.clone().add(new Vector3(snapshot.core.radius * 0.6, 0, 0));
        controller.transformIsland(fragment.islandId, {
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          translation: {
            x: target.x - fragment.position.x,
            y: target.y - fragment.position.y,
            z: target.z - fragment.position.z,
          },
        });
        controller.setIslandVelocity(fragment.islandId, { x: -0.5, y: 0, z: 0 });
      }
      return controller.snapshot();
    }
    case 'split-wither': {
      const opening = detachDebugFragment(controller, 12, { x: 0, y: 2, z: -6 });
      const fragment = controller.snapshot().fragments.find(
        (candidate) => candidate.id === opening.fragmentId,
      );
      if (fragment) {
        const pocket = new Vector3(26.5, 1, -13);
        controller.transformIsland(fragment.islandId, {
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          translation: {
            x: pocket.x - fragment.position.x,
            y: pocket.y - fragment.position.y,
            z: pocket.z - fragment.position.z,
          },
        });
        controller.setIslandVelocity(fragment.islandId, { x: 0, y: 0, z: 0 });
      }
      return controller.snapshot();
    }
    case 'portal': {
      const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI * 0.5);
      const rotatedCore = core.clone().applyQuaternion(rotation);
      controller.transformIsland(controller.topology.mainIslandId, {
        rotation,
        translation: core.clone().sub(rotatedCore),
      });
      controller.setTraversalState('PortalTraverse');
      control?.setPose({
        id: 'blob-debug-portal',
        kind: 'tendril',
        center: core.clone().add(new Vector3(0, 0, -1.2)),
        target: core.clone().add(new Vector3(0, 0, 1.2)),
        length: 2.4,
        radius: 0.55,
        duration: 0.35,
      });
      return controller.snapshot();
    }
    case 'pose':
      control?.setPose({
        id: 'blob-debug-pose',
        kind: 'column',
        center: core,
        target: core.clone().add(new Vector3(0, 3.4, 0)),
        radius: 0.9,
        height: 3.4,
        duration: 0.45,
      });
      return controller.snapshot();
    case 'freeze':
      controller.setOverrideState('Frozen');
      return controller.snapshot();
    case 'death':
      {
        const detached = detachDebugFragment(
          controller,
          16,
          { x: 4, y: 1.4, z: 0 },
        );
        // The death presentation owns a single continuous skin. Remove the
        // combat island through the normal damage path before stopping the
        // simulation, otherwise an unscheduled newborn fallback would remain.
        if (detached.fragmentId !== null) {
          controller.applyImpact({
            point: { x: core.x + snapshot.core.radius, y: core.y, z: core.z },
            direction: { x: -1, y: 0, z: 0 },
            damage: 1_000,
            fragmentId: detached.fragmentId,
          });
        }
      }
      {
        const opened = controller.snapshot().wounds.find(
          (wound) => wound.state === 'Breached' || wound.state === 'Exposed',
        );
        if (opened) {
          controller.applyImpact({
            point: opened.point,
            direction: {
              x: -opened.normal.x,
              y: -opened.normal.y,
              z: -opened.normal.z,
            },
            damage: controller.core.maximumHealth,
          });
        }
      }
      animator?.notifyDeath(undefined, new Vector3(), 'blob-core');
      controller.setOverrideState('Dead');
      return controller.snapshot();
    default:
      throw new Error(`Unknown Blob V2 debug scenario '${name}'`);
  }
}

function detachDebugFragment(
  controller: BlobOrganismController,
  biomass: number,
  impulse: { x: number; y: number; z: number },
) {
  const snapshot = controller.snapshot();
  return controller.applyImpact({
    point: {
      x: snapshot.core.position.x + snapshot.core.radius,
      y: snapshot.core.position.y,
      z: snapshot.core.position.z,
    },
    direction: { x: -1, y: 0, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    impulse,
    damage: 40,
    cohesionEnergy: 40,
    detachBiomass: biomass,
  });
}

function resolvePresetFor(definition: CharacterDefinition, options: NpcPresetOptions): NpcPreset {
  switch (definition.aiProfileId) {
    case 'alyxSupport':
      return applyDefinitionStats(buildAlyxPreset(), definition);
    case 'rebelAlly':
      return applyDefinitionStats(buildRebelPreset(options), definition);
    case 'rebelMedic':
      return applyDefinitionStats(buildRebelPreset({ ...options, medic: true }), definition);
    case 'zombieMelee':
      return applyDefinitionStats(buildZombiePreset(), definition);
    case 'passiveHumanoid':
      return applyDefinitionStats(buildPassivePreset(), definition);
    case 'headcrabMelee':
      return buildHeadcrabPreset();
    case 'blobCreature':
      return buildBlobPreset();
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
      return applyDefinitionStats(buildCombinePreset(options), definition);
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
  // El grupo lo puebla `BlobV2Animator` con su isosuperficie programada.
  blob: () => {
    const group = new Group();
    group.name = 'blob-root';
    return group;
  },
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
