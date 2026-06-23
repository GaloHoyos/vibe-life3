import type { Disposable } from '@shared/types/lifecycle';
import { EditorMenuBar, type EditorMenuCallbacks } from './EditorMenuBar';
import { iconSpan } from './editorIcons';

export interface EditorPanels {
  palette: HTMLElement;
  outliner: HTMLElement;
  inspector: HTMLElement;
  settings: HTMLElement;
}

export type ToastKind = 'success' | 'error' | 'info';

/**
 * Layout estructural del editor: menubar arriba, paleta a la izquierda,
 * outliner/inspector/settings a la derecha, status abajo. El centro queda
 * transparente a eventos para que el viewport (canvas) reciba el mouse.
 * Expone `element` como host de los modales (vive con la UI del editor).
 */
export class EditorUIView implements Disposable {
  readonly element = document.createElement('div');
  private readonly menuBar: EditorMenuBar;
  private readonly status = document.createElement('div');
  private readonly statusText = document.createElement('span');
  private readonly toasts = document.createElement('div');
  private readonly toastTimers = new Set<number>();

  constructor(container: HTMLElement, callbacks: EditorMenuCallbacks, panels: EditorPanels) {
    this.element.className = 'editor-ui is-hidden';

    this.menuBar = new EditorMenuBar(callbacks);

    const leftDock = document.createElement('div');
    leftDock.className = 'editor-dock editor-dock--left';
    leftDock.append(panels.palette);

    const rightDock = document.createElement('div');
    rightDock.className = 'editor-dock editor-dock--right';
    rightDock.append(panels.outliner, panels.inspector, panels.settings);

    this.status.className = 'editor-status';
    this.statusText.textContent = 'RMB: orbitar/volar · Rueda: zoom · LMB: seleccionar/mover';
    this.status.append(this.statusText);

    this.toasts.className = 'editor-toasts';

    this.element.append(this.menuBar.element, leftDock, rightDock, this.status, this.toasts);
    container.append(this.element);
  }

  setStatus(text: string): void {
    this.statusText.textContent = text;
  }

  toast(message: string, kind: ToastKind = 'info'): void {
    const el = document.createElement('div');
    el.className = `editor-toast editor-toast--${kind}`;
    el.append(iconSpan(kind === 'error' ? 'warning' : 'check'));
    const text = document.createElement('span');
    text.textContent = message;
    el.append(text);
    this.toasts.append(el);
    this.setStatus(message);

    const hide = window.setTimeout(() => {
      this.toastTimers.delete(hide);
      el.classList.add('is-leaving');
      const drop = window.setTimeout(() => {
        this.toastTimers.delete(drop);
        el.remove();
      }, 280);
      this.toastTimers.add(drop);
    }, 3000);
    this.toastTimers.add(hide);
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle('is-hidden', !visible);
  }

  dispose(): void {
    for (const timer of this.toastTimers) window.clearTimeout(timer);
    this.toastTimers.clear();
    this.menuBar.dispose();
    this.element.remove();
  }
}
