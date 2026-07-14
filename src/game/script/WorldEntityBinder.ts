import { Vector3 } from 'three';
import { tupleToVector3 } from '@shared/math/VectorTuple';
import type { VectorTuple } from '@shared/math/VectorTuple';
import type { LevelActionKind } from '@game/GameEvents';
import type { SoundscapeId } from '@game/config/audio.config';
import type { DoorDefinition, NPCDefinition, TriggerDefinition } from '@game/levels/LevelDefinition';
import type { ActivatorRef, EntityHandle, EntityIOSystem, InputArgs } from './EntityIOSystem';
import type { LogicEntityDefinition } from './EntityIOTypes';
import { effectiveName } from './EntityIOTypes';
import {
  createAutoHandle,
  createCounterHandle,
  createRelayHandle,
  createTimerHandle,
} from './logicEntities';

/**
 * Efectos de mundo que los inputs de las entidades lógicas ejecutan. `Game` los
 * implementa reusando sus métodos existentes; así el módulo de script queda
 * desacoplado de la orquestación del juego.
 */
export interface WorldEntityHooks {
  showDialogue(text: string, duration: number, speaker: string | undefined): void;
  spawnNpcs(npcs: NPCDefinition[], spawnerName: string): Promise<void> | void;
  setDoorOpen(doorId: string, open: boolean, activator: ActivatorRef): void;
  toggleDoor(doorId: string, activator: ActivatorRef): void;
  runLevelAction(action: LevelActionKind): void;
  updateObjective(text: string, completed: boolean | undefined, marker: VectorTuple | undefined): void;
  activateSoundscape(id: SoundscapeId): void;
  endLevel(landmark: VectorTuple | undefined): void;
  setTriggerEnabled(triggerId: string, enabled: boolean): void;
  toggleTrigger(triggerId: string): void;
  killPlayer(): void;
  teleportPlayer(position: Vector3): void;
}

export interface WorldEntitiesInput {
  logic: readonly LogicEntityDefinition[];
  doors: readonly DoorDefinition[];
  triggers: readonly TriggerDefinition[];
}

/**
 * Registra en el `EntityIOSystem` los handles y conexiones de las entidades del
 * nivel (lógicas, puertas y triggers). Devuelve la tabla de markers (info_target)
 * para que los sistemas de secuencias/escolta resuelvan destinos por nombre.
 */
export function bindWorldEntities(
  io: EntityIOSystem,
  world: WorldEntitiesInput,
  hooks: WorldEntityHooks,
): Map<string, Vector3> {
  const markers = new Map<string, Vector3>();

  for (const def of world.logic) {
    const name = effectiveName(def);
    switch (def.kind) {
      case 'relay':
        io.registerEntity(createRelayHandle(def, io));
        break;
      case 'auto':
        io.registerEntity(createAutoHandle(def, io));
        break;
      case 'timer':
        io.registerEntity(createTimerHandle(def, io));
        break;
      case 'counter':
        io.registerEntity(createCounterHandle(def, io));
        break;
      case 'marker':
        markers.set(name, tupleToVector3(def.position));
        break;
      case 'message':
        io.registerEntity(createMessageHandle(def, hooks));
        break;
      case 'objective':
        io.registerEntity(createObjectiveHandle(def, hooks));
        break;
      case 'soundscape':
        io.registerEntity(createSoundscapeHandle(def, hooks));
        break;
      case 'npcSpawner':
        io.registerEntity(createSpawnerHandle(def, io, hooks));
        break;
      case 'levelAction':
        io.registerEntity(createLevelActionHandle(def, hooks));
        break;
      case 'changelevel':
        io.registerEntity(createChangelevelHandle(def, hooks));
        break;
    }
    if (def.kind !== 'marker') {
      io.registerConnections({ key: def.id, name }, def.connections ?? []);
    }
  }

  io.registerEntity(createPlayerHandle(markers, hooks));

  for (const door of world.doors) {
    io.registerEntity(createDoorHandle(door, hooks));
    io.registerConnections(
      { key: door.id, name: effectiveName(door) },
      door.connections ?? [],
    );
  }

  for (const trigger of world.triggers) {
    io.registerEntity(createTriggerHandle(trigger, hooks));
    io.registerConnections(
      { key: trigger.id, name: effectiveName(trigger) },
      trigger.connections ?? [],
    );
  }

  return markers;
}

