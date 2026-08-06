import { Vector3 } from 'three';
import { AirNavigationDomain } from '@engine/ai/navigation/AirNavigationDomain';
import type { NavAgentProfile } from '@engine/ai/navigation/NavigationTypes';
import type { RaycastHit, RaycastSource } from '@engine/physics/Raycast';
import type { VehiclePresetDefinition } from '@game/config/vehicles.config';
import type { SurfaceType } from '@shared/types/Surface';
import type { AirLandingSpot } from './AirVehicleAiTypes';
import type { VehicleNavPoint } from './VehicleAiTypes';

/** Margen sobre el radio del casco para no rozar al planificar. */
const CLEARANCE_MARGIN = 1.4;
const LANDING_PROBE_HEIGHT = 120;
/** Pendiente máxima de una posada improvisada. */
const MAX_LANDING_SLOPE = Math.cos((12 * Math.PI) / 180);
const LANDING_FAN_RADII = [0, 7, 14, 21, 28, 35] as const;
const LANDING_FAN_DIVISIONS = 8;
const LANDING_HEIGHT_TOLERANCE = 1.1;
const LANDING_RING_SAMPLES = 12;
const LANDING_SUPPORT_RINGS = [
  { scale: 0.52, phase: 0 },
  { scale: 0.9, phase: Math.PI / LANDING_RING_SAMPLES },
] as const;

const tmpFrom = new Vector3();
const tmpTo = new Vector3();
const tmpOrigin = new Vector3();
const tmpDirection = new Vector3();
const DOWN = new Vector3(0, -1, 0);

export interface AirLandingProbe {
  position: VehicleNavPoint;
  slopeDegrees: number;
  surfaceId: string;
  surfaceType?: SurfaceType;
}

/**
 * Perfil aéreo derivado del preset. El radio sale de la diagonal del casco
 * porque el A* aéreo valida los tramos con un haz de rayos de ese radio: con el
 * semiancho solo, un helicóptero de 9 m de largo pasaría "limpio" por huecos
 * donde en realidad entra de punta.
 */
export function airNavProfileFromPreset(
  preset: VehiclePresetDefinition,
): NavAgentProfile {
  const navigation = preset.navigation;
  const radius =
    Math.hypot(navigation.halfWidth, navigation.halfLength) + CLEARANCE_MARGIN;
  return {
    id: `${preset.id}:air`,
    domain: 'air',
    radius,
    standingHeight: navigation.clearanceHeight,
    navigationHeight: navigation.clearanceHeight,
    maxSlopeDegrees: 89,
    stepHeight: 0,
    maxSpeed: 24,
    acceleration: 6,
    canJump: false,
    canCrouch: false,
    canDrop: false,
    canOpenDoors: false,
    canUsePortals: false,
    jumpSpeed: 0,
    maxJumpDistance: 0,
    safeDropHeight: 0,
    areaCosts: {},
    // Voxels del tamaño del aparato: más finos multiplican el coste del A* sin
    // encontrar huecos por los que igual no cabe.
    airCellSize: Math.max(2, radius),
  };
}

/**
 * Navegación aérea de un aparato. Se apoya en `AirNavigationDomain`, que crea
 * los voxels durante la consulta y valida cada tramo con rayos: no hay bake ni
 * hash que mantener, a diferencia de la grilla vehicular terrestre.
 */
export class AirVehicleNavigation {
  private readonly domain: AirNavigationDomain;
  private readonly raycast: RaycastSource;

  constructor(
    raycast: RaycastSource,
    private readonly profile: NavAgentProfile,
    /** Id del propio aparato: sin excluirlo, su casco tapa cada sondeo. */
    excludeId: string,
  ) {
    this.raycast = {
      cast: (origin, direction, maxDistance, excludeBody, ignoreId, filter) => {
        const solidFilter = (
          metadata: Parameters<NonNullable<typeof filter>>[0],
          collider: Parameters<NonNullable<typeof filter>>[1],
        ): boolean =>
          !collider.isSensor() && (filter?.(metadata, collider) ?? true);
        return raycast.cast(
          origin,
          direction,
          maxDistance,
          excludeBody,
          ignoreId ?? excludeId,
          solidFilter,
        );
      },
    };
    this.domain = new AirNavigationDomain(this.raycast);
  }

  getProfile(): NavAgentProfile {
    return this.profile;
  }

  /** Radio que debe quedar libre y que también usan las reservas de posada. */
  getLandingRadius(): number {
    return this.profile.radius;
  }

  /** Ruta 3D entre dos puntos, o `null` si no hay paso. */
  planRoute(from: VehicleNavPoint, to: VehicleNavPoint): VehicleNavPoint[] | null {
    tmpFrom.set(from[0], from[1], from[2]);
    tmpTo.set(to[0], to[1], to[2]);
    const path = this.domain.findPath(tmpFrom, tmpTo, this.profile);
    if (!path || path.points.length === 0) return null;
    return path.points.map<VehicleNavPoint>((point) => [point.x, point.y, point.z]);
  }

