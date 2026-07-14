/**
 * Estado de tiempo del game loop. Lo actualiza `GameLoop`; los sistemas
 * lo consumen como snapshot read-only por frame.
 *
 * `delta` viene clamped a 1/20 s (50 ms) para que físicas y animaciones
 * no se vuelvan locas tras un tab inactivo. `fps` está suavizado.
 */
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
    this.lastTimestamp = Number.isFinite(now) ? now : 0;
    this.smoothedDelta = 1 / 60;
  }

  update(now: number): void {
    if (this.lastTimestamp === 0) {
      this.reset(now);
      return;
    }

    // RAF's frame timestamp and the performance.now() sampled by reset() are
    // not guaranteed to describe the same instant. In particular, the first
    // callback can carry a timestamp just behind the startup sample. Keep the
    // shared frame clock monotonic so no downstream timer receives a negative
    // or non-finite delta, and do not move the baseline when that happens.
    const monotonicNow = Number.isFinite(now)
      ? Math.max(now, this.lastTimestamp)
      : this.lastTimestamp;
    const rawDelta = (monotonicNow - this.lastTimestamp) / 1000;
    this.delta = Math.min(rawDelta, 1 / 20);
    this.elapsed += this.delta;
    this.frame += 1;
    this.lastTimestamp = monotonicNow;
    this.smoothedDelta = this.smoothedDelta * 0.9 + this.delta * 0.1;
    this.fps = this.smoothedDelta > 0 ? 1 / this.smoothedDelta : 0;
  }
}
