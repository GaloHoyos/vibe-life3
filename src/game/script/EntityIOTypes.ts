import type { VectorTuple } from '@shared/math/VectorTuple';
import type { LandmarkReference } from '@game/levels/LevelTransition';
import type { LevelActionKind } from '@game/GameEvents';
import type { SoundscapeId } from '@game/config/audio.config';
import type { NPCDefinition } from '@game/levels/LevelDefinition';

/**
 * Modelo de entity I/O estilo Source (Half-Life 2). Toda entidad con nombre
 * (`targetname`) puede emitir *outputs* y recibir *inputs*; una `EntityConnection`
 * ata un output de la fuente a un input de un target, con `delay` y límite de
 * refires. Es 100% serializable (datos, no closures) para viajar por niveles,
 * editor y Workshop.
 */

export type ConnectionParam = string | number | boolean;

export interface EntityConnection {
  /** Output de la entidad fuente (validado contra `EntityCatalog`). */
  output: string;
  /**
   * targetname destino, o keyword contextual (`!self`, `!activator`). Varias
   * entidades pueden compartir nombre → fan-out.
   */
  target: string;
  input: string;
  /** Valor que viaja al input (p.ej. cantidad de un counter, nombre de un marker). */
  param?: ConnectionParam;
  /** Segundos desde que el output dispara. Default 0 (inmediato). */
  delay?: number;
  /** Máximo de disparos de ESTA conexión. undefined = infinito; 1 = once. */
  maxFires?: number;
}

/** Campos comunes de toda entidad direccionable por I/O. */
export interface IOEntityFields {
  /**
   * targetname estilo Source. Si falta, el runtime usa `id` como nombre — así
   * los mapas no duplican strings. Varias entidades pueden compartir nombre.
   */
  name?: string;
  connections?: EntityConnection[];
}

/**
 * Entidades lógicas y de efecto sin representación física propia (equivalentes
 * a `logic_*`, `math_counter`, `env_message`, `point_template`, etc. de Source).
 */
export type LogicEntityDefinition =
  /** Reenvía/agrupa outputs. Deshabilitado rompe la cadena. */
  | {
      kind: 'relay';
      id: string;
      name: string;
      startDisabled?: boolean;
      /** Permite re-disparar antes de que venza la cadena anterior. */
      allowFastRetrigger?: boolean;
      /** Consume el relay después del primer Trigger aceptado. */
      triggerOnce?: boolean;
      connections?: EntityConnection[];
    }
  /** Dispara `OnMapSpawn` al cargar el nivel (logic_auto). */
  | { kind: 'auto'; id: string; name?: string; connections?: EntityConnection[] }
  /** Dispara `OnTimer` cada `interval` segundos mientras esté habilitado. */
  | { kind: 'timer'; id: string; name: string; interval: number; startDisabled?: boolean; connections?: EntityConnection[] }
  /** Acumulador: `Add`/`Subtract` → `OnHitMax` al alcanzar `max` (una vez hasta `Reset`). */
  | { kind: 'counter'; id: string; name: string; max: number; startValue?: number; connections?: EntityConnection[] }
  /** Punto con nombre (info_target): destino de move-to/escort/face. Sin inputs/outputs. */
  | { kind: 'marker'; id: string; name: string; position: VectorTuple }
  /** Línea de diálogo/subtítulo. Input `Show`. */
  | { kind: 'message'; id: string; name: string; text: string; speaker?: string; duration: number; connections?: EntityConnection[] }
  /** Actualiza el objetivo del HUD. Input `Apply`. */
  | { kind: 'objective'; id: string; name: string; text: string; completed?: boolean; marker?: VectorTuple; connections?: EntityConnection[] }
  /** Cambia el soundscape activo. Input `Activate`. */
  | { kind: 'soundscape'; id: string; name: string; soundscape: SoundscapeId; connections?: EntityConnection[] }
  /** Spawnea un grupo de NPCs. Input `Spawn` → output `OnSpawned`. */
  | { kind: 'npcSpawner'; id: string; name: string; npcs: NPCDefinition[]; connections?: EntityConnection[] }
  /** Acción de nivel (respawn de encuentros, arsenal). Input `Trigger`. */
  | { kind: 'levelAction'; id: string; name: string; action: LevelActionKind; connections?: EntityConnection[] }
  /** Salida de nivel estilo `info_landmark`. Input `Trigger`. */
  | { kind: 'changelevel'; id: string; name: string; landmark?: LandmarkReference; connections?: EntityConnection[] };

export type LogicEntityKind = LogicEntityDefinition['kind'];

/** Nombre efectivo (targetname) de una entidad IO-capaz: `name` o, si falta, `id`. */
export function effectiveName(def: { id: string; name?: string }): string {
  return def.name && def.name.length > 0 ? def.name : def.id;
}
