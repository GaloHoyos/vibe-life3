import type { VehicleAiBehavior } from '@game/levels/LevelDefinition';
import type { VehicleAiTarget, VehicleNavPoint } from './VehicleAiTypes';

/**
 * Estado runtime de un aparato aéreo, ortogonal al `behavior` autorado igual
 * que en tierra. Los tres estados propios del aire —despegue, aproximación y
 * aterrizaje— existen porque son transiciones con una condición de salida
 * física, no decisiones tácticas.
 */
export type VehicleAirState =
  | 'grounded'
  | 'takeoff'
  | 'cruising'
  | 'engaging'
  | 'pursuing'
  | 'searching'
  | 'evading'
  | 'approach'
  | 'landing'
  | 'stopped';

/** Punto de posada: marcador autorado o claro encontrado por sondeo. */
export interface AirLandingSpot {
  position: VehicleNavPoint;
  /** `authored` sale de un `vehicleNavMarker` de tipo `landingZone`. */
  source: 'authored' | 'improvised';
}

export interface AirBrainContext {
  position: VehicleNavPoint;
  /** Radianes; cero mira hacia +Z. */
  heading: number;
  velocity: VehicleNavPoint;
  /** Metros sobre el terreno; `Infinity` sin nada debajo. */
  altitude: number;
  grounded: boolean;
  healthFraction: number;
  pilotAvailable: boolean;
  gunnerAvailable: boolean;
  passengersOnboard: boolean;
  /** El jugador va a bordo: no se puede abandonar el aparato ni desmontarlo. */
  hasPlayerOccupant: boolean;
  /** Hay tripulación en camino: despegar ahora la dejaría en tierra. */
  crewPending: boolean;
  authoredGoal?: VehicleNavPoint;
  patrolPoints?: readonly VehicleNavPoint[];
  escortTarget?: VehicleAiTarget;
  threat?: VehicleAiTarget;
  retreatPoint?: VehicleNavPoint;
  landingSpot?: AirLandingSpot;
  weaponRange?: number;
  /** La torreta agotó su recorrido: conviene virar el casco. */
  turretAtTraverseLimit?: boolean;
  /** Ruta 3D vigente hacia el objetivo, si el planificador ya respondió. */
  route?: readonly VehicleNavPoint[];
}

/** Lo que el cerebro le pide al seguidor de vuelo. */
export interface AirFlightIntent {
  /** Punto a alcanzar; `null` mantiene la posición. */
  target: VehicleNavPoint | null;
  /** Altura sobre el terreno que se quiere sostener. */
  targetAltitude: number;
  /** Hacia dónde apuntar el morro; `null` sigue la velocidad. */
  facing: VehicleNavPoint | null;
  cruiseSpeed: number;
  /**
   * Descenso vertical mandado: el seguidor deja de perseguir altitud y baja a
   * ritmo fijo. Es lo que separa aterrizar de volar bajo.
   */
  descend: boolean;
  /** Corta el rotor: sólo con el aparato ya posado. */
  shutdown: boolean;
}

export interface AirBrainDecision {
  tickInterval: number;
  behavior: VehicleAiBehavior;
  state: VehicleAirState;
  intent: AirFlightIntent;
  /** Punto que el planificador debe resolver; `null` no pide ruta nueva. */
  planGoal: VehicleNavPoint | null;
  crewAction: 'none' | 'requestBoarding' | 'requestDisembark';
}

export interface AirFollowerInput {
  delta: number;
  position: VehicleNavPoint;
  velocity: VehicleNavPoint;
  heading: number;
  altitude: number;
  grounded: boolean;
  intent: AirFlightIntent;
  /** Ruta 3D a seguir; sin ella el seguidor va directo al objetivo. */
  route?: readonly VehicleNavPoint[];
}

export interface AirControlCommand {
  /** Cíclico longitudinal: positivo baja el morro y el aparato avanza. */
  throttle: number;
  /** Alabeo; positivo es la derecha del proyecto. */
  steering: number;
  /** Pedales; positivo guiña a la derecha. */
  yaw: number;
  collective: number;
  targetPoint: VehicleNavPoint | null;
  targetSpeed: number;
}
