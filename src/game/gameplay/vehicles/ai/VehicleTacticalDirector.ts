import { VEHICLE_TACTICAL_SELECTOR } from '@game/config/vehicleTactics.config';
import { VEHICLE_TACTIC_CATALOG } from './VehicleTacticCatalog';
import { VehicleTacticMemory } from './VehicleTacticMemory';
import type {
  VehicleTacticalAnchor,
  VehicleTacticalDecision,
  VehicleTacticalDoctrine,
  VehicleTacticalSituation,
  VehicleTacticCandidate,
  VehicleTacticFailureReason,
  VehicleTacticId,
  VehicleTacticMemoryScope,
} from './VehicleTacticalTypes';

export class VehicleTacticalDirector {
  readonly memory = new VehicleTacticMemory();
  private current: VehicleTacticalDecision | null = null;
  private objectiveKey = '';

  constructor(private readonly doctrine: VehicleTacticalDoctrine) {}

  decide(situation: VehicleTacticalSituation): VehicleTacticalDecision | null {
    const objectiveKey = keyForObjective(situation);
    if (objectiveKey !== this.objectiveKey) {
      this.objectiveKey = objectiveKey;
      this.current = null;
    }

    const scope = scopeForSituation(situation);
    const candidates = this.scoreCandidates(situation, scope);
    if (candidates.length === 0) {
      this.current = null;
      return null;
    }

    const best = candidates[0];
    const currentCandidate = this.current
      ? candidates.find((candidate) => candidate.tactic === this.current?.tactic)
      : undefined;
    let selected = best;
    if (this.current && currentCandidate) {
      const committed = situation.nowSeconds < this.current.committedUntilSeconds;
      const lacksMargin = best.tactic !== currentCandidate.tactic &&
        best.utility < currentCandidate.utility + VEHICLE_TACTICAL_SELECTOR.switchMargin;
      if (committed || lacksMargin) selected = currentCandidate;
    }

    const changed = this.current?.tactic !== selected.tactic;
    const anchorState = this.resolveAnchor(situation, changed);
    const decision: VehicleTacticalDecision = {
      tactic: selected.tactic,
      utility: selected.utility,
      changed,
      committedUntilSeconds: changed
        ? situation.nowSeconds + VEHICLE_TACTICAL_SELECTOR.commitSeconds
        : this.current?.committedUntilSeconds ?? situation.nowSeconds,
      anchor: anchorState.anchor,
      anchorUntilSeconds: anchorState.until,
      candidates,
    };
    this.current = decision;
    return decision;
  }

  reportFailure(
    situation: VehicleTacticalSituation,
    tactic: VehicleTacticId,
    reason: VehicleTacticFailureReason,
  ): void {
    this.memory.recordFailure(
      scopeForSituation(situation),
      tactic,
      reason,
      situation.nowSeconds,
    );
    if (this.current?.tactic === tactic) {
      this.current = {
        ...this.current,
        committedUntilSeconds: situation.nowSeconds,
      };
    }
  }

  reportProgress(
    situation: VehicleTacticalSituation,
    meters: number,
  ): boolean {
    return this.memory.recordProgress(
      scopeForSituation(situation),
      meters,
      situation.nowSeconds,
    );
  }

  getDecision(): VehicleTacticalDecision | null {
    return this.current;
  }

  reset(): void {
    this.current = null;
    this.objectiveKey = '';
    this.memory.clear();
  }

  private scoreCandidates(
    situation: VehicleTacticalSituation,
    scope: VehicleTacticMemoryScope,
  ): VehicleTacticCandidate[] {
    return VEHICLE_TACTIC_CATALOG.flatMap((definition) => {
      if (!definition.applicable(situation)) return [];
      const assessment = this.memory.assess(
        scope,
        definition.id,
        situation.nowSeconds,
      );
      const baseUtility = this.doctrine.utility[definition.id];
      const situationUtility = definition.situationUtility(situation, this.doctrine);
      return [{
        tactic: definition.id,
        baseUtility,
        situationUtility,
        failurePenalty: assessment.penalty,
        coolingDown: assessment.coolingDown,
        utility: baseUtility + situationUtility - assessment.penalty,
      }];
    }).sort((left, right) => right.utility - left.utility);
  }

  private resolveAnchor(
    situation: VehicleTacticalSituation,
    tacticChanged: boolean,
  ): { anchor: VehicleTacticalAnchor | null; until: number } {
    if (
      !tacticChanged &&
      this.current &&
      situation.nowSeconds < this.current.anchorUntilSeconds
    ) {
      return {
        anchor: this.current.anchor,
        until: this.current.anchorUntilSeconds,
      };
    }
    const preferred = situation.preferredAnchor;
    return {
      anchor: preferred
        ? { key: preferred.key, position: [...preferred.position] }
        : null,
      until: situation.nowSeconds + VEHICLE_TACTICAL_SELECTOR.anchorHoldSeconds,
    };
  }
}

export function scopeForSituation(
  situation: VehicleTacticalSituation,
): VehicleTacticMemoryScope {
  return {
    objectiveId: situation.objective?.id ?? 'autonomous',
    objectiveRevision: situation.objective?.revision ?? 0,
    context: situation.memoryContext ?? 'global',
  };
}

function keyForObjective(situation: VehicleTacticalSituation): string {
  return JSON.stringify([
    situation.objective?.id ?? 'autonomous',
    situation.objective?.revision ?? 0,
  ]);
}
