import type { VehicleNavMarkerDefinition } from '@game/levels/LevelDefinition';
import type {
  AirLandingSpot,
  AirNoLandingArea,
} from './AirVehicleAiTypes';
import type { AirVehicleNavigation } from './AirVehicleNavigation';
import type { VehicleNavPoint } from './VehicleAiTypes';

const RING_STEP = 7;
const RING_DIVISIONS = 8;
const AUTHORED_PREFERENCE_METERS = 12;

export interface AirLandingReservation {
  vehicleId: string;
  position: VehicleNavPoint;
  radius: number;
}

export interface AirLandingResolveRequest {
  requested: VehicleNavPoint;
  searchRadius: number;
  searchFrom: number;
  presetId: string;
  preferAuthored: boolean;
  authoredSites: readonly VehicleNavMarkerDefinition[];
  exclusions: readonly AirNoLandingArea[];
  reservations: readonly AirLandingReservation[];
  unavailableSiteKeys: ReadonlySet<string>;
}

export type AirLandingResolveStep =
  | { status: 'pending' }
  | { status: 'selected'; spot: AirLandingSpot }
  | { status: 'failed' };

interface LandingCandidate {
  position: VehicleNavPoint;
  source: AirLandingSpot['source'];
  markerId?: string;
  score: number;
}

/**
 * Resuelve pocos candidatos por tick. La lista está ordenada por utilidad, de
 * modo que el primer punto físicamente válido ya es el mejor: no hace falta
 * raycastear todo el abanico antes de tomar una decisión.
 */
export class AirLandingSiteResolver {
  private candidates: LandingCandidate[] = [];
  private cursor = 0;
  private request: AirLandingResolveRequest | null = null;

  constructor(private readonly navigation: AirVehicleNavigation) {}

  begin(request: AirLandingResolveRequest): void {
    this.request = request;
    this.cursor = 0;
    this.candidates = buildCandidates(request);
  }

  reset(): void {
    this.request = null;
    this.candidates = [];
    this.cursor = 0;
  }

  step(candidateBudget: number): AirLandingResolveStep {
    const request = this.request;
    if (!request) return { status: 'failed' };
    const budget = Math.max(1, Math.floor(candidateBudget));
    let tested = 0;
    while (this.cursor < this.candidates.length && tested < budget) {
      const candidate = this.candidates[this.cursor];
      this.cursor += 1;
      tested += 1;
      if (request.unavailableSiteKeys.has(airLandingSiteKey(candidate.position))) {
        continue;
      }
      if (overlapsReservation(candidate.position, this.navigation.getLandingRadius(), request)) {
        continue;
      }
      const probe = this.navigation.probeLandingSite(
        candidate.position[0],
        candidate.position[2],
        request.searchFrom,
      );
      if (!probe) continue;
      if (intersectsExclusion(probe.position, this.navigation.getLandingRadius(), request.exclusions)) {
        continue;
      }
      return {
        status: 'selected',
        spot: {
          position: probe.position,
          source: candidate.source,
          requestedPosition: [...request.requested],
          ...(candidate.markerId ? { markerId: candidate.markerId } : {}),
          slopeDegrees: probe.slopeDegrees,
          surfaceId: probe.surfaceId,
          ...(probe.surfaceType ? { surfaceType: probe.surfaceType } : {}),
        },
      };
    }
    return this.cursor >= this.candidates.length
      ? { status: 'failed' }
      : { status: 'pending' };
  }
}

export function airLandingSiteKey(position: VehicleNavPoint): string {
  return `${Math.round(position[0] * 2)}:${Math.round(position[2] * 2)}`;
}

function buildCandidates(
  request: AirLandingResolveRequest,
): LandingCandidate[] {
  const candidates: LandingCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: LandingCandidate): void => {
    const key = airLandingSiteKey(candidate.position);
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  for (const marker of request.authoredSites) {
    if (
      marker.allowedPresets &&
      !marker.allowedPresets.some((preset) => preset === request.presetId)
    ) {
      continue;
    }
    const distance = planarDistance(marker.position, request.requested);
    if (distance > request.searchRadius) continue;
    add({
      position: [...marker.position],
      source: 'authored',
      markerId: marker.id,
      score: distance - (request.preferAuthored ? AUTHORED_PREFERENCE_METERS : 0),
    });
  }

  add({
    position: [...request.requested],
    source: 'improvised',
    score: 0,
  });
  for (let radius = RING_STEP; radius <= request.searchRadius; radius += RING_STEP) {
    addRing(request.requested, radius, add);
  }
  const remainder = request.searchRadius % RING_STEP;
  if (request.searchRadius > 0 && remainder > 0.01) {
    addRing(request.requested, request.searchRadius, add);
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates;
}

function addRing(
  center: VehicleNavPoint,
  radius: number,
  add: (candidate: LandingCandidate) => void,
): void {
  for (let index = 0; index < RING_DIVISIONS; index += 1) {
    const angle = (index / RING_DIVISIONS) * Math.PI * 2;
    add({
      position: [
        center[0] + Math.sin(angle) * radius,
        center[1],
        center[2] + Math.cos(angle) * radius,
      ],
      source: 'improvised',
      score: radius,
    });
  }
}

function overlapsReservation(
  position: VehicleNavPoint,
  radius: number,
  request: AirLandingResolveRequest,
): boolean {
  return request.reservations.some(
    (reservation) =>
      planarDistance(position, reservation.position) <
      radius + reservation.radius + 1,
  );
}

function intersectsExclusion(
  position: VehicleNavPoint,
  radius: number,
  exclusions: readonly AirNoLandingArea[],
): boolean {
  return exclusions.some((area) => {
    const dx = Math.max(0, Math.abs(position[0] - area.center[0]) - area.halfExtents[0]);
    const dz = Math.max(0, Math.abs(position[2] - area.center[2]) - area.halfExtents[2]);
    const vertical = Math.abs(position[1] - area.center[1]) <=
      area.halfExtents[1] + radius;
    return vertical && Math.hypot(dx, dz) < radius;
  });
}

function planarDistance(a: VehicleNavPoint, b: VehicleNavPoint): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}
