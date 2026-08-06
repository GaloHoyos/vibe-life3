import type { AudioClipDefinition } from "@engine/audio/AudioManifest";
import type {
  ControllablePositionalSound,
  PositionalSoundManager,
} from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { VehicleArchetypeId } from "@game/config/vehicles.config";
import type { VehicleEntity } from "./VehicleEntity";

/**
 * El clip `vehicles.alarm` sigue registrado aunque ya no haya capa de alarma:
 * `horn()` lo reusa grave y sin bucle como bocina industrial.
 */
interface VehicleAudioRig {
  readonly engine: ControllablePositionalSound;
  readonly secondary: readonly ControllablePositionalSound[];
}

const audioUrl = (file: string): string =>
  new URL(`../../assets/vehicles/audio/${file}`, import.meta.url).href;

const VehicleClips: readonly AudioClipDefinition[] = [
  clip("vehicles.buggy.engine", "buggy-engine-loop.wav", true),
  clip("vehicles.buggy.transmission", "buggy-transmission-loop.wav", true),
  clip("vehicles.buggy.skid", "buggy-skid-loop.wav", true),
  clip("vehicles.airboat.engine", "airboat-engine-loop.wav", true),
  clip("vehicles.airboat.fan", "airboat-fan-loop.wav", true),
  clip("vehicles.airboat.water", "airboat-water-loop.wav", true),
  clip("vehicles.helicopter.rotor", "helicopter-rotor-loop.wav", true),
  // La cabina es la capa interior: acompaña al rotor, no compite con él.
  clip("vehicles.helicopter.cabin", "helicopter-cabin-loop.wav", true, -6),
  clip("vehicles.combineGlider.engine", "combine-glider-engine-loop.wav", true),
  clip("vehicles.combineGlider.hover", "combine-glider-hover-loop.wav", true),
  clip("vehicles.combineSwimmer.breath", "combine-swimmer-breath-loop.wav", true),
  clip("vehicles.combineSwimmer.graft", "combine-swimmer-graft-loop.wav", true),
  clip("vehicles.combineSwimmer.strain", "combine-swimmer-strain-loop.wav", true),
  clip("vehicles.alarm", "vehicle-alarm-loop.wav", true),
  clip("vehicles.crash", "vehicle-crash.wav", false, 3),
  clip("vehicles.damage", "vehicle-damage-hit.wav", false),
];

/**
 * Capas posicionales originales controladas por telemetría. El registro de
 * clips es un lease de nivel: al descargar se frenan voces y se liberan buffers.
 */
export class VehicleAudioSystem {
  private readonly rigs = new Map<string, VehicleAudioRig>();
  private releaseClips: (() => void) | null = null;

  constructor(
    private readonly sounds: SoundManager,
    private readonly positional: PositionalSoundManager,
  ) {}

  load(vehicles: readonly VehicleEntity[]): void {
    this.clear();
    this.releaseClips = this.sounds.registerClips(VehicleClips);
    this.sounds.preload(VehicleClips.map((definition) => definition.id));
    vehicles.forEach((vehicle) => {
      const layers = layerIds(vehicle.preset.archetype);
      const root = vehicle.visual.root;
      const engine = this.positional.attachControllable(
        layers.engine,
        root,
        loopOptions(vehicle.preset.archetype, 0),
      );
      const secondary = layers.secondary.map((id) =>
        this.positional.attachControllable(
          id,
          root,
          loopOptions(vehicle.preset.archetype, 0),
        ),
      );
      this.rigs.set(vehicle.id, { engine, secondary });
    });
  }

