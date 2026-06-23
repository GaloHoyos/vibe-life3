import type { Disposable } from '@shared/types/lifecycle';
import { getAllLevels } from '@game/levels/LevelRegistry';
import { listLibraryMaps } from '../mapLibrary';
import type { PaletteKind } from '../editorFactory';
import type { PropKind } from '../EditorDocument';
import { iconSpan, type EditorIconName } from './editorIcons';
import { MenuButton, type MenuItem } from './EditorMenu';
import { PALETTE_GROUPS } from './paletteCatalog';

export type ExportFormat = 'json' | 'ts';

export interface EditorMenuCallbacks {
  onNew(): void;
  onOpenRegistry(levelId: string): void;
  onOpenLibrary(id: string): void;
  onImportFile(): void;
  onSaveLibrary(): void;
  onPublish(): void;
  onExport(format: ExportFormat): void;
  onExit(): void;
  onUndo(): void;
  onRedo(): void;
  onDuplicate(): void;
  onDelete(): void;
  onFocus(): void;
  onAdd(kind: PaletteKind): void;
  onAddProp(prop: PropKind): void;
  onToggleGrid(visible: boolean): void;
  onToggleAxes(visible: boolean): void;
  onSnapChange(step: number | null): void;
  onOpenSettings(): void;
  onValidate(): void;
  onPlaytest(): void;
}

const SNAP_PRESETS = [0.25, 0.5, 1, 2] as const;

/**
 * Barra de menus del editor: menus desplegables (Archivo/Editar/Añadir/Ver/
 * Mapa) a la izquierda y acciones rapidas (grilla/snap/Probar/Salir) a la
 * derecha. Es la fuente de verdad del estado de grilla/ejes/snap y lo mantiene
 * sincronizado entre los menus y la barra de acciones.
 */
export class EditorMenuBar implements Disposable {
  readonly element = document.createElement('div');
  private readonly menus: MenuButton[] = [];
  private readonly gridToggle = document.createElement('button');
  private readonly snapToggle = document.createElement('input');
  private readonly snapInput = document.createElement('input');

  private gridOn = true;
  private axesOn = true;
  private snapOn = false;
  private snapStep = 0.5;

  constructor(private readonly cb: EditorMenuCallbacks) {
    this.element.className = 'editor-menubar';

    const brand = document.createElement('div');
    brand.className = 'editor-menubar__brand';
    const lambda = document.createElement('span');
    lambda.className = 'editor-menubar__lambda';
    lambda.textContent = 'λ';
    const brandText = document.createElement('span');
    brandText.textContent = 'EDITOR';
    brand.append(lambda, brandText);

    const menus = document.createElement('div');
    menus.className = 'editor-menubar__menus';
    this.addMenu(menus, 'Archivo', () => this.fileItems());
    this.addMenu(menus, 'Editar', () => this.editItems());
    this.addMenu(menus, 'Añadir', () => this.addItems());
    this.addMenu(menus, 'Ver', () => this.viewItems());
    this.addMenu(menus, 'Mapa', () => this.mapItems());

    this.element.append(brand, menus, this.buildActions());
  }

  dispose(): void {
    for (const menu of this.menus) menu.dispose();
  }

  // ---------------------------------------------------------------------------

  private addMenu(host: HTMLElement, label: string, getItems: () => MenuItem[]): void {
    const menu = new MenuButton(label, getItems, { onOpen: () => this.closeOthers(menu) });
    menu.element.addEventListener('mouseenter', () => {
      if (!menu.isOpen() && this.menus.some((m) => m.isOpen())) menu.openMenu();
    });
    this.menus.push(menu);
    host.append(menu.element);
  }

  private closeOthers(except: MenuButton): void {
    for (const menu of this.menus) if (menu !== except) menu.close();
  }

  private fileItems(): MenuItem[] {
    const campaign: MenuItem[] = getAllLevels().map((level) => ({
      label: level.title,
      onClick: () => this.cb.onOpenRegistry(level.id),
    }));
    const library = listLibraryMaps().map((info) => ({
      label: info.title || info.id,
      onClick: () => this.cb.onOpenLibrary(info.id),
    }));
    return [
      { label: 'Nuevo', icon: 'file', accel: 'Ctrl+N', onClick: () => this.cb.onNew() },
      {
        label: 'Abrir mapa',
        icon: 'folder',
        submenu: [
          { label: 'Campaña', icon: 'folder', submenu: orEmpty(campaign, 'Sin niveles') },
          { label: 'Biblioteca', icon: 'folder', submenu: orEmpty(library, 'Sin mapas guardados') },
        ],
      },
      { label: 'Importar JSON…', icon: 'upload', onClick: () => this.cb.onImportFile() },
      { separator: true },
      { label: 'Guardar en biblioteca…', icon: 'save', onClick: () => this.cb.onSaveLibrary() },
      { label: 'Publicar en Workshop…', icon: 'globe', onClick: () => this.cb.onPublish() },
      {
        label: 'Exportar',
        icon: 'download',
        submenu: [
          { label: 'JSON…', icon: 'download', onClick: () => this.cb.onExport('json') },
          { label: 'TypeScript…', icon: 'download', onClick: () => this.cb.onExport('ts') },
        ],
      },
      { separator: true },
      { label: 'Salir del editor', icon: 'close', onClick: () => this.cb.onExit() },
    ];
  }

