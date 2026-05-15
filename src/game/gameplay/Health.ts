export class Health {
  current: number;
  private depleted = false;

  constructor(readonly max: number) {
    this.current = max;
  }

  applyDamage(amount: number): number {
    if (this.depleted) {
      return this.current;
    }

    this.current = Math.max(0, this.current - amount);
    this.depleted = this.current <= 0;
    return this.current;
  }

  heal(amount: number): number {
    this.current = Math.min(this.max, this.current + amount);
    this.depleted = this.current <= 0;
    return this.current;
  }

  reset(): void {
    this.current = this.max;
    this.depleted = false;
  }

  isAlive(): boolean {
    return this.current > 0;
  }

  wasDepleted(): boolean {
    return this.depleted;
  }
}
