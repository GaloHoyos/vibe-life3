import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { PlayOptions, SoundManager } from "@engine/audio/core/SoundManager";

export interface PlayedSound {
  id: string;
  options: PlayOptions;
}

export type FakeSoundManager = SoundManager & {
  readonly available: Set<string>;
  readonly played: PlayedSound[];
};

export function fakePositionalSounds(): PositionalSoundManager {
  return {
    playAt: () => undefined,
    clear: () => undefined,
  } as unknown as PositionalSoundManager;
}

export function fakeSoundManager(soundIds: Iterable<string> = []): FakeSoundManager {
  const available = new Set(soundIds);
  const played: PlayedSound[] = [];

  return {
    available,
    played,
    hasSound: (soundId: string) => available.has(soundId),
    preload: () => undefined,
    play: (id: string, options: PlayOptions = {}) => {
      played.push({ id, options });
    },
    playLoop: (id: string, options: PlayOptions = {}) => {
      played.push({ id, options: { ...options, loop: true } });
    },
    stop: () => undefined,
    fadeOut: () => undefined,
    stopAllByCategory: () => undefined,
    setBusVolume: () => undefined,
    getBuffer: async () => null,
  } as unknown as FakeSoundManager;
}
