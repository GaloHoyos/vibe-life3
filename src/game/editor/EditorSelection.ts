import {
  BoxHelper,
  type PerspectiveCamera,
  Raycaster,
  type Scene,
  Vector2,
  Vector3,
} from 'three';
import type { EditorDocument, EditorEntity } from './EditorDocument';
import { EditorScene, PLAYER_START_EID } from './EditorScene';
import { getPosition, rotateEntity, translateEntity } from './EditorEntityOps';
import { TranslateGizmo } from './TranslateGizmo';
import { RotateGizmo } from './RotateGizmo';

export type TransformMode = 'translate' | 'rotate';

/** Puente del seleccionador hacia el documento y el resto del editor. */
export interface SelectionHost {
  getEntity(eid: string): EditorEntity | undefined;
  getDocument(): EditorDocument;
  onSelectionChange(eid: string | null): void;
  /** Antes de empezar a arrastrar (para snapshot de undo). */
  onTransformStart(): void;
  /** Durante el arrastre (para refrescar el inspector en vivo). */
  onTransformLive(): void;
  /** Al soltar (commit). */
  onTransformEnd(): void;
}

/**
 * Seleccion por raycast (boton izquierdo) + gizmo de traslacion. El boton
 * derecho/medio quedan para la camara. Escribe los cambios de transform al
 * documento via `EditorEntityOps` y re-ancla el preview al soltar.
 */
