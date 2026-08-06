import { VEHICLE_TACTICAL_SELECTOR } from '@game/config/vehicleTactics.config';
import type {
  VehicleTacticAttempt,
  VehicleTacticFailureReason,
  VehicleTacticId,
  VehicleTacticMemoryScope,
} from './VehicleTacticalTypes';

export interface VehicleTacticMemoryAssessment {
  readonly failures: number;
  readonly penalty: number;
  readonly coolingDown: boolean;
}

export class VehicleTacticMemory {
  private attempts: VehicleTacticAttempt[] = [];
  private readonly progressByScope = new Map<string, number>();

  recordFailure(
    scope: VehicleTacticMemoryScope,
    tactic: VehicleTacticId,
    reason: VehicleTacticFailureReason,
    nowSeconds: number,
  ): void {
    this.purge(nowSeconds);
    this.progressByScope.set(scopeKey(scope), 0);
    this.attempts.push({ scope: { ...scope }, tactic, reason, atSeconds: nowSeconds });
    const overflow = this.attempts.length -
      VEHICLE_TACTICAL_SELECTOR.memory.maxAttempts;
    if (overflow > 0) this.attempts.splice(0, overflow);
  }

  assess(
    scope: VehicleTacticMemoryScope,
    tactic: VehicleTacticId,
    nowSeconds: number,
  ): VehicleTacticMemoryAssessment {
    this.purge(nowSeconds);
    const matching = this.attempts.filter(
      (attempt) => attempt.tactic === tactic && sameScope(attempt.scope, scope),
    );
    const newest = matching.at(-1);
    const coolingDown =
      matching.length >= VEHICLE_TACTICAL_SELECTOR.memory.failuresBeforeCooldown &&
      newest !== undefined &&
      nowSeconds - newest.atSeconds < VEHICLE_TACTICAL_SELECTOR.memory.cooldownSeconds;
    return {
      failures: matching.length,
      penalty:
        matching.length * VEHICLE_TACTICAL_SELECTOR.memory.failurePenalty +
        (coolingDown ? VEHICLE_TACTICAL_SELECTOR.memory.cooldownPenalty : 0),
      coolingDown,
    };
  }

  recordProgress(
    scope: VehicleTacticMemoryScope,
    meters: number,
    nowSeconds: number,
  ): boolean {
    this.purge(nowSeconds);
    if (meters <= 0) return false;
    const key = scopeKey(scope);
    const progress = (this.progressByScope.get(key) ?? 0) + meters;
    if (progress < VEHICLE_TACTICAL_SELECTOR.memory.progressClearMeters) {
      this.progressByScope.set(key, progress);
      return false;
    }
    this.progressByScope.delete(key);
    const previousLength = this.attempts.length;
    this.attempts = this.attempts.filter(
      (attempt) => !sameScope(attempt.scope, scope),
    );
    return this.attempts.length !== previousLength;
  }

  attemptsAt(nowSeconds: number): readonly VehicleTacticAttempt[] {
    this.purge(nowSeconds);
    return this.attempts;
  }

  clear(): void {
    this.attempts = [];
    this.progressByScope.clear();
  }

  private purge(nowSeconds: number): void {
    this.attempts = this.attempts.filter(
      (attempt) =>
        nowSeconds - attempt.atSeconds < VEHICLE_TACTICAL_SELECTOR.memory.ttlSeconds,
    );
    const liveScopes = new Set(this.attempts.map((attempt) => scopeKey(attempt.scope)));
    for (const key of this.progressByScope.keys()) {
      if (!liveScopes.has(key)) this.progressByScope.delete(key);
    }
  }
}

function sameScope(
  left: VehicleTacticMemoryScope,
  right: VehicleTacticMemoryScope,
): boolean {
  return left.objectiveId === right.objectiveId &&
    left.objectiveRevision === right.objectiveRevision &&
    left.context === right.context;
}

function scopeKey(scope: VehicleTacticMemoryScope): string {
  return JSON.stringify([
    scope.objectiveId,
    scope.objectiveRevision,
    scope.context,
  ]);
}
