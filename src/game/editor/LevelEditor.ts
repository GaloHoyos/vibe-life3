import { AxesHelper, GridHelper, type Scene, Vector3 } from 'three';
import type { Time } from '@engine/core/Time';
import type { Input } from '@engine/input/Input';
import type { CameraSystem } from '@engine/render/CameraSystem';
import type { EnvironmentSystem } from '@engine/render/environment/EnvironmentSystem';
import type { LightingSystem } from '@engine/render/environment/LightingSystem';
import type { TerrainDefinition } from '@game/levels/LevelDefinition';
import type { PublishMeta } from '@game/workshop/WorkshopTypes';
import type { VectorTuple } from '@shared/math/VectorTuple';
import type { Disposable } from '@shared/types/lifecycle';
import { EditorCamera } from './EditorCamera';
import { EditorScene, PLAYER_START_EID } from './EditorScene';
import type { PropAssetRegistry } from '@game/assets/props/PropAssetRegistry';
import { EditorSelection, type TransformMode } from './EditorSelection';
import { getPosition, translateEntity } from './EditorEntityOps';
import { cloneEntity } from './editorFactory';
import { EditorUI } from './ui/EditorUI';
import { loadDraft, saveDraft } from './persistence';
import {
  blankDocument,
  cloneDocument,
  type EditorDocument,
  type EditorEntity,
} from './EditorDocument';

export interface LevelEditorCallbacks {
  /** Salir del editor de vuelta al menu principal. */
  onExit: () => void;
  /** Publicar el documento actual en el Workshop; resuelve con un mensaje de estado. */
  onPublish?: (doc: EditorDocument, meta: PublishMeta) => Promise<string>;
  /** Si el backend del Workshop esta configurado (habilita el form de publicar). */
  canPublish?: () => boolean;
}

/** Contrato que la UI del editor expone al nucleo para reaccionar a cambios. */
export interface EditorUiBridge extends Disposable {
  onSelectionChange(eid: string | null): void;
  onDocumentChange(): void;
  onLiveTransform(): void;
  setVisible(visible: boolean): void;
}

/**
 * Editor de niveles: estado dedicado del juego para componer `LevelDefinition`
 * visualmente. No corre fisica ni IA — es un preview liviano. La fisica real
 * solo existe al "Probar" (que recarga la pagina en modo playtest).
 */
export class LevelEditor implements Disposable {
  private active = false;
  /** Hubo cambios en esta sesion sin guardar a biblioteca/exportar/publicar. */
  private dirty = false;
  private doc: EditorDocument = blankDocument();
  private readonly undoStack: EditorDocument[] = [];
  private readonly redoStack: EditorDocument[] = [];
  private previous: EditorDocument = cloneDocument(this.doc);
  private readonly editorCamera: EditorCamera;
  private readonly editorScene: EditorScene;
  private readonly selection: EditorSelection;
  private readonly ui: EditorUiBridge;
  private readonly grid: GridHelper;
  private readonly axes: AxesHelper;

  constructor(
    root: HTMLElement,
    private readonly scene: Scene,
    camera: CameraSystem,
    canvas: HTMLCanvasElement,
    private readonly input: Input,
    private readonly environment: EnvironmentSystem,
    private readonly lighting: LightingSystem,
    private readonly callbacks: LevelEditorCallbacks,
    propAssets: PropAssetRegistry | null = null,
  ) {
    this.editorCamera = new EditorCamera(camera.camera, canvas);
    this.editorScene = new EditorScene(scene, propAssets);
    this.selection = new EditorSelection(scene, camera.camera, canvas, this.editorScene, {
      getEntity: (eid) => this.doc.entities.find((e) => e.eid === eid),
      getDocument: () => this.doc,
      onSelectionChange: (eid) => this.ui.onSelectionChange(eid),
      onTransformStart: () => undefined,
      onTransformLive: () => this.ui.onLiveTransform(),
      onTransformEnd: () => this.changed(),
    });
    this.grid = new GridHelper(120, 120, 0x2c6e7a, 0x1b2a30);
    this.grid.name = 'editor-grid';
    this.axes = new AxesHelper(2);
    this.axes.name = 'editor-axes';
    this.ui = new EditorUI(root, this);
  }

