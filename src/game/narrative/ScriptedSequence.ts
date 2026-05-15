export type ScriptStep = {
  delay: number;
  action: () => void;
};

export class ScriptedSequence {
  private elapsed = 0;
  private cursor = 0;
  private playing = false;

  constructor(private readonly steps: ScriptStep[]) {}

  play(): void {
    this.elapsed = 0;
    this.cursor = 0;
    this.playing = true;
  }

  update(delta: number): void {
    if (!this.playing || this.cursor >= this.steps.length) {
      return;
    }

    this.elapsed += delta;
    const step = this.steps[this.cursor];

    if (this.elapsed >= step.delay) {
      step.action();
      this.cursor += 1;
    }

    if (this.cursor >= this.steps.length) {
      this.playing = false;
    }
  }
}
