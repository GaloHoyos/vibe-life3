import type { Disposable } from '@shared/types/lifecycle';
import { getLevel, type LevelId } from '@game/levels/LevelRegistry';
import type { EditorUiBridge, LevelEditor } from '../LevelEditor';
import { PLAYER_START_EID } from '../EditorScene';
import { blankDocument } from '../EditorDocument';
import { createEntity, createProp } from '../editorFactory';
import { toLevelDefinition } from '../codegen/toLevelDefinition';
import { toTypeScript } from '../codegen/toTypeScript';
import { fromLevelDefinition } from '../codegen/fromLevelDefinition';
import { downloadJson, downloadText, pickJsonFile, saveDraft, setEditorMode } from '../persistence';
import { EditorUIView } from './EditorUIView';
import { InspectorView } from './InspectorView';
import { LevelSettingsView } from './LevelSettingsView';
import { OutlinerView } from './OutlinerView';
import { PaletteView } from './PaletteView';

/**
 * Componente raiz de la UI del editor (patron Component+View). Implementa
 * `EditorUiBridge`: el nucleo (`LevelEditor`) lo llama ante cambios de seleccion
 * o documento, y la UI delega las acciones del usuario de vuelta al nucleo.
 */
export class EditorUI implements EditorUiBridge, Disposable {
  private readonly view: EditorUIView;
  private readonly palette: PaletteView;
  private readonly outliner: OutlinerView;
  private readonly inspector: InspectorView;
  private readonly settings: LevelSettingsView;

  constructor(root: HTMLElement, private readonly editor: LevelEditor) {
    this.palette = new PaletteView({
      onAdd: (kind) => this.editor.addEntity(createEntity(kind, this.editor.getFocusPoint())),
      onAddProp: (prop) => this.editor.addEntity(createProp(prop, this.editor.getFocusPoint())),
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
    this.view = new EditorUIView(
      root,
      {
        onExit: () => this.editor.requestExit(),
        onToggleGrid: (visible) => this.editor.setGridVisible(visible),
        onSnapChange: (step) => this.editor.setSnap(step),
        onFocus: () => this.editor.focusSelection(),
        onDuplicate: () => this.duplicateSelected(),
        onDelete: () => this.deleteSelected(),
        onNew: () => this.editor.loadDocument(blankDocument()),
        onExportJson: () => this.exportJson(),
        onExportTs: () => this.exportTs(),
        onImportFile: () => this.importFile(),
        onImportRegistry: (levelId) => this.importRegistry(levelId),
        onPlaytest: () => this.playtest(),
      },
      {
        palette: this.palette.element,
        outliner: this.outliner.element,
        inspector: this.inspector.element,
        settings: this.settings.element,
      },
    );

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

  private exportJson(): void {
    downloadJson(this.editor.getDocument());
    this.view.setStatus('JSON exportado.');
  }

  private exportTs(): void {
    const doc = this.editor.getDocument();
    try {
      toLevelDefinition(doc); // valida ids unicos antes de emitir
    } catch (error) {
      this.view.setStatus(`Error: ${errorMessage(error)}`);
      return;
    }
    downloadText(`${doc.meta.id || 'nivel'}.ts`, toTypeScript(doc));
    this.view.setStatus('TypeScript exportado.');
  }

  private importFile(): void {
    pickJsonFile()
      .then((doc) => {
        this.editor.loadDocument(doc);
        this.view.setStatus('Documento importado.');
      })
      .catch((error: unknown) => this.view.setStatus(`Error: ${errorMessage(error)}`));
  }

  private importRegistry(levelId: string): void {
    try {
      this.editor.loadDocument(fromLevelDefinition(getLevel(levelId as LevelId)));
      this.view.setStatus(`Mapa "${levelId}" cargado.`);
    } catch (error) {
      this.view.setStatus(`Error: ${errorMessage(error)}`);
    }
  }

  /** Valida, persiste el draft y recarga la pagina en modo playtest. */
  private playtest(): void {
    const doc = this.editor.getDocument();
    try {
      toLevelDefinition(doc); // valida ids unicos / builders antes de jugar
    } catch (error) {
      this.view.setStatus(`No se puede probar: ${errorMessage(error)}`);
      return;
    }
    saveDraft(doc);
    setEditorMode('playtest');
    window.location.reload();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.editor.isActive() || isTextInput(document.activeElement)) return;
    if (event.code === 'Delete') {
      this.deleteSelected();
    } else if (event.code === 'KeyF') {
      this.editor.focusSelection();
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