export class EditorSelection {
  private readonly raycaster = new Raycaster();
  private readonly gizmo = new TranslateGizmo();
  private readonly rotateGizmo = new RotateGizmo();
  private mode: TransformMode = 'translate';
  private selectedEid: string | null = null;
  private highlight: BoxHelper | null = null;
  private dragLast: Vector3 | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    private readonly editorScene: EditorScene,
    private readonly host: SelectionHost,
  ) {}

  attach(): void {
    this.gizmo.attach(this.scene);
    this.rotateGizmo.attach(this.scene);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
  }

  detach(): void {
    this.selectedEid = null;
    this.clearHighlight();
    this.gizmo.setTarget(null);
    this.rotateGizmo.setTarget(null);
    this.gizmo.detach(this.scene);
    this.rotateGizmo.detach(this.scene);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  getSelectedEid(): string | null {
    return this.selectedEid;
  }

  setSnap(step: number | null): void {
    this.gizmo.setSnap(step);
  }

  getMode(): TransformMode {
    return this.mode;
  }

  setMode(mode: TransformMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.refresh();
  }

  /** Gizmo del modo activo (rotacion no aplica al spawn del jugador). */
  private activeGizmo(): TranslateGizmo | RotateGizmo {
    return this.mode === 'rotate' ? this.rotateGizmo : this.gizmo;
  }

  /** Por frame: tamano del gizmo + caja de seleccion. */
  update(): void {
    this.gizmo.update(this.camera);
    this.rotateGizmo.update(this.camera);
    this.highlight?.update();
  }

  /** Selecciona por eid (desde el viewport o el outliner) o deselecciona. */
  select(eid: string | null): void {
    this.selectedEid = eid;
    this.refresh();
    this.host.onSelectionChange(eid);
  }

  /** Re-sincroniza gizmo/caja tras cambios externos (inspector, rebuild). */
  refresh(): void {
    this.clearHighlight();
    const pos = this.selectionPosition();
    const obj = this.selectedEid ? this.editorScene.getObject(this.selectedEid) : undefined;
    if (!pos || !obj) {
      this.gizmo.setTarget(null);
      this.rotateGizmo.setTarget(null);
      return;
    }
    // La rotacion no aplica al spawn del jugador (solo posicion).
    const canRotate = this.mode === 'rotate' && this.selectedEid !== PLAYER_START_EID;
    this.gizmo.setTarget(canRotate ? null : pos);
    this.rotateGizmo.setTarget(canRotate ? pos : null);
    this.highlight = new BoxHelper(obj, 0x37d67a);
    this.highlight.renderOrder = 998;
    this.scene.add(this.highlight);
  }

  dispose(): void {
    this.clearHighlight();
    this.gizmo.dispose();
    this.rotateGizmo.dispose();
  }

  // ---------------------------------------------------------------------------

  private selectionPosition(): Vector3 | null {
    if (!this.selectedEid) return null;
    if (this.selectedEid === PLAYER_START_EID) {
      const [x, y, z] = this.host.getDocument().meta.playerStart;
      return new Vector3(x, y, z);
    }
    const entity = this.host.getEntity(this.selectedEid);
    if (!entity) return null;
    const p = getPosition(entity);
    return new Vector3(p[0], p[1], p[2]);
  }

  private clearHighlight(): void {
    if (!this.highlight) return;
    this.scene.remove(this.highlight);
    this.highlight.dispose();
    this.highlight = null;
  }

  private setRayFromEvent(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.setRayFromEvent(event);

    if (this.selectedEid && this.activeGizmo().beginDrag(this.raycaster)) {
      this.dragLast = this.selectionPosition();
      this.host.onTransformStart();
      window.addEventListener('pointermove', this.onPointerMove);
      window.addEventListener('pointerup', this.onPointerUp);
      return;
    }

    const hits = this.raycaster.intersectObjects(this.scene.children, true);
    for (const hit of hits) {
      const eid = this.editorScene.resolveEid(hit.object);
      if (eid) {
        this.select(eid);
        return;
      }
    }
    this.select(null);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.selectedEid) return;
    this.setRayFromEvent(event);
    if (this.mode === 'rotate') {
      this.dragRotate();
    } else {
      this.dragTranslate();
    }
  };

  private dragTranslate(): void {
    if (!this.gizmo.isDragging() || !this.selectedEid || !this.dragLast) return;
    const next = this.gizmo.dragTo(this.raycaster);
    if (!next) return;

    const dx = next.x - this.dragLast.x;
    const dy = next.y - this.dragLast.y;
    const dz = next.z - this.dragLast.z;
    this.dragLast = next.clone();

    if (this.selectedEid === PLAYER_START_EID) {
      this.host.getDocument().meta.playerStart = [next.x, next.y, next.z];
      this.editorScene.updatePlayerStart(next);
    } else {
      const entity = this.host.getEntity(this.selectedEid);
      if (entity) {
        translateEntity(entity, dx, dy, dz);
        this.editorScene.getObject(this.selectedEid)?.position.add(new Vector3(dx, dy, dz));
      }
    }
    this.highlight?.update();
    this.host.onTransformLive();
  }

  private dragRotate(): void {
    if (!this.rotateGizmo.isDragging() || !this.selectedEid || this.selectedEid === PLAYER_START_EID) return;
    const delta = this.rotateGizmo.dragTo(this.raycaster);
    if (!delta) return;
    const entity = this.host.getEntity(this.selectedEid);
    if (!entity) return;

    rotateEntity(entity, delta);
    // Pivote estable: rotar alrededor del centro deja getPosition() invariante.
    const pivot = this.selectionPosition();
    const obj = this.editorScene.getObject(this.selectedEid);
    if (pivot && obj) {
      obj.position.sub(pivot).applyQuaternion(delta).add(pivot);
      obj.quaternion.premultiply(delta);
    }
    this.highlight?.update();
    this.host.onTransformLive();
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const active = this.activeGizmo();
    if (event.button !== 0 || !active.isDragging()) return;
    active.endDrag();
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.dragLast = null;

    if (this.selectedEid && this.selectedEid !== PLAYER_START_EID) {
      const entity = this.host.getEntity(this.selectedEid);
      if (entity) this.editorScene.rebuildEntity(entity);
    }
    this.refresh();
    this.host.onTransformEnd();
  };
}
