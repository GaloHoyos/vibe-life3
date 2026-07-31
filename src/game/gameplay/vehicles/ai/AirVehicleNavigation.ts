import { Vector3 } from 'three';
import { AirNavigationDomain } from '@engine/ai/navigation/AirNavigationDomain';
import type { NavAgentProfile } from '@engine/ai/navigation/NavigationTypes';
import type { RaycastSource } from '@engine/physics/Raycast';
import type { VehiclePresetDefinition } from '@game/config/vehicles.config';
import type { AirLandingSpot } from './AirVehicleAiTypes';
import type { VehicleNavPoint } from './VehicleAiTypes';

/** Margen sobre el radio del casco para no rozar al planificar. */
const CLEARANCE_MARGIN = 1.4;
const LANDING_PROBE_HEIGHT = 60;
/** Pendiente máxima de una posada improvisada. */
const MAX_LANDING_SLOPE = Math.cos((12 * Math.PI) / 180);
const LANDING_FAN_RADII = [0, 8, 16, 26] as const;
const LANDING_FAN_DIVISIONS = 8;

const tmpFrom = new Vector3();
const tmpTo = new Vector3();
const tmpOrigin = new Vector3();
const DOWN = new Vector3(0, -1, 0);

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
      cast: (origin, direction, maxDistance, excludeBody, ignoreId, filter) =>
        raycast.cast(
          origin,
          direction,
          maxDistance,
          excludeBody,
          ignoreId ?? excludeId,
          filter,
        ),
    };
    this.domain = new AirNavigationDomain(this.raycast);
  }

  getProfile(): NavAgentProfile {
    return this.profile;
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
        const spot = this.probeLanding(x, z, searchFrom);
        if (spot) return { position: spot, source: 'improvised' };
      }
    }
    return null;
  }

  /** Si el aparato entra en vertical desde `from` hasta posarse en `to`. */
  descentClear(to: VehicleNavPoint, from: number): boolean {
    tmpOrigin.set(to[0], from, to[2]);
    const hit = this.raycast.cast(tmpOrigin, DOWN, LANDING_PROBE_HEIGHT);
    if (!hit) return false;
    return Math.abs(hit.point.y - to[1]) <= this.profile.radius;
  }

  private probeLanding(
    x: number,
    z: number,
    searchFrom: number,
  ): VehicleNavPoint | null {
    tmpOrigin.set(x, searchFrom, z);
    const hit = this.raycast.cast(tmpOrigin, DOWN, LANDING_PROBE_HEIGHT);
    if (!hit) return null;
    // Sin normal no hay forma de saber la pendiente, y posarse en un talud
    // termina con el aparato rodando: mejor descartar el punto.
    if (!hit.normal || hit.normal.y < MAX_LANDING_SLOPE) return null;
    // El disco del rotor necesita el mismo hueco que pide el planificador.
    const radius = this.profile.radius;
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2;
      tmpOrigin.set(
        x + Math.sin(angle) * radius * 0.8,
        searchFrom,
        z + Math.cos(angle) * radius * 0.8,
      );
      const edge = this.raycast.cast(tmpOrigin, DOWN, LANDING_PROBE_HEIGHT);
      if (!edge) return null;
      if (Math.abs(edge.point.y - hit.point.y) > 1.2) return null;
    }
    return [x, hit.point.y, z];
  }
}
