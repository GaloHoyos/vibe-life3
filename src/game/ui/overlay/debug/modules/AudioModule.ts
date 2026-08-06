import type { AudioBusName, AudioSystem } from "@engine/audio/core/AudioSystem";
import { gainToDb, sliderToGain } from "@engine/audio/mix/GainStaging";
import type { AcousticSpaceSystem } from "@engine/audio/spatial/AcousticSpaceSystem";
import type { DebugModule } from "../DebugModule";
import { buildOutput, buildSection } from "../widgets";

/**
 * Lo que la sonda acústica está midiendo ahora mismo y en qué se traduce.
 *
 * Sin esto la reverb es una caja negra: se escucha que "algo cambió" al entrar
 * a un edificio, pero no si el estimador leyó bien el espacio o si el problema
 * está en la curva de respuesta.
 */
const BUS_ORDER: readonly AudioBusName[] = [
  "master",
  "music",
  "voice",
  "ambience",
  "ui",
  "sfx",
  "weapons",
  "enemies",
  "vehicles",
  "footsteps",
  "world",
];

export class AudioModule implements DebugModule {
  readonly id = "audio";
  readonly label = "Audio";
  readonly updateWhenHidden = false;
  private active = false;
  private readonly spaceOutput = buildOutput();
  private readonly mixOutput = buildOutput();

  constructor(
    private readonly audio: AudioSystem,
    private readonly acoustics: AcousticSpaceSystem,
  ) {}

  mount(container: HTMLElement): void {
    const space = buildSection("Espacio acustico", "#9fd8ff");
    space.appendChild(this.spaceOutput);
    container.appendChild(space);

    const mix = buildSection("Mixer", "#ffcc66");
    mix.appendChild(this.mixOutput);
    container.appendChild(mix);
  }

  update(): void {
    const { estimate, space } = this.acoustics.inspect();

    this.spaceOutput.textContent = estimate
      ? [
          `volumen    ${formatVolume(estimate.volume)}`,
          `distancia  ${estimate.meanDistance.toFixed(1)} m`,
          `absorcion  ${estimate.absorption.toFixed(2)}`,
          `apertura   ${estimate.openness.toFixed(2)}`,
          "",
          space
            ? [
                `cola       ${space.duration.toFixed(2)} s (decay ${space.decay.toFixed(1)})`,
                `wet        ${space.wet.toFixed(3)}`,
                `tono       ${Math.round(space.toneHz)} Hz`,
                `eco        ${space.echoDelay.toFixed(3)} s x ${space.echoFeedback.toFixed(2)}`,
              ].join("\n")
            : "sin espacio aplicado",
        ].join("\n")
      : "sin sondeo (nivel sin cargar o sin raycast)";

    this.mixOutput.textContent = BUS_ORDER.map((bus) => {
      const slider = this.audio.getVolume(bus);
      const db = gainToDb(sliderToGain(slider));
      const label = `${Math.round(slider * 100)}%`.padStart(4);
      const level = Number.isFinite(db) ? `${db.toFixed(1)} dB` : "-inf";
      return `${bus.padEnd(10)} ${label}  ${level}`;
    }).join("\n");
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.active = false;
  }
}

function formatVolume(volume: number): string {
  if (volume >= 10_000) {
    return `${(volume / 1000).toFixed(1)}k m3`;
  }
  return `${Math.round(volume)} m3`;
}
