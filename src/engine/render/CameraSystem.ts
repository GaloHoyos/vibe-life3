import { Euler, PerspectiveCamera, Vector3 } from 'three';
import type { Input } from '../Input';

/**
 * Cámara FPS: maneja yaw/pitch del mouse, expone direcciones planares
 * para movimiento (`getPlanarForward`/`getPlanarRight`) y se sincroniza
 * con la posición del jugador (`syncToPosition`).
 */
export class CameraSystem {
  readonly camera: PerspectiveCamera;

  private yaw = 0;
  private pitch = 0;
  private readonly lookEuler = new Euler(0, 0, 0, 'YXZ');
  private readonly forward = new Vector3();
  private readonly right = new Vector3();

  constructor(private readonly container: HTMLElement) {
    const aspect = this.container.clientWidth / Math.max(this.container.clientHeight, 1);
    this.camera = new PerspectiveCamera(75, aspect, 0.05, 350);
    this.camera.position.set(0, 1.7, 4);

    window.addEventListener('resize', this.handleResize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
  }

  updateLook(input: Input): void {
    const delta = input.getMouseDelta();
    const sensitivity = 0.0022;
    const maxPitch = Math.PI / 2 - 0.02;

    this.yaw -= delta.x * sensitivity;
    this.pitch -= delta.y * sensitivity;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

    this.lookEuler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this.lookEuler);
  }

  setYaw(yaw: number): void {
    this.yaw = yaw;
    this.lookEuler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion.setFromEuler(this.lookEuler);
  }

  syncToPosition(position: Vector3): void {
    this.camera.position.copy(position);
  }

  getYaw(): number {
    return this.yaw;
  }

  getForwardDirection(): Vector3 {
    this.camera.getWorldDirection(this.forward);
    return this.forward.clone().normalize();
  }

  getPlanarForward(): Vector3 {
    this.camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    return this.forward.normalize();
  }

  getPlanarRight(): Vector3 {
    this.getPlanarForward();
    this.right.crossVectors(this.forward, new Vector3(0, 1, 0));
    return this.right.normalize();
  }

  private readonly handleResize = (): void => {
    this.camera.aspect = this.container.clientWidth / Math.max(this.container.clientHeight, 1);
    this.camera.updateProjectionMatrix();
  };
}