type MessageDef = Extract<LogicEntityDefinition, { kind: 'message' }>;
type ObjectiveDef = Extract<LogicEntityDefinition, { kind: 'objective' }>;
type SoundscapeDef = Extract<LogicEntityDefinition, { kind: 'soundscape' }>;
type SpawnerDef = Extract<LogicEntityDefinition, { kind: 'npcSpawner' }>;
type LevelActionDef = Extract<LogicEntityDefinition, { kind: 'levelAction' }>;
type ChangelevelDef = Extract<LogicEntityDefinition, { kind: 'changelevel' }>;

function createMessageHandle(def: MessageDef, hooks: WorldEntityHooks): EntityHandle {
  const name = effectiveName(def);
  return {
    key: def.id,
    name,
    classId: 'message',
    acceptInput(input: string): void {
      if (input === 'Show') hooks.showDialogue(def.text, def.duration, def.speaker);
    },
  };
}

function createObjectiveHandle(def: ObjectiveDef, hooks: WorldEntityHooks): EntityHandle {
  const name = effectiveName(def);
  return {
    key: def.id,
    name,
    classId: 'objective',
    acceptInput(input: string): void {
      if (input === 'Apply') hooks.updateObjective(def.text, def.completed, def.marker);
    },
  };
}

function createSoundscapeHandle(def: SoundscapeDef, hooks: WorldEntityHooks): EntityHandle {
  const name = effectiveName(def);
  return {
    key: def.id,
    name,
    classId: 'soundscape',
    acceptInput(input: string): void {
      if (input === 'Activate') hooks.activateSoundscape(def.soundscape);
    },
  };
}

function createSpawnerHandle(def: SpawnerDef, io: EntityIOSystem, hooks: WorldEntityHooks): EntityHandle {
  const name = effectiveName(def);
  const source = { key: def.id, name };
  return {
    key: def.id,
    name,
    classId: 'npcSpawner',
    acceptInput(input: string, args: InputArgs): void {
      if (input !== 'Spawn') return;
      let completion: Promise<unknown>;
      try {
        completion = Promise.resolve(hooks.spawnNpcs(def.npcs, name));
      } catch (error: unknown) {
        completion = Promise.reject(error);
      }
      io.fireOutputAfter(
        // Captura tanto rechazos async como throws sincronicos del factory y
        // los enruta por OnSpawnFailed sin diferir un spawn sincrónico.
        completion,
        source,
        'OnSpawned',
        args.activator,
        'OnSpawnFailed',
      );
    },
  };
}

function createLevelActionHandle(def: LevelActionDef, hooks: WorldEntityHooks): EntityHandle {
  const name = effectiveName(def);
  return {
    key: def.id,
    name,
    classId: 'levelAction',
    acceptInput(input: string): void {
      if (input === 'Trigger') hooks.runLevelAction(def.action);
    },
  };
}

function createChangelevelHandle(def: ChangelevelDef, hooks: WorldEntityHooks): EntityHandle {
  const name = effectiveName(def);
  return {
    key: def.id,
    name,
    classId: 'changelevel',
    acceptInput(input: string): void {
      if (input === 'Trigger') hooks.endLevel(def.landmark);
    },
  };
}

function createDoorHandle(def: DoorDefinition, hooks: WorldEntityHooks): EntityHandle {
  return {
    key: def.id,
    name: effectiveName(def),
    classId: 'door',
    acceptInput(input: string, args: InputArgs): void {
      switch (input) {
        case 'Open':
          hooks.setDoorOpen(def.id, true, args.activator);
          return;
        case 'Close':
          hooks.setDoorOpen(def.id, false, args.activator);
          return;
        case 'Toggle':
          hooks.toggleDoor(def.id, args.activator);
          return;
      }
    },
  };
}

function createTriggerHandle(def: TriggerDefinition, hooks: WorldEntityHooks): EntityHandle {
  return {
    key: def.id,
    name: effectiveName(def),
    classId: 'trigger',
    acceptInput(input: string): void {
      switch (input) {
        case 'Enable':
          hooks.setTriggerEnabled(def.id, true);
          return;
        case 'Disable':
          hooks.setTriggerEnabled(def.id, false);
          return;
        case 'Toggle':
          hooks.toggleTrigger(def.id);
          return;
      }
    },
  };
}

function createPlayerHandle(
  markers: ReadonlyMap<string, Vector3>,
  hooks: WorldEntityHooks,
): EntityHandle {
  return {
    key: '!player',
    name: '!player',
    classId: 'player',
    acceptInput(input: string, args: InputArgs): void {
      switch (input) {
        case 'Kill':
          hooks.killPlayer();
          return;
        case 'Teleport': {
          if (typeof args.param !== 'string') return;
          const point = markers.get(args.param);
          if (point) hooks.teleportPlayer(point.clone());
          return;
        }
      }
    },
  };
}
