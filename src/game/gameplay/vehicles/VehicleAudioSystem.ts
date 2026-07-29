import type { AudioClipDefinition } from "@engine/audio/AudioManifest";
import type {
  ControllablePositionalSound,
  PositionalSoundManager,
} from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { VehicleArchetypeId } from "@game/config/vehicles.config";
import type { VehicleEntity } from "./VehicleEntity";

interface VehicleAudioRig {
  readonly engine: ControllablePositionalSound;
  readonly secondary: readonly ControllablePositionalSound[];
  readonly alarm: ControllablePositionalSound;
}

const audioUrl = (file: string): string =>
  new URL(`../../assets/vehicles/audio/${file}`, import.meta.url).href;

const VehicleClips: readonly AudioClipDefinition[] = [
  clip("vehicles.buggy.engine", "buggy-engine-loop.wav", true, 0.8),
  clip("vehicles.buggy.transmission", "buggy-transmission-loop.wav", true, 0.52),
  clip("vehicles.buggy.skid", "buggy-skid-loop.wav", true, 0.48),
  clip("vehicles.airboat.engine", "airboat-engine-loop.wav", true, 0.72),
  clip("vehicles.airboat.fan", "airboat-fan-loop.wav", true, 0.74),
  clip("vehicles.airboat.water", "airboat-water-loop.wav", true, 0.58),
  clip("vehicles.helicopter.rotor", "helicopter-rotor-loop.wav", true, 0.86),
  clip("vehicles.helicopter.cabin", "helicopter-cabin-loop.wav", true, 0.46),
  clip("vehicles.combineGlider.engine", "combine-glider-engine-loop.wav", true, 0.72),
  clip("vehicles.combineGlider.hover", "combine-glider-hover-loop.wav", true, 0.62),
  clip("vehicles.alarm", "vehicle-alarm-loop.wav", true, 0.55),
  clip("vehicles.crash", "vehicle-crash.wav", false, 0.95),
  clip("vehicles.damage", "vehicle-damage-hit.wav", false, 0.72),
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
      const alarm = this.positional.attachControllable(
        "vehicles.alarm",
        root,
        {
          ...loopOptions(vehicle.preset.archetype, 0),
          refDistance: 2.5,
          maxDistance: 32,
        },
      );
      this.rigs.set(vehicle.id, { engine, secondary, alarm });
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
    }

    const critical =
      vehicle.damage.isBurning() ||
      vehicle.isCrashing() ||
      vehicle.damage.getZoneFraction("hull") < 0.25;
    rig.alarm.setVolume(critical ? 0.7 : 0);
    rig.alarm.setPlaybackRate(vehicle.isCrashing() ? 1.18 : 1);
    rig.alarm.setLowpassFrequency(listenerInside ? 7_500 : 15_000);
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
      rig.alarm.dispose();
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
  volume: number,
): AudioClipDefinition {
  return {
    id,
    path: audioUrl(file),
    loop,
    volume,
    bus: "vehicles",
    category: "vehicles",
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
  }
}

function loopOptions(
  archetype: VehicleArchetypeId,
  volume: number,
) {
  const maxDistance = archetype === "helicopter"
    ? 95
    : archetype === "combineGlider"
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
