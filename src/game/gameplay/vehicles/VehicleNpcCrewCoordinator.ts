import { Vector3 } from "three";
import type {
  VehicleCrewRole,
  VehicleSeatPreset,
} from "@game/config/vehicles.config";
import type {
  INpc,
  NpcVehicleApproachOrder,
} from "@game/npc/core/INpc";
import { canUseVehicleRole } from "./VehicleAccessPolicy";
import type {
  VehicleEntity,
  VehicleOccupant,
} from "./VehicleEntity";

export type VehicleNpcCrewPhase =
  | "approach"
  | "boarding"
  | "mounted"
  | "exiting";

export interface VehicleNpcCrewAssignment {
  readonly actorId: string;
  readonly vehicleId: string;
  readonly seatId: string;
  readonly role: VehicleCrewRole;
  readonly phase: VehicleNpcCrewPhase;
  readonly approachTarget: Vector3 | null;
  readonly exitTarget: Vector3 | null;
  readonly emergencyExit: boolean;
}

export interface VehicleNpcAnchorCandidate {
  readonly index: number;
  readonly position: Vector3;
}

export interface VehicleNpcAnchorSelection {
  readonly index: number;
  readonly position: Vector3;
}

export interface VehicleNpcApproachContext {
  readonly npc: INpc;
  readonly vehicle: VehicleEntity;
  readonly seat: VehicleSeatPreset;
  readonly candidates: readonly VehicleNpcAnchorCandidate[];
}

export interface VehicleNpcExitContext extends VehicleNpcApproachContext {
  readonly emergency: boolean;
}

export interface VehicleNpcSeatPolicyContext {
  readonly npc: INpc;
  readonly vehicle: VehicleEntity;
  readonly seat: VehicleSeatPreset;
}

export interface VehicleNpcCrewCoordinatorOptions {
  readonly rolePriority?: readonly VehicleCrewRole[];
  readonly arriveRadius?: number;
  readonly maxApproachSeconds?: number;
  readonly maxBlockedSeconds?: number;
  readonly maxBoardingSeconds?: number;
  readonly maxExitingSeconds?: number;
  readonly maxBoardingSpeed?: number;
  readonly maxExitSpeed?: number;
  readonly exitReservationRadius?: number;
  readonly canReserveSeat?: (context: VehicleNpcSeatPolicyContext) => boolean;
  readonly selectApproach?: (
    context: VehicleNpcApproachContext,
  ) => VehicleNpcAnchorSelection | null;
  readonly selectExit?: (
    context: VehicleNpcExitContext,
  ) => VehicleNpcAnchorSelection | null;
}

export interface VehicleNpcBoardingRequest {
  readonly preferredSeatId?: string;
  readonly roles?: readonly VehicleCrewRole[];
  readonly arriveRadius?: number;
}

export interface VehicleNpcBoardAction {
  readonly type: "board";
  readonly npc: INpc;
  readonly vehicle: VehicleEntity;
  readonly seatId: string;
  readonly role: VehicleCrewRole;
  readonly approachPosition: Vector3;
}

export interface VehicleNpcExitAction {
  readonly type: "exit";
  readonly npc: INpc;
  readonly vehicle: VehicleEntity;
  readonly seatId: string;
  readonly role: VehicleCrewRole;
  readonly exitPosition: Vector3;
  readonly exitIndex: number;
  readonly emergency: boolean;
}

export type VehicleNpcCrewAction =
  | VehicleNpcBoardAction
  | VehicleNpcExitAction;

export type VehicleNpcExitRequestResult =
  | "started"
  | "queued"
  | "rejected";

export interface VehicleNpcEvacuationResult {
  readonly exiting: number;
  readonly queued: number;
  readonly canceledApproaches: number;
}

export interface VehicleNpcExitReservation {
  readonly actorId: string;
  readonly vehicleId: string;
  readonly seatId: string;
  readonly exitIndex: number;
  readonly position: Vector3;
}

interface ResolvedOptions {
  readonly rolePriority: readonly VehicleCrewRole[];
  readonly arriveRadius: number;
  readonly maxApproachSeconds: number;
  readonly maxBlockedSeconds: number;
  readonly maxBoardingSeconds: number;
  readonly maxExitingSeconds: number;
  readonly maxBoardingSpeed: number;
  readonly maxExitSpeed: number;
  readonly exitReservationRadius: number;
  readonly canReserveSeat: (context: VehicleNpcSeatPolicyContext) => boolean;
  readonly selectApproach: (
    context: VehicleNpcApproachContext,
  ) => VehicleNpcAnchorSelection | null;
  readonly selectExit: (
    context: VehicleNpcExitContext,
  ) => VehicleNpcAnchorSelection | null;
}

