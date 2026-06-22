import type { Disposable } from '@shared/types/lifecycle';
import type { PropKind } from '../EditorDocument';
import type { PaletteKind } from '../editorFactory';

export interface PaletteCallbacks {
  onAdd(kind: PaletteKind): void;
  onAddProp(prop: PropKind): void;
}

interface Group {
  title: string;
  items: Array<{ label: string; kind: PaletteKind } | { label: string; prop: PropKind }>;
}

const GROUPS: Group[] = [
  {
    title: 'Geometria',
    items: [
      { label: 'Caja estatica', kind: 'staticBox' },
      { label: 'Caja dinamica', kind: 'dynamicBox' },
      { label: 'Rampa', kind: 'ramp' },
    ],
  },
  {
    title: 'Estructuras',
    items: [
      { label: 'Edificio', kind: 'building' },
      { label: 'Casa', kind: 'house' },
    ],
  },
  {
    title: 'Interactivo',
    items: [
      { label: 'Puerta', kind: 'door' },
      { label: 'Boton de accion', kind: 'actionButton' },
      { label: 'Cargador', kind: 'charger' },
      { label: 'Trigger', kind: 'trigger' },
    ],
  },
  {
    title: 'Entidades',
    items: [
      { label: 'NPC', kind: 'npc' },
      { label: 'Arma', kind: 'weaponPickup' },
      { label: 'Item', kind: 'itemPickup' },
    ],
  },
  {
    title: 'Props (cover)',
    items: [
      { label: 'Caja suelta', prop: 'crate' },
      { label: 'Pila de cajas', prop: 'crateStack' },
      { label: 'Linea de sacos', prop: 'sandbagLine' },
      { label: 'Muro de cobertura', prop: 'coverWall' },
      { label: 'Pilar', prop: 'pillar' },
      { label: 'Contenedor', prop: 'cargoContainer' },
      { label: 'Torre de vigilancia', prop: 'watchtower' },
    ],
  },
];

/** Paleta para agregar entidades en el punto enfocado por la camara. */
export class PaletteView implements Disposable {
  readonly element = document.createElement('div');

  constructor(callbacks: PaletteCallbacks) {
    this.element.className = 'editor-panel editor-palette';
    const title = document.createElement('h2');
    title.className = 'editor-panel__title';
    title.textContent = 'Agregar';
    this.element.append(title);

    for (const group of GROUPS) {
      const section = document.createElement('div');
      section.className = 'editor-palette__group';
      const heading = document.createElement('h4');
      heading.textContent = group.title;
      section.append(heading);
      for (const item of group.items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor-button editor-button--add';
        button.textContent = item.label;
        button.addEventListener('click', () => {
          if ('prop' in item) callbacks.onAddProp(item.prop);
          else callbacks.onAdd(item.kind);
        });
        section.append(button);
      }
      this.element.append(section);
    }
  }

  dispose(): void {
    this.element.replaceChildren();
  }
}
