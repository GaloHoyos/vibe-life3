import type { VectorTuple } from '@shared/math/VectorTuple';
import { DefaultSoundscapeId } from '@game/config/audio.config';
import type { LogicEntityDefinition, LogicEntityKind } from '@game/script/EntityIOTypes';
import { newEid, type EditorEntity, type PropKind } from './EditorDocument';
import {
  AMMO_IDS,
  CHARACTER_IDS,
  CHARGER_KINDS,
  ITEM_IDS,
  LEVEL_ACTIONS,
  WEAPON_IDS,
} from './editorOptions';

/**
 * Tipos de entidad creables desde la paleta con `createEntity` (sin `prop`/
 * `prebuiltBuilding` ni `logic` — esos tienen factories propias).
 */
export type PaletteKind = Exclude<EditorEntity['kind'], 'prop' | 'prebuiltBuilding' | 'logic'>;

let lidCounter = Math.floor(Math.random() * 0xffff);

/** Id de nivel unico y legible para una entidad nueva. */
function lid(prefix: string): string {
  lidCounter += 1;
  return `${prefix}-${lidCounter.toString(36)}`;
}

export function createEntity(kind: PaletteKind, at: VectorTuple): EditorEntity {
  const [x, y, z] = at;
  switch (kind) {
    case 'staticBox':
      return { eid: newEid(kind), kind, def: { id: lid('box'), position: [x, y + 1, z], size: [2, 2, 2], material: 'concrete' } };
    case 'dynamicBox':
      return { eid: newEid(kind), kind, def: { id: lid('crate'), position: [x, y + 0.5, z], size: [1, 1, 1], mass: 18, material: 'crate' } };
    case 'door':
      return {
        eid: newEid(kind),
        kind,
        def: {
          id: lid('door'),
          position: [x, y + 1.1, z],
          size: [1.6, 2.2, 0.2],
          openOffset: [0, 2.2, 0],
          speed: 2,
          material: 'door',
          button: { id: lid('door-btn'), label: 'Abrir', position: [x + 1.1, y + 1.1, z], size: [0.3, 0.3, 0.12] },
        },
      };
    case 'actionButton':
      return { eid: newEid(kind), kind, def: { id: lid('action'), label: 'Accion', action: LEVEL_ACTIONS[0], position: [x, y + 1.1, z], size: [0.4, 0.4, 0.2] } };
    case 'npc':
      return { eid: newEid(kind), kind, def: { id: lid('npc'), position: [x, y, z], characterId: CHARACTER_IDS[0] ?? 'combine' } };
    case 'weaponPickup':
      return { eid: newEid(kind), kind, def: { id: lid('weapon'), weaponId: WEAPON_IDS[0], position: [x, y + 0.5, z] } };
    case 'itemPickup':
      return { eid: newEid(kind), kind, def: { id: lid('item'), itemId: ITEM_IDS[0], position: [x, y + 0.5, z] } };
    case 'ammoPickup':
      return { eid: newEid(kind), kind, def: { id: lid('ammo'), ammoId: AMMO_IDS[0], position: [x, y + 0.5, z] } };
    case 'charger':
      return { eid: newEid(kind), kind, def: { id: lid('charger'), kind: CHARGER_KINDS[0], position: [x, y, z], rotationY: 0 } };
    case 'trigger':
      return { eid: newEid(kind), kind, def: { id: lid('trigger'), position: [x, y + 1, z], size: [3, 2, 3], once: true, connections: [] } };
    case 'explosiveBarrel':
      return { eid: newEid(kind), kind, def: { id: lid('barrel'), position: [x, y, z] } };
    case 'hazardVolume':
      return { eid: newEid(kind), kind, def: { id: lid('hazard'), position: [x, y + 1, z], size: [4, 2, 4], kind: 'toxic', damagePerSecond: 15 } };
    case 'building':
      return {
        eid: newEid(kind),
        kind,
        spec: { id: lid('building'), center: [x, z], groundY: y, width: 8, depth: 8, storyHeight: 3, stories: [{ windows: 'auto' }, { windows: 'auto' }], roof: 'flat' },
      };
    case 'house':
      return { eid: newEid(kind), kind, spec: { id: lid('house'), center: [x, z], floorY: y, width: 6, depth: 6, height: 3 } };
    case 'ramp':
      return { eid: newEid(kind), kind, spec: { id: lid('ramp'), start: [x, z], end: [x, z + 4], startY: y, endY: y + 2, width: 2, steps: 6 } };
    case 'sequence': {
      const id = lid('seq');
      return { eid: newEid(kind), kind, def: { id, name: id, targetNpc: '', position: [x, y, z], moveMode: 'walk', steps: [], connections: [] } };
    }
  }
}