interface CrewAssignment {
  readonly npc: INpc;
  readonly vehicle: VehicleEntity;
  seatId: string;
  role: VehicleCrewRole;
  phase: VehicleNpcCrewPhase;
  phaseElapsed: number;
  blockedElapsed: number;
  approachTarget: Vector3 | null;
  approachIndex: number | null;
  arriveRadius: number;
  exitTarget: Vector3 | null;
  exitIndex: number | null;
  emergencyExit: boolean;
}

interface ExitReservation {
  readonly actorId: string;
  readonly seatId: string;
  readonly exitIndex: number;
  readonly position: Vector3;
}

const DEFAULT_ROLE_PRIORITY: readonly VehicleCrewRole[] = [
  "gunner",
  "passenger",
  "commander",
  "driver",
  "pilot",
];

const DEFAULT_OPTIONS: ResolvedOptions = {
  rolePriority: DEFAULT_ROLE_PRIORITY,
  arriveRadius: 0.9,
  maxApproachSeconds: 18,
  maxBlockedSeconds: 4,
  maxBoardingSeconds: 2,
  maxExitingSeconds: 5,
  maxBoardingSpeed: 1.25,
  maxExitSpeed: 1.25,
  exitReservationRadius: 1.1,
  canReserveSeat: () => true,
  selectApproach: selectClosestAnchor,
  selectExit: selectClosestAnchor,
};

/**
 * Owns NPC crew intent and mutual exclusion without mutating physical
 * occupancy. VehicleSystem remains the authority for mounting and animation,
 * then acknowledges the transition through the confirmation methods.
 */
export class VehicleNpcCrewCoordinator {
  private readonly options: ResolvedOptions;
  private readonly assignments = new Map<string, CrewAssignment>();
  private readonly seatReservations = new Map<string, Map<string, string>>();
  private readonly exitReservations = new Map<
    string,
    Map<string, ExitReservation>
  >();
  private readonly pendingEvacuations = new Map<
    string,
    { readonly emergency: boolean }
  >();
  private actions: VehicleNpcCrewAction[] = [];

  constructor(options: VehicleNpcCrewCoordinatorOptions = {}) {
    this.options = {
      rolePriority: options.rolePriority ?? DEFAULT_OPTIONS.rolePriority,
      arriveRadius: positiveOr(
        options.arriveRadius,
        DEFAULT_OPTIONS.arriveRadius,
      ),
      maxApproachSeconds: positiveOr(
        options.maxApproachSeconds,
        DEFAULT_OPTIONS.maxApproachSeconds,
      ),
      maxBlockedSeconds: positiveOr(
        options.maxBlockedSeconds,
        DEFAULT_OPTIONS.maxBlockedSeconds,
      ),
      maxBoardingSeconds: positiveOr(
        options.maxBoardingSeconds,
        DEFAULT_OPTIONS.maxBoardingSeconds,
      ),
      maxExitingSeconds: positiveOr(
        options.maxExitingSeconds,
        DEFAULT_OPTIONS.maxExitingSeconds,
      ),
      maxBoardingSpeed: nonNegativeOr(
        options.maxBoardingSpeed,
        DEFAULT_OPTIONS.maxBoardingSpeed,
      ),
      maxExitSpeed: nonNegativeOr(
        options.maxExitSpeed,
        DEFAULT_OPTIONS.maxExitSpeed,
      ),
      exitReservationRadius: positiveOr(
        options.exitReservationRadius,
        DEFAULT_OPTIONS.exitReservationRadius,
      ),
      canReserveSeat:
        options.canReserveSeat ?? DEFAULT_OPTIONS.canReserveSeat,
      selectApproach:
        options.selectApproach ?? DEFAULT_OPTIONS.selectApproach,
      selectExit: options.selectExit ?? DEFAULT_OPTIONS.selectExit,
    };
  }