  isActive(): boolean {
    return this.active;
  }

  /** Si hay cambios sin persistir (para confirmar antes de descartar). */
  isDirty(): boolean {
    return this.dirty;
  }

  /** Marca el documento como guardado (tras exportar/guardar/publicar). */
  markSaved(): void {
    this.dirty = false;
  }

  getDocument(): EditorDocument {
    return this.doc;
  }

  getSelectedEid(): string | null {
    return this.selection.getSelectedEid();
  }

  select(eid: string | null): void {
    this.selection.select(eid);
  }

  setSnap(step: number | null): void {
    this.selection.setSnap(step);
  }

  setTransformMode(mode: TransformMode): void {
    this.selection.setMode(mode);
  }

  getTransformMode(): TransformMode {
    return this.selection.getMode();
  }

  setGridVisible(visible: boolean): void {
    this.grid.visible = visible;
  }

  setAxesVisible(visible: boolean): void {
    this.axes.visible = visible;
  }

  /** Punto donde la camara esta enfocada (para colocar entidades nuevas). */
  getFocusPoint(): VectorTuple {
    const t = this.editorCamera.getTarget();
    return [t.x, t.y, t.z];
  }

  /**
   * Punto de colocacion para entidades nuevas: el foco de camara con la Y
   * asentada sobre la superficie (staticBox, p.ej. el suelo) que haya bajo el
   * cursor. `grounded` indica si encontro apoyo — el caller lo usa para decidir
   * si un edificio necesita losa propia (queda flotando = sin apoyo).
   */
  getPlacement(): { point: VectorTuple; grounded: boolean } {
    const [x, fy, z] = this.getFocusPoint();
    let top = -Infinity;
    for (const e of this.doc.entities) {
      if (e.kind !== 'staticBox') continue;
      const [px, py, pz] = e.def.position;
      const [sx, sy, sz] = e.def.size;
      if (Math.abs(x - px) > sx / 2 || Math.abs(z - pz) > sz / 2) continue;
      const surfaceY = py + sy / 2;
      if (surfaceY <= fy + 0.5 && surfaceY > top) top = surfaceY;
    }
    if (top === -Infinity) return { point: [x, fy, z], grounded: false };
    return { point: [x, top, z], grounded: true };
  }

  selectedEntity(): EditorEntity | undefined {
    const eid = this.getSelectedEid();
    return eid ? this.doc.entities.find((e) => e.eid === eid) : undefined;
  }

  addEntity(entity: EditorEntity): void {
    this.doc.entities.push(entity);
    if (this.active) this.editorScene.addEntity(entity);
    this.select(entity.eid);
    this.changed();
  }

  removeEntity(eid: string): void {
    const index = this.doc.entities.findIndex((e) => e.eid === eid);
    if (index < 0) return;
    this.doc.entities.splice(index, 1);
    this.editorScene.removeEntity(eid);
    if (this.getSelectedEid() === eid) this.select(null);
    this.changed();
  }

  duplicateEntity(eid: string): void {
    const entity = this.doc.entities.find((e) => e.eid === eid);
    if (!entity) return;
    const clone = cloneEntity(entity);
    translateEntity(clone, 1, 0, 1);
    this.addEntity(clone);
  }

  setEntityHidden(eid: string, hidden: boolean): void {
    const entity = this.doc.entities.find((e) => e.eid === eid);
    if (!entity) return;
    entity.hidden = hidden;
    this.editorScene.setVisible(eid, !hidden);
    this.changed();
  }

  /** Tras editar la def/spec en sitio desde el inspector: re-arma el preview. */
  onEntityEdited(eid: string): void {
    const entity = this.doc.entities.find((e) => e.eid === eid);
    if (entity && this.active) this.editorScene.rebuildEntity(entity);
    this.selection.refresh();
    this.changed();
  }

