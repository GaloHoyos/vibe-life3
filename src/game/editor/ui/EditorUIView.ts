import type { Disposable } from '@shared/types/lifecycle';
import { getAllLevels } from '@game/levels/LevelRegistry';

export interface EditorViewCallbacks {
  onExit(): void;
  onToggleGrid(visible: boolean): void;
  onSnapChange(step: number | null): void;
  onFocus(): void;
  onDuplicate(): void;
  onDelete(): void;
  onNew(): void;
  onExportJson(): void;
  onExportTs(): void;
  onSaveLibrary(): void;
  onPublish(): void;
  onImportFile(): void;
  onImportRegistry(levelId: string): void;
  onPlaytest(): void;
}

export interface EditorPanels {
  palette: HTMLElement;
  outliner: HTMLElement;
  inspector: HTMLElement;
  settings: HTMLElement;
}

/**
 * Layout estructural del editor: toolbar arriba, paleta a la izquierda,
 * outliner/inspector/settings a la derecha, status abajo. El centro queda
 * transparente a eventos para que el viewport (canvas) reciba el mouse.
 */
export class EditorUIView implements Disposable {
  readonly element = document.createElement('div');
  private readonly status = document.createElement('div');
  private readonly snapStep = document.createElement('input');
  private readonly snapToggle = document.createElement('input');

  constructor(
    container: HTMLElement,
    private readonly callbacks: EditorViewCallbacks,
    panels: EditorPanels,
  ) {
    this.element.className = 'editor-ui is-hidden';

    const toolbar = document.createElement('div');
    toolbar.className = 'editor-toolbar';

    const brand = document.createElement('span');
    brand.className = 'editor-toolbar__brand';
    brand.textContent = 'EDITOR DE NIVELES';
    toolbar.append(brand, this.buildFileControls(), this.buildToolbarControls());

    const leftDock = document.createElement('div');
    leftDock.className = 'editor-dock editor-dock--left';
    leftDock.append(panels.palette);

    const rightDock = document.createElement('div');
    rightDock.className = 'editor-dock editor-dock--right';
    rightDock.append(panels.outliner, panels.inspector, panels.settings);

    this.status.className = 'editor-status';
    this.status.textContent = 'RMB: orbitar/volar · Rueda: zoom · LMB: seleccionar/mover';

    this.element.append(toolbar, leftDock, rightDock, this.status);
    container.append(this.element);
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle('is-hidden', !visible);
  }

  dispose(): void {
    this.element.remove();
  }

  private buildFileControls(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'editor-toolbar__group';

    const loadSelect = document.createElement('select');
    loadSelect.className = 'editor-input editor-input--load';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Cargar mapa...';
    loadSelect.append(placeholder);
    for (const level of getAllLevels()) {
      const option = document.createElement('option');
      option.value = level.id;
      option.textContent = level.title;
      loadSelect.append(option);
    }
    loadSelect.addEventListener('change', () => {
      if (loadSelect.value) {
        this.callbacks.onImportRegistry(loadSelect.value);
        loadSelect.value = '';
      }
    });

    group.append(
      toolbarButton('Nuevo', () => this.callbacks.onNew()),
      loadSelect,
      toolbarButton('Importar', () => this.callbacks.onImportFile()),
      toolbarButton('Guardar en biblioteca', () => this.callbacks.onSaveLibrary()),
      toolbarButton('Publicar en Workshop', () => this.callbacks.onPublish()),
      toolbarButton('Exportar JSON', () => this.callbacks.onExportJson()),
      toolbarButton('Exportar TS', () => this.callbacks.onExportTs()),
    );
    return group;
  }

  private buildToolbarControls(): HTMLElement {
    const group = document.createElement('div');
    group.className = 'editor-toolbar__group editor-toolbar__group--right';

    const gridToggle = labeledCheckbox('Grid', true, (v) => this.callbacks.onToggleGrid(v));
    group.append(gridToggle);

    const snapWrap = document.createElement('label');
    snapWrap.className = 'editor-toolbar__check';
    this.snapToggle.type = 'checkbox';
    this.snapStep.type = 'number';
    this.snapStep.step = '0.25';
    this.snapStep.min = '0';
    this.snapStep.value = '0.5';
    this.snapStep.className = 'editor-input editor-input--snap';
    const emitSnap = (): void =>
      this.callbacks.onSnapChange(this.snapToggle.checked ? Number(this.snapStep.value) : null);
    this.snapToggle.addEventListener('change', emitSnap);
    this.snapStep.addEventListener('change', emitSnap);
    const snapLabel = document.createElement('span');
    snapLabel.textContent = 'Snap';
    snapWrap.append(this.snapToggle, snapLabel, this.snapStep);
    group.append(snapWrap);

    group.append(
      toolbarButton('Enfocar', () => this.callbacks.onFocus()),
      toolbarButton('Duplicar', () => this.callbacks.onDuplicate()),
      toolbarButton('Borrar', () => this.callbacks.onDelete(), 'editor-button--danger'),
      toolbarButton('Probar', () => this.callbacks.onPlaytest(), 'editor-button--play'),
      toolbarButton('Salir', () => this.callbacks.onExit(), 'editor-button--exit'),
    );
    return group;
  }
}

function toolbarButton(label: string, onClick: () => void, extra = ''): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `editor-button${extra ? ` ${extra}` : ''}`;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function labeledCheckbox(
  label: string,
  checked: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'editor-toolbar__check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(input, span);
  return wrap;
}
