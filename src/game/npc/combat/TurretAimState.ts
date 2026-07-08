export type TurretPhase =
  | "dormant"
  | "deploying"
  | "active"
  | "tipped"
  | "inert"
  | "dead";

/**
 * Estado de apuntado compartido entre `TurretCombat` (lo escribe) y
 * `TurretAnimator` (lo lee). Desacopla combate↔visual sin casts: el combat
 * decide hacia donde apunta el cañon y en que fase esta; el animador rota el
 * cañon y enciende el ojo a partir de eso.
 */
export class TurretAimState {
  phase: TurretPhase = "dormant";
  /** Yaw world del cañon (rad). El animador le resta el yaw del cuerpo. */
  barrelYaw = 0;
  /** Rotacion local del cañon en X (rad): cabeceo del cañon para el visual. */
  barrelPitch = 0;
  /** 0 (ojo apagado) .. 1 (ojo a full). El animador lo mapea al emissive. */
  eyeLevel = 0;
  /** Cañon alineado al objetivo dentro de tolerancia (feedback visual). */
  aligned = false;
}
