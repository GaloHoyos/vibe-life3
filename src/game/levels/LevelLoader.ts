import type { Scene } from 'three';
import type { AssetManager } from '@engine/assets/AssetManager';
import type { CharacterFactory } from '@game/characters/CharacterFactory';
import { CharacterPresets } from '@game/characters/CharacterPresets';
import type { VectorTuple } from '@shared/math/VectorTuple';
import { tupleToVector3 } from '@shared/math/VectorTuple';
import type { GameEventBus } from "@game/GameEvents";
import { ActionButton, DoorButton, InteractSystem, SlidingDoor } from '@game/gameplay/interactions';
import { WeaponPickup } from '@game/gameplay/weapons/pickup/WeaponPickup';
import { CombatSquadCoordinator } from '@game/npc/combat/CombatSquadCoordinator';
import type { INpc } from '@game/npc/core/INpc';
import type { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { Raycast } from '@engine/physics/Raycast';
import { SpawnValidator } from '@engine/physics/character/SpawnValidator';
import { createBoxMesh } from '@engine/render/PrimitiveFactory';
import { createTerrainMesh } from '@engine/render/TerrainMesh';
import type { MaterialKey } from '@engine/render/material/Materials';
import { generateHeightField } from '@shared/math/HeightField';
import type { NavGraph } from '@engine/ai/NavGraph';
import { CoverSystem } from './CoverSystem';
import type { LevelDefinition } from './LevelDefinition';
import { NavGraphBuilder } from './NavGraphBuilder';
import type { TriggerSystem } from './TriggerSystem';

export interface LoadedLevel {
  npcs: INpc[];
  doors: SlidingDoor[];
  weaponPickups: WeaponPickup[];
  coverSystem: CoverSystem;
  navGraph: NavGraph;
  squad: CombatSquadCoordinator;
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
    private readonly characters: CharacterFactory,
    private readonly assets: AssetManager,
  ) {}

  async load(level: LevelDefinition): Promise<LoadedLevel> {
    const npcs: INpc[] = [];
    const doors: SlidingDoor[] = [];
    const weaponPickups: WeaponPickup[] = [];
    const sharedRaycast = new Raycast(this.physics);
    const coverSystem = new CoverSystem(sharedRaycast);
    coverSystem.load(level.coverPoints ?? []);

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

    level.staticBoxes.forEach((definition) => {
      const mesh = createLevelBox(definition.id, definition.position, definition.size, definition.material);
      this.scene.add(mesh);
      this.physics.createStaticBox({
        id: definition.id,
        position: tupleToVector3(definition.position),
        size: tupleToVector3(definition.size),
      });
    });

    level.dynamicBoxes.forEach((definition) => {
      const mesh = createLevelBox(definition.id, definition.position, definition.size, definition.material);
      this.scene.add(mesh);
      this.physics.createDynamicBox(
        {
          id: definition.id,
          position: tupleToVector3(definition.position),
          size: tupleToVector3(definition.size),
          mass: definition.mass,
        },
        mesh,
      );
    });

    level.doors.forEach((definition) => {
      const mesh = createLevelBox(definition.id, definition.position, definition.size, definition.material);
      this.scene.add(mesh);

      const body = this.physics.createKinematicBox({
        id: definition.id,
        position: tupleToVector3(definition.position),
        size: tupleToVector3(definition.size),
        metadata: { kind: 'door' },
      });
      const door = new SlidingDoor(
        definition.id,
        mesh,
        body,
        tupleToVector3(definition.openOffset),
        definition.speed,
      );
      doors.push(door);

      const button = createBoxMesh({
        id: definition.button.id,
        position: definition.button.position,
        size: definition.button.size,
        material: 'button',
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

    level.triggers.forEach((definition) => {
      this.triggerSystem.addTrigger(definition);
    });

    this.physics.updateQueryPipeline();
    const navGraph = new NavGraphBuilder().build(level, sharedRaycast);
    console.info(
      `[LevelLoader] NavGraph: ${navGraph.nodeCount()} nodos generados`,
    );

    const squad = new CombatSquadCoordinator();

    return { npcs, doors, weaponPickups, coverSystem, navGraph, squad };
  }
}

function createLevelBox(id: string, position: VectorTuple, size: VectorTuple, material: MaterialKey) {
  return createBoxMesh({
    id,
    position,
    size,
    material,
    castShadow: true,
    receiveShadow: true,
  });
}