  /** Altura del terreno bajo un punto, o `null` si no hay suelo debajo. */
  groundHeightAt(x: number, z: number, from: number): number | null {
    tmpOrigin.set(x, from, z);
    const hit = this.raycast.cast(tmpOrigin, DOWN, LANDING_PROBE_HEIGHT);
    return hit ? hit.point.y : null;
  }

  /**
   * Claro plano donde posarse cerca de `center`. Barre en abanico creciente y
   * exige suelo llano, sin techo y con espacio para el rotor. Es el plan B de
   * un aparato dañado que no llega a ninguna zona autorada.
   */
  findClearing(center: VehicleNavPoint, searchFrom: number): AirLandingSpot | null {
    for (const radius of LANDING_FAN_RADII) {
      const divisions = radius === 0 ? 1 : LANDING_FAN_DIVISIONS;
      for (let index = 0; index < divisions; index += 1) {
        const angle = (index / divisions) * Math.PI * 2;
        const x = center[0] + Math.sin(angle) * radius;
        const z = center[2] + Math.cos(angle) * radius;
        const spot = this.probeLandingSite(x, z, searchFrom);
        if (spot) {
          return {
            position: spot.position,
            source: 'improvised',
            slopeDegrees: spot.slopeDegrees,
          };
        }
      }
    }
    return null;
  }

  /** Si el aparato entra en vertical desde `from` hasta posarse en `to`. */
  descentClear(to: VehicleNavPoint, from: number): boolean {
    const probe = this.probeLandingSite(to[0], to[2], from);
    return Boolean(
      probe && Math.abs(probe.position[1] - to[1]) <= LANDING_HEIGHT_TOLERANCE,
    );
  }

  /**
   * Valida el disco del rotor, el apoyo y el volumen del casco con el contrato
   * de raycast disponible. Todos los apoyos deben ser fijos: un techo estático
   * sirve, una puerta, un vehículo o una plataforma móvil no.
   */
  probeLandingSite(
    x: number,
    z: number,
    searchFrom: number,
  ): AirLandingProbe | null {
    tmpOrigin.set(x, searchFrom, z);
    const hit = this.raycast.cast(tmpOrigin, DOWN, LANDING_PROBE_HEIGHT);
    if (!hit) return null;
    if (!isFixedLandingSurface(hit)) return null;
    if (!hit.normal || hit.normal.y < MAX_LANDING_SLOPE) return null;

    const radius = this.profile.radius;
    const groundY = hit.point.y;
    for (const { scale, phase } of LANDING_SUPPORT_RINGS) {
      for (let index = 0; index < LANDING_RING_SAMPLES; index += 1) {
        const angle = (index / LANDING_RING_SAMPLES) * Math.PI * 2 + phase;
        tmpOrigin.set(
          x + Math.sin(angle) * radius * scale,
          searchFrom,
          z + Math.cos(angle) * radius * scale,
        );
        const edge = this.raycast.cast(tmpOrigin, DOWN, LANDING_PROBE_HEIGHT);
        if (!edge || !isFixedLandingSurface(edge)) return null;
        if (!edge.normal || edge.normal.y < MAX_LANDING_SLOPE) return null;
        if (Math.abs(edge.point.y - groundY) > LANDING_HEIGHT_TOLERANCE) {
          return null;
        }
      }
    }

    // Un apoyo amplio no alcanza si una pared, árbol o borde invade el volumen
    // del fuselaje o el disco. Los rayos salen desde dos alturas para no dejar
    // pasar un obstáculo bajo las palas ni uno pegado al casco.
    const clearanceHeights = [
      Math.max(0.65, this.profile.navigationHeight * 0.3),
      Math.max(1.4, this.profile.navigationHeight * 0.85),
    ];
    for (const height of clearanceHeights) {
      for (let index = 0; index < LANDING_RING_SAMPLES; index += 1) {
        const angle = (index / LANDING_RING_SAMPLES) * Math.PI * 2;
        tmpOrigin.set(x, groundY + height, z);
        tmpDirection.set(Math.sin(angle), 0, Math.cos(angle));
        if (this.raycast.cast(tmpOrigin, tmpDirection, radius * 0.92)) {
          return null;
        }
      }
    }

    return {
      position: [x, groundY, z],
      slopeDegrees: Math.acos(Math.min(1, hit.normal.y)) * (180 / Math.PI),
      surfaceId: hit.metadata?.id ?? 'world',
      ...(hit.metadata?.surface ? { surfaceType: hit.metadata.surface } : {}),
    };
  }
}

function isFixedLandingSurface(
  hit: Pick<RaycastHit, 'collider' | 'metadata'>,
): boolean {
  if (hit.collider.isSensor()) return false;
  const kind = hit.metadata?.kind;
  if (kind !== undefined && kind !== 'static') return false;
  const body = hit.collider.parent();
  return !body || body.isFixed();
}
