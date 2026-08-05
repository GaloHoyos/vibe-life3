import {
  VEHICLE_OBJECTIVE_SOURCES,
  type VehicleObjective,
  type VehicleObjectiveFailure,
  type VehicleObjectiveRequest,
  type VehicleObjectiveSource,
  type VehicleObjectiveTarget,
  type VehicleObjectiveTransition,
} from './VehicleTacticalTypes';

const OUTCOME_LIMIT = 16;

export class VehicleObjectiveController {
  private readonly objectives = new Map<VehicleObjectiveSource, VehicleObjective>();
  private readonly recentOutcomes: VehicleObjective[] = [];

  assign(request: VehicleObjectiveRequest): VehicleObjectiveTransition {
    const previousActive = this.active();
    const current = this.objectives.get(request.source);
    if (current && current.revision >= request.revision) {
      return unchanged(previousActive);
    }

    let outcome: VehicleObjective | null = null;
    if (current && current.id !== request.id) {
      outcome = this.finish(current, 'cancelled', request.issuedAtSeconds);
      this.rememberOutcome(outcome);
    }
    this.objectives.set(request.source, {
      ...request,
      target: cloneTarget(request.target),
      status: 'queued',
      updatedAtSeconds: request.issuedAtSeconds,
    });
    this.reconcile(request.issuedAtSeconds);
    return transition(previousActive, this.active(), outcome, true);
  }

  cancel(
    id: string,
    revision: number,
    nowSeconds: number,
  ): VehicleObjectiveTransition {
    return this.resolve(id, revision, nowSeconds, 'cancelled');
  }

  complete(
    id: string,
    revision: number,
    nowSeconds: number,
  ): VehicleObjectiveTransition {
    return this.resolve(id, revision, nowSeconds, 'completed');
  }

  fail(
    id: string,
    revision: number,
    failure: VehicleObjectiveFailure,
  ): VehicleObjectiveTransition {
    const previousActive = this.active();
    const entry = this.find(id, revision);
    if (!entry) return unchanged(previousActive);
    const outcome: VehicleObjective = {
      ...entry.objective,
      status: 'failed',
      updatedAtSeconds: failure.atSeconds,
      failure,
    };
    this.objectives.delete(entry.source);
    this.rememberOutcome(outcome);
    this.reconcile(failure.atSeconds);
    return transition(previousActive, this.active(), outcome);
  }

  active(): VehicleObjective | null {
    for (const source of VEHICLE_OBJECTIVE_SOURCES) {
      const objective = this.objectives.get(source);
      if (objective) return objective;
    }
    return null;
  }

  objective(source: VehicleObjectiveSource): VehicleObjective | null {
    return this.objectives.get(source) ?? null;
  }

  pending(): readonly VehicleObjective[] {
    return VEHICLE_OBJECTIVE_SOURCES.flatMap((source) => {
      const objective = this.objectives.get(source);
      return objective ? [objective] : [];
    });
  }

  outcomes(): readonly VehicleObjective[] {
    return this.recentOutcomes;
  }

  reset(): void {
    this.objectives.clear();
    this.recentOutcomes.length = 0;
  }

  private resolve(
    id: string,
    revision: number,
    nowSeconds: number,
    status: 'cancelled' | 'completed',
  ): VehicleObjectiveTransition {
    const previousActive = this.active();
    const entry = this.find(id, revision);
    if (!entry) return unchanged(previousActive);
    const outcome = this.finish(entry.objective, status, nowSeconds);
    this.objectives.delete(entry.source);
    this.rememberOutcome(outcome);
    this.reconcile(nowSeconds);
    return transition(previousActive, this.active(), outcome);
  }

  private find(
    id: string,
    revision: number,
  ): { source: VehicleObjectiveSource; objective: VehicleObjective } | null {
    for (const [source, objective] of this.objectives) {
      if (objective.id === id && objective.revision === revision) {
        return { source, objective };
      }
    }
    return null;
  }

  private finish(
    objective: VehicleObjective,
    status: 'cancelled' | 'completed',
    nowSeconds: number,
  ): VehicleObjective {
    return { ...objective, status, updatedAtSeconds: nowSeconds };
  }

  private reconcile(nowSeconds: number): void {
    let activeAssigned = false;
    for (const source of VEHICLE_OBJECTIVE_SOURCES) {
      const objective = this.objectives.get(source);
      if (!objective) continue;
      const status = activeAssigned ? 'queued' : 'active';
      activeAssigned = true;
      if (objective.status !== status) {
        this.objectives.set(source, {
          ...objective,
          status,
          updatedAtSeconds: nowSeconds,
        });
      }
    }
  }

  private rememberOutcome(outcome: VehicleObjective): void {
    this.recentOutcomes.push(outcome);
    if (this.recentOutcomes.length > OUTCOME_LIMIT) this.recentOutcomes.shift();
  }
}

function transition(
  previousActive: VehicleObjective | null,
  active: VehicleObjective | null,
  outcome: VehicleObjective | null,
  acceptedAssignment = false,
): VehicleObjectiveTransition {
  return {
    previousActive,
    active,
    outcome,
    changed: acceptedAssignment ||
      previousActive?.id !== active?.id ||
      previousActive?.revision !== active?.revision ||
      outcome !== null,
  };
}

function unchanged(active: VehicleObjective | null): VehicleObjectiveTransition {
  return { previousActive: active, active, outcome: null, changed: false };
}

function cloneTarget(target: VehicleObjectiveTarget): VehicleObjectiveTarget {
  switch (target.type) {
    case 'none':
      return target;
    case 'position':
      return { ...target, position: [...target.position] };
    case 'entity':
      return target.lastKnownPosition
        ? { ...target, lastKnownPosition: [...target.lastKnownPosition] }
        : target;
    case 'route':
      return { ...target, points: target.points.map((point) => [...point]) };
    case 'area':
      return { ...target, center: [...target.center] };
  }
}
