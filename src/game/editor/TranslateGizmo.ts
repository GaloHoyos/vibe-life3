import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  type PerspectiveCamera,
  Plane,
  type Raycaster,
  type Scene,
  Vector3,
} from 'three';

type Axis = 'x' | 'y' | 'z' | 'xz';

const AXIS_DIR: Record<Axis, Vector3> = {
  x: new Vector3(1, 0, 0),
  y: new Vector3(0, 1, 0),
  z: new Vector3(0, 0, 1),
  xz: new Vector3(0, 1, 0),
};

/**
 * Gizmo de traslacion hecho a mano: tres flechas de eje (X/Y/Z) mas un handle
 * central que arrastra sobre el plano del piso (XZ). Mantiene un tamano
 * constante en pantalla y traduce el arrastre del puntero a una posicion
 * mundial proyectando el rayo sobre el plano de arrastre del eje.
 *
 * Es independiente del modelo de entidades: solo emite la nueva posicion; el
 * caller la mapea a la def/spec via `EditorEntityOps`. (Se evita
 * `TransformControls` de three por el desfase de versiones types 0.184 /
 * runtime 0.164.)
 */
export class TranslateGizmo {
  private readonly group = new Group();
  private readonly handles = new Map<Object3D, Axis>();
  private readonly pickMeshes: Object3D[] = [];
  private target: Vector3 | null = null;
  private snapStep: number | null = null;

  private drag: {
    axis: Axis;
    plane: Plane;
    startHit: Vector3;
    startPos: Vector3;
  } | null = null;

  constructor() {
    this.group.name = 'editor-gizmo';
    this.group.visible = false;
    this.group.renderOrder = 999;
    this.buildArrow('x', 0xff5566, (g) => (g.rotation.z = -Math.PI / 2));
    this.buildArrow('y', 0x66dd77, () => undefined);
    this.buildArrow('z', 0x5588ff, (g) => (g.rotation.x = Math.PI / 2));
    this.buildCenter();
  }

  attach(scene: Scene): void {
    scene.add(this.group);
  }

  detach(scene: Scene): void {
    scene.remove(this.group);
  }

  setSnap(step: number | null): void {
    this.snapStep = step && step > 0 ? step : null;
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

  /** Mantiene tamano constante en pantalla. Llamar cada frame. */
  update(camera: PerspectiveCamera): void {
    if (!this.target || !this.group.visible) return;
    const dist = camera.position.distanceTo(this.target);
    this.group.scale.setScalar(Math.max(dist * 0.12, 0.05));
  }

  /** Intenta empezar a arrastrar si el rayo pega un handle. */
  beginDrag(raycaster: Raycaster): boolean {
    if (!this.target) return false;
    const hits = raycaster.intersectObjects(this.pickMeshes, false);
    if (hits.length === 0) return false;
    const axis = this.resolveAxis(hits[0].object);
    if (!axis) return false;

    const plane = this.dragPlane(axis, raycaster.ray.direction);
    const startHit = raycaster.ray.intersectPlane(plane, new Vector3());
    if (!startHit) return false;
    this.drag = { axis, plane, startHit, startPos: this.target.clone() };
    return true;
  }

  /** Devuelve la nueva posicion mundial mientras se arrastra, o null. */
  dragTo(raycaster: Raycaster): Vector3 | null {
    if (!this.drag) return null;
    const hit = raycaster.ray.intersectPlane(this.drag.plane, new Vector3());
    if (!hit) return null;

    const next = this.drag.startPos.clone();
    if (this.drag.axis === 'xz') {
      next.x += hit.x - this.drag.startHit.x;
      next.z += hit.z - this.drag.startHit.z;
      this.snapAxis(next, 'x');
      this.snapAxis(next, 'z');
    } else {
      const dir = AXIS_DIR[this.drag.axis];
      const along = dir.dot(hit.clone().sub(this.drag.startHit));
      next.addScaledVector(dir, along);
      this.snapAxis(next, this.drag.axis);
    }

    this.target = next.clone();
    this.group.position.copy(next);
    return next.clone();
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

  private dragPlane(axis: Axis, viewDir: Vector3): Plane {
    const origin = this.target ?? new Vector3();
    if (axis === 'xz') {
      return new Plane().setFromNormalAndCoplanarPoint(AXIS_DIR.y, origin);
    }
    const dir = AXIS_DIR[axis];
    // Plano que contiene el eje y encara la camara: normal = viewDir sin su
    // componente sobre el eje.
    const normal = viewDir.clone().addScaledVector(dir, -dir.dot(viewDir));
    if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);
    normal.normalize();
    return new Plane().setFromNormalAndCoplanarPoint(normal, origin);
  }

  private snapAxis(v: Vector3, axis: 'x' | 'y' | 'z'): void {
    if (!this.snapStep) return;
    v[axis] = Math.round(v[axis] / this.snapStep) * this.snapStep;
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

  private buildArrow(axis: Axis, color: number, orient: (g: Group) => void): void {
    const arrow = new Group();
    const material = new MeshBasicMaterial({ color, depthTest: false, transparent: true });
    const shaft = new Mesh(new CylinderGeometry(0.045, 0.045, 0.8, 8), material);
    shaft.position.y = 0.4;
    shaft.renderOrder = 999;
    const tip = new Mesh(new ConeGeometry(0.11, 0.26, 12), material);
    tip.position.y = 0.92;
    tip.renderOrder = 999;
    arrow.add(shaft, tip);
    orient(arrow);
    this.group.add(arrow);
    this.handles.set(arrow, axis);
    this.pickMeshes.push(shaft, tip);
  }

  private buildCenter(): void {
    const material = new MeshBasicMaterial({
      color: 0xffd23f,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });
    const box = new Mesh(new BoxGeometry(0.16, 0.16, 0.16), material);
    box.renderOrder = 999;
    this.group.add(box);
    this.handles.set(box, 'xz');
    this.pickMeshes.push(box);
  }
}
