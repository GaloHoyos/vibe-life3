import { Euler, Quaternion, Vector3, type PerspectiveCamera } from "three";

/** Duración (s) de la caída de la cámara al morir. */
const DURATION = 1.3;
/**
 * Cuánto baja la cámara desde la altura de ojos (m). Relativo a la posición de
 * muerte (no a un Y absoluto) para aterrizar justo sobre el piso local —
 * funciona igual en planta baja, pisos altos de edificios o terreno elevado.
 * La altura de ojos de pie es ~1.6 m, así que ~1.35 deja la vista a ras del suelo.
 */
const FALL_DROP = 1.35;
/** Inclinación lateral final (rad) — la "cabeza" cae de costado. */
const TARGET_ROLL = -1.45;

/**
 * Caída de la cámara estilo Half-Life al morir: la vista se desploma hacia el
 * piso, se inclina de costado y nivela el horizonte, como si el jugador cayera
 * derribado. El view-model del arma sigue a la cámara (se reposiciona contra
 * ella cada frame), así que cae con la vista sin código aparte.
 */
export class DeathSequence {
  private elapsed = 0;
  private active = false;
  private readonly startPos = new Vector3();
  private startYaw = 0;
  private startPitch = 0;
  private readonly euler = new Euler(0, 0, 0, "YXZ");
  private readonly quat = new Quaternion();

  start(camera: PerspectiveCamera, yaw: number, pitch: number): void {
    this.active = true;
    this.elapsed = 0;
    this.startPos.copy(camera.position);
    this.startYaw = yaw;
    this.startPitch = pitch;
  }

  reset(): void {
    this.active = false;
    this.elapsed = 0;
  }

  /** Progreso 0→1 de la caída (alimenta la intensidad del tinte rojo). */
  get progress(): number {
    return DURATION > 0 ? Math.min(1, this.elapsed / DURATION) : 1;
  }

  isComplete(): boolean {
    return this.elapsed >= DURATION;
  }

  update(delta: number, camera: PerspectiveCamera): void {
    if (!this.active) {
      return;
    }
    this.elapsed += delta;
    const ease = easeOutCubic(this.progress);

    const targetY = this.startPos.y - FALL_DROP;
    camera.position.set(
      this.startPos.x,
      this.startPos.y + (targetY - this.startPos.y) * ease,
      this.startPos.z,
    );

    const pitch = this.startPitch * (1 - ease);
    const roll = TARGET_ROLL * ease;
    this.euler.set(pitch, this.startYaw, roll);
    camera.quaternion.copy(this.quat.setFromEuler(this.euler));
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