  private editItems(): MenuItem[] {
    return [
      { label: 'Deshacer', icon: 'undo', accel: 'Ctrl+Z', onClick: () => this.cb.onUndo() },
      { label: 'Rehacer', icon: 'redo', accel: 'Ctrl+Shift+Z', onClick: () => this.cb.onRedo() },
      { separator: true },
      { label: 'Duplicar', icon: 'copy', accel: 'Ctrl+D', onClick: () => this.cb.onDuplicate() },
      { label: 'Borrar', icon: 'trash', accel: 'Supr', danger: true, onClick: () => this.cb.onDelete() },
      { label: 'Enfocar seleccion', icon: 'target', accel: 'F', onClick: () => this.cb.onFocus() },
    ];
  }

  private addItems(): MenuItem[] {
    return PALETTE_GROUPS.map((group) => ({
      label: group.title,
      icon: group.icon,
      submenu: group.items.map((item) => ({
        label: item.label,
        icon: item.icon,
        onClick: () => ('kind' in item ? this.cb.onAdd(item.kind) : this.cb.onAddProp(item.prop)),
      })),
    }));
  }

  private viewItems(): MenuItem[] {
    return [
      { label: 'Grilla', icon: 'grid', checked: this.gridOn, onClick: () => this.setGrid(!this.gridOn) },
      { label: 'Ejes', icon: 'target', checked: this.axesOn, onClick: () => this.setAxes(!this.axesOn) },
      {
        label: 'Snap',
        icon: 'magnet',
        submenu: [
          { label: 'Desactivado', checked: !this.snapOn, onClick: () => this.setSnap(null) },
          ...SNAP_PRESETS.map((step) => ({
            label: `${step} m`,
            checked: this.snapOn && this.snapStep === step,
            onClick: () => this.setSnap(step),
          })),
        ],
      },
    ];
  }

  private mapItems(): MenuItem[] {
    return [
      { label: 'Configuracion del nivel', icon: 'gear', onClick: () => this.cb.onOpenSettings() },
      { label: 'Validar mapa', icon: 'check', onClick: () => this.cb.onValidate() },
      { separator: true },
      { label: 'Probar', icon: 'play', onClick: () => this.cb.onPlaytest() },
    ];
  }

  // --- Barra de acciones (derecha) ------------------------------------------

  private buildActions(): HTMLElement {
    const actions = document.createElement('div');
    actions.className = 'editor-menubar__actions';

    this.gridToggle.type = 'button';
    this.gridToggle.className = 'editor-actionbar__toggle is-on';
    this.gridToggle.append(iconSpan('grid'));
    const gridLabel = document.createElement('span');
    gridLabel.textContent = 'Grilla';
    this.gridToggle.append(gridLabel);
    this.gridToggle.addEventListener('click', () => this.setGrid(!this.gridOn));

    const snap = document.createElement('label');
    snap.className = 'editor-actionbar__snap';
    snap.append(iconSpan('magnet'));
    this.snapToggle.type = 'checkbox';
    this.snapInput.type = 'number';
    this.snapInput.step = '0.25';
    this.snapInput.min = '0';
    this.snapInput.value = String(this.snapStep);
    this.snapInput.className = 'editor-input editor-input--snap';
    const emitSnap = (): void =>
      this.setSnap(this.snapToggle.checked ? Number(this.snapInput.value) : null);
    this.snapToggle.addEventListener('change', emitSnap);
    this.snapInput.addEventListener('change', emitSnap);
    const snapText = document.createElement('span');
    snapText.textContent = 'Snap';
    snap.append(this.snapToggle, snapText, this.snapInput);

    const sep = document.createElement('span');
    sep.className = 'editor-actionbar__sep';

    actions.append(this.gridToggle, snap, sep, this.actionButton('Probar', 'play', 'primary', () => this.cb.onPlaytest()), this.actionButton('Salir', 'close', 'ghost', () => this.cb.onExit()));
    return actions;
  }

  private actionButton(
    label: string,
    icon: EditorIconName,
    variant: 'primary' | 'ghost',
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `editor-button editor-button--${variant}`;
    button.append(iconSpan(icon));
    const text = document.createElement('span');
    text.textContent = label;
    button.append(text);
    button.addEventListener('click', onClick);
    return button;
  }

  // --- State (sincroniza menus + barra) -------------------------------------

  private setGrid(on: boolean): void {
    this.gridOn = on;
    this.gridToggle.classList.toggle('is-on', on);
    this.cb.onToggleGrid(on);
  }

  private setAxes(on: boolean): void {
    this.axesOn = on;
    this.cb.onToggleAxes(on);
  }

  private setSnap(step: number | null): void {
    this.snapOn = step !== null;
    if (step !== null) this.snapStep = step;
    this.snapToggle.checked = this.snapOn;
    this.snapInput.value = String(this.snapStep);
    this.cb.onSnapChange(step);
  }
}

function orEmpty(items: MenuItem[], emptyLabel: string): MenuItem[] {
  return items.length > 0 ? items : [{ label: emptyLabel, disabled: true }];
}
