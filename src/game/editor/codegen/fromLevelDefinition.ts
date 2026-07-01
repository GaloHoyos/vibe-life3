import type { LevelDefinition } from '@game/levels/LevelDefinition';
import type { MapMeta } from '@game/levels/builders/MapCreator';
import { newEid, type EditorDocument, type EditorEntity } from '../EditorDocument';

/**
 * Convierte un `LevelDefinition` (ya construido) en un `EditorDocument`. Las
 * primitivas mapean 1:1; los edificios entran como `prebuiltBuilding` (movibles
 * y borrables, pero no re-parametrizables — para eso, autorear como JSON nativo
 * del editor o reconstruir con la herramienta de edificio). Clona todo para no
 * mutar el `LevelRegistry` compartido.
 */
export function fromLevelDefinition(level: LevelDefinition): EditorDocument {
  const meta: MapMeta = {
    id: level.id,
    title: level.title,
    description: level.description,
    nextLevel: level.nextLevel,
    entryLandmark: level.entryLandmark ? [...level.entryLandmark] : undefined,
    objective: level.objective ? structuredClone(level.objective) : undefined,
    background: level.background,
    skybox: level.skybox,
    sun: level.sun,
    playerStart: [...level.playerStart],
    audio: structuredClone(level.audio),
  };

  const entities: EditorEntity[] = [];
  const clone = <T>(value: T): T => structuredClone(value);

  for (const def of level.staticBoxes) entities.push({ eid: newEid('staticBox'), kind: 'staticBox', def: clone(def) });
  for (const artifact of level.buildings ?? []) entities.push({ eid: newEid('prebuiltBuilding'), kind: 'prebuiltBuilding', artifact: clone(artifact) });
  for (const def of level.dynamicBoxes) entities.push({ eid: newEid('dynamicBox'), kind: 'dynamicBox', def: clone(def) });
  for (const def of level.doors) entities.push({ eid: newEid('door'), kind: 'door', def: clone(def) });
  for (const def of level.actionButtons ?? []) entities.push({ eid: newEid('actionButton'), kind: 'actionButton', def: clone(def) });
  for (const def of level.npcs) entities.push({ eid: newEid('npc'), kind: 'npc', def: clone(def) });
  for (const def of level.weaponPickups) entities.push({ eid: newEid('weaponPickup'), kind: 'weaponPickup', def: clone(def) });
  for (const def of level.itemPickups ?? []) entities.push({ eid: newEid('itemPickup'), kind: 'itemPickup', def: clone(def) });
  for (const def of level.ammoPickups ?? []) entities.push({ eid: newEid('ammoPickup'), kind: 'ammoPickup', def: clone(def) });
  for (const def of level.chargers ?? []) entities.push({ eid: newEid('charger'), kind: 'charger', def: clone(def) });
  for (const def of level.triggers) entities.push({ eid: newEid('trigger'), kind: 'trigger', def: clone(def) });
  for (const def of level.explosiveBarrels ?? []) entities.push({ eid: newEid('explosiveBarrel'), kind: 'explosiveBarrel', def: clone(def) });
  for (const def of level.hazardVolumes ?? []) entities.push({ eid: newEid('hazardVolume'), kind: 'hazardVolume', def: clone(def) });

  return {
    meta,
    terrain: level.terrain ? clone(level.terrain) : undefined,
    entities,
  };
}
