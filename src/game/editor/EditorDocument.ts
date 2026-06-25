import type { MapMeta } from '@game/levels/builders/MapCreator';
import type {
  ActionButtonDefinition,
  ChargerDefinition,
  DoorDefinition,
  DynamicBoxDefinition,
  ItemPickupDefinition,
  NPCDefinition,
  StaticBoxDefinition,
  TerrainDefinition,
  TriggerDefinition,
  WeaponPickupDefinition,
} from '@game/levels/LevelDefinition';
import type { HazardVolumeDefinition } from '@game/levels/HazardVolumeSystem';
import type { ExplosiveBarrelDefinition } from '@game/gameplay/hazards/ExplosiveBarrel';
import type { BuildingSpec } from '@game/levels/builders/BuildingBuilder';
import type { HouseSpec } from '@game/levels/builders/HouseBuilder';
import type { RampSpec } from '@game/levels/builders/RampBuilder';
import type {
  ContainerSpec,
  CoverWallSpec,
  CrateSpec,
  CrateStackSpec,
  PillarSpec,
  SandbagLineSpec,
  WatchtowerSpec,
} from '@game/levels/builders/PropBuilder';
import type { BuildingArtifact } from '@game/levels/buildings/BuildingArtifact';

/**
 * Spec etiquetado de un prop del `PropBuilder`. Retiene los parametros para
 * re-editar el prop y regenerar su geometria (a diferencia de las cajas
 * ya aplanadas de un `LevelDefinition`).
 */
export type PropEntitySpec =
  | { prop: 'crate'; spec: CrateSpec }
  | { prop: 'crateStack'; spec: CrateStackSpec }
  | { prop: 'sandbagLine'; spec: SandbagLineSpec }
  | { prop: 'coverWall'; spec: CoverWallSpec }
  | { prop: 'pillar'; spec: PillarSpec }
  | { prop: 'cargoContainer'; spec: ContainerSpec }
  | { prop: 'watchtower'; spec: WatchtowerSpec };

export type PropKind = PropEntitySpec['prop'];

interface EditorEntityBase {
  /** Id estable del editor para seleccion/tracking, independiente del id del nivel. */
  eid: string;
  hidden?: boolean;
}

/**
 * Entidad del documento del editor. Las primitivas mapean 1:1 a los arrays de
 * `LevelDefinition`; los smart objects (`building`/`house`/`ramp`/`prop`)
 * retienen su spec para re-parametrizarse; `prebuiltBuilding` es un edificio
 * importado ya construido (movible/borrable, no re-parametrizable).
 */
export type EditorEntity = EditorEntityBase &
  (
    | { kind: 'staticBox'; def: StaticBoxDefinition }
    | { kind: 'dynamicBox'; def: DynamicBoxDefinition }
    | { kind: 'door'; def: DoorDefinition }
    | { kind: 'actionButton'; def: ActionButtonDefinition }
    | { kind: 'npc'; def: NPCDefinition }
    | { kind: 'weaponPickup'; def: WeaponPickupDefinition }
    | { kind: 'itemPickup'; def: ItemPickupDefinition }
    | { kind: 'charger'; def: ChargerDefinition }
    | { kind: 'trigger'; def: TriggerDefinition }
    | { kind: 'explosiveBarrel'; def: ExplosiveBarrelDefinition }
    | { kind: 'hazardVolume'; def: HazardVolumeDefinition }
    | { kind: 'building'; spec: BuildingSpec }
    | { kind: 'house'; spec: HouseSpec }
    | { kind: 'ramp'; spec: RampSpec }
    | { kind: 'prop'; prop: PropEntitySpec }
    | { kind: 'prebuiltBuilding'; artifact: BuildingArtifact }
  );

export type EditorEntityKind = EditorEntity['kind'];

export interface EditorDocument {
  meta: MapMeta;
  terrain?: TerrainDefinition;
  entities: EditorEntity[];
}

let eidCounter = Math.floor(Math.random() * 0xffff);

/** Genera un id de entidad de editor unico para la sesion. */
export function newEid(kind: EditorEntityKind): string {
  eidCounter += 1;
  return `${kind}-${eidCounter.toString(36)}`;
}

/** Clon profundo del documento (para snapshots de undo y duplicacion). */
export function cloneDocument(doc: EditorDocument): EditorDocument {
  return structuredClone(doc);
}

/** Documento vacio listo para empezar a editar. */
export function blankDocument(): EditorDocument {
  return {
    meta: {
      id: 'nuevo-nivel',
      title: 'Nuevo Nivel',
      background: 0x101820,
      playerStart: [0, 1.6, 6],
      audio: { ambiences: [], footstepSounds: [] },
    },
    entities: [
      {
        eid: newEid('staticBox'),
        kind: 'staticBox',
        def: { id: 'ground', position: [0, -0.5, 0], size: [40, 1, 40], material: 'floor' },
      },
    ],
  };
}

/** Id del nivel (def.id / spec.id) de la entidad, para mostrar en la UI. */
export function entityLevelId(entity: EditorEntity): string {
  switch (entity.kind) {
    case 'prop':
      return entity.prop.spec.id;
    case 'prebuiltBuilding':
      return entity.artifact.id;
    case 'building':
    case 'house':
    case 'ramp':
      return entity.spec.id;
    default:
      return entity.def.id;
  }
}

const KIND_LABELS: Record<EditorEntityKind, string> = {
  staticBox: 'Caja estatica',
  dynamicBox: 'Caja dinamica',
  door: 'Puerta',
  actionButton: 'Boton de accion',
  npc: 'NPC',
  weaponPickup: 'Arma',
  itemPickup: 'Item',
  charger: 'Cargador',
  trigger: 'Trigger',
  explosiveBarrel: 'Barril explosivo',
  hazardVolume: 'Kill-volume',
  building: 'Edificio',
  house: 'Casa',
  ramp: 'Rampa',
  prop: 'Prop',
  prebuiltBuilding: 'Edificio (importado)',
};

export function entityKindLabel(kind: EditorEntityKind): string {
  return KIND_LABELS[kind];
}
