import { Euler, MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import type { Input } from '@engine/input/Input';

const IDENTITY_Q = new Quaternion();
const TMP_BASE_Q = new Quaternion();
// Des-roleo post-portal estilo Source (`cl_reorient_rate` /
// `cl_reorient_acceleration_rate`). Más rápido que los defaults de Portal 1
// (120/400): un roll de 90° se endereza en ~0.55 s en vez de ~1 s.
const REORIENT_RATE = MathUtils.degToRad(220);
const REORIENT_ACCEL = MathUtils.degToRad(1000);

/**
 * CÃ¡mara FPS: maneja yaw/pitch del mouse, expone direcciones planares
 * para movimiento (`getPlanarForward`/`getPlanarRight`) y se sincroniza
 * con la posiciÃ³n del jugador (`syncToPosition`).
 */
export class CameraSystem {
  readonly camera: PerspectiveCamera;
  /** FOV base (grados) sin zoom. El zoom de mira lerpea hacia/desde este valor. */
  readonly defaultFov = 75;

  private yaw = 0;
  private pitch = 0;
  private readonly lookEuler = new Euler(0, 0, 0, 'YXZ');
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  /**
   * Offset transitorio (mundo) sobre la base yaw/pitch: al salir de un portal
   * con roll implícito (piso/techo), la vista queda CONTINUA en el cruce y
   * este offset absorbe el residuo; `updateReorient` lo des-rolea suave hacia
   * identidad en vez de snapear (comportamiento de Portal/Source).
   */
  private readonly reorientOffset = new Quaternion();
  private reorientSpeed = 0;

  constructor(private readonly container: HTMLElement) {
    const aspect = this.container.clientWidth / Math.max(this.container.clientHeight, 1);
    this.camera = new PerspectiveCamera(this.defaultFov, aspect, 0.05, 350);
    this.camera.position.set(0, 1.7, 4);

    window.addEventListener('resize', this.handleResize);
  }

  /**
   * Lerpea el FOV de la cámara hacia `targetFov` (grados) — usado por el zoom
   * de mira de las armas. Suaviza la transición con un factor dependiente de
   * `delta`; cuando ya está cerca del objetivo no toca la matriz de proyección.
   */
  applyZoom(targetFov: number, delta: number): void {
    const current = this.camera.fov;
    if (Math.abs(current - targetFov) < 0.05) {
      if (current !== targetFov) {
        this.camera.fov = targetFov;
        this.camera.updateProjectionMatrix();
      }
      return;
    }
    const t = 1 - Math.exp(-delta * 14);
    this.camera.fov = current + (targetFov - current) * t;
    this.camera.updateProjectionMatrix();
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

    this.applyOrientation();
  }

  /**
   * Des-rolea el offset post-portal hacia identidad con velocidad que acelera
   * (rate/acceleration de Source). Llamar una vez por frame.
   */
  updateReorient(delta: number): void {
    const angle = this.reorientOffset.angleTo(IDENTITY_Q);
    if (angle < 1e-4) {
      if (this.reorientSpeed !== 0) {
        this.reorientOffset.identity();
        this.reorientSpeed = 0;
        this.applyOrientation();
      }
      return;
    }
    this.reorientSpeed = Math.min(
      REORIENT_RATE,
      this.reorientSpeed + REORIENT_ACCEL * delta,
    );
    this.reorientOffset.rotateTowards(IDENTITY_Q, this.reorientSpeed * delta);
    this.applyOrientation();
  }

  setYaw(yaw: number): void {
    this.yaw = yaw;
    this.applyOrientation();
  }

  /**
   * Fija yaw y pitch de una vez (teleports/portales). Clampea pitch como
   * `updateLook`. Con `continuousOrientation` (portales): la vista queda
   * exactamente en esa orientación este frame — el residuo (roll) sobre la
   * base yaw/pitch se guarda como offset y se des-rolea suave. Sin ella, el
   * snap es duro y cancela cualquier des-roleo pendiente.
   */
  setLook(yaw: number, pitch: number, continuousOrientation?: Quaternion): void {
    const maxPitch = Math.PI / 2 - 0.02;
    this.yaw = yaw;
    this.pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));
    if (continuousOrientation) {
      this.lookEuler.set(this.pitch, this.yaw, 0);
      TMP_BASE_Q.setFromEuler(this.lookEuler).invert();
      this.reorientOffset
        .copy(continuousOrientation)
        .multiply(TMP_BASE_Q)
        .normalize();
    } else {
      this.reorientOffset.identity();
    }
    this.reorientSpeed = 0;
    this.applyOrientation();
  }

  /** Compone base yaw/pitch + offset transitorio en el quaternion de la cámara. */
  private applyOrientation(): void {
    this.lookEuler.set(this.pitch, this.yaw, 0);
    this.camera.quaternion
      .setFromEuler(this.lookEuler)
      .premultiply(this.reorientOffset);
  }

  syncToPosition(position: Vector3): void {
    this.camera.position.copy(position);
  }

  getYaw(): number {
    return this.yaw;
  }

  getPitch(): number {
    return this.pitch;
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
