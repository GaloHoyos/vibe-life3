import { Box3, Group, Mesh, MeshStandardMaterial, BoxGeometry, Vector3, type Scene } from 'three';
import type { AssetManager } from '@engine/assets/AssetManager';
import type { CharacterFactory } from '@game/characters/CharacterFactory';
import { CharacterPresets } from '@game/characters/CharacterPresets';
import type { VectorTuple } from '@shared/math/VectorTuple';
import { tupleToVector3 } from '@shared/math/VectorTuple';
import type { GameEventBus } from "@game/GameEvents";
import { ActionButton, Charger, DoorButton, InteractSystem, SlidingDoor } from '@game/gameplay/interactions';
import { WeaponPickup } from '@game/gameplay/weapons/pickup/WeaponPickup';
import { ItemPickup } from '@game/gameplay/items/ItemPickup';
import { getChargerType } from '@game/config/items.config';
import { SquadDirector } from '@game/npc/ai/SquadDirector';
import type { INpc } from '@game/npc/core/INpc';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { Raycast } from '@engine/physics/Raycast';
import { SpawnValidator } from '@engine/physics/character/SpawnValidator';
import { createBoxMesh } from '@engine/render/PrimitiveFactory';
import { createTerrainMesh } from '@engine/render/TerrainMesh';
import type { MaterialKey } from '@engine/render/material/Materials';
import { generateHeightField } from '@shared/math/HeightField';
import { NavSpace } from '@engine/ai/nav/NavSpace';
import { NavSpaceBuilder } from '@engine/ai/nav/NavSpaceBuilder';
import { PathRequestQueue } from '@engine/ai/nav/PathRequestQueue';
import type { NpcRuntimeServices } from '@game/characters/CharacterFactory';
import { TacticalMap, TacticalMapAnalyzer } from '@game/npc/ai/TacticalMap';
import { BuildingRegistry } from '@game/levels/buildings/BuildingRegistry';
import { quatFromEuler } from '@game/levels/builders/transform';
import type { LevelDefinition } from './LevelDefinition';
import type { TriggerSystem } from './TriggerSystem';
import type { CheckpointSystem } from './CheckpointSystem';

export interface LoadedLevel {
  npcs: INpc[];
  doors: SlidingDoor[];
  weaponPickups: WeaponPickup[];
  itemPickups: ItemPickup[];
  chargers: Charger[];
  tacticalMap: TacticalMap;
  squadDirector: SquadDirector;
  buildingRegistry: BuildingRegistry;
  navSpace: NavSpace;
  pathQueue: PathRequestQueue;
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
    private readonly characters: CharacterFactory,
    private readonly assets: AssetManager,
  ) {}

  async load(level: LevelDefinition): Promise<LoadedLevel> {
    const npcs: INpc[] = [];
    const doors: SlidingDoor[] = [];
    const weaponPickups: WeaponPickup[] = [];
    const itemPickups: ItemPickup[] = [];
    const chargers: Charger[] = [];
    const sharedRaycast = new Raycast(this.physics);

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
      });
    }

    const buildings = level.buildings ?? [];
    const buildingBoxes = buildings.flatMap((b) => b.boxes);
    const allStaticBoxes = [...level.staticBoxes, ...buildingBoxes];
    allStaticBoxes.forEach((definition) => {
      const mesh = createLevelBox(definition.id, definition.position, definition.size, definition.material, definition.rotation);
      this.scene.add(mesh);
      this.physics.createStaticBox({
        id: definition.id,
        position: tupleToVector3(definition.position),
        size: tupleToVector3(definition.size),
        rotation: definition.rotation ? quatFromEuler(definition.rotation) : undefined,
      });
    });
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
      const door = new SlidingDoor(definition.id, mesh, body, openOffset, definition.speed);
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

    const navSpaceBounds = computeNavSpaceBounds({
      ...level,
      staticBoxes: allStaticBoxes,
    });
    const navBuildStart = performance.now();
    const navSpace = new NavSpaceBuilder().build(sharedRaycast, buildings, {
      bounds: navSpaceBounds,
      // Edificios de hasta 4 pisos + techo = 5 superficies apiladas por columna.
      // Solo las columnas que realmente apilan pagan el costo extra del scan.
      maxLayers: 6,
    });
    console.info(
      `[LevelLoader] NavSpace: ${navSpace.cellCount()} celdas, ${navSpace.portalCount()} portales (${Math.round(performance.now() - navBuildStart)} ms)`,
    );
    const pathQueue = new PathRequestQueue(navSpace);

    const enrichedLevel: LevelDefinition = { ...level, staticBoxes: allStaticBoxes };
    const tacticalMap = new TacticalMapAnalyzer().analyze(
      enrichedLevel,
      navSpace,
      sharedRaycast,
    );
    const squadDirector = new SquadDirector();

    const npcServices: NpcRuntimeServices = {
      navSpace,
      pathQueue,
      buildingRegistry,
      raycast: sharedRaycast,
      tacticalMap,
      squadDirector,
    };

    for (const definition of level.npcs) {
      const requested = tupleToVector3(definition.position);
      const preset =
        CharacterPresets[definition.characterId] ??
        CharacterPresets.placeholderHumanoid;
      const halfExtent = preset.collider.height / 2;
      const validation = spawnValidator.validate(requested, halfExtent);
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
        await ItemPickup.create(this.scene, this.physics, this.assets, {
          id: definition.id,
          itemId: definition.itemId,
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

      const charger = new Charger(definition.id, object, type, definition.capacity ?? type.capacity);
      this.interactSystem.register(charger);
      chargers.push(charger);
    }

    level.triggers.forEach((definition) => {
      this.triggerSystem.addTrigger(definition);
    });

    (level.checkpoints ?? []).forEach((definition) => {
      this.checkpointSystem.addCheckpoint(definition);
    });

    this.physics.updateQueryPipeline();

    return {
      npcs,
      doors,
      weaponPickups,
      itemPickups,
      chargers,
      tacticalMap,
      squadDirector,
      buildingRegistry,
      navSpace,
      pathQueue,
    };
  }
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

function computeNavSpaceBounds(level: LevelDefinition): {
  minX: number; maxX: number; minZ: number; maxZ: number;
} {
  if (level.terrain) {
    const [cx, , cz] = level.terrain.position;
    const [sx, sz] = level.terrain.size;
    return { minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2 };
  }
  if (level.staticBoxes.length === 0) {
    return { minX: -20, maxX: 20, minZ: -20, maxZ: 20 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const box of level.staticBoxes) {
    const [x, , z] = box.position;
    const [sx, , sz] = box.size;
    minX = Math.min(minX, x - sx / 2);
    maxX = Math.max(maxX, x + sx / 2);
    minZ = Math.min(minZ, z - sz / 2);
    maxZ = Math.max(maxZ, z + sz / 2);
  }
  const margin = 4;
  return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };
}
