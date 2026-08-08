import type { PropKind } from '../EditorDocument';
import type { PaletteKind } from '../editorFactory';
import {
  PROP_ARCHETYPE_IDS,
  PropArchetypes,
  type PropArchetypeId,
} from '@game/config/props.config';
import type { LogicEntityKind } from '@game/script/EntityIOTypes';
import type { EditorIconName } from './editorIcons';

/**
 * Una entrada de la paleta: crea una entidad (`kind`), un smart object de
 * arquitectura (`prop`), un prop del catálogo (`propArchetype`) o una lógica de
 * I/O (`logic`).
 */
export type PaletteEntry =
  | { label: string; icon: EditorIconName; kind: PaletteKind }
  | { label: string; icon: EditorIconName; prop: PropKind }
  | { label: string; icon: EditorIconName; propArchetype: PropArchetypeId }
  | { label: string; icon: EditorIconName; logic: LogicEntityKind };

export interface PaletteGroup {
  title: string;
  icon: EditorIconName;
  items: PaletteEntry[];
}

/**
 * Catalogo de la paleta, compartido por el panel `PaletteView` y el menu
 * "Añadir" de la barra (`EditorMenuBar`) para no duplicar la lista.
 */
export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  {
    title: 'Geometria',
    icon: 'cube',
    items: [
      { label: 'Caja estatica', icon: 'cube', kind: 'staticBox' },
      { label: 'Caja dinamica', icon: 'cube', kind: 'dynamicBox' },
      { label: 'Rampa', icon: 'stairs', kind: 'ramp' },
    ],
  },
  {
    title: 'Estructuras',
    icon: 'building',
    items: [
      { label: 'Edificio', icon: 'building', kind: 'building' },
      { label: 'Casa', icon: 'house', kind: 'house' },
    ],
  },
  {
    title: 'Interactivo',
    icon: 'bolt',
    items: [
      { label: 'Puerta', icon: 'door', kind: 'door' },
      { label: 'Boton de accion', icon: 'bolt', kind: 'actionButton' },
      { label: 'Cargador', icon: 'bolt', kind: 'charger' },
      { label: 'Trigger', icon: 'target', kind: 'trigger' },
    ],
  },
  {
    title: 'Entidades',
    icon: 'person',
    items: [
      { label: 'NPC', icon: 'person', kind: 'npc' },
      { label: 'Arma', icon: 'weapon', kind: 'weaponPickup' },
      { label: 'Municion', icon: 'ammo', kind: 'ammoPickup' },
      { label: 'Item', icon: 'item', kind: 'itemPickup' },
    ],
  },
  {
    title: 'Props',
    icon: 'cube',
    // Derivado de la tabla: un arquetipo nuevo aparece solo en la paleta.
    items: PROP_ARCHETYPE_IDS.map((id) => ({
      label: PropArchetypes[id].displayName,
      icon: 'cube' as const,
      propArchetype: id,
    })),
  },
  {
    title: 'Peligros',
    icon: 'bolt',
    items: [
      { label: 'Barril explosivo', icon: 'cube', kind: 'explosiveBarrel' },
      { label: 'Kill-volume', icon: 'warning', kind: 'hazardVolume' },
    ],
  },
  {
    title: 'Vehículos',
    icon: 'gear',
    items: [
      { label: 'Vehículo', icon: 'gear', kind: 'vehicle' },
      { label: 'Waypoint vehicular', icon: 'target', kind: 'vehicleWaypoint' },
      { label: 'Volumen de agua', icon: 'grid', kind: 'waterVolume' },
      { label: 'Área navegable', icon: 'grid', kind: 'vehicleNavArea' },
      { label: 'Carril vehicular', icon: 'stairs', kind: 'vehicleNavLane' },
      { label: 'Marker vehicular', icon: 'target', kind: 'vehicleNavMarker' },
      { label: 'Checkpoint', icon: 'save', kind: 'checkpoint' },
    ],
  },
  {
    title: 'Logica (I/O)',
    icon: 'bolt',
    items: [
      { label: 'Secuencia', icon: 'person', kind: 'sequence' },
      { label: 'Relay', icon: 'bolt', logic: 'relay' },
      { label: 'Auto (al cargar)', icon: 'bolt', logic: 'auto' },
      { label: 'Timer', icon: 'bolt', logic: 'timer' },
      { label: 'Contador', icon: 'bolt', logic: 'counter' },
      { label: 'Marcador', icon: 'target', logic: 'marker' },
      { label: 'Mensaje', icon: 'bolt', logic: 'message' },
      { label: 'Objetivo', icon: 'target', logic: 'objective' },
      { label: 'Ambiente sonoro', icon: 'bolt', logic: 'soundscape' },
      { label: 'Fuente de sonido', icon: 'target', logic: 'ambientSound' },
      { label: 'Spawner de NPCs', icon: 'person', logic: 'npcSpawner' },
      { label: 'Accion de nivel', icon: 'bolt', logic: 'levelAction' },
      { label: 'Cambio de nivel', icon: 'bolt', logic: 'changelevel' },
    ],
  },
  {
    title: 'Props (cover)',
    icon: 'cube',
    items: [
      { label: 'Caja suelta', icon: 'cube', prop: 'crate' },
      { label: 'Pila de cajas', icon: 'cube', prop: 'crateStack' },
      { label: 'Linea de sacos', icon: 'cube', prop: 'sandbagLine' },
      { label: 'Muro de cobertura', icon: 'cube', prop: 'coverWall' },
      { label: 'Pilar', icon: 'cube', prop: 'pillar' },
      { label: 'Contenedor', icon: 'cube', prop: 'cargoContainer' },
      { label: 'Torre de vigilancia', icon: 'building', prop: 'watchtower' },
    ],
  },
];
