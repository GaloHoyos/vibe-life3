import type { Disposable } from '@shared/types/lifecycle';
import type { PropKind } from '../EditorDocument';
import type { PaletteKind } from '../editorFactory';
import { iconSpan } from './editorIcons';
import { PALETTE_GROUPS } from './paletteCatalog';

export interface PaletteCallbacks {
  onAdd(kind: PaletteKind): void;
  onAddProp(prop: PropKind): void;
}

/** Paleta para agregar entidades en el punto enfocado por la camara. */
export class PaletteView implements Disposable {
  readonly element = document.createElement('div');

  constructor(callbacks: PaletteCallbacks) {
    this.element.className = 'editor-panel editor-palette';

    const title = document.createElement('h2');
    title.className = 'editor-panel__title';
    title.append(iconSpan('plus'));
    const titleText = document.createElement('span');
    titleText.textContent = 'Añadir';
    title.append(titleText);

    const body = document.createElement('div');
    body.className = 'editor-palette__body';

    for (const group of PALETTE_GROUPS) {
      const section = document.createElement('details');
      section.className = 'editor-palette__group';
      section.open = true;

      const summary = document.createElement('summary');
      summary.append(iconSpan(group.icon));
      const heading = document.createElement('span');
      heading.textContent = group.title;
      summary.append(heading);
      section.append(summary);

      const items = document.createElement('div');
      items.className = 'editor-palette__items';
      for (const item of group.items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'editor-button editor-button--add';
        button.append(iconSpan(item.icon));
        const label = document.createElement('span');
        label.textContent = item.label;
        button.append(label);
        button.addEventListener('click', () => {
          if ('prop' in item) callbacks.onAddProp(item.prop);
          else callbacks.onAdd(item.kind);
        });
        items.append(button);
      }
      section.append(items);
      body.append(section);
    }

    this.element.append(title, body);
  }

  dispose(): void {
    this.element.replaceChildren();
  }
}