  requestBoarding(
    npc: INpc,
    vehicle: VehicleEntity,
    request: VehicleNpcBoardingRequest = {},
  ): VehicleNpcCrewAssignment | null {
    if (this.assignments.has(npc.id)) return null;
    const existingOccupant = vehicle.getOccupant(npc.id);
    if (existingOccupant) {
      return this.adoptMounted(npc, vehicle);
    }
    if (!this.canNpcApproach(npc) || !this.isVehicleBoardable(vehicle)) {
      return null;
    }

    const seat = this.selectSeat(npc, vehicle, request);
    if (!seat) return null;

    const candidates = this.anchorCandidates(vehicle, seat.id);
    const approach = this.options.selectApproach({
      npc,
      vehicle,
      seat,
      candidates,
    });
    if (!isValidSelection(approach, candidates)) return null;

    const arriveRadius = positiveOr(
      request.arriveRadius,
      this.options.arriveRadius,
    );
    const assignment: CrewAssignment = {
      npc,
      vehicle,
      seatId: seat.id,
      role: seat.role,
      phase: "approach",
      phaseElapsed: 0,
      blockedElapsed: 0,
      approachTarget: approach.position.clone(),
      approachIndex: approach.index,
      arriveRadius,
      exitTarget: null,
      exitIndex: null,
      emergencyExit: false,
    };

    this.reserveSeat(vehicle.id, seat.id, npc.id);
    this.assignments.set(npc.id, assignment);
    this.applyApproachOrder(assignment);
    return this.publicAssignment(assignment);
  }

  /**
   * Tracks authored/restored occupants so they can be evacuated even when they
   * did not approach through this coordinator.
   */
  adoptMounted(
    npc: INpc,
    vehicle: VehicleEntity,
  ): VehicleNpcCrewAssignment | null {
    const occupant = vehicle.getOccupant(npc.id);
    if (!occupant) return null;

    this.forget(npc.id);
    const assignment = this.mountedAssignment(npc, vehicle, occupant);
    this.assignments.set(npc.id, assignment);
    return this.publicAssignment(assignment);
  }

  update(deltaSeconds: number): void {
    const delta =
      Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;

    for (const assignment of [...this.assignments.values()]) {
      if (this.assignments.get(assignment.npc.id) !== assignment) continue;
      if (!assignment.npc.isAlive()) {
        this.forget(assignment.npc.id);
        continue;
      }

      switch (assignment.phase) {
        case "approach":
          this.updateApproach(assignment, delta);
          break;
        case "boarding":
          this.updateBoarding(assignment, delta);
          break;
        case "mounted":
          this.updateMounted(assignment);
          break;
        case "exiting":
          this.updateExiting(assignment, delta);
          break;
      }
    }
  }

  drainActions(): readonly VehicleNpcCrewAction[] {
    const pending = this.actions;
    this.actions = [];
    return pending;
  }

  confirmBoarded(actorId: string): boolean {
    const assignment = this.assignments.get(actorId);
    if (!assignment || assignment.phase !== "boarding") return false;

    const occupant = assignment.vehicle.getOccupant(actorId);
    if (!occupant) return false;
    this.transitionToMounted(assignment, occupant);
    return true;
  }

  requestExit(
    actorId: string,
    emergency = false,
  ): VehicleNpcExitRequestResult {
    const assignment = this.assignments.get(actorId);
    if (!assignment || assignment.phase !== "mounted") return "rejected";

    const occupant = assignment.vehicle.getOccupant(actorId);
    if (!occupant) {
      this.forget(actorId);
      return "rejected";
    }
    this.syncMountedSeat(assignment, occupant);

    if (
      !emergency &&
      this.vehicleSpeed(assignment.vehicle) > this.options.maxExitSpeed
    ) {
      this.pendingEvacuations.set(actorId, { emergency });
      return "queued";
    }

    const seat = this.seatPreset(assignment.vehicle, assignment.seatId);
    if (!seat) {
      this.pendingEvacuations.set(actorId, { emergency });
      return "queued";
    }

    let allCandidates = this.anchorCandidates(
      assignment.vehicle,
      assignment.seatId,
    );
    if (emergency && allCandidates.length === 0) {
      const center = assignment.vehicle.getWorldPosition(new Vector3());
      const outward = assignment.npc.position
        .clone()
        .sub(center)
        .setY(0);
      if (outward.lengthSq() < 1e-4) outward.set(1, 0, 0);
      outward
        .normalize()
        .multiplyScalar(
          assignment.vehicle.preset.navigation.halfWidth + 1.2,
        );
      allCandidates = [{
        index: -1,
        position: center.add(outward).add(new Vector3(0, 1, 0)),
      }];
    }
    const candidates = allCandidates.filter(
      (candidate) =>
        !this.isExitPositionReserved(
          assignment.vehicle.id,
          candidate.position,
          actorId,
        ),
    );
    if (candidates.length === 0) {
      this.pendingEvacuations.set(actorId, { emergency });
      return "queued";
    }

    const exit = this.options.selectExit({
      npc: assignment.npc,
      vehicle: assignment.vehicle,
      seat,
      candidates,
      emergency,
    });
    if (!isValidSelection(exit, candidates)) {
      this.pendingEvacuations.set(actorId, { emergency });
      return "queued";
    }

    this.reserveExit(
      assignment.vehicle.id,
      actorId,
      assignment.seatId,
      exit,
    );
    this.pendingEvacuations.delete(actorId);
    assignment.phase = "exiting";
    assignment.phaseElapsed = 0;
    assignment.exitTarget = exit.position.clone();
    assignment.exitIndex = exit.index;
    assignment.emergencyExit = emergency;
    this.removeQueuedActions(actorId);
    this.actions.push({
      type: "exit",
      npc: assignment.npc,
      vehicle: assignment.vehicle,
      seatId: assignment.seatId,
      role: assignment.role,
      exitPosition: exit.position.clone(),
      exitIndex: exit.index,
      emergency,
    });
    return "started";
  }

