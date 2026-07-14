import { Box3, Group, Mesh, MeshStandardMaterial, BoxGeometry, Vector3, type Scene } from 'three';
import type { AssetManager } from '@engine/assets/AssetManager';
import type { CharacterFactory } from '@game/characters/CharacterFactory';
import { CharacterPresets, isFlyingCharacter } from '@game/characters/CharacterPresets';
import type { VectorTuple } from '@shared/math/VectorTuple';
import { tupleToVector3 } from '@shared/math/VectorTuple';
import type { GameEventBus } from "@game/GameEvents";
import { ActionButton, Charger, DoorButton, InteractSystem, SlidingDoor } from '@game/gameplay/interactions';
import { WeaponPickup } from '@game/gameplay/weapons/pickup/WeaponPickup';
import { ItemPickup } from '@game/gameplay/items/ItemPickup';
import { AmmoPickup } from '@game/gameplay/items/AmmoPickup';
import { getChargerType } from '@game/config/items.config';
import { SquadDirector } from '@game/npc/ai/SquadDirector';
import type { INpc } from '@game/npc/core/INpc';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { Raycast } from '@engine/physics/Raycast';
import { SpawnValidator } from '@engine/physics/character/SpawnValidator';
import { createBoxMesh, createInstancedBoxMeshes } from '@engine/render/PrimitiveFactory';
import { createTerrainMesh } from '@engine/render/TerrainMesh';
import type { MaterialKey } from '@engine/render/material/Materials';
import { materialToSurface } from './materialSurface';
import { generateHeightField } from '@shared/math/HeightField';
import { buildNavigationGeometry } from '@engine/ai/navigation/NavigationGeometry';
import { NavigationService } from '@engine/ai/navigation/NavigationService';
import { NavigationRequestQueue } from '@engine/ai/navigation/NavigationRequestQueue';
import type { NavigationActionLink } from '@engine/ai/navigation/NavigationTypes';
import { NavigationProfiles } from '@game/npc/navigation/NavAgentProfiles';
import type { NpcRuntimeServices } from '@game/characters/CharacterFactory';
import { TacticalMap, TacticalMapAnalyzer } from '@game/npc/ai/TacticalMap';
import { BuildingRegistry } from '@game/levels/buildings/BuildingRegistry';
import { quatFromEuler } from '@game/levels/builders/transform';
import type { LevelDefinition } from './LevelDefinition';
import type { TriggerSystem } from './TriggerSystem';
import type { CheckpointSystem } from './CheckpointSystem';
import type { HazardVolumeSystem } from './HazardVolumeSystem';
import type { ExplosiveBarrelSystem } from '@game/gameplay/hazards/ExplosiveBarrelSystem';

/**
 * Wiring de portales para los NPCs del nivel (LOS/disparo portal-aware, cruce
 * de flyers). Vive en el caller (Game) porque el par y el raycast through son
 * del sistema de portales, no del nivel.
 */
export type NpcPortalServices = Pick<
  NpcRuntimeServices,
  'losRaycast' | 'portals' | 'onFlyerPortalTeleport'
>;

export interface LoadedLevel {
  npcs: INpc[];
  doors: SlidingDoor[];
  weaponPickups: WeaponPickup[];
  itemPickups: ItemPickup[];
  ammoPickups: AmmoPickup[];
  chargers: Charger[];
  tacticalMap: TacticalMap;
  squadDirector: SquadDirector;
  buildingRegistry: BuildingRegistry;
  navigation: NavigationService;
  navigationRequests: NavigationRequestQueue;
}

/**
 * Materializa un `LevelDefinition` en escena: crea cuerpos físicos, mallas,
 * puertas con sus botones interactuables, instancia NPCs vía `CharacterFactory`,
 * arma pickups y registra triggers.
 */
