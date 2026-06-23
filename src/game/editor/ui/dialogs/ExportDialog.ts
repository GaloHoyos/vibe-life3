import type { EditorDocument } from '../../EditorDocument';
import type { ExportFormat } from '../EditorMenuBar';
import { openModal } from '../EditorModal';
import { feedbackBox } from './dialogParts';

export interface ExportDialogOptions {
  doc: EditorDocument;
  host?: HTMLElement;
  format: ExportFormat;
  /** Descarga el archivo; puede lanzar (validacion al emitir TypeScript). */
  export: (format: ExportFormat, filename: string) => void;
  onExported: (message: string) => void;
}

const EXT: Record<ExportFormat, string> = { json: 'json', ts: 'ts' };

/** Modal para exportar a archivo: elige formato y nombre antes de descargar. */
export function openExportDialog(options: ExportDialogOptions): void {
  const { doc } = options;
  let format = options.format;
  const base = doc.meta.id || 'nivel';

  const body = document.createElement('div');

  const formatRow = document.createElement('div');
  formatRow.className = 'editor-field';
  const formatLabel = document.createElement('label');
  formatLabel.className = 'editor-field__label';
  formatLabel.textContent = 'Formato';
  const formatSelect = document.createElement('select');
  formatSelect.className = 'editor-input';
  for (const [value, label] of [
    ['json', 'JSON (.json)'],
    ['ts', 'TypeScript (.ts)'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    if (value === format) option.selected = true;
    formatSelect.append(option);
  }
  formatRow.append(formatLabel, formatSelect);

  const nameRow = document.createElement('div');
  nameRow.className = 'editor-field';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'editor-field__label';
  nameLabel.textContent = 'Archivo';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'editor-input';
  nameInput.value = `${base}.${EXT[format]}`;
  nameRow.append(nameLabel, nameInput);

  const error = feedbackBox('error');

  const stripExt = (name: string): string => name.replace(/\.(json|ts)$/i, '');
  formatSelect.addEventListener('change', () => {
    format = formatSelect.value === 'ts' ? 'ts' : 'json';
    nameInput.value = `${stripExt(nameInput.value) || base}.${EXT[format]}`;
    error.hide();
  });

  body.append(formatRow, nameRow, error.element);

  openModal({
    title: 'Exportar mapa',
    subtitle: 'Descarga el nivel como archivo para versionarlo o compartirlo.',
    icon: 'download',
    host: options.host,
    body,
    actions: [
      { label: 'Cancelar', variant: 'ghost', onClick: () => undefined },
      {
        label: 'Exportar',
        variant: 'primary',
        icon: 'download',
        onClick: () => {
          const name = nameInput.value.trim() || `${base}.${EXT[format]}`;
          const filename = /\.(json|ts)$/i.test(name) ? name : `${name}.${EXT[format]}`;
          try {
            options.export(format, filename);
            options.onExported(`Exportado: ${filename}.`);
          } catch (err) {
            error.show(err instanceof Error ? err.message : 'Error al exportar.');
            throw err;
          }
        },
      },
    ],
  });
}
