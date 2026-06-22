import { PerspectiveCamera, Vector3 } from 'three';
import type { Input } from '@engine/input/Input';

/**
 * Camara de editor: orbita/pan/dolly alrededor de un punto objetivo, con un
 * modo "fly" (RMB sostenido + WASDQE) para desplazar el pivote por la escena.
 *
 * No usa pointer lock (la UI necesita el mouse libre) ni `Input.getMouseDelta`
 * (que solo entrega delta con pointer lock), asi que escucha sus propios
 * eventos de puntero sobre el canvas. El picking/gizmo del editor usa el boton
 * izquierdo; esta camara reserva el derecho (orbit/fly) y el del medio (pan).
 */
export class EditorCamera {
  private readonly target = new Vector3(0, 1, 0);
  private distance = 18;
  private theta = Math.PI * 0.25;
  private phi = Math.PI * 0.32;

  private orbiting = false;
  private panning = false;
  private lastX = 0;
  private lastY = 0;

  private readonly minPhi = 0.05;
  private readonly maxPhi = Math.PI - 0.05;
  private readonly minDistance = 1.5;
  private readonly maxDistance = 220;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  attach(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.apply();
  }

  detach(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  /** True mientras el usuario orbita o paneanea (para suprimir el picking). */
  isManipulating(): boolean {
    return this.orbiting || this.panning;
  }

  getTarget(): Vector3 {
    return this.target.clone();
  }

  setTarget(point: Vector3, distance?: number): void {
    this.target.copy(point);
    if (distance !== undefined) {
      this.distance = clamp(distance, this.minDistance, this.maxDistance);
    }
    this.apply();
  }

  /** Encuadra un punto manteniendo el angulo actual (boton "focus"). */
  focusOn(point: Vector3): void {
    this.setTarget(point, this.distance);
  }

  update(input: Input, delta: number): void {
    if (!this.orbiting) return;
    const speed = (input.isKeyDown('ShiftLeft') ? 26 : 11) * delta;
    const forward = new Vector3();
    this.camera.getWorldDirection(forward);
    const flat = new Vector3(forward.x, 0, forward.z);
    if (flat.lengthSq() < 1e-5) flat.set(0, 0, -1);
    flat.normalize();
    const right = new Vector3().crossVectors(flat, UP).normalize();

    const move = new Vector3();
    if (input.isKeyDown('KeyW')) move.add(flat);
    if (input.isKeyDown('KeyS')) move.sub(flat);
    if (input.isKeyDown('KeyD')) move.add(right);
    if (input.isKeyDown('KeyA')) move.sub(right);
    if (input.isKeyDown('KeyE')) move.y += 1;
    if (input.isKeyDown('KeyQ')) move.y -= 1;
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      this.target.add(move);
      this.apply();
    }
  }

  private apply(): void {
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.distance * sinPhi * Math.sin(this.theta),
      this.target.y + this.distance * Math.cos(this.phi),
      this.target.z + this.distance * sinPhi * Math.cos(this.theta),
    );
    this.camera.lookAt(this.target);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === 2) {
      this.orbiting = true;
    } else if (event.button === 1) {
      this.panning = true;
      event.preventDefault();
    } else {
      return;
    }
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.orbiting && !this.panning) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;

    if (this.orbiting) {
      this.theta -= dx * 0.005;
      this.phi = clamp(this.phi - dy * 0.005, this.minPhi, this.maxPhi);
    } else {
      const panScale = this.distance * 0.0015;
      const right = new Vector3();
      const up = new Vector3();
      this.camera.matrixWorld.extractBasis(right, up, new Vector3());
      this.target.addScaledVector(right, -dx * panScale);
      this.target.addScaledVector(up, dy * panScale);
    }
    this.apply();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.button === 2) this.orbiting = false;
    if (event.button === 1) this.panning = false;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const factor = Math.exp(event.deltaY * 0.0012);
    this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
    this.apply();
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };
}

const UP = new Vector3(0, 1, 0);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
