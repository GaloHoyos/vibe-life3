import type { EditorDocument } from '../../EditorDocument';
import { textField } from '../editorFields';
import { openModal } from '../EditorModal';
import { feedbackBox } from './dialogParts';

export interface SaveLibraryDialogOptions {
  doc: EditorDocument;
  host?: HTMLElement;
  /** Ids ya presentes en la biblioteca, para avisar de sobrescritura. */
  existingIds: readonly string[];
  /** Persiste el mapa con el nombre/id dados; puede lanzar (validacion de ids). */
  save: (title: string, id: string) => void;
  onSaved: (message: string) => void;
}

/** Modal para guardar en la biblioteca local: edita nombre/id y avisa si sobrescribe. */
export function openSaveLibraryDialog(options: SaveLibraryDialogOptions): void {
  const { doc } = options;
  const body = document.createElement('div');

  let title = doc.meta.title ?? '';
  let id = doc.meta.id ?? '';
  const titleField = textField('Nombre', title, (v) => (title = v));

  const idRow = document.createElement('div');
  idRow.className = 'editor-field';
  const idLabel = document.createElement('label');
  idLabel.className = 'editor-field__label';
  idLabel.textContent = 'Id';
  const idInput = document.createElement('input');
  idInput.type = 'text';
  idInput.className = 'editor-input';
  idInput.value = id;
  idRow.append(idLabel, idInput);

  const warn = feedbackBox('warn');
  const error = feedbackBox('error');
  const refreshWarn = (): void => {
    if (id && options.existingIds.includes(id)) {
      warn.show(`Ya existe un mapa con id «${id}»: se sobrescribira.`);
    } else {
      warn.hide();
    }
  };
  idInput.addEventListener('input', () => {
    id = idInput.value.trim();
    error.hide();
    refreshWarn();
  });
  refreshWarn();

  body.append(titleField.element, idRow, warn.element, error.element);

  openModal({
    title: 'Guardar en la biblioteca',
    subtitle: 'Tu mapa quedara disponible en "Mapas Personalizados".',
    icon: 'save',
    host: options.host,
    body,
    actions: [
      { label: 'Cancelar', variant: 'ghost', onClick: () => undefined },
      {
        label: 'Guardar',
        variant: 'primary',
        icon: 'save',
        onClick: () => {
          const cleanId = id.trim();
          if (!cleanId) {
            error.show('El id es obligatorio.');
            throw new Error('id vacío');
          }
          const cleanTitle = title.trim() || cleanId;
          try {
            options.save(cleanTitle, cleanId);
            options.onSaved(`Guardado en la biblioteca: "${cleanTitle}".`);
          } catch (err) {
            error.show(err instanceof Error ? err.message : 'Error al guardar.');
            throw err;
          }
        },
      },
    ],
  });
}
