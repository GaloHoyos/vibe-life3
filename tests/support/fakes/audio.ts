import type { Object3D, Vector3 } from "three";
import type {
  PositionalAudioOptions,
  PositionalSoundManager,
} from "@engine/audio/core/PositionalSoundManager";
import type { PlayOptions, SoundManager } from "@engine/audio/core/SoundManager";

export interface PlayedSound {
  id: string;
  options: PlayOptions;
}

export interface FadedSound {
  id: string;
  duration: number;
}

export interface PositionalSoundCall {
  id: string;
  object?: Object3D;
  position?: Vector3;
  options: PositionalAudioOptions;
}

export type FakePositionalSoundManager = PositionalSoundManager & {
  readonly attachedCalls: PositionalSoundCall[];
  readonly followed: PositionalSoundCall[];
  readonly playedAt: PositionalSoundCall[];
  readonly stopped: Object3D[];
};

export type FakeSoundManager = SoundManager & {
  readonly available: Set<string>;
  readonly played: PlayedSound[];
  readonly fadedOut: FadedSound[];
};

export function fakePositionalSounds(): FakePositionalSoundManager {
  const attachedCalls: PositionalSoundCall[] = [];
  const followed: PositionalSoundCall[] = [];
  const playedAt: PositionalSoundCall[] = [];
  const stopped: Object3D[] = [];

  return {
    attachedCalls,
    followed,
    playedAt,
    stopped,
    playAt: (id: string, position: Vector3, options: PositionalAudioOptions = {}) => {
      playedAt.push({ id, position, options });
    },
    playFollowing: (id: string, object: Object3D, options: PositionalAudioOptions = {}) => {
      followed.push({ id, object, options });
    },
    attachToObject: (id: string, object: Object3D, options: PositionalAudioOptions = {}) => {
      attachedCalls.push({ id, object, options });
    },
    stopAttached: (object: Object3D) => {
      stopped.push(object);
    },
    clear: () => undefined,
  } as unknown as FakePositionalSoundManager;
}

export function fakeSoundManager(soundIds: Iterable<string> = []): FakeSoundManager {
  const available = new Set(soundIds);
  const played: PlayedSound[] = [];
  const fadedOut: FadedSound[] = [];

  return {
    available,
    played,
    fadedOut,
    hasSound: (soundId: string) => available.has(soundId),
    preload: () => undefined,
    play: (id: string, options: PlayOptions = {}) => {
      played.push({ id, options });
    },
    playLoop: (id: string, options: PlayOptions = {}) => {
      played.push({ id, options: { ...options, loop: true } });
    },
    stop: () => undefined,
    fadeOut: (id: string, duration?: number) => {
      fadedOut.push({ id, duration: duration ?? 1 });
    },
    setBusVolume: () => undefined,
    getClip: (id: string) =>
      available.has(id)
        ? {
            id,
            path: `${id}.wav`,
            source: `${id}.wav`,
            loop: false,
            bus: "world" as const,
            role: "impact" as const,
          }
        : null,
    getBuffer: async () => null,
  } as unknown as FakeSoundManager;
}