  /** Tras editar el meta del nivel (settings): aplica entorno + spawn. */
  onMetaEdited(): void {
    if (this.active) {
      this.applyEnvironment();
      this.editorScene.rebuildPlayerStart(this.doc);
      this.selection.refresh();
    }
    this.changed();
  }

  setTerrain(terrain: TerrainDefinition | undefined): void {
    this.doc.terrain = terrain;
    if (this.active) this.editorScene.rebuildTerrain(this.doc);
    this.changed();
  }

  undo(): void {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.redoStack.push(cloneDocument(this.doc));
    this.applySnapshot(snap);
  }

  redo(): void {
    const snap = this.redoStack.pop();
    if (!snap) return;
    this.undoStack.push(cloneDocument(this.doc));
    this.applySnapshot(snap);
  }

  focusSelection(): void {
    const entity = this.selectedEntity();
    if (entity) {
      const p = getPosition(entity);
      this.editorCamera.focusOn(new Vector3(p[0], p[1], p[2]));
    } else if (this.getSelectedEid() === PLAYER_START_EID) {
      const [x, y, z] = this.doc.meta.playerStart;
      this.editorCamera.focusOn(new Vector3(x, y, z));
    }
  }

  enter(doc?: EditorDocument): void {
    if (this.active) return;
    this.active = true;
    const next = doc ?? loadDraft();
    if (next) this.doc = next;
    this.resetHistory();
    this.dirty = false;

    this.scene.add(this.grid, this.axes);
    this.editorCamera.attach();
    this.applyEnvironment();
    this.editorScene.mount(this.doc);
    this.selection.attach();
    this.ui.setVisible(true);
    this.ui.onDocumentChange();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.ui.setVisible(false);
    this.selection.detach();
    this.editorCamera.detach();
    this.editorScene.clear();
    this.scene.remove(this.grid, this.axes);
  }

  /** Reemplaza el documento y re-monta el preview (si esta activo). */
  loadDocument(doc: EditorDocument): void {
    this.doc = doc;
    this.resetHistory();
    this.dirty = false;
    saveDraft(this.doc);
    if (this.active) {
      this.applyEnvironment();
      this.editorScene.mount(this.doc);
      this.selection.select(null);
      this.ui.onDocumentChange();
    }
  }

  requestExit(): void {
    this.callbacks.onExit();
  }

  canPublish(): boolean {
    return this.callbacks.canPublish?.() ?? false;
  }

  requestPublish(doc: EditorDocument, meta: PublishMeta): Promise<string> {
    if (!this.callbacks.onPublish) {
      return Promise.reject(new Error("Publicar en el Workshop no esta disponible."));
    }
    return this.callbacks.onPublish(doc, meta);
  }

  update(time: Time): void {
    if (!this.active) return;
    this.editorCamera.update(this.input, time.delta);
    this.selection.update();
  }

  /** Persiste el draft, registra el snapshot de undo y notifica a la UI. */
  private changed(): void {
    this.dirty = true;
    this.recordHistory();
    saveDraft(this.doc);
    this.ui.onDocumentChange();
  }

  private recordHistory(): void {
    this.undoStack.push(this.previous);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.previous = cloneDocument(this.doc);
    this.redoStack.length = 0;
  }

  private resetHistory(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.previous = cloneDocument(this.doc);
  }

  private applySnapshot(snapshot: EditorDocument): void {
    this.doc = cloneDocument(snapshot);
    this.previous = cloneDocument(this.doc);
    this.dirty = true;
    saveDraft(this.doc);
    if (this.active) {
      this.applyEnvironment();
      this.editorScene.mount(this.doc);
      this.selection.select(null);
    }
    this.ui.onDocumentChange();
  }

  private applyEnvironment(): void {
    void this.environment.applySkybox(
      this.scene,
      this.doc.meta.skybox ?? 'default',
      this.doc.meta.background,
    );
    this.lighting.configureSun(this.doc.meta.sun);
  }

  dispose(): void {
    this.exit();
    this.ui.dispose();
    this.selection.dispose();
    this.editorScene.dispose();
    this.grid.dispose();
    this.axes.dispose();
  }
}
