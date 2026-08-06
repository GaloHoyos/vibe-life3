import type { VehicleAiBehavior } from '@game/levels/LevelDefinition';
import type { SurfaceType } from '@shared/types/Surface';
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
  | 'goAround'
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
  /** Punto pedido antes de resolver el claro físicamente apto más cercano. */
  requestedPosition?: VehicleNavPoint;
  markerId?: string;
  slopeDegrees?: number;
  /** Stable hull heading selected for the final approach. */
  approachHeading?: number;
  surfaceId?: string;
  surfaceType?: SurfaceType;
}

export type AirLandingStatus =
  | 'none'
  | 'resolving'
  | 'selected'
  | 'goAround'
  | 'landed'
  | 'failed';

export type AirLandingFailureReason =
  | 'noSafeSite'
  | 'siteBlocked'
  | 'approachBlocked'
  | 'aborted';

export interface AirLandingOrderOptions {
  /** Se limita a 35 m aunque el llamador pase un valor mayor. */
  searchRadius?: number;
  /** Las zonas autoradas reciben preferencia, pero no evitan la validación. */
  preferAuthored?: boolean;
  /** Mantiene el aparato posado hasta cancelar o reemplazar la orden. */
  holdAfterLanding?: boolean;
  orderId?: string;
}

export interface AirLandingOrder {
  id: string;
  revision: number;
  target: VehicleNavPoint;
  options: Readonly<Required<Omit<AirLandingOrderOptions, 'orderId'>>>;
}

/** Volumen world-space que prohíbe apoyar el disco del rotor. */
export interface AirNoLandingArea {
  id: string;
  center: VehicleNavPoint;
  halfExtents: VehicleNavPoint;
}

export type AirLandingEvent =
  | {
      type: 'selected';
      vehicleId: string;
      orderId: string;
      revision: number;
      requested: VehicleNavPoint;
      selected: VehicleNavPoint;
      deviation: number;
      source: AirLandingSpot['source'];
      surfaceId?: string;
      surfaceType?: SurfaceType;
    }
  | {
      type: 'landed';
      vehicleId: string;
      orderId: string;
      revision: number;
      requested: VehicleNavPoint;
      selected: VehicleNavPoint;
    }
  | {
      type: 'failed';
      vehicleId: string;
      orderId: string;
      revision: number;
      requested: VehicleNavPoint;
      reason: AirLandingFailureReason;
    };

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
  /** Mission phase owns the grounded pose while cargo exits. */
  groundHold?: boolean;
  /**
   * Hay gente esperando extracción en este punto. Manda sobre la lógica normal
   * de transporte, que sólo se posa con carga: para recoger hay que bajar vacío.
   */
  pickupAt?: VehicleNavPoint;
  authoredGoal?: VehicleNavPoint;
  patrolPoints?: readonly VehicleNavPoint[];
  escortTarget?: VehicleAiTarget;
  threat?: VehicleAiTarget;
  retreatPoint?: VehicleNavPoint;
  landingSpot?: AirLandingSpot;
  /** Hay una intención de posarse, aunque todavía se esté buscando el claro. */
  landingRequested?: boolean;
  landingStatus?: AirLandingStatus;
  /** Un sitio cambió o quedó bloqueado durante el descenso. */
  landingGoAround?: boolean;
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
