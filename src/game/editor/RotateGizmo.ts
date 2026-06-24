import {
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
  Plane,
  Quaternion,
  type Raycaster,
  type Scene,
  TorusGeometry,
  Vector3,
} from 'three';

type Axis = 'x' | 'y' | 'z';

const AXIS_DIR: Record<Axis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
};

/**
 * Gizmo de rotacion hecho a mano: tres anillos de eje (X/Y/Z) que giran la
 * seleccion alrededor del pivote. Mantiene tamano constante en pantalla y
 * traduce el arrastre del puntero a un **delta de cuaternion** por frame
 * (con snap de angulo opcional), que el caller compone sobre la entidad via
 * `EditorEntityOps.rotateEntity`. Espejo de `TranslateGizmo` (mismo motivo para
 * no usar `TransformControls` de three: desfase de versiones types/runtime).
 */
export class RotateGizmo {
  private readonly group = new Group();
  private readonly handles = new Map<Object3D, Axis>();
  private readonly pickMeshes: Object3D[] = [];
  private target: Vector3 | null = null;
  private snapStep: number | null = Math.PI / 12;

  private drag: {
    axis: Axis;
    plane: Plane;
    lastAngle: number;
    accum: number;
    emitted: number;
  } | null = null;

  constructor() {
    this.group.name = 'editor-rotate-gizmo';
    this.group.visible = false;
    this.group.renderOrder = 999;
    this.buildRing('x', 0xff5566, (m) => (m.rotation.y = Math.PI / 2));
    this.buildRing('y', 0x66dd77, (m) => (m.rotation.x = Math.PI / 2));
    this.buildRing('z', 0x5588ff, () => undefined);
  }

  attach(scene: Scene): void {
    scene.add(this.group);
  }

  detach(scene: Scene): void {
    scene.remove(this.group);
  }

  /** Snap de angulo en radianes (null = libre). */
  setSnap(radians: number | null): void {
    this.snapStep = radians && radians > 0 ? radians : null;
  }

  setTarget(position: Vector3 | null): void {
    if (!position) {
      this.target = null;
      this.group.visible = false;
      return;
    }
    this.target = position.clone();
    this.group.position.copy(this.target);
    this.group.visible = true;
  }

  isDragging(): boolean {
    return this.drag !== null;
  }

  update(camera: PerspectiveCamera): void {
    if (!this.target || !this.group.visible) return;
    const dist = camera.position.distanceTo(this.target);
    this.group.scale.setScalar(Math.max(dist * 0.12, 0.05));
  }

  beginDrag(raycaster: Raycaster): boolean {
    if (!this.target) return false;
    const hits = raycaster.intersectObjects(this.pickMeshes, false);
    if (hits.length === 0) return false;
    const axis = this.resolveAxis(hits[0].object);
    if (!axis) return false;

    const plane = new Plane().setFromNormalAndCoplanarPoint(AXIS_DIR[axis], this.target);
    const hit = raycaster.ray.intersectPlane(plane, new Vector3());
    if (!hit) return false;
    this.drag = {
      axis,
      plane,
      lastAngle: this.angleOf(hit, axis),
      accum: 0,
      emitted: 0,
    };
    return true;
  }

  /** Delta de rotacion (cuaternion) desde el ultimo frame, o null si no hubo. */
  dragTo(raycaster: Raycaster): Quaternion | null {
    if (!this.drag) return null;
    const hit = raycaster.ray.intersectPlane(this.drag.plane, new Vector3());
    if (!hit) return null;

    const angle = this.angleOf(hit, this.drag.axis);
    this.drag.accum += wrapAngle(angle - this.drag.lastAngle);
    this.drag.lastAngle = angle;

    const snapped = this.snapStep
      ? Math.round(this.drag.accum / this.snapStep) * this.snapStep
      : this.drag.accum;
    const delta = snapped - this.drag.emitted;
    if (Math.abs(delta) < 1e-6) return null;
    this.drag.emitted = snapped;
    return new Quaternion().setFromAxisAngle(AXIS_DIR[this.drag.axis], delta);
  }

  endDrag(): void {
    this.drag = null;
  }

  dispose(): void {
    this.group.traverse((child) => {
      if (child instanceof Mesh) {
        child.geometry.dispose();
        if (!Array.isArray(child.material)) child.material.dispose();
      }
    });
  }

  // ---------------------------------------------------------------------------

  /** Angulo del punto (relativo al pivote) proyectado en el plano del eje. */
  private angleOf(point: Vector3, axis: Axis): number {
    const n = AXIS_DIR[axis];
    const rel = point.clone().sub(this.target ?? new Vector3());
    const u = Math.abs(n.x) < 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
    u.sub(n.clone().multiplyScalar(u.dot(n))).normalize();
    const v = n.clone().cross(u);
    return Math.atan2(rel.dot(v), rel.dot(u));
  }

  private resolveAxis(object: Object3D): Axis | undefined {
    let cur: Object3D | null = object;
    while (cur) {
      const axis = this.handles.get(cur);
      if (axis) return axis;
      cur = cur.parent;
    }
    return undefined;
  }

  private buildRing(axis: Axis, color: number, orient: (m: Mesh) => void): void {
    const material = new MeshBasicMaterial({ color, depthTest: false, transparent: true });
    const ring = new Mesh(new TorusGeometry(0.9, 0.03, 8, 48), material);
    ring.renderOrder = 999;
    orient(ring);
    this.group.add(ring);
    this.handles.set(ring, axis);
    this.pickMeshes.push(ring);
  }
}

/** Normaliza un angulo a (-pi, pi] para evitar saltos al cruzar +-pi. */
function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}