  evacuate(
    vehicle: VehicleEntity,
    emergency = false,
  ): VehicleNpcEvacuationResult {
    let exiting = 0;
    let queued = 0;
    let canceledApproaches = 0;

    for (const assignment of [...this.assignments.values()]) {
      if (assignment.vehicle !== vehicle && assignment.vehicle.id !== vehicle.id) {
        continue;
      }
      if (
        assignment.phase === "approach" ||
        assignment.phase === "boarding"
      ) {
        if (this.cancel(assignment.npc.id)) canceledApproaches += 1;
        continue;
      }
      if (assignment.phase === "exiting") {
        exiting += 1;
        continue;
      }

      const result = this.requestExit(assignment.npc.id, emergency);
      if (result === "started") exiting += 1;
      if (result === "queued") queued += 1;
    }

    return { exiting, queued, canceledApproaches };
  }

  confirmExited(actorId: string): boolean {
    const assignment = this.assignments.get(actorId);
    if (!assignment || assignment.phase !== "exiting") return false;
    this.forget(actorId);
    return true;
  }

  /**
   * Cancels intent, never physical occupancy. Approach/boarding is abandoned,
   * exiting returns to mounted, and mounted only drops a queued evacuation.
   */
  cancel(actorId: string): boolean {
    const assignment = this.assignments.get(actorId);
    if (!assignment) return false;

    if (
      assignment.phase === "approach" ||
      assignment.phase === "boarding"
    ) {
      this.forget(actorId);
      return true;
    }
    if (assignment.phase === "exiting") {
      this.releaseExit(assignment.vehicle.id, actorId);
      this.pendingEvacuations.delete(actorId);
      this.removeQueuedActions(actorId);
      assignment.phase = "mounted";
      assignment.phaseElapsed = 0;
      assignment.exitTarget = null;
      assignment.exitIndex = null;
      assignment.emergencyExit = false;
      return true;
    }
    return this.pendingEvacuations.delete(actorId);
  }

  cancelVehicle(vehicleId: string): number {
    let canceled = 0;
    for (const assignment of [...this.assignments.values()]) {
      if (assignment.vehicle.id !== vehicleId) continue;
      if (this.cancel(assignment.npc.id)) canceled += 1;
    }
    return canceled;
  }

  /**
   * Drops bookkeeping after death, unload, or external ownership changes. It
   * deliberately leaves both the NPC mount and VehicleEntity untouched.
   */
  forget(actorId: string): boolean {
    const assignment = this.assignments.get(actorId);
    if (!assignment) return false;

    if (
      assignment.phase === "approach" ||
      assignment.phase === "boarding"
    ) {
      assignment.npc.setVehicleApproach?.(null);
    }
    this.releaseSeat(
      assignment.vehicle.id,
      assignment.seatId,
      assignment.npc.id,
    );
    this.releaseExit(assignment.vehicle.id, actorId);
    this.pendingEvacuations.delete(actorId);
    this.removeQueuedActions(actorId);
    this.assignments.delete(actorId);
    return true;
  }

