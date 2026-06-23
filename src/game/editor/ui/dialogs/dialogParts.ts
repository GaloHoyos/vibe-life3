import { iconSpan } from '../editorIcons';

export interface FeedbackBox {
  element: HTMLElement;
  show(message: string): void;
  hide(): void;
}

/** Caja de feedback inline para un modal (error rojo o aviso ambar), oculta al inicio. */
export function feedbackBox(kind: 'error' | 'warn'): FeedbackBox {
  const element = document.createElement('div');
  element.className = `editor-modal__${kind} is-hidden`;
  element.append(iconSpan('warning'));
  const text = document.createElement('span');
  element.append(text);
  return {
    element,
    show(message: string) {
      text.textContent = message;
      element.classList.remove('is-hidden');
    },
    hide() {
      element.classList.add('is-hidden');
    },
  };
}

/** Lista descriptiva read-only (clave → valor) para resumenes en modales. */
export function summaryBox(rows: ReadonlyArray<readonly [string, string]>): HTMLElement {
  const dl = document.createElement('dl');
  dl.className = 'editor-modal__summary';
  for (const [key, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  return dl;
}
