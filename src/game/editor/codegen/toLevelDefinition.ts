import type { LevelDefinition } from '@game/levels/LevelDefinition';
import { createMap } from '@game/levels/builders/MapCreator';
import type { EditorDocument } from '../EditorDocument';
import { buildProp } from '../propRuntime';

/**
 * Reconstruye un `LevelDefinition` desde el documento del editor, reusando
 * `createMap()` (que corre los builders de smart objects y valida ids unicos).
 * Lanza si hay ids duplicados — el caller debe capturar y avisar.
 */
export function toLevelDefinition(doc: EditorDocument): LevelDefinition {
  const map = createMap(doc.meta);
  if (doc.terrain) map.terrain(doc.terrain);

  for (const entity of doc.entities) {
    switch (entity.kind) {
      case 'staticBox':
        map.boxes(entity.def);
        break;
      case 'dynamicBox':
        map.dynamicBoxes(entity.def);
        break;
      case 'door':
        map.door(entity.def);
        break;
      case 'actionButton':
        map.actionButton(entity.def);
        break;
      case 'npc':
        map.npc(entity.def);
        break;
      case 'weaponPickup':
        map.pickup(entity.def);
        break;
      case 'itemPickup':
        map.item(entity.def);
        break;
      case 'ammoPickup':
        map.ammo(entity.def);
        break;
      case 'charger':
        map.charger(entity.def);
        break;
      case 'trigger':
        map.trigger(entity.def);
        break;
      case 'explosiveBarrel':
        map.explosiveBarrel(entity.def);
        break;
      case 'hazardVolume':
        map.hazardVolume(entity.def);
        break;
      case 'building':
        map.structure(entity.spec);
        break;
      case 'house':
        map.house(entity.spec);
        break;
      case 'ramp':
        map.ramp(entity.spec);
        break;
      case 'prop':
        map.prop(buildProp(entity.prop));
        break;
      case 'prebuiltBuilding':
        map.building(entity.artifact);
        break;
    }
  }

  return map.build();
}