  getAssignment(actorId: string): VehicleNpcCrewAssignment | null {
    const assignment = this.assignments.get(actorId);
    return assignment ? this.publicAssignment(assignment) : null;
  }

  getAssignments(vehicleId?: string): readonly VehicleNpcCrewAssignment[] {
    return [...this.assignments.values()]
      .filter(
        (assignment) =>
          vehicleId === undefined || assignment.vehicle.id === vehicleId,
      )
      .map((assignment) => this.publicAssignment(assignment));
  }

  getSeatReservation(vehicleId: string, seatId: string): string | null {
    return this.seatReservations.get(vehicleId)?.get(seatId) ?? null;
  }

  getExitReservations(
    vehicleId: string,
  ): readonly VehicleNpcExitReservation[] {
    return [...(this.exitReservations.get(vehicleId)?.values() ?? [])].map(
      (reservation) => ({
        actorId: reservation.actorId,
        vehicleId,
        seatId: reservation.seatId,
        exitIndex: reservation.exitIndex,
        position: reservation.position.clone(),
      }),
    );
  }

  dispose(): void {
    for (const assignment of [...this.assignments.values()]) {
      this.forget(assignment.npc.id);
    }
    this.actions = [];
  }

  private updateApproach(
    assignment: CrewAssignment,
    delta: number,
  ): void {
    const occupant = assignment.vehicle.getOccupant(assignment.npc.id);
    if (occupant) {
      this.transitionToMounted(assignment, occupant);
      return;
    }
    if (
      !this.isVehicleBoardable(assignment.vehicle) ||
      !this.isSeatStillAvailable(assignment)
    ) {
      this.forget(assignment.npc.id);
      return;
    }

    assignment.phaseElapsed += delta;
    if (assignment.phaseElapsed > this.options.maxApproachSeconds) {
      this.forget(assignment.npc.id);
      return;
    }

    this.applyApproachOrder(assignment);
    const status = assignment.npc.getVehicleApproachStatus?.() ?? "none";
    if (status === "blocked") {
      assignment.blockedElapsed += delta;
      if (assignment.blockedElapsed > this.options.maxBlockedSeconds) {
        this.forget(assignment.npc.id);
      }
      return;
    }
    assignment.blockedElapsed = 0;

    const target = assignment.approachTarget;
    if (status !== "arrived" || !target) return;

    assignment.phase = "boarding";
    assignment.phaseElapsed = 0;
    this.removeQueuedActions(assignment.npc.id);
    this.actions.push({
      type: "board",
      npc: assignment.npc,
      vehicle: assignment.vehicle,
      seatId: assignment.seatId,
      role: assignment.role,
      approachPosition: target.clone(),
    });
  }

  private updateBoarding(
    assignment: CrewAssignment,
    delta: number,
  ): void {
    const occupant = assignment.vehicle.getOccupant(assignment.npc.id);
    if (occupant) {
      this.transitionToMounted(assignment, occupant);
      return;
    }
    if (
      !this.isVehicleBoardable(assignment.vehicle) ||
      !this.isSeatStillAvailable(assignment)
    ) {
      this.forget(assignment.npc.id);
      return;
    }

    assignment.phaseElapsed += delta;
    this.applyApproachOrder(assignment);
    if (assignment.phaseElapsed > this.options.maxBoardingSeconds) {
      this.forget(assignment.npc.id);
    }
  }

  private updateMounted(assignment: CrewAssignment): void {
    const occupant = assignment.vehicle.getOccupant(assignment.npc.id);
    if (!occupant) {
      this.forget(assignment.npc.id);
      return;
    }
    this.syncMountedSeat(assignment, occupant);
    const evacuation = this.pendingEvacuations.get(assignment.npc.id);
    if (evacuation) {
      this.requestExit(assignment.npc.id, evacuation.emergency);
    }
  }

  private updateExiting(
    assignment: CrewAssignment,
    delta: number,
  ): void {
    assignment.phaseElapsed += delta;
    if (assignment.phaseElapsed <= this.options.maxExitingSeconds) return;

    if (!assignment.vehicle.getOccupant(assignment.npc.id)) {
      this.confirmExited(assignment.npc.id);
      return;
    }
    this.cancel(assignment.npc.id);
  }

