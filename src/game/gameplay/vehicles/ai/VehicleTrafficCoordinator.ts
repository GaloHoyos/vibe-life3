import type { VehicleNavMarkerDefinition } from '@game/levels/LevelDefinition';
import type { VehiclePresetId } from '@game/config/vehicles.config';
import type {
  VehicleLaneEdge,
  VehicleNavPoint,
  VehiclePose2D,
} from './VehicleAiTypes';
import { clamp, headingToVector, planarDistance } from './VehicleAiMath';

export interface VehicleReservationRequest {
  resourceId: string;
  vehicleId: string;
  now: number;
  leaseSeconds?: number;
  priority?: number;
  convoyId?: string;
}

export interface VehicleReservationResult {
  granted: boolean;
  queuePosition: number;
  ownerId: string | null;
}

interface QueuedReservation {
  vehicleId: string;
  ownerKey: string;
  priority: number;
  leaseSeconds: number;
  convoyId?: string;
  serial: number;
}

interface ActiveReservation {
  ownerKey: string;
  ownerId: string;
  convoyId?: string;
  vehicleIds: Set<string>;
  expiresAt: number;
  leaseSeconds: number;
}

interface ResourceReservation {
  active: ActiveReservation | null;
  queue: QueuedReservation[];
}

export class VehicleReservationManager {
  private readonly resources = new Map<string, ResourceReservation>();
  private serial = 0;

  request(request: VehicleReservationRequest): VehicleReservationResult {
    const resource = this.resource(request.resourceId);
    this.expireAndPromote(resource, request.now);
    const ownerKey = reservationOwnerKey(request.vehicleId, request.convoyId);
    if (resource.active?.ownerKey === ownerKey) {
      resource.active.vehicleIds.add(request.vehicleId);
      resource.active.expiresAt = request.now + Math.max(0.25, request.leaseSeconds ?? 3);
      return {
        granted: true,
        queuePosition: 0,
        ownerId: resource.active.ownerId,
      };
    }
    if (!resource.active) {
      resource.active = createActiveReservation(request, ownerKey);
      return { granted: true, queuePosition: 0, ownerId: request.vehicleId };
    }

    let queued = resource.queue.find((entry) => entry.ownerKey === ownerKey);
    if (!queued) {
      queued = {
        vehicleId: request.vehicleId,
        ownerKey,
        priority: request.priority ?? 0,
        leaseSeconds: Math.max(0.25, request.leaseSeconds ?? 3),
        convoyId: request.convoyId,
        serial: this.serial++,
      };
      resource.queue.push(queued);
    } else {
      queued.priority = Math.max(queued.priority, request.priority ?? 0);
      queued.leaseSeconds = Math.max(queued.leaseSeconds, request.leaseSeconds ?? 3);
    }
    sortReservationQueue(resource.queue);
    return {
      granted: false,
      queuePosition: resource.queue.findIndex((entry) => entry.ownerKey === ownerKey) + 1,
      ownerId: resource.active.ownerId,
    };
  }

  renew(resourceId: string, vehicleId: string, now: number, leaseSeconds = 3): boolean {
    const resource = this.resources.get(resourceId);
    if (!resource) return false;
    this.expireAndPromote(resource, now);
    if (!resource.active?.vehicleIds.has(vehicleId)) return false;
    resource.active.expiresAt = now + Math.max(0.25, leaseSeconds);
    return true;
  }

  release(resourceId: string, vehicleId: string, now: number): void {
    const resource = this.resources.get(resourceId);
    if (!resource) return;
    resource.queue = resource.queue.filter((entry) => entry.vehicleId !== vehicleId);
    if (resource.active?.vehicleIds.has(vehicleId)) {
      resource.active.vehicleIds.delete(vehicleId);
      if (resource.active.vehicleIds.size === 0) {
        resource.active = null;
      } else if (resource.active.ownerId === vehicleId) {
        resource.active.ownerId = [...resource.active.vehicleIds].sort()[0];
      }
    }
    this.expireAndPromote(resource, now);
    if (!resource.active && resource.queue.length === 0) this.resources.delete(resourceId);
  }

