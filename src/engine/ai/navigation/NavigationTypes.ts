import type { Vector3 } from "three";

export type NavigationDomain =
  | "ground"
  | "smallGround"
  | "largeGround"
  | "air"
  | "stationary";

export type NavigationArea =
  | "ground"
  | "stairs"
  | "crouch"
  | "door"
  | "hazard"
  | "costly";

export type NavigationActionKind =
  | "jump"
  | "drop"
  | "crouch"
  | "door"
  | "portal";

export interface NavAgentProfile {
  id: string;
  domain: NavigationDomain;
  radius: number;
  standingHeight: number;
  navigationHeight: number;
  maxSlopeDegrees: number;
  stepHeight: number;
  maxSpeed: number;
  acceleration: number;
  canJump: boolean;
  canCrouch: boolean;
  canDrop: boolean;
  canOpenDoors: boolean;
  canUsePortals: boolean;
  jumpSpeed: number;
  maxJumpDistance: number;
  safeDropHeight: number;
  areaCosts: Partial<Record<NavigationArea, number>>;
  /** Dominio bakeado a usar cuando este id no tiene navmesh propio. */
  fallbackProfileId?: string;
  /** Perfil con clearance de pie contra el que se clasifican zonas crouch. */
  standingProfileId?: string;
  /** Tamaño de voxel (m) del A* aéreo. Solo domain "air". */
  airCellSize?: number;
  /** Presupuesto de links jump/drop generados por perfil. */
  maxTraversalLinks?: number;
}

export interface NavigationActionLink {
  id: string;
  kind: NavigationActionKind;
  start: Vector3;
  /** Punto detrás del plano que fuerza el cruce físico tras llegar a `start`. */
  traverseStart?: Vector3;
  end: Vector3;
  bidirectional: boolean;
  cost: number;
  width: number;
  profileIds?: readonly string[];
  doorId?: string;
  portalId?: string;
}

export type NavigationStatus =
  | "idle"
  | "moving"
  | "arrived"
  | "partial"
  | "blocked"
  | "traversing"
  | "unreachable";

export interface NavigationPathAction {
  pointIndex: number;
  link: NavigationActionLink;
}

export interface NavigationPath {
  points: Vector3[];
  actions: NavigationPathAction[];
  length: number;
  partial: boolean;
}

export interface NavigationSample {
  id: number;
  position: Vector3;
  componentId: number;
  area: NavigationArea;
  roomId: string | null;
  buildingId: string | null;
}

export interface NavigationDebugSnapshot {
  ready: boolean;
  profiles: Array<{
    id: string;
    triangleCount: number;
    obstacleCount: number;
  }>;
  pendingRequests: number;
  activeReservations: number;
  lastUpdateMs: number;
  averageUpdateMs: number;
  p95UpdateMs: number;
}