  private transitionToMounted(
    assignment: CrewAssignment,
    occupant: VehicleOccupant,
  ): void {
    this.releaseSeat(
      assignment.vehicle.id,
      assignment.seatId,
      assignment.npc.id,
    );
    assignment.npc.setVehicleApproach?.(null);
    assignment.seatId = occupant.seatId;
    assignment.role = occupant.role;
    assignment.phase = "mounted";
    assignment.phaseElapsed = 0;
    assignment.blockedElapsed = 0;
    assignment.approachTarget = null;
    assignment.approachIndex = null;
    assignment.exitTarget = null;
    assignment.exitIndex = null;
    assignment.emergencyExit = false;
    this.removeQueuedActions(assignment.npc.id);
  }

  private syncMountedSeat(
    assignment: CrewAssignment,
    occupant: VehicleOccupant,
  ): void {
    assignment.seatId = occupant.seatId;
    assignment.role = occupant.role;
  }

  private mountedAssignment(
    npc: INpc,
    vehicle: VehicleEntity,
    occupant: VehicleOccupant,
  ): CrewAssignment {
    return {
      npc,
      vehicle,
      seatId: occupant.seatId,
      role: occupant.role,
      phase: "mounted",
      phaseElapsed: 0,
      blockedElapsed: 0,
      approachTarget: null,
      approachIndex: null,
      arriveRadius: this.options.arriveRadius,
      exitTarget: null,
      exitIndex: null,
      emergencyExit: false,
    };
  }

  private selectSeat(
    npc: INpc,
    vehicle: VehicleEntity,
    request: VehicleNpcBoardingRequest,
  ): VehicleSeatPreset | null {
    const rolePriority = request.roles ?? this.options.rolePriority;
    const allowedRoles = new Set(rolePriority);
    const preferred = request.preferredSeatId
      ? vehicle.preset.seats.find(
          (seat) =>
            seat.id === request.preferredSeatId &&
            allowedRoles.has(seat.role),
        )
      : null;
    if (preferred && this.canReserveSeat(npc, vehicle, preferred)) {
      return preferred;
    }

    for (const role of rolePriority) {
      const seat = vehicle.preset.seats.find(
        (candidate) =>
          candidate.role === role &&
          this.canReserveSeat(npc, vehicle, candidate),
      );
      if (seat) return seat;
    }
    return null;
  }

  private canReserveSeat(
    npc: INpc,
    vehicle: VehicleEntity,
    seat: VehicleSeatPreset,
  ): boolean {
    if (
      vehicle.getOccupants().some(
        (occupant) => occupant.seatId === seat.id,
      ) ||
      this.getSeatReservation(vehicle.id, seat.id)
    ) {
      return false;
    }
    if (
      !canUseVehicleRole(
        {
          kind: "npc",
          faction: npc.faction,
          vehicleCapability: npc.vehicleCapability,
        },
        vehicle.definition,
        seat.role,
      )
    ) {
      return false;
    }
    return this.options.canReserveSeat({ npc, vehicle, seat });
  }

  private canNpcApproach(npc: INpc): boolean {
    return Boolean(
      npc.isAlive() &&
        npc.vehicleCapability &&
        npc.setVehicleApproach &&
        npc.getVehicleApproachStatus &&
        !npc.isVehicleMounted?.(),
    );
  }

  private isVehicleBoardable(vehicle: VehicleEntity): boolean {
    const damageState = vehicle.damage.getState();
    return (
      vehicle.isEnabled() &&
      !vehicle.isLocked() &&
      !vehicle.isCrashing() &&
      !vehicle.isWreckage() &&
      !vehicle.damage.isBurning() &&
      damageState !== "disabled" &&
      damageState !== "crashing" &&
      damageState !== "destroyed" &&
      this.vehicleSpeed(vehicle) <= this.options.maxBoardingSpeed
    );
  }

  private vehicleSpeed(vehicle: VehicleEntity): number {
    return vehicle.getLinearVelocity().length();
  }

  private isSeatStillAvailable(assignment: CrewAssignment): boolean {
    const occupant = assignment.vehicle
      .getOccupants()
      .find((candidate) => candidate.seatId === assignment.seatId);
    if (occupant && occupant.actor !== assignment.npc.id) return false;
    return (
      this.getSeatReservation(
        assignment.vehicle.id,
        assignment.seatId,
      ) === assignment.npc.id
    );
  }

