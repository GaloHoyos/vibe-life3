import type { Disposable } from '@shared/types/lifecycle';
import { getLevel, type LevelId } from '@game/levels/LevelRegistry';
import type { EditorUiBridge, LevelEditor } from '../LevelEditor';
import { PLAYER_START_EID } from '../EditorScene';
import { blankDocument, type PropKind } from '../EditorDocument';
import { createEntity, createProp, type PaletteKind } from '../editorFactory';
import { toLevelDefinition } from '../codegen/toLevelDefinition';
import { toTypeScript } from '../codegen/toTypeScript';
import { fromLevelDefinition } from '../codegen/fromLevelDefinition';
import { downloadText, pickJsonFile, saveDraft, setEditorMode } from '../persistence';
import { getLibraryMap, listLibraryMaps, saveLibraryMap } from '../mapLibrary';
import { EditorUIView } from './EditorUIView';
import type { EditorMenuCallbacks, ExportFormat } from './EditorMenuBar';
import { confirmDialog } from './EditorModal';
import { openPublishDialog } from './dialogs/PublishDialog';
import { openSaveLibraryDialog } from './dialogs/SaveLibraryDialog';
import { openExportDialog } from './dialogs/ExportDialog';
import { InspectorView } from './InspectorView';
import { LevelSettingsView } from './LevelSettingsView';
import { OutlinerView } from './OutlinerView';
import { PaletteView } from './PaletteView';

/**
 * Componente raiz de la UI del editor (patron Component+View). Implementa
 * `EditorUiBridge`: el nucleo (`LevelEditor`) lo llama ante cambios de seleccion
 * o documento, y la UI delega las acciones del usuario de vuelta al nucleo.
 * Las acciones sensibles (publicar/guardar/exportar/descartar) pasan por modales
 * de confirmacion en vez de ejecutarse al instante.
 */
export class EditorUI implements EditorUiBridge, Disposable {
  private readonly view: EditorUIView;
  private readonly palette: PaletteView;
  private readonly outliner: OutlinerView;
  private readonly inspector: InspectorView;
  private readonly settings: LevelSettingsView;

  constructor(root: HTMLElement, private readonly editor: LevelEditor) {
    this.palette = new PaletteView({
      onAdd: (kind) => this.addEntity(kind),
      onAddProp: (prop) => this.addProp(prop),
    });
    this.outliner = new OutlinerView({
      onSelect: (eid) => this.editor.select(eid),
      onDelete: (eid) => this.editor.removeEntity(eid),
      onToggleHidden: (eid) => this.toggleHidden(eid),
    });
    this.inspector = new InspectorView({
      getDocument: () => this.editor.getDocument(),
      onEntityChanged: (eid) => this.editor.onEntityEdited(eid),
      onPlayerStartChanged: () => this.editor.onMetaEdited(),
    });
    this.settings = new LevelSettingsView({
      getDocument: () => this.editor.getDocument(),
      onMetaChanged: () => this.editor.onMetaEdited(),
      onTerrainChanged: (terrain) => this.editor.setTerrain(terrain),
    });

    const callbacks: EditorMenuCallbacks = {
      onNew: () => this.newDocument(),
      onOpenRegistry: (levelId) => this.openRegistry(levelId),
      onOpenLibrary: (id) => this.openLibrary(id),
      onImportFile: () => this.importFile(),
      onSaveLibrary: () => this.saveLibrary(),
      onPublish: () => this.publishWorkshop(),
      onExport: (format) => this.exportFile(format),
      onExit: () => this.requestExit(),
      onUndo: () => this.editor.undo(),
      onRedo: () => this.editor.redo(),
      onDuplicate: () => this.duplicateSelected(),
      onDelete: () => this.deleteSelected(),
      onFocus: () => this.editor.focusSelection(),
      onAdd: (kind) => this.addEntity(kind),
      onAddProp: (prop) => this.addProp(prop),
      onToggleGrid: (visible) => this.editor.setGridVisible(visible),
      onToggleAxes: (visible) => this.editor.setAxesVisible(visible),
      onSnapChange: (step) => this.editor.setSnap(step),
      onOpenSettings: () => this.settings.open(),
      onValidate: () => this.validate(),
      onPlaytest: () => this.playtest(),
    };

    this.view = new EditorUIView(root, callbacks, {
      palette: this.palette.element,
      outliner: this.outliner.element,
      inspector: this.inspector.element,
      settings: this.settings.element,
    });

    window.addEventListener('keydown', this.onKeyDown);
  }

