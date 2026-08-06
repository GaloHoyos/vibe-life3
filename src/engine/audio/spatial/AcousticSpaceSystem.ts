import { Vector3 } from "three";
import type { AudioSystem } from "@engine/audio/core/AudioSystem";
import type { ReverbSpace } from "@engine/audio/dsp/ReverbRack";
import type { RaycastSource } from "@engine/physics/Raycast";
import type { SurfaceType } from "@shared/types/Surface";
import { AcousticProbe, type AcousticEstimate } from "./AcousticProbe";
import {
  reverbSpaceFor,
  type AcousticResponseTuning,
} from "./AcousticResponse";
import {
  spaceCoupling,
  type AcousticSpaceProvider,
} from "./AcousticSpaceProvider";
import type { SpatialAudioSystem } from "./SpatialAudioSystem";

/**
 * Decide cómo suena el espacio donde está el jugador y se lo aplica al retorno
 * de efectos.
 *
 * Cada tick: la sonda mide la geometría real, la respuesta se traduce a
 * parámetros del rack y cada voz recibe cuánto acopla con el recinto del
 * oyente. Un nivel puede forzar un preset (`setOverride`), pero lo normal es
 * que la reverb salga sola de la geometría — que es la única forma de que
 * funcione en mapas del Workshop que nadie autoró.
 */

export interface AcousticSpaceConfig {
  readonly absorption: Readonly<Partial<Record<SurfaceType, number>>>;
  readonly response: AcousticResponseTuning;
}

/** Cada cuánto se le habla al rack: la IR solo cambia si cruzó un escalón. */
const ApplyIntervalSeconds = 0.25;

const listenerPosition = new Vector3();

export class AcousticSpaceSystem {
  private readonly probe: AcousticProbe;
  private provider: AcousticSpaceProvider | null = null;
  private raycast: RaycastSource | null = null;
  private override: Partial<ReverbSpace> | null = null;
  private estimate: AcousticEstimate | null = null;
  private applied: ReverbSpace | null = null;
  private sinceApply = 0;

  constructor(
    private readonly audio: AudioSystem,
    private readonly spatial: SpatialAudioSystem,
    private readonly config: AcousticSpaceConfig,
  ) {
    this.probe = new AcousticProbe(config.absorption);
    this.spatial.setWetResolver((position) =>
      spaceCoupling(this.provider, listenerPosition, position),
    );
  }

  setRaycast(raycast: RaycastSource | null): void {
    this.raycast = raycast;
  }

  /** Lo instala el nivel al cargar; sin edificios se pasa `null`. */
  setSpaceProvider(provider: AcousticSpaceProvider | null): void {
    this.provider = provider;
  }

  /** Override artístico del soundscape del nivel sobre lo que mide la sonda. */
  setOverride(override: Partial<ReverbSpace> | null): void {
    this.override = override;
    this.sinceApply = ApplyIntervalSeconds;
  }

  update(delta: number, listener: Vector3): void {
    listenerPosition.copy(listener);

    const estimate = this.probe.update(delta, this.raycast, listenerPosition);
    if (estimate) {
      this.estimate = estimate;
    }

    this.sinceApply += delta;
    if (this.sinceApply < ApplyIntervalSeconds) {
      return;
    }
    this.sinceApply = 0;

    const rack = this.audio.getReverbRack();
    if (!rack || !this.estimate) {
      return;
    }

    const space: ReverbSpace = {
      ...reverbSpaceFor(this.estimate, this.config.response),
      ...this.override,
    };
    this.applied = space;
    rack.apply(space);
  }

  /** Estado para el overlay de debug. */
  inspect(): { estimate: AcousticEstimate | null; space: ReverbSpace | null } {
    return { estimate: this.estimate, space: this.applied };
  }

  clear(): void {
    this.probe.reset();
    this.provider = null;
    this.override = null;
    this.estimate = null;
    this.applied = null;
    this.audio.getReverbRack()?.apply(SilentSpace, 0.4);
  }
}

/** Sin nivel cargado no hay sala: el retorno queda en silencio. */
const SilentSpace: ReverbSpace = {
  duration: 0.2,
  decay: 4,
  diffusion: 0,
  toneHz: 8_000,
  preDelay: 0,
  echoDelay: 0.05,
  echoFeedback: 0,
  echoWet: 0,
  wet: 0,
};