  private applyApproachOrder(assignment: CrewAssignment): void {
    const target = assignment.approachTarget;
    if (!target) return;
    const order: NpcVehicleApproachOrder = {
      vehicleId: assignment.vehicle.id,
      seatId: assignment.seatId,
      target: target.clone(),
      facing: assignment.vehicle.getWorldPosition(new Vector3()),
      arriveRadius: assignment.arriveRadius,
    };
    assignment.npc.setVehicleApproach?.(order);
  }

  private anchorCandidates(
    vehicle: VehicleEntity,
    seatId: string,
  ): readonly VehicleNpcAnchorCandidate[] {
    return vehicle.getExitWorldPositions(seatId).map((position, index) => ({
      index,
      position,
    }));
  }

  private seatPreset(
    vehicle: VehicleEntity,
    seatId: string,
  ): VehicleSeatPreset | null {
    return vehicle.preset.seats.find((seat) => seat.id === seatId) ?? null;
  }

  private reserveSeat(
    vehicleId: string,
    seatId: string,
    actorId: string,
  ): void {
    let reservations = this.seatReservations.get(vehicleId);
    if (!reservations) {
      reservations = new Map();
      this.seatReservations.set(vehicleId, reservations);
    }
    reservations.set(seatId, actorId);
  }

  private releaseSeat(
    vehicleId: string,
    seatId: string,
    actorId: string,
  ): void {
    const reservations = this.seatReservations.get(vehicleId);
    if (reservations?.get(seatId) !== actorId) return;
    reservations.delete(seatId);
    if (reservations.size === 0) this.seatReservations.delete(vehicleId);
  }

  private reserveExit(
    vehicleId: string,
    actorId: string,
    seatId: string,
    selection: VehicleNpcAnchorSelection,
  ): void {
    let reservations = this.exitReservations.get(vehicleId);
    if (!reservations) {
      reservations = new Map();
      this.exitReservations.set(vehicleId, reservations);
    }
    reservations.set(actorId, {
      actorId,
      seatId,
      exitIndex: selection.index,
      position: selection.position.clone(),
    });
  }

  private releaseExit(vehicleId: string, actorId: string): void {
    const reservations = this.exitReservations.get(vehicleId);
    if (!reservations) return;
    reservations.delete(actorId);
    if (reservations.size === 0) this.exitReservations.delete(vehicleId);
  }

  private isExitPositionReserved(
    vehicleId: string,
    position: Vector3,
    exceptActorId: string,
  ): boolean {
    const reservations = this.exitReservations.get(vehicleId);
    if (!reservations) return false;
    const radiusSquared =
      this.options.exitReservationRadius *
      this.options.exitReservationRadius;
    return [...reservations.values()].some(
      (reservation) =>
        reservation.actorId !== exceptActorId &&
        horizontalDistanceSquared(reservation.position, position) <
          radiusSquared,
    );
  }

  private removeQueuedActions(actorId: string): void {
    this.actions = this.actions.filter((action) => action.npc.id !== actorId);
  }

  private publicAssignment(
    assignment: CrewAssignment,
  ): VehicleNpcCrewAssignment {
    return {
      actorId: assignment.npc.id,
      vehicleId: assignment.vehicle.id,
      seatId: assignment.seatId,
      role: assignment.role,
      phase: assignment.phase,
      approachTarget: assignment.approachTarget?.clone() ?? null,
      exitTarget: assignment.exitTarget?.clone() ?? null,
      emergencyExit: assignment.emergencyExit,
    };
  }
}

function selectClosestAnchor(
  context: VehicleNpcApproachContext,
): VehicleNpcAnchorSelection | null {
  let selected: VehicleNpcAnchorCandidate | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of context.candidates) {
    const distance = horizontalDistanceSquared(
      context.npc.position,
      candidate.position,
    );
    if (distance >= bestDistance) continue;
    selected = candidate;
    bestDistance = distance;
  }
  return selected
    ? { index: selected.index, position: selected.position.clone() }
    : null;
}

function isValidSelection(
  selection: VehicleNpcAnchorSelection | null,
  candidates: readonly VehicleNpcAnchorCandidate[],
): selection is VehicleNpcAnchorSelection {
  return Boolean(
    selection &&
      Number.isInteger(selection.index) &&
      Number.isFinite(selection.position.x) &&
      Number.isFinite(selection.position.y) &&
      Number.isFinite(selection.position.z) &&
      candidates.some((candidate) => candidate.index === selection.index),
  );
}

function horizontalDistanceSquared(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function nonNegativeOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}
