import type { VehicleControlInput } from "./VehicleMotor";

/** Intención cruda del piloto, ya resuelta desde los bindings o desde la IA. */
export interface AircraftDriverIntent {
  /** Cíclico adelante: baja el morro y el aparato avanza. */
  forward: boolean;
  back: boolean;
  /** Alabeo: el viraje sale del ladeo, no de los pedales. */
  left: boolean;
  right: boolean;
  yawLeft: boolean;
  yawRight: boolean;
  ascend: boolean;
  descend: boolean;
}

/**
 * Mapeo puro de teclas a ejes de vuelo. No suaviza nada a propósito: el motor
 * ya persigue la actitud con `attitudeResponse` y el empuje con `liftResponse`,
 * así que un segundo filtro acá sólo agregaría retardo sobre retardo.
 */
export function aircraftControlFromIntent(
  intent: Readonly<AircraftDriverIntent>,
): VehicleControlInput {
  return {
    throttle: axis(intent.forward, intent.back),
    steering: axis(intent.right, intent.left),
    yaw: axis(intent.yawRight, intent.yawLeft),
    collective: axis(intent.ascend, intent.descend),
    brake: 0,
    handbrake: 0,
    boost: false,
  };
}

function axis(positive: boolean, negative: boolean): number {
  return (positive ? 1 : 0) - (negative ? 1 : 0);
}