export class LevelLoader {
  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly eventBus: GameEventBus,
    private readonly interactSystem: InteractSystem,
    private readonly triggerSystem: TriggerSystem,
    private readonly checkpointSystem: CheckpointSystem,
    private readonly hazardVolumes: HazardVolumeSystem,
    private readonly explosiveBarrels: ExplosiveBarrelSystem,
    private readonly characters: CharacterFactory,
    private readonly assets: AssetManager,
    private readonly npcPortalServices: NpcPortalServices,
  ) {}

  async load(level: LevelDefinition): Promise<LoadedLevel> {
    const npcs: INpc[] = [];
    const doors: SlidingDoor[] = [];
    const weaponPickups: WeaponPickup[] = [];
    const itemPickups: ItemPickup[] = [];
    const ammoPickups: AmmoPickup[] = [];
    const chargers: Charger[] = [];
    const sharedRaycast = new Raycast(this.physics);
    let navigationTerrain: Parameters<typeof buildNavigationGeometry>[1];

    if (level.terrain) {
      const terrain = level.terrain;
      const field = generateHeightField({
        widthSamples: terrain.widthSamples,
        depthSamples: terrain.depthSamples,
        size: terrain.size,
        source: terrain.source,
      });
      const mesh = createTerrainMesh(field, {
        id: terrain.id,
        position: terrain.position,
        size: terrain.size,
        material: terrain.material,
      });
      this.scene.add(mesh);
      this.physics.createHeightfield(field, {
        id: terrain.id,
        position: tupleToVector3(terrain.position),
        size: terrain.size,
        metadata: { surface: materialToSurface(terrain.material) },
      });
      navigationTerrain = {
        field,
        position: tupleToVector3(terrain.position),
        size: terrain.size,
      };
    }

    const buildings = level.buildings ?? [];
    const buildingBoxes = buildings.flatMap((b) => b.boxes);
    const allStaticBoxes = [...level.staticBoxes, ...buildingBoxes];
    this.scene.add(
      ...createInstancedBoxMeshes({
        id: `${level.id}-static-boxes`,
        boxes: allStaticBoxes,
        castShadow: true,
        receiveShadow: true,
      }),
    );
    this.physics.createStaticBoxes(
      allStaticBoxes.map((definition) => ({
        id: definition.id,
        position: tupleToVector3(definition.position),
        size: tupleToVector3(definition.size),
        rotation: definition.rotation ? quatFromEuler(definition.rotation) : undefined,
        metadata: {
          surface: materialToSurface(definition.material),
          blobPermeable: definition.blobPermeable === true || definition.blobFlow !== undefined,
          blobFlow: normalizeBlobFlow(definition),
        },
      })),
    );
    const buildingRegistry = new BuildingRegistry(buildings);

    level.dynamicBoxes.forEach((definition) => {
      const mesh = createLevelBox(definition.id, definition.position, definition.size, definition.material, definition.rotation);
      this.scene.add(mesh);
      this.physics.createDynamicBox(
        {
          id: definition.id,
          position: tupleToVector3(definition.position),
          size: tupleToVector3(definition.size),
          rotation: definition.rotation ? quatFromEuler(definition.rotation) : undefined,
          mass: definition.mass,
          metadata: {
            surface: materialToSurface(definition.material),
            ...(definition.blobConsumable
              ? {
                  blobConsumable: {
                    consumeSeconds: definition.blobConsumable.consumeSeconds ?? 2,
                    biomass: definition.blobConsumable.biomass ?? 4,
                  },
                }
              : {}),
          },
        },
        mesh,
      );
    });

    level.doors.forEach((definition) => {
      const quat = definition.rotation ? quatFromEuler(definition.rotation) : undefined;
      const mesh = createLevelBox(definition.id, definition.position, definition.size, definition.material, definition.rotation);
      this.scene.add(mesh);

      const body = this.physics.createKinematicBox({
        id: definition.id,
        position: tupleToVector3(definition.position),
        size: tupleToVector3(definition.size),
        rotation: quat,
        metadata: { kind: 'door' },
      });
      // openOffset es local al marco de la puerta: lo rotamos para que el
      // deslizamiento siga la orientacion (una puerta girada desliza girado).
      const openOffset = tupleToVector3(definition.openOffset);
      if (quat) openOffset.applyQuaternion(quat);
      const door = new SlidingDoor(
        definition.id,
        mesh,
        body,
        openOffset,
        definition.speed,
        (open, activator) => this.eventBus.emit('door.opened', {
          id: definition.id,
          open,
          activator,
        }),
      );
      doors.push(door);

      const doorPos = tupleToVector3(definition.position);
      const buttonPos = tupleToVector3(definition.button.position);
      if (quat) buttonPos.sub(doorPos).applyQuaternion(quat).add(doorPos);
      const button = createBoxMesh({
        id: definition.button.id,
        position: [buttonPos.x, buttonPos.y, buttonPos.z],
        size: definition.button.size,
        material: 'button',
        rotation: definition.rotation,
        castShadow: true,
      });
      this.scene.add(button);
      this.interactSystem.register(
        new DoorButton(definition.button.id, definition.button.label, button, door, this.eventBus),
      );
    });

    level.actionButtons?.forEach((definition) => {
      const button = createBoxMesh({
        id: definition.id,
        position: definition.position,
        size: definition.size,
        material: 'button',
        rotation: definition.rotation,
        castShadow: true,
      });
      this.scene.add(button);
      this.interactSystem.register(
        new ActionButton(
          definition.id,
          definition.label,
          button,
          definition.action,
          this.eventBus,
        ),
      );
    });

    this.physics.updateQueryPipeline();
    const spawnValidator = new SpawnValidator(new Raycast(this.physics));

    const navigationGeometry = buildNavigationGeometry(allStaticBoxes, navigationTerrain);
    const navigationBuildStart = performance.now();
    const navigation = await NavigationService.create({
      geometry: navigationGeometry,
      raycast: sharedRaycast,
      physics: this.physics,
      assetKey: level.id,
      maxAgents: 60,
      openDoor: (doorId, ownerId) => doors
        .find((door) => door.id === doorId)
        ?.setOpen(true, { kind: 'entity', key: ownerId, name: ownerId }),
      isDoorPassable: (doorId) => doors.find((door) => door.id === doorId)?.isPassable() ?? true,
      metadataAt: (position) => {
        const located = buildingRegistry.roomContaining(position);
        if (located) return { buildingId: located.building.id, roomId: located.room.id };
        return { buildingId: buildingRegistry.containing(position)?.id ?? null, roomId: null };
      },
      groundProfiles: [
        NavigationProfiles.humanoid,
        NavigationProfiles.humanoidLimited,
        NavigationProfiles.headcrab,
        NavigationProfiles.blob,
        NavigationProfiles.strider,
      ],
    });
    navigation.setSemanticActionLinks([
      ...buildDoorNavigationLinks(buildings, navigation),
      ...buildBlobFlowNavigationLinks(allStaticBoxes, navigation),
      ...buildBlobClimbNavigationLinks(allStaticBoxes, navigation),
    ]);
    const navigationRequests = new NavigationRequestQueue(navigation, 3);
    console.info(
      `[LevelLoader] NavigationService: ${navigation.debugSnapshot().profiles.map((p) => `${p.id}:${p.triangleCount}`).join(', ')} (${Math.round(performance.now() - navigationBuildStart)} ms)`,
    );

    const enrichedLevel: LevelDefinition = { ...level, staticBoxes: allStaticBoxes };
    const tacticalMap = new TacticalMapAnalyzer().analyze(
      enrichedLevel,
      navigation,
      sharedRaycast,
    );
    const squadDirector = new SquadDirector();

    const npcServices: NpcRuntimeServices = {
      navigation,
      navigationRequests,
      buildingRegistry,
      raycast: sharedRaycast,
      ...this.npcPortalServices,
      tacticalMap,
      squadDirector,
    };

    for (const definition of level.npcs) {
      const requested = tupleToVector3(definition.position);
      const preset =
        CharacterPresets[definition.characterId] ??
        CharacterPresets.placeholderHumanoid;
      const halfExtent = preset.collider.height / 2;
      // Los voladores conservan su altura de diseño (no se pegan al suelo).
      const validation = isFlyingCharacter(preset)
        ? { position: requested, valid: true, relocated: false }
        : spawnValidator.validate(requested, halfExtent);
      if (!validation.valid) {
        console.warn(
          `[LevelLoader] NPC '${definition.id}' spawn invalid at ${requested.toArray().join(',')} — usando posición pedida igual`,
        );
      } else if (validation.relocated) {
        console.info(
          `[LevelLoader] NPC '${definition.id}' relocated de ${requested.toArray().join(',')} → ${validation.position.toArray().join(',')}`,
        );
      }
      const npc = await this.characters.createNPC(
        definition.characterId,
        definition.id,
        validation.position,
        definition.patrol?.map(tupleToVector3) ?? [],
        npcServices,
      );
      this.scene.add(npc.mesh);
      npcs.push(npc);
    }

    for (const definition of level.weaponPickups) {
      weaponPickups.push(
        await WeaponPickup.create(this.scene, this.physics, this.assets, {
          id: definition.id,
          weaponId: definition.weaponId,
          position: tupleToVector3(definition.position),
        }),
      );
    }

    for (const definition of level.itemPickups ?? []) {
      itemPickups.push(
        await ItemPickup.create(
          this.scene,
          this.physics,
          this.assets,
          this.eventBus,
          {
            id: definition.id,
            itemId: definition.itemId,
            position: tupleToVector3(definition.position),
          },
        ),
      );
    }

    for (const definition of level.ammoPickups ?? []) {
      ammoPickups.push(
        await AmmoPickup.create(this.scene, this.physics, this.assets, {
          id: definition.id,
          ammoId: definition.ammoId,
          position: tupleToVector3(definition.position),
        }),
      );
    }

    for (const definition of level.chargers ?? []) {
      const type = getChargerType(definition.kind);
      const instance = await this.assets.instantiateModel(type.modelId);
      const object = new Group();
      object.name = definition.id;
      object.add(instance.root ?? createChargerFallback(definition.id));
      object.scale.setScalar(type.scale);
      object.rotation.y = definition.rotationY ?? 0;
      const base = tupleToVector3(definition.position);
      object.position.copy(base);
      object.updateMatrixWorld(true);
      // Asienta la base del modelo sobre la Y pedida (sin depender del pivote del GLB).
      const bounds = new Box3().setFromObject(object);
      object.position.y += base.y - bounds.min.y;
      object.updateMatrixWorld(true);
      this.scene.add(object);

      const solid = new Box3().setFromObject(object);
      this.physics.createStaticBox({
        id: `${definition.id}-body`,
        position: solid.getCenter(new Vector3()),
        size: solid.getSize(new Vector3()),
      });

      const charger = new Charger(
        definition.id,
        object,
        type,
        definition.capacity ?? type.capacity,
        this.eventBus,
      );
      this.interactSystem.register(charger);
      chargers.push(charger);
    }

    level.triggers.forEach((definition) => {
      this.triggerSystem.addTrigger(definition);
    });

    (level.checkpoints ?? []).forEach((definition) => {
      this.checkpointSystem.addCheckpoint(definition);
    });

    (level.explosiveBarrels ?? []).forEach((definition) => {
      this.explosiveBarrels.spawn(definition);
    });

    (level.hazardVolumes ?? []).forEach((definition) => {
      this.hazardVolumes.addVolume(definition);
    });

    this.physics.updateQueryPipeline();

    return {
      npcs,
      doors,
      weaponPickups,
      itemPickups,
      ammoPickups,
      chargers,
      tacticalMap,
      squadDirector,
      buildingRegistry,
      navigation,
      navigationRequests,
    };
  }
}
function buildDoorNavigationLinks(
  buildings: LevelDefinition['buildings'],
  navigation: NavigationService,
): NavigationActionLink[] {
  const links: NavigationActionLink[] = [];
  for (const building of buildings ?? []) {
    for (const doorway of building.doorways) {
      if (!doorway.doorId) continue;
      const center = tupleToVector3(doorway.position);
      const normal = tupleToVector3(doorway.normal).setY(0).normalize();
      const reach = Math.max(0.65, NavigationProfiles.humanoid.radius + 0.25);
      const start = navigation.projectPoint(
        center.clone().addScaledVector(normal, -reach),
        NavigationProfiles.humanoid,
      );
      const end = navigation.projectPoint(
        center.clone().addScaledVector(normal, reach),
        NavigationProfiles.humanoid,
      );
      if (!start || !end) continue;
      links.push({
        id: `door-${building.id}-${doorway.id}`,
        kind: 'door',
        start,
        end,
        bidirectional: true,
        cost: start.distanceTo(end) + 0.4,
        width: doorway.width,
        doorId: doorway.doorId,
        profileIds: [NavigationProfiles.humanoid.id],
      });
    }
  }
  return links;
}