  releaseVehicle(vehicleId: string, now: number): void {
    for (const [resourceId, resource] of this.resources) {
      resource.queue = resource.queue.filter((entry) => entry.vehicleId !== vehicleId);
      if (resource.active?.vehicleIds.has(vehicleId)) {
        resource.active.vehicleIds.delete(vehicleId);
        if (resource.active.vehicleIds.size === 0) {
          resource.active = null;
        } else if (resource.active.ownerId === vehicleId) {
          resource.active.ownerId = [...resource.active.vehicleIds].sort()[0];
        }
      }
      this.expireAndPromote(resource, now);
      if (!resource.active && resource.queue.length === 0) this.resources.delete(resourceId);
    }
  }

  update(now: number): void {
    for (const [resourceId, resource] of this.resources) {
      this.expireAndPromote(resource, now);
      if (!resource.active && resource.queue.length === 0) this.resources.delete(resourceId);
    }
  }

  owner(resourceId: string, now: number): string | null {
    const resource = this.resources.get(resourceId);
    if (!resource) return null;
    this.expireAndPromote(resource, now);
    return resource.active?.ownerId ?? null;
  }

  queuedCount(resourceId: string): number {
    return this.resources.get(resourceId)?.queue.length ?? 0;
  }

  clear(): void {
    this.resources.clear();
  }

  private resource(id: string): ResourceReservation {
    let resource = this.resources.get(id);
    if (!resource) {
      resource = { active: null, queue: [] };
      this.resources.set(id, resource);
    }
    return resource;
  }

  private expireAndPromote(resource: ResourceReservation, now: number): void {
    if (resource.active && resource.active.expiresAt <= now) resource.active = null;
    if (resource.active || resource.queue.length === 0) return;
    sortReservationQueue(resource.queue);
    const next = resource.queue.shift();
    if (!next) return;
    resource.active = {
      ownerKey: next.ownerKey,
      ownerId: next.vehicleId,
      convoyId: next.convoyId,
      vehicleIds: new Set([next.vehicleId]),
      expiresAt: now + next.leaseSeconds,
      leaseSeconds: next.leaseSeconds,
    };
  }
}

export function vehicleLaneReservationKey(edge: VehicleLaneEdge): string | null {
  if (!edge.reservable) return null;
  const authoredKey = edge.tags
    .find((tag) => tag.startsWith('reservation:'))
    ?.slice('reservation:'.length);
  if (authoredKey) return `authored:${authoredKey}`;
  if (edge.laneId) return `lane:${edge.laneId}`;
  return `junction:${[edge.from, edge.to].sort().join('|')}`;
}

export function nearestPassingBay(
  position: VehicleNavPoint,
  markers: readonly VehicleNavMarkerDefinition[],
  presetId: VehiclePresetId,
  maximumDistance = Infinity,
): VehicleNavMarkerDefinition | null {
  let result: VehicleNavMarkerDefinition | null = null;
  let distance = maximumDistance;
  for (const marker of markers) {
    if (marker.kind !== 'passingBay') continue;
    if (marker.allowedPresets && !marker.allowedPresets.includes(presetId)) continue;
    const candidateDistance = planarDistance(position, marker.position);
    if (
      candidateDistance < distance ||
      (candidateDistance === distance && result !== null && marker.id.localeCompare(result.id) < 0)
    ) {
      result = marker;
      distance = candidateDistance;
    }
  }
  return result;
}

export interface VehicleConvoyMemberState {
  vehicleId: string;
  pose: VehiclePose2D;
  speed: number;
}

export interface VehicleConvoyGuidance {
  convoyId: string;
  leaderId: string;
  target: VehicleNavPoint | null;
  targetSpeed: number;
  spacingError: number;
}

interface Convoy {
  memberIds: string[];
  spacing: number;
}

