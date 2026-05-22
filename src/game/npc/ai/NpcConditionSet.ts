export type NpcCondition =
  | "SeeEnemy"
  | "LostEnemy"
  | "HeardDanger"
  | "LowHealth"
  | "NeedsReload"
  | "HasCover"
  | "PathFailed"
  | "Stuck"
  | "SquadOrder"
  | "EnemyDead"
  | "InMeleeRange"
  | "TooFarFromLeader";

export class NpcConditionSet {
  private readonly values = new Set<NpcCondition>();

  set(condition: NpcCondition, active = true): void {
    if (active) {
      this.values.add(condition);
    } else {
      this.values.delete(condition);
    }
  }

  has(condition: NpcCondition): boolean {
    return this.values.has(condition);
  }

  clear(): void {
    this.values.clear();
  }

  replace(conditions: Iterable<NpcCondition>): void {
    this.values.clear();
    for (const condition of conditions) {
      this.values.add(condition);
    }
  }

  toArray(): NpcCondition[] {
    return [...this.values].sort();
  }
}
