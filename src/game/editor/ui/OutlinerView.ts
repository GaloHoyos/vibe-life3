import type { Disposable } from '@shared/types/lifecycle';
import type { EditorDocument } from '../EditorDocument';
import { entityKindLabel, entityLevelId } from '../EditorDocument';
import { PLAYER_START_EID } from '../EditorScene';
import { entityIcon, iconSpan } from './editorIcons';

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
    title.append(iconSpan('folder'));
    const titleText = document.createElement('span');
    titleText.textContent = 'Jerarquia';
    title.append(titleText);

    const body = document.createElement('div');
    body.className = 'editor-panel__body';
    this.list.className = 'editor-outliner__list';
    body.append(this.list);

    this.element.append(title, body);
  }

  render(doc: EditorDocument, selectedEid: string | null): void {
    this.list.replaceChildren();

    this.list.append(
      this.row(
        PLAYER_START_EID,
        iconSpan('person'),
        'Spawn del jugador',
        'jugador',
        selectedEid === PLAYER_START_EID,
        false,
      ),
    );

    for (const entity of doc.entities) {
      this.list.append(
        this.row(
          entity.eid,
          entityIcon(entity.kind),
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
    icon: HTMLElement,
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
    const labelEl = document.createElement('span');
    labelEl.className = 'editor-outliner__label';
    labelEl.textContent = label;
    name.append(icon, labelEl);
    name.addEventListener('click', () => this.callbacks.onSelect(eid));
    row.append(name);

    const tagEl = document.createElement('span');
    tagEl.className = 'editor-outliner__tag';
    tagEl.textContent = tag;
    row.append(tagEl);

    if (deletable) {
      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = `editor-outliner__icon${hidden ? ' is-active' : ''}`;
      eye.append(iconSpan(hidden ? 'eyeOff' : 'eye'));
      eye.title = hidden ? 'Mostrar' : 'Ocultar';
      eye.addEventListener('click', () => this.callbacks.onToggleHidden(eid));
      row.append(eye);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'editor-outliner__icon editor-outliner__icon--danger';
      del.append(iconSpan('trash'));
      del.title = 'Borrar';
      del.addEventListener('click', () => this.callbacks.onDelete(eid));
      row.append(del);
    }

    return row;
  }
}
