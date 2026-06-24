import type { EditorDocument } from '../../EditorDocument';
import type { PublishMeta } from '@game/workshop/WorkshopTypes';
import { splitList, textField, textareaField } from '../editorFields';
import { openModal } from '../EditorModal';
import { feedbackBox, summaryBox } from './dialogParts';

export interface PublishDialogOptions {
  doc: EditorDocument;
  host?: HTMLElement;
  /** `workshop.capabilities.publish`. */
  available: boolean;
  /** Sube el mapa; resuelve con un mensaje de exito o lanza con el motivo. */
  publish: (meta: PublishMeta) => Promise<string>;
  onPublished: (message: string) => void;
}

/**
 * Modal de configuracion para publicar en el Workshop: edita titulo/descripcion/
 * tags (pre-cargados del `meta`) y muestra un resumen antes de subir. Ya no se
 * publica al instante con tags vacios.
 */
export function openPublishDialog(options: PublishDialogOptions): void {
  const { doc } = options;

  if (!options.available) {
    const message = document.createElement('p');
    message.className = 'editor-modal__message';
    message.textContent =
      'El Workshop no esta configurado en esta build (falta VITE_WORKSHOP_API). No es posible publicar.';
    openModal({
      title: 'Publicar en el Workshop',
      icon: 'globe',
      host: options.host,
      body: message,
      actions: [{ label: 'Entendido', variant: 'primary', onClick: () => undefined }],
    });
    return;
  }

  const body = document.createElement('div');
  let title = doc.meta.title ?? '';
  let description = doc.meta.description ?? '';
  let tagsRaw = '';

  const titleField = textField('Titulo', title, (v) => (title = v));
  const descField = textareaField('Descripcion', description, (v) => (description = v), 4);
  const tagsField = textField('Tags', tagsRaw, (v) => (tagsRaw = v));
  const error = feedbackBox('error');

  body.append(
    titleField.element,
    descField.element,
    tagsField.element,
    summaryBox([
      ['Id del mapa', doc.meta.id || '(sin id)'],
      ['Entidades', String(doc.entities.length)],
      ['Terreno', doc.terrain ? 'Si' : 'No'],
    ]),
    error.element,
  );

  openModal({
    title: 'Publicar en el Workshop',
    subtitle: 'Revisa los datos del mapa antes de subirlo a la comunidad.',
    icon: 'globe',
    host: options.host,
    body,
    actions: [
      { label: 'Cancelar', variant: 'ghost', onClick: () => undefined },
      {
        label: 'Publicar',
        variant: 'primary',
        icon: 'globe',
        onClick: async () => {
          const cleanTitle = title.trim();
          if (!cleanTitle) {
            error.show('El titulo es obligatorio.');
            throw new Error('título vacío');
          }
          error.hide();
          // Persistimos titulo/descripcion en el doc para que queden en el draft.
          doc.meta.title = cleanTitle;
          doc.meta.description = description.trim() || undefined;
          const meta: PublishMeta = {
            title: cleanTitle,
            description: description.trim(),
            tags: splitList(tagsRaw),
            type: 'map',
          };
          try {
            const message = await options.publish(meta);
            options.onPublished(message);
          } catch (err) {
            error.show(err instanceof Error ? err.message : 'Error al publicar.');
            throw err;
          }
        },
      },
    ],
  });
}
