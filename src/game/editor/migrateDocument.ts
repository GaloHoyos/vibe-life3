import type { NPCDefinition } from '@game/levels/LevelDefinition';
import type { EntityConnection, LogicEntityDefinition } from '@game/script/EntityIOTypes';
import type { LevelActionKind } from '@game/GameEvents';
import type { SoundscapeId } from '@game/config/audio.config';
import type { VectorTuple } from '@shared/math/VectorTuple';
import {
  normalizeLandmark,
  type LandmarkReference,
} from '@game/levels/LevelTransition';
import {
  cloneDocument,
  CURRENT_EDITOR_SCHEMA_VERSION,
  entityIoName,
  entityLevelId,
  newEid,
  type EditorDocument,
  type EditorEntity,
} from './EditorDocument';

/**
 * Forma vieja de las acciones de trigger (pre entity-I/O), tal como quedaron
 * serializadas en documentos de biblioteca/Workshop. Se detecta estructuralmente
 * y se convierte a entidades lógicas + conexiones. NO se usa en el runtime.
 */
type LegacyAction =
  | { kind: 'dialogue'; speaker?: string; text: string; duration: number; delay?: number }
  | { kind: 'spawnNpcs'; npcs: NPCDefinition[]; delay?: number }
  | { kind: 'door'; doorId: string; open: boolean; delay?: number }
  | { kind: 'levelAction'; action: LevelActionKind; delay?: number }
  | { kind: 'soundscape'; soundscape: SoundscapeId; delay?: number }
  | { kind: 'objective'; text: string; completed?: boolean; marker?: VectorTuple; delay?: number }
  | { kind: 'endLevel'; landmark?: LandmarkReference; delay?: number };

interface LegacyTriggerDef {
  id: string;
  actions?: LegacyAction[];
  dialogue?: { speaker?: string; text: string; duration: number };
  connections?: EntityConnection[];
}

/**
 * Migra un `EditorDocument` con triggers de forma vieja (`actions`/`dialogue`) al
 * modelo de entity I/O: cada acción se convierte en una entidad lógica + una
 * conexión `OnStartTouch` del trigger, conservando su `delay`. Idempotente: un
 * documento ya migrado (o nativo del modelo nuevo) se devuelve sin cambios.
 */
export function migrateDocument(input: EditorDocument): EditorDocument {
  const needsSchemaMigration =
    (input as { schemaVersion?: unknown }).schemaVersion !== CURRENT_EDITOR_SCHEMA_VERSION;
  const hasLegacy = input.entities.some(
    (e) => e?.kind === 'trigger' && isLegacyTrigger(e.def as unknown as LegacyTriggerDef),
  );
  const hasLegacyLandmark =
    Array.isArray(input.meta.entryLandmark) ||
    input.entities.some(
      (entity) =>
        entity?.kind === 'logic' &&
        entity.def.kind === 'changelevel' &&
        Array.isArray(entity.def.landmark),
    );
  if (!hasLegacy && !needsSchemaMigration && !hasLegacyLandmark) return input;

  const doc = cloneDocument(input);
  doc.schemaVersion = CURRENT_EDITOR_SCHEMA_VERSION;
  if (doc.meta.entryLandmark) {
    doc.meta.entryLandmark = normalizeLandmark(doc.meta.entryLandmark);
  }
  for (const entity of doc.entities) {
    if (
      entity.kind === 'logic' &&
      entity.def.kind === 'changelevel' &&
      entity.def.landmark
    ) {
      entity.def.landmark = normalizeLandmark(entity.def.landmark);
    }
  }
  const generated: EditorEntity[] = [];
  const occupied = new Set<string>();
  for (const entity of doc.entities) {
    occupied.add(entityLevelId(entity));
    const ioName = entityIoName(entity);
    if (ioName) occupied.add(ioName);
  }

  for (const entity of doc.entities) {
    if (entity.kind !== 'trigger') continue;
    const legacy = entity.def as unknown as LegacyTriggerDef;
    if (!isLegacyTrigger(legacy)) continue;

    const actions: LegacyAction[] = legacy.actions && legacy.actions.length > 0
      ? legacy.actions
      : legacy.dialogue
        ? [{ kind: 'dialogue', ...legacy.dialogue }]
        : [];
    const connections: EntityConnection[] = [...(legacy.connections ?? [])];

    actions.forEach((action, index) => {
      const built = migrateAction(action, uniqueName(`mig-${legacy.id}-${index}`, occupied));
      if (built.logic) generated.push({ eid: newEid('logic'), kind: 'logic', def: built.logic, position: [0, 1, 0] });
      connections.push({ ...built.connection, delay: action.delay });
    });

    entity.def.connections = connections;
    delete legacy.actions;
    delete legacy.dialogue;
  }

  doc.entities.push(...generated);
  return doc;
}

function isLegacyTrigger(def: LegacyTriggerDef): boolean {
  return Array.isArray(def.actions) || def.dialogue !== undefined;
}

interface MigratedAction {
  logic: LogicEntityDefinition | null;
  connection: Omit<EntityConnection, 'delay'>;
}

function migrateAction(action: LegacyAction, name: string): MigratedAction {
  switch (action.kind) {
    case 'dialogue':
      return {
        logic: { kind: 'message', id: name, name, speaker: action.speaker, text: action.text, duration: action.duration },
        connection: { output: 'OnStartTouch', target: name, input: 'Show' },
      };
    case 'objective':
      return {
        logic: { kind: 'objective', id: name, name, text: action.text, completed: action.completed, marker: action.marker },
        connection: { output: 'OnStartTouch', target: name, input: 'Apply' },
      };
    case 'soundscape':
      return {
        logic: { kind: 'soundscape', id: name, name, soundscape: action.soundscape },
        connection: { output: 'OnStartTouch', target: name, input: 'Activate' },
      };
    case 'levelAction':
      return {
        logic: { kind: 'levelAction', id: name, name, action: action.action },
        connection: { output: 'OnStartTouch', target: name, input: 'Trigger' },
      };
    case 'spawnNpcs':
      return {
        logic: { kind: 'npcSpawner', id: name, name, npcs: action.npcs },
        connection: { output: 'OnStartTouch', target: name, input: 'Spawn' },
      };
    case 'endLevel':
      return {
        logic: {
          kind: 'changelevel',
          id: name,
          name,
          landmark: action.landmark
            ? normalizeLandmark(action.landmark)
            : undefined,
        },
        connection: { output: 'OnStartTouch', target: name, input: 'Trigger' },
      };
    case 'door':
      // La puerta ya existe: se apunta a ella por id, sin entidad lógica nueva.
      return {
        logic: null,
        connection: { output: 'OnStartTouch', target: action.doorId, input: action.open ? 'Open' : 'Close' },
      };
  }
}

function uniqueName(base: string, occupied: Set<string>): string {
  let candidate = base;
  let suffix = 2;
  while (occupied.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  occupied.add(candidate);
  return candidate;
}
