import type { Scene } from 'three';
import type { CharacterFactory } from '../characters/CharacterFactory';
import type { VectorTuple } from '../engine/MathTypes';
import { tupleToVector3 } from '../engine/MathTypes';
import type { GameEventBus } from '../engine/GameEvents';
import { DoorButton, InteractSystem, SlidingDoor } from '../gameplay/interactions';
import { NPC } from '../ai/NPC';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { createBoxMesh } from '../render/PrimitiveFactory';
import type { MaterialKey } from '../render/Materials';
import type { LevelDefinition } from './LevelDefinition';
import type { TriggerSystem } from './TriggerSystem';

export interface LoadedLevel {
  npcs: NPC[];
  doors: SlidingDoor[];
}

export class LevelLoader {
  constructor(
    private readonly scene: Scene,
    private readonly physics: PhysicsWorld,
    private readonly eventBus: GameEventBus,
    private readonly interactSystem: InteractSystem,
    private readonly triggerSystem: TriggerSystem,
    private readonly characters: CharacterFactory,
  ) {}

  async load(level: LevelDefinition): Promise<LoadedLevel> {
    const npcs: NPC[] = [];
    const doors: SlidingDoor[] = [];

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

    for (const definition of level.npcs) {
      const npc = await this.characters.createNPC(
        definition.characterId,
        definition.id,
        tupleToVector3(definition.position),
      );
      this.scene.add(npc.mesh);
      npcs.push(npc);
    }

    level.triggers.forEach((definition) => {
      this.triggerSystem.addTrigger(definition);
    });

    return { npcs, doors };
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
