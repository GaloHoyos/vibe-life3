import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { SurfaceType } from "@shared/types/Surface";

export interface FootstepSoundConfig {
  /** Tiempo (s) entre pasos cuando el caminante está a velocidad plena. */
  stepCooldown: number;
}

const DefaultFootstepConfig: FootstepSoundConfig = {
  stepCooldown: 0.45,
};

/** Desafinación aleatoria por paso (cents) para romper la repetición. */
const StepDetuneRange = 90;
/** Jitter de volumen por paso. */
const StepVolumeJitter = 0.12;

/**
 * Reproduce pasos eligiendo el pool según la superficie sobre la que se
 * camina. La capa de juego provee los pools por superficie con
 * `setSurfacePools(...)` y un pool default con `setSounds(...)` (fallback
 * cuando la superficie es desconocida o no está tagueada). En cada paso el
 * sistema consulta `resolveSurface()` — solo en el frame que toca paso — para
 * decidir el pool, y aplica variación de pitch/volumen para que no suene
 * repetitivo.
 */
export class FootstepSoundSystem {
  private cooldown = 0;
  private defaultPool: readonly string[] = [];
  private surfacePools: Partial<Record<SurfaceType, readonly string[]>> = {};
  private config: FootstepSoundConfig = DefaultFootstepConfig;

  constructor(private readonly sounds: SoundManager) {}

  /** Pool default del nivel (fallback sin superficie). */
  setSounds(soundIds: readonly string[]): void {
    this.defaultPool = soundIds;
  }

  /** Pools por superficie (tabla data-driven del juego). */
  setSurfacePools(pools: Partial<Record<SurfaceType, readonly string[]>>): void {
    this.surfacePools = pools;
  }

  /** Ajusta cadencia y otros parámetros (típicamente desde game/config). */
  configure(config: FootstepSoundConfig): void {
    this.config = config;
  }

  /**
   * Avanza la cadencia y reproduce un paso si corresponde. `resolveSurface`
   * se invoca solo cuando toca paso (evita raycasts por frame). Devuelve
   * `true` si sonó un paso este frame (lo usa el ruido de sigilo).
   */
  update(
    delta: number,
    speed: number,
    resolveSurface?: () => SurfaceType | null,
  ): boolean {
    if (speed <= 0) {
      return false;
    }

    this.cooldown -= delta;
    if (this.cooldown > 0) {
      return false;
    }

    this.cooldown = this.config.stepCooldown;

    const surface = resolveSurface?.() ?? null;
    const pool = this.poolFor(surface);
    const soundId = this.pickRandom(pool);
    if (!soundId || !this.sounds.hasSound(soundId)) {
      return false;
    }

    this.sounds.play(soundId, {
      bus: "footsteps",
      detune: (Math.random() * 2 - 1) * StepDetuneRange,
      volumeJitter: StepVolumeJitter,
    });
    return true;
  }

  private poolFor(surface: SurfaceType | null): readonly string[] {
    if (surface) {
      const pool = this.surfacePools[surface];
      if (pool && pool.length > 0) {
        return pool;
      }
    }
    return this.defaultPool;
  }

  private pickRandom(items: readonly string[]): string | null {
    if (items.length === 0) {
      return null;
    }
    const index = Math.floor(Math.random() * items.length);
    return items[index] ?? null;
  }
}