function buildBlobFlowNavigationLinks(
  boxes: LevelDefinition['staticBoxes'],
  navigation: NavigationService,
): NavigationActionLink[] {
  const links: NavigationActionLink[] = [];
  for (const box of boxes) {
    if (!box.blobPermeable && !box.blobFlow) continue;
    const flow = normalizeBlobFlow(box);
    // Authored blobFlow data must contain at least one usable opening. Only
    // the legacy blobPermeable flag is allowed to synthesize a full opening.
    if (!flow) continue;
    const center = tupleToVector3(box.position);
    const size = tupleToVector3(box.size);
    const rotation = box.rotation ? quatFromEuler(box.rotation) : undefined;
    const localNormal = size.x <= size.z ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1);
    if (rotation) localNormal.applyQuaternion(rotation);
    localNormal.y = 0;
    if (localNormal.lengthSq() < 1e-4) continue;
    localNormal.normalize();
    const halfThickness = (size.x <= size.z ? size.x : size.z) * 0.5;
    const reach = halfThickness + NavigationProfiles.blob.radius + 0.35;
    const floorY = center.y - size.y * 0.5 + 0.05;
    const start = navigation.projectPoint(
      center.clone().setY(floorY).addScaledVector(localNormal, -reach),
      NavigationProfiles.blob,
    );
    const end = navigation.projectPoint(
      center.clone().setY(floorY).addScaledVector(localNormal, reach),
      NavigationProfiles.blob,
    );
    if (!start || !end) continue;
    links.push({
      id: `blob-flow-${box.id}`,
      kind: 'flow',
      start,
      traverseStart: start.clone().addScaledVector(localNormal, 0.15),
      end,
      bidirectional: true,
      cost: start.distanceTo(end) + 0.25,
      width: Math.max(size.x, size.z),
      profileIds: [NavigationProfiles.blob.id],
      permeableId: box.id,
      flowOpenings: flow.openings,
      brainCrossFraction: flow.brainCrossFraction,
    });
  }
  return links;
}

