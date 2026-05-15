import { AudioManifest } from "./AudioManifest";
import type { SoundManager } from "./SoundManager";

export class BackgroundAmbienceSystem {
  private readonly activeIds = new Set<string>();

  constructor(private readonly sounds: SoundManager) {}

  startForLevel(levelId: string): void {
    if (levelId !== "demo") {
      return;
    }

    const ambienceIds = ["background.wind"];

    ambienceIds.forEach((id) => {
      if (this.activeIds.has(id)) {
        return;
      }
      this.activeIds.add(id);
      const clip = AudioManifest.background.wind;
      this.sounds.playLoop(id, { volume: clip.volume, fadeIn: 2 });
    });
  }

  stopForLevel(levelId: string): void {
    if (levelId !== "demo") {
      return;
    }

    this.fadeOut(1.4);
  }

  fadeIn(duration = 2): void {
    this.activeIds.forEach((id) => {
      this.sounds.playLoop(id, { fadeIn: duration });
    });
  }

  fadeOut(duration = 1.2): void {
    this.activeIds.forEach((id) => {
      this.sounds.fadeOut(id, duration);
    });
    this.activeIds.clear();
  }
}