  onSelectionChange(eid: string | null): void {
    this.refreshInspector(eid);
    this.outliner.render(this.editor.getDocument(), eid);
  }

  onLiveTransform(): void {
    this.inspector.syncTransform();
  }

  onDocumentChange(): void {
    this.outliner.render(this.editor.getDocument(), this.editor.getSelectedEid());
    this.settings.refresh();
  }

  setVisible(visible: boolean): void {
    this.view.setVisible(visible);
    if (!visible) return;
    this.settings.refresh();
    this.refreshInspector(this.editor.getSelectedEid());
    this.outliner.render(this.editor.getDocument(), this.editor.getSelectedEid());
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.palette.dispose();
    this.outliner.dispose();
    this.inspector.dispose();
    this.settings.dispose();
    this.view.dispose();
  }

  // ---------------------------------------------------------------------------

  private refreshInspector(eid: string | null): void {
    if (!eid) {
      this.inspector.clear();
      return;
    }
    if (eid === PLAYER_START_EID) {
      this.inspector.showPlayerStart();
      return;
    }
    const entity = this.editor.getDocument().entities.find((e) => e.eid === eid);
    if (entity) this.inspector.showEntity(entity);
    else this.inspector.clear();
  }

  private addEntity(kind: PaletteKind): void {
    this.editor.addEntity(createEntity(kind, this.editor.getFocusPoint()));
  }

  private addProp(prop: PropKind): void {
    this.editor.addEntity(createProp(prop, this.editor.getFocusPoint()));
  }

  private toggleHidden(eid: string): void {
    const entity = this.editor.getDocument().entities.find((e) => e.eid === eid);
    if (entity) this.editor.setEntityHidden(eid, !(entity.hidden ?? false));
  }

  private duplicateSelected(): void {
    const eid = this.editor.getSelectedEid();
    if (eid && eid !== PLAYER_START_EID) this.editor.duplicateEntity(eid);
  }

  private deleteSelected(): void {
    const eid = this.editor.getSelectedEid();
    if (eid && eid !== PLAYER_START_EID) this.editor.removeEntity(eid);
  }

  /** Confirma descartar el trabajo de la sesion si hay cambios sin guardar. */
  private confirmDiscard(title: string, message: string): Promise<boolean> {
    if (!this.editor.isDirty()) return Promise.resolve(true);
    return confirmDialog({
      title,
      message,
      confirmLabel: 'Descartar y continuar',
      cancelLabel: 'Seguir editando',
      danger: true,
      host: this.view.element,
    });
  }

  private newDocument(): void {
    void this.confirmDiscard(
      'Nuevo mapa',
      'Se descartaran los cambios no guardados de esta sesion. ¿Empezar un mapa vacio?',
    ).then((ok) => {
      if (!ok) return;
      this.editor.loadDocument(blankDocument());
      this.view.toast('Nuevo mapa creado.', 'info');
    });
  }

  private openRegistry(levelId: string): void {
    void this.confirmDiscard('Abrir mapa', 'Se descartaran los cambios no guardados de esta sesion.').then((ok) => {
      if (!ok) return;
      try {
        this.editor.loadDocument(fromLevelDefinition(getLevel(levelId as LevelId)));
        this.view.toast(`Mapa "${levelId}" cargado.`, 'success');
      } catch (error) {
        this.view.toast(errorMessage(error), 'error');
      }
    });
  }

  private openLibrary(id: string): void {
    void this.confirmDiscard('Abrir mapa', 'Se descartaran los cambios no guardados de esta sesion.').then((ok) => {
      if (!ok) return;
      const doc = getLibraryMap(id);
      if (!doc) {
        this.view.toast('No se encontro el mapa en la biblioteca.', 'error');
        return;
      }
      this.editor.loadDocument(doc);
      this.view.toast(`Mapa "${doc.meta.title || id}" cargado.`, 'success');
    });
  }