function normalizeBlobFlow(
  box: LevelDefinition['staticBoxes'][number],
): { openings: Array<{ offset: number; width: number; bottom: number; height: number }>; brainCrossFraction: number } | undefined {
  const size = tupleToVector3(box.size);
  const gateWidth = Math.max(size.x, size.z);
  const gateHeight = size.y;
  const explicit = box.blobFlow?.openings
    .filter((opening) =>
      Number.isFinite(opening.offset)
      && Number.isFinite(opening.width)
      && Number.isFinite(blobFlowOpeningBase(opening))
      && Number.isFinite(opening.height)
      && opening.width > 0
      && opening.height > 0,
    )
    .map((opening) => {
      const width = Math.min(gateWidth, opening.width);
      const halfOffsetRange = Math.max(0, (gateWidth - width) * 0.5);
      const bottom = Math.max(0, Math.min(gateHeight, blobFlowOpeningBase(opening)));
      return {
        // Keep the whole channel, not only its center, inside the local panel.
        offset: Math.max(-halfOffsetRange, Math.min(halfOffsetRange, opening.offset)),
        width,
        bottom,
        height: Math.min(gateHeight - bottom, opening.height),
      };
    })
    .filter((opening) => opening.height > 0);

  if (explicit && explicit.length > 0) {
    return {
      openings: explicit,
      brainCrossFraction: Math.max(0.5, Math.min(0.95, box.blobFlow?.brainCrossFraction ?? 0.6)),
    };
  }
  if (!box.blobPermeable) return undefined;
  return {
    openings: [{ offset: 0, width: gateWidth, bottom: 0, height: gateHeight }],
    brainCrossFraction: 0.6,
  };
}

