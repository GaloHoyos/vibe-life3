import { Time } from './Time';

export type GameLoopCallback = (time: Time) => void;

/**
 * Loop principal sobre `requestAnimationFrame`. Acepta un único callback
 * y le pasa un `Time` con `delta`/`elapsed`/`fps` calculados. Idempotente:
 * llamadas dobles a `start` mientras corre son no-op.
 */
export class GameLoop {
  readonly time = new Time();

  private animationFrame = 0;
  private running = false;
  private callback: GameLoopCallback | null = null;

  start(callback: GameLoopCallback): void {
    if (this.running) {
      return;
    }

    this.callback = callback;
    this.running = true;
    this.time.reset();
    this.animationFrame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    cancelAnimationFrame(this.animationFrame);
  }

  private readonly tick = (now: number): void => {
    if (!this.running || !this.callback) {
      return;
    }

    this.time.update(now);
    this.callback(this.time);
    this.animationFrame = requestAnimationFrame(this.tick);
  };
}
