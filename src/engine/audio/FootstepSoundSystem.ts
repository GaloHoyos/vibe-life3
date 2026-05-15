import type { SoundManager } from "./SoundManager";

export class FootstepSoundSystem {
  private cooldown = 0;
  private readonly snowSteps = [
    "footsteps.snow1",
    "footsteps.snow2",
    "footsteps.snow3",
    "footsteps.snow4",
  ];

  constructor(private readonly sounds: SoundManager) {}

  update(delta: number, speed: number): void {
    if (speed <= 0) {
      return;
    }

    this.cooldown -= delta;
    if (this.cooldown > 0) {
      return;
    }

    this.cooldown = 0.45;
    const soundId = this.pickRandom(this.snowSteps) ?? "footsteps.concrete1";
    if (this.sounds.hasSound(soundId)) {
      this.sounds.play(soundId, { bus: "footsteps" });
    }
  }

  private pickRandom(items: string[]): string | null {
    if (items.length === 0) {
      return null;
    }
    const index = Math.floor(Math.random() * items.length);
    return items[index] ?? null;
  }
}