/** Crea una entidad lógica del entity I/O del sub-kind indicado. */
export function createLogicEntity(logicKind: LogicEntityKind, at: VectorTuple): EditorEntity {
  const [x, y, z] = at;
  const id = lid('io');
  const def = defaultLogicDef(logicKind, id, [x, y, z]);
  return { eid: newEid('logic'), kind: 'logic', def, position: [x, y + 1, z] };
}

function defaultLogicDef(kind: LogicEntityKind, id: string, at: VectorTuple): LogicEntityDefinition {
  switch (kind) {
    case 'relay':
      return { kind, id, name: id, connections: [] };
    case 'auto':
      return { kind, id, name: id, connections: [] };
    case 'timer':
      return { kind, id, name: id, interval: 5, connections: [] };
    case 'counter':
      return { kind, id, name: id, max: 3, connections: [] };
    case 'marker':
      return { kind, id, name: id, position: at };
    case 'message':
      return { kind, id, name: id, text: 'Texto', duration: 3, connections: [] };
    case 'objective':
      return { kind, id, name: id, text: 'Objetivo', connections: [] };
    case 'soundscape':
      return { kind, id, name: id, soundscape: DefaultSoundscapeId, connections: [] };
    case 'npcSpawner':
      return { kind, id, name: id, npcs: [], connections: [] };
    case 'levelAction':
      return { kind, id, name: id, action: LEVEL_ACTIONS[0], connections: [] };
    case 'changelevel':
      return { kind, id, name: id, connections: [] };
  }
}

/** Clona una entidad regenerando su eid y sus ids de nivel (evita duplicados). */
export function cloneEntity(entity: EditorEntity): EditorEntity {
  const c = structuredClone(entity);
  c.eid = newEid(c.kind);
  switch (c.kind) {
    case 'door':
      c.def.id = lid('door');
      c.def.button.id = lid('door-btn');
      break;
    case 'staticBox':
      c.def.id = lid('box');
      break;
    case 'dynamicBox':
      c.def.id = lid('crate');
      break;
    case 'actionButton':
      c.def.id = lid('action');
      break;
    case 'npc':
      c.def.id = lid('npc');
      break;
    case 'weaponPickup':
      c.def.id = lid('weapon');
      break;
    case 'itemPickup':
      c.def.id = lid('item');
      break;
    case 'ammoPickup':
      c.def.id = lid('ammo');
      break;
    case 'charger':
      c.def.id = lid('charger');
      break;
    case 'trigger':
      c.def.id = lid('trigger');
      break;
    case 'explosiveBarrel':
      c.def.id = lid('barrel');
      break;
    case 'hazardVolume':
      c.def.id = lid('hazard');
      break;
    case 'building':
    case 'house':
    case 'ramp':
      c.spec.id = lid(c.kind);
      break;
    case 'prop':
      c.prop.spec.id = lid('prop');
      break;
    case 'prebuiltBuilding': {
      const base = lid('building');
      c.artifact.id = base;
      c.artifact.boxes = c.artifact.boxes.map((b, i) => ({ ...b, id: `${base}-b${i}` }));
      break;
    }
    case 'logic': {
      const nid = lid('io');
      c.def.id = nid;
      c.def.name = nid;
      break;
    }
    case 'sequence': {
      const nid = lid('seq');
      c.def.id = nid;
      c.def.name = nid;
      break;
    }
  }
  return c;
}

export function createProp(prop: PropKind, at: VectorTuple): EditorEntity {
  const [x, y, z] = at;
  const eid = newEid('prop');
  switch (prop) {
    case 'crate':
      return { eid, kind: 'prop', prop: { prop, spec: { id: lid('crate'), at: [x, y, z], size: 0.9 } } };
    case 'crateStack':
      return { eid, kind: 'prop', prop: { prop, spec: { id: lid('stack'), at: [x, z], baseY: y, rows: 2, cols: 2, layers: 2 } } };
    case 'sandbagLine':
      return { eid, kind: 'prop', prop: { prop, spec: { id: lid('sandbags'), from: [x - 2, z], to: [x + 2, z], y } } };
    case 'coverWall':
      return { eid, kind: 'prop', prop: { prop, spec: { id: lid('cover'), at: [x, z], axis: 'x', length: 4, height: 1.3, y } } };
    case 'pillar':
      return { eid, kind: 'prop', prop: { prop, spec: { id: lid('pillar'), at: [x, z], height: 3, y } } };
    case 'cargoContainer':
      return { eid, kind: 'prop', prop: { prop, spec: { id: lid('container'), at: [x, z], axis: 'x', y } } };
    case 'watchtower':
      return { eid, kind: 'prop', prop: { prop, spec: { id: lid('tower'), at: [x, z], baseY: y } } };
  }
}