function blobFlowOpeningBase(
  opening: NonNullable<LevelDefinition['staticBoxes'][number]['blobFlow']>['openings'][number],
): number {
  return opening.base ?? opening.bottom ?? Number.NaN;
}

function buildBlobClimbNavigationLinks(
  boxes: LevelDefinition['staticBoxes'],
  navigation: NavigationService,
): NavigationActionLink[] {
  const links: NavigationActionLink[] = [];
  const profile = NavigationProfiles.blob;
  const minHeight = profile.stepHeight + 0.01;
  const maxHeight = 1.25;
  const localNormals = [
    new Vector3(1, 0, 0),
    new Vector3(-1, 0, 0),
    new Vector3(0, 0, 1),
    new Vector3(0, 0, -1),
  ];

  for (const box of boxes) {
    if (links.length >= 128) break;
    if (box.blobPermeable || box.blobFlow || box.size[1] < minHeight || box.size[1] > maxHeight) continue;
    if (box.size[0] < profile.radius * 2 || box.size[2] < profile.radius * 2) continue;
    const center = tupleToVector3(box.position);
    const size = tupleToVector3(box.size);
    const rotation = box.rotation ? quatFromEuler(box.rotation) : undefined;
    const topY = center.y + size.y * 0.5 + 0.04;
    const baseY = center.y - size.y * 0.5 + 0.04;

    for (let side = 0; side < localNormals.length && links.length < 128; side += 1) {
      const localNormal = localNormals[side];
      const normal = localNormal.clone();
      if (rotation) normal.applyQuaternion(rotation);
      normal.y = 0;
      if (normal.lengthSq() < 1e-4) continue;
      normal.normalize();
      const halfDepth = Math.abs(localNormal.x) > 0 ? size.x * 0.5 : size.z * 0.5;
      const approach = halfDepth + profile.radius + 0.16;
      const inset = Math.max(0.08, halfDepth - profile.radius - 0.08);
      const rawStart = center.clone().setY(baseY).addScaledVector(normal, approach);
      const rawEnd = center.clone().setY(topY).addScaledVector(normal, inset);
      const start = navigation.projectPoint(rawStart, profile);
      const end = navigation.projectPoint(rawEnd, profile);
      if (!start || !end) continue;
      const climbHeight = end.y - start.y;
      if (climbHeight < minHeight - 0.04 || climbHeight > maxHeight + 0.04) continue;
      if (start.distanceTo(rawStart) > 1 || end.distanceTo(rawEnd) > 1) continue;
      links.push({
        id: `blob-climb-${box.id}-${side}`,
        kind: 'climb',
        start,
        traverseStart: start.clone().addScaledVector(normal, -0.08),
        end,
        bidirectional: false,
        cost: start.distanceTo(end) + 0.45,
        width: Math.abs(localNormal.x) > 0 ? size.z : size.x,
        profileIds: [profile.id],
        climbHeight,
      });
    }
  }
  return links;
}

function createChargerFallback(id: string): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(1, 1.9, 0.5),
    new MeshStandardMaterial({ color: 0x2c3138, emissive: 0x113322, emissiveIntensity: 0.3, roughness: 0.6 }),
  );
  mesh.name = `${id}-fallback`;
  return mesh;
}

function createLevelBox(
  id: string,
  position: VectorTuple,
  size: VectorTuple,
  material: MaterialKey,
  rotation?: VectorTuple,
) {
  return createBoxMesh({
    id,
    position,
    size,
    material,
    rotation,
    castShadow: true,
    receiveShadow: true,
  });
}
