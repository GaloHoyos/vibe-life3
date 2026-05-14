export class Time {
  delta = 0;
  elapsed = 0;
  frame = 0;
  fps = 0;

  private lastTimestamp = 0;
  private smoothedDelta = 1 / 60;

  reset(now = performance.now()): void {
    this.delta = 0;
    this.elapsed = 0;
    this.frame = 0;
    this.fps = 0;
    this.lastTimestamp = now;
    this.smoothedDelta = 1 / 60;
  }

  update(now: number): void {
    if (this.lastTimestamp === 0) {
      this.reset(now);
      return;
    }

    const rawDelta = (now - this.lastTimestamp) / 1000;
    this.delta = Math.min(rawDelta, 1 / 20);
    this.elapsed += this.delta;
    this.frame += 1;
    this.lastTimestamp = now;
    this.smoothedDelta = this.smoothedDelta * 0.9 + this.delta * 0.1;
    this.fps = this.smoothedDelta > 0 ? 1 / this.smoothedDelta : 0;
  }
}