  update(vehicle: VehicleEntity, listenerInside: boolean): void {
    const rig = this.rigs.get(vehicle.id);
    if (!rig) return;
    const telemetry = vehicle.getTelemetry();
    const rpm01 = Math.min(1, Math.max(0, telemetry.engineRpm / 6_500));
    const running =
      vehicle.isEngineOn() &&
      vehicle.isEnabled() &&
      !vehicle.isWreckage();
    const interiorFilter = listenerInside ? 6_800 : 18_000;
    rig.engine.setVolume(running ? 0.2 + rpm01 * 0.72 : 0);
    rig.engine.setPlaybackRate(0.62 + rpm01 * 0.92);
    rig.engine.setLowpassFrequency(interiorFilter);

    switch (vehicle.preset.archetype) {
      case "buggy":
      case "rebelCrawler": {
        const transmission = rig.secondary[0];
        const skid = rig.secondary[1];
        transmission?.setVolume(
          running ? Math.min(0.58, Math.abs(telemetry.forwardSpeed) / 32) : 0,
        );
        transmission?.setPlaybackRate(
          0.72 + Math.min(1, telemetry.speed / 35) * 0.8,
        );
        skid?.setVolume(
          telemetry.grounded
            ? Math.min(0.65, Math.abs(telemetry.steering) * telemetry.speed / 18)
            : 0,
        );
        rig.secondary.forEach((layer) =>
          layer.setLowpassFrequency(interiorFilter),
        );
        break;
      }
      case "airboat": {
        const fan = rig.secondary[0];
        const water = rig.secondary[1];
        fan?.setVolume(running ? 0.28 + rpm01 * 0.62 : 0);
        fan?.setPlaybackRate(0.6 + rpm01 * 1.05);
        water?.setVolume(
          Math.min(
            0.72,
            telemetry.submergedRatio *
              (0.16 + Math.abs(telemetry.forwardSpeed) / 28),
          ),
        );
        water?.setPlaybackRate(0.78 + Math.min(1, telemetry.speed / 30) * 0.7);
        rig.secondary.forEach((layer) =>
          layer.setLowpassFrequency(interiorFilter),
        );
        break;
      }
      case "helicopter": {
        const cabin = rig.secondary[0];
        cabin?.setVolume(running ? (listenerInside ? 0.52 : 0.24) : 0);
        cabin?.setPlaybackRate(0.82 + rpm01 * 0.38);
        cabin?.setLowpassFrequency(listenerInside ? 4_600 : 13_000);
        break;
      }
      case "combineGlider": {
        const hover = rig.secondary[0];
        hover?.setVolume(
          running
            ? 0.24 + rpm01 * 0.28 + (telemetry.grounded ? 0.18 : 0)
            : 0,
        );
        hover?.setPlaybackRate(
          0.82 + Math.min(1, telemetry.speed / 32) * 0.46,
        );
        hover?.setLowpassFrequency(listenerInside ? 7_200 : 16_000);
        break;
      }
      case "combineSwimmer": {
        const graft = rig.secondary[0];
        const strain = rig.secondary[1];
        const alive = !vehicle.isWreckage();
        const hurt = 1 - vehicle.damage.getZoneFraction("hull");
        // Un bicho respira aunque esté quieto y apagado; sólo el cadáver se
        // calla. La capa primaria por eso no se apaga con el motor, y herido
        // respira más rápido y más agudo.
        rig.engine.setVolume(alive ? 0.26 + rpm01 * 0.5 : 0);
        rig.engine.setPlaybackRate(0.72 + rpm01 * 0.85 + hurt * 0.24);
        graft?.setVolume(
          running
            ? 0.2 + rpm01 * 0.26 + (telemetry.grounded ? 0.14 : 0)
            : 0,
        );
        graft?.setPlaybackRate(
          0.84 + Math.min(1, telemetry.speed / 32) * 0.4,
        );
        // El chillido no acompaña al acelerador: aparece recién cuando se lo
        // fuerza, que es lo que convierte correr en maltratar a algo.
        strain?.setVolume(
          alive
            ? Math.min(0.62, Math.max(0, rpm01 - 0.45) * 1.15 + hurt * 0.22)
            : 0,
        );
        strain?.setPlaybackRate(0.9 + rpm01 * 0.5 - hurt * 0.18);
        rig.secondary.forEach((layer) =>
          layer.setLowpassFrequency(listenerInside ? 7_200 : 16_000),
        );
        break;
      }
    }

  }

  impact(vehicle: VehicleEntity, intensity: number): void {
    this.positional.playAt(
      "vehicles.damage",
      vehicle.getWorldPosition(),
      {
        bus: "vehicles",
        volume: Math.min(1, Math.max(0.15, intensity)),
        playbackRate: 0.82 + Math.random() * 0.3,
        refDistance: 2,
        maxDistance: 34,
      },
    );
  }

  crash(vehicle: VehicleEntity): void {
    this.positional.playAt(
      "vehicles.crash",
      vehicle.getWorldPosition(),
      {
        bus: "vehicles",
        volume: 1,
        refDistance: 4,
        maxDistance: 80,
      },
    );
  }

  horn(vehicle: VehicleEntity): void {
    // La alarma original, reproducida grave y sin loop, funciona como bocina
    // industrial sin sumar una voz o asset duplicado.
    this.positional.playAt(
      "vehicles.alarm",
      vehicle.getWorldPosition(),
      {
        bus: "vehicles",
        loop: false,
        playbackRate: 0.52,
        volume: 0.56,
        refDistance: 3,
        maxDistance: 45,
      },
    );
  }

  clear(): void {
    this.rigs.forEach((rig) => {
      rig.engine.dispose();
      rig.secondary.forEach((layer) => layer.dispose());
    });
    this.rigs.clear();
    this.releaseClips?.();
    this.releaseClips = null;
  }

  dispose(): void {
    this.clear();
  }
}

function clip(
  id: string,
  file: string,
  loop: boolean,
  trimDb?: number,
): AudioClipDefinition {
  return {
    id,
    path: audioUrl(file),
    source: `vehicles/${file}`,
    loop,
    bus: "vehicles",
    role: loop ? "engineLoop" : "impact",
    trimDb,
  };
}

function layerIds(archetype: VehicleArchetypeId): {
  engine: string;
  secondary: readonly string[];
} {
  switch (archetype) {
    case "buggy":
    case "rebelCrawler":
      return {
        engine: "vehicles.buggy.engine",
        secondary: [
          "vehicles.buggy.transmission",
          "vehicles.buggy.skid",
        ],
      };
    case "airboat":
      return {
        engine: "vehicles.airboat.engine",
        secondary: ["vehicles.airboat.fan", "vehicles.airboat.water"],
      };
    case "helicopter":
      return {
        engine: "vehicles.helicopter.rotor",
        secondary: ["vehicles.helicopter.cabin"],
      };
    case "combineGlider":
      return {
        engine: "vehicles.combineGlider.engine",
        secondary: ["vehicles.combineGlider.hover"],
      };
    // El nadador no tiene motor: la capa primaria es su respiración, y el
    // zumbido del injerto pasa a ser secundario.
    case "combineSwimmer":
      return {
        engine: "vehicles.combineSwimmer.breath",
        secondary: [
          "vehicles.combineSwimmer.graft",
          "vehicles.combineSwimmer.strain",
        ],
      };
  }
}

function loopOptions(
  archetype: VehicleArchetypeId,
  volume: number,
) {
  const maxDistance = archetype === "helicopter"
    ? 95
    : archetype === "combineGlider" || archetype === "combineSwimmer"
      ? 58
      : 48;
  return {
    bus: "vehicles" as const,
    loop: true,
    volume,
    refDistance: archetype === "helicopter" ? 5 : 2.4,
    maxDistance,
    rolloffFactor: 1.05,
  };
}
