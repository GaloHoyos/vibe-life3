import type { Disposable } from '@shared/types/lifecycle';
import type { EditorDocument } from '../EditorDocument';
import { entityKindLabel, entityLevelId } from '../EditorDocument';
import { PLAYER_START_EID } from '../EditorScene';

export interface OutlinerCallbacks {
  onSelect(eid: string): void;
  onDelete(eid: string): void;
  onToggleHidden(eid: string): void;
}

/** Jerarquia de entidades del nivel. Selecciona, oculta y borra. */
export class OutlinerView implements Disposable {
  readonly element = document.createElement('div');
  private readonly list = document.createElement('div');

  constructor(private readonly callbacks: OutlinerCallbacks) {
    this.element.className = 'editor-panel editor-outliner';
    const title = document.createElement('h2');
    title.className = 'editor-panel__title';
    title.textContent = 'Jerarquia';
    this.list.className = 'editor-outliner__list';
    this.element.append(title, this.list);
  }

  render(doc: EditorDocument, selectedEid: string | null): void {
    this.list.replaceChildren();

    this.list.append(
      this.row(PLAYER_START_EID, 'Spawn del jugador', 'jugador', selectedEid === PLAYER_START_EID, false),
    );

    for (const entity of doc.entities) {
      this.list.append(
        this.row(
          entity.eid,
          entityLevelId(entity),
          entityKindLabel(entity.kind),
          selectedEid === entity.eid,
          true,
          entity.hidden ?? false,
        ),
      );
    }
  }

  dispose(): void {
    this.element.replaceChildren();
  }

  private row(
    eid: string,
    label: string,
    tag: string,
    selected: boolean,
    deletable: boolean,
    hidden = false,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'editor-outliner__row';
    if (selected) row.classList.add('is-selected');

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'editor-outliner__name';
    const tagEl = document.createElement('span');
    tagEl.className = 'editor-outliner__tag';
    tagEl.textContent = tag;
    name.append(tagEl, document.createTextNode(` ${label}`));
    name.addEventListener('click', () => this.callbacks.onSelect(eid));
    row.append(name);

    if (deletable) {
      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'editor-outliner__icon';
      eye.textContent = hidden ? 'O' : '*';
      eye.title = hidden ? 'Mostrar' : 'Ocultar';
      eye.addEventListener('click', () => this.callbacks.onToggleHidden(eid));
      row.append(eye);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'editor-outliner__icon editor-outliner__icon--danger';
      del.textContent = 'X';
      del.title = 'Borrar';
      del.addEventListener('click', () => this.callbacks.onDelete(eid));
      row.append(del);
    }

    return row;
  }
}