export class VehicleConvoyCoordinator {
  private readonly convoys = new Map<string, Convoy>();
  private readonly memberStates = new Map<string, VehicleConvoyMemberState>();
  private readonly convoyByMember = new Map<string, string>();

  setConvoy(convoyId: string, memberIds: readonly string[], spacing = 7): void {
    this.removeConvoy(convoyId);
    const uniqueMembers = [...new Set(memberIds)];
    this.convoys.set(convoyId, {
      memberIds: uniqueMembers,
      spacing: Math.max(2, spacing),
    });
    for (const memberId of uniqueMembers) this.convoyByMember.set(memberId, convoyId);
  }

  updateMember(state: VehicleConvoyMemberState): void {
    this.memberStates.set(state.vehicleId, state);
  }

  guidance(vehicleId: string, desiredSpeed: number): VehicleConvoyGuidance | null {
    const convoyId = this.convoyByMember.get(vehicleId);
    const convoy = convoyId ? this.convoys.get(convoyId) : undefined;
    if (!convoyId || !convoy) return null;
    const memberIndex = convoy.memberIds.indexOf(vehicleId);
    if (memberIndex < 0) return null;
    const leaderId = convoy.memberIds[0];
    if (memberIndex === 0) {
      return {
        convoyId,
        leaderId,
        target: null,
        targetSpeed: Math.max(0, desiredSpeed),
        spacingError: 0,
      };
    }
    const predecessor = this.memberStates.get(convoy.memberIds[memberIndex - 1]);
    const follower = this.memberStates.get(vehicleId);
    if (!predecessor || !follower) return null;
    const forward = headingToVector(predecessor.pose.heading);
    const target: VehicleNavPoint = [
      predecessor.pose.position[0] - forward[0] * convoy.spacing,
      predecessor.pose.position[1],
      predecessor.pose.position[2] - forward[1] * convoy.spacing,
    ];
    const actualSpacing = planarDistance(
      follower.pose.position,
      predecessor.pose.position,
    );
    const spacingError = actualSpacing - convoy.spacing;
    return {
      convoyId,
      leaderId,
      target,
      targetSpeed: clamp(predecessor.speed + spacingError * 0.45, 0, desiredSpeed),
      spacingError,
    };
  }

  removeVehicle(vehicleId: string): void {
    const convoyId = this.convoyByMember.get(vehicleId);
    this.memberStates.delete(vehicleId);
    this.convoyByMember.delete(vehicleId);
    if (!convoyId) return;
    const convoy = this.convoys.get(convoyId);
    if (!convoy) return;
    convoy.memberIds = convoy.memberIds.filter((id) => id !== vehicleId);
    if (convoy.memberIds.length === 0) this.convoys.delete(convoyId);
  }

  removeConvoy(convoyId: string): void {
    const previous = this.convoys.get(convoyId);
    if (previous) {
      for (const memberId of previous.memberIds) this.convoyByMember.delete(memberId);
    }
    this.convoys.delete(convoyId);
  }

  clear(): void {
    this.convoys.clear();
    this.memberStates.clear();
    this.convoyByMember.clear();
  }
}

function createActiveReservation(
  request: VehicleReservationRequest,
  ownerKey: string,
): ActiveReservation {
  return {
    ownerKey,
    ownerId: request.vehicleId,
    convoyId: request.convoyId,
    vehicleIds: new Set([request.vehicleId]),
    expiresAt: request.now + Math.max(0.25, request.leaseSeconds ?? 3),
    leaseSeconds: Math.max(0.25, request.leaseSeconds ?? 3),
  };
}

function reservationOwnerKey(vehicleId: string, convoyId: string | undefined): string {
  return convoyId ? `convoy:${convoyId}` : `vehicle:${vehicleId}`;
}

function sortReservationQueue(queue: QueuedReservation[]): void {
  queue.sort((a, b) => b.priority - a.priority || a.serial - b.serial);
}