  private importFile(): void {
    void this.confirmDiscard('Importar JSON', 'Se descartaran los cambios no guardados de esta sesion.').then((ok) => {
      if (!ok) return;
      pickJsonFile()
        .then((doc) => {
          this.editor.loadDocument(doc);
          this.view.toast('Documento importado.', 'success');
        })
        .catch((error: unknown) => {
          const message = errorMessage(error);
          if (message !== 'Sin archivo') this.view.toast(message, 'error');
        });
    });
  }

  private saveLibrary(): void {
    openSaveLibraryDialog({
      doc: this.editor.getDocument(),
      host: this.view.element,
      existingIds: listLibraryMaps().map((info) => info.id),
      save: (title, id) => {
        const doc = this.editor.getDocument();
        doc.meta.title = title;
        doc.meta.id = id;
        toLevelDefinition(doc); // valida ids unicos antes de guardar (puede lanzar)
        saveLibraryMap(doc);
        this.editor.markSaved();
        this.settings.refresh();
      },
      onSaved: (message) => this.view.toast(message, 'success'),
    });
  }

  private publishWorkshop(): void {
    openPublishDialog({
      doc: this.editor.getDocument(),
      host: this.view.element,
      available: this.editor.canPublish(),
      publish: (meta) => this.editor.requestPublish(this.editor.getDocument(), meta),
      onPublished: (message) => {
        this.editor.markSaved();
        this.view.toast(message, 'success');
      },
    });
  }

  private exportFile(format: ExportFormat): void {
    openExportDialog({
      doc: this.editor.getDocument(),
      host: this.view.element,
      format,
      export: (fmt, filename) => {
        const doc = this.editor.getDocument();
        if (fmt === 'ts') {
          toLevelDefinition(doc); // valida ids unicos antes de emitir (puede lanzar)
          downloadText(filename, toTypeScript(doc));
        } else {
          downloadText(filename, JSON.stringify(doc, null, 2), 'application/json');
        }
        this.editor.markSaved();
      },
      onExported: (message) => this.view.toast(message, 'success'),
    });
  }

  private validate(): void {
    try {
      toLevelDefinition(this.editor.getDocument());
      this.view.toast('Mapa valido: listo para probar o exportar.', 'success');
    } catch (error) {
      this.view.toast(`Validacion: ${errorMessage(error)}`, 'error');
    }
  }

  private requestExit(): void {
    void confirmDialog({
      title: 'Salir del editor',
      message: 'Tu borrador se guarda automaticamente. ¿Volver al menu principal?',
      confirmLabel: 'Salir',
      cancelLabel: 'Seguir editando',
      host: this.view.element,
    }).then((ok) => {
      if (ok) this.editor.requestExit();
    });
  }

  /** Valida, persiste el draft y recarga la pagina en modo playtest. */
  private playtest(): void {
    const doc = this.editor.getDocument();
    try {
      toLevelDefinition(doc); // valida ids unicos / builders antes de jugar
    } catch (error) {
      this.view.toast(`No se puede probar: ${errorMessage(error)}`, 'error');
      return;
    }
    saveDraft(doc);
    setEditorMode('playtest');
    window.location.reload();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.editor.isActive() || isTextInput(document.activeElement)) return;
    // No interceptar atajos mientras hay un modal o un menu abierto.
    if (document.querySelector('.editor-modal') || document.querySelector('.editor-menu.is-open')) return;

    if (event.code === 'Delete') {
      this.deleteSelected();
    } else if (event.code === 'KeyF') {
      this.editor.focusSelection();
    } else if (event.code === 'KeyN' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.newDocument();
    } else if (event.code === 'KeyD' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.duplicateSelected();
    } else if (event.code === 'KeyZ' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (event.shiftKey) this.editor.redo();
      else this.editor.undo();
    } else if (event.code === 'KeyY' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.editor.redo();
    }
  };
}

function isTextInput(element: Element | null): boolean {
  if (!element) return false;
  const tag = element.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
