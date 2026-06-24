import type { PropKind } from '../EditorDocument';
import type { PaletteKind } from '../editorFactory';
import type { EditorIconName } from './editorIcons';

/** Una entrada de la paleta: o crea una entidad (`kind`) o un prop (`prop`). */
export type PaletteEntry =
  | { label: string; icon: EditorIconName; kind: PaletteKind }
  | { label: string; icon: EditorIconName; prop: PropKind };

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
      { label: 'Item', icon: 'item', kind: 'itemPickup' },
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
