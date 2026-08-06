import type { AudioClipDefinition } from "@engine/audio/AudioManifest";
import type {
  ControllablePositionalSound,
  PositionalSoundManager,
} from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { VehicleArchetypeId } from "@game/config/vehicles.config";
import type { VehicleEntity } from "./VehicleEntity";

/**
 * Capas del motor por arquetipo. El ralentí y la aceleración son dos lazos que
 * se cruzan según revoluciones, y encima va una capa de rodadura o de agua que
 * depende de la velocidad: así acelerar suena a esfuerzo del motor y no a un
 * único loop con el pitch subido.
 *
 * El planeador y el nadador combine mantienen sus capas sintéticas: no hay
 * equivalente en el banco de HL2 para una máquina que flota ni para un bicho.
 */
type LayerName =
  | "idle"
  | "power"
  | "roll"
  | "skid"
  | "aux";

type ArchetypeLayers = Readonly<Partial<Record<LayerName, string>>>;

export const ArchetypeAudio: Readonly<Record<VehicleArchetypeId, ArchetypeLayers>> = {
  buggy: {
    idle: "vehicles.buggy.hl2.idle",
    power: "vehicles.buggy.hl2.rev",
    roll: "vehicles.buggy.hl2.cruise",
    skid: "vehicles.buggy.hl2.skid",
  },
  // El crawler rebelde es un diésel pesado, no el V8 del buggy.
  rebelCrawler: {
    idle: "vehicles.crawler.hl2.idle",
    power: "vehicles.crawler.hl2.rev",
    roll: "vehicles.crawler.hl2.cruise",
    skid: "vehicles.buggy.hl2.skid",
    aux: "vehicles.crawler.hl2.diesel",
  },
  airboat: {
    idle: "vehicles.airboat.hl2.motorIdle",
    power: "vehicles.airboat.hl2.motorFull",
    aux: "vehicles.airboat.hl2.bladeFull",
    roll: "vehicles.airboat.hl2.waterFast",
    skid: "vehicles.airboat.hl2.waterIdle",
  },
  helicopter: {
    idle: "vehicles.helicopter.hl2.rotor",
    power: "vehicles.helicopter.hl2.wash",
    aux: "vehicles.helicopter.hl2.cabin",
    roll: "vehicles.helicopter.hl2.wind",
  },
  combineGlider: {
    idle: "vehicles.combineGlider.engine",
    aux: "vehicles.combineGlider.hover",
  },
  combineSwimmer: {
    idle: "vehicles.combineSwimmer.breath",
    aux: "vehicles.combineSwimmer.graft",
    power: "vehicles.combineSwimmer.strain",
  },
};

/** Golpes y arranques por arquetipo: one-shots, no capas. */
interface ArchetypeOneShots {
  readonly start?: string;
  readonly stop?: string;
  readonly impact: readonly string[];
  readonly crash: readonly string[];
  readonly horn?: string;
}

const BUGGY_IMPACTS = [
  "vehicles.buggy.hl2.impactMedium1",
  "vehicles.buggy.hl2.impactMedium2",
  "vehicles.buggy.hl2.impactMedium3",
  "vehicles.buggy.hl2.impactMedium4",
] as const;
const BUGGY_CRASHES = [
  "vehicles.buggy.hl2.impactHeavy1",
  "vehicles.buggy.hl2.impactHeavy2",
  "vehicles.buggy.hl2.rollover1",
  "vehicles.buggy.hl2.rollover2",
] as const;

export const ArchetypeOneShotAudio: Readonly<
  Record<VehicleArchetypeId, ArchetypeOneShots>
> = {
  buggy: {
    start: "vehicles.buggy.hl2.start",
    stop: "vehicles.buggy.hl2.stop",
    impact: BUGGY_IMPACTS,
    crash: BUGGY_CRASHES,
    horn: "vehicles.alarm",
  },
  rebelCrawler: {
    start: "vehicles.crawler.hl2.start",
    stop: "vehicles.crawler.hl2.stop",
    impact: BUGGY_IMPACTS,
    crash: BUGGY_CRASHES,
    horn: "vehicles.alarm",
  },
  airboat: {
    start: "vehicles.airboat.hl2.start",
    stop: "vehicles.airboat.hl2.stop",
    impact: [
      "vehicles.airboat.hl2.impact1",
      "vehicles.airboat.hl2.impact2",
      "vehicles.airboat.hl2.splash1",
      "vehicles.airboat.hl2.splash2",
    ],
    crash: ["vehicles.airboat.hl2.impact1", "vehicles.airboat.hl2.impact2"],
  },
  helicopter: {
    impact: BUGGY_IMPACTS,
    crash: ["vehicles.helicopter.hl2.crashAlert", ...BUGGY_CRASHES],
  },
  combineGlider: {
    impact: ["vehicles.damage"],
    crash: ["vehicles.crash"],
  },
  combineSwimmer: {
    impact: ["vehicles.damage"],
    crash: ["vehicles.crash"],
  },
};

const audioUrl = (file: string): string =>
  new URL(`../../assets/vehicles/audio/${file}`, import.meta.url).href;

/**
 * Lo que queda de audio generado: las capas del planeador y del nadador, más
 * la bocina y los golpes genéricos que usan ambos. El resto de la flota suena
 * con el banco de HL2 registrado en `AudioManifest`.
 */
export const SyntheticVehicleClips: readonly AudioClipDefinition[] = [
  clip("vehicles.combineGlider.engine", "combine-glider-engine-loop.wav", true),
  clip("vehicles.combineGlider.hover", "combine-glider-hover-loop.wav", true),
  clip("vehicles.combineSwimmer.breath", "combine-swimmer-breath-loop.wav", true),
  clip("vehicles.combineSwimmer.graft", "combine-swimmer-graft-loop.wav", true),
  clip("vehicles.combineSwimmer.strain", "combine-swimmer-strain-loop.wav", true),
  clip("vehicles.alarm", "vehicle-alarm-loop.wav", true),
  clip("vehicles.crash", "vehicle-crash.wav", false, 3),
  clip("vehicles.damage", "vehicle-damage-hit.wav", false),
];

interface VehicleAudioRig {
  readonly archetype: VehicleArchetypeId;
  readonly layers: ReadonlyMap<LayerName, ControllablePositionalSound>;
  /** Estado del motor en el frame anterior, para disparar arranque y parada. */
  engineWasOn: boolean;
}

/**
 * Capas posicionales controladas por telemetría. El registro de clips
 * sintéticos es un lease de nivel: al descargar se frenan voces y se liberan
 * buffers.
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
    this.releaseClips = this.sounds.registerClips(SyntheticVehicleClips);
    this.sounds.preload([
      ...SyntheticVehicleClips.map((definition) => definition.id),
      ...vehicles.flatMap((vehicle) =>
        Object.values(ArchetypeAudio[vehicle.preset.archetype]),
      ),
    ]);

    vehicles.forEach((vehicle) => {
      const archetype = vehicle.preset.archetype;
      const root = vehicle.visual.root;
      const layers = new Map<LayerName, ControllablePositionalSound>();
      for (const [name, soundId] of Object.entries(ArchetypeAudio[archetype])) {
        if (!this.sounds.hasSound(soundId)) {
          continue;
        }
        layers.set(
          name as LayerName,
          this.positional.attachControllable(soundId, root, loopOptions(archetype)),
        );
      }
      this.rigs.set(vehicle.id, {
        archetype,
        layers,
        engineWasOn: vehicle.isEngineOn(),
      });
    });
  }

  update(vehicle: VehicleEntity, listenerInside: boolean): void {
    const rig = this.rigs.get(vehicle.id);
    if (!rig) return;

    const telemetry = vehicle.getTelemetry();
    const rpm01 = clamp01(telemetry.engineRpm / 6_500);
    const speed01 = clamp01(telemetry.speed / 32);
    const running =
      vehicle.isEngineOn() && vehicle.isEnabled() && !vehicle.isWreckage();
    const interiorFilter = listenerInside ? 6_800 : 18_000;

    this.handleIgnition(vehicle, rig, running);

    switch (rig.archetype) {
      case "buggy":
      case "rebelCrawler":
        this.driveEngine(rig, running, rpm01, interiorFilter);
        this.setLayer(rig, "roll", running ? Math.min(0.58, speed01 * 0.85) : 0, 0.72 + speed01 * 0.8, interiorFilter);
        this.setLayer(
          rig,
          "skid",
          telemetry.grounded
            ? Math.min(0.65, (Math.abs(telemetry.steering) * telemetry.speed) / 18)
            : 0,
          1,
          interiorFilter,
        );
        this.setLayer(rig, "aux", running ? 0.16 + rpm01 * 0.2 : 0, 0.8 + rpm01 * 0.4, interiorFilter);
        break;

      case "airboat": {
        this.driveEngine(rig, running, rpm01, interiorFilter);
        // La hélice es la voz del airboat: sube con el acelerador, no con la
        // velocidad, porque gira igual aunque el casco esté encallado.
        this.setLayer(rig, "aux", running ? 0.22 + rpm01 * 0.6 : 0, 0.7 + rpm01 * 0.85, interiorFilter);
        const wet = telemetry.submergedRatio;
        this.setLayer(rig, "roll", Math.min(0.72, wet * (0.1 + speed01 * 0.9)), 0.85 + speed01 * 0.5, interiorFilter);
        this.setLayer(rig, "skid", Math.min(0.4, wet * (0.4 - speed01 * 0.4)), 1, interiorFilter);
        break;
      }

      case "helicopter": {
        // El rotor no se apaga con las revoluciones: mientras gire, gira.
        this.setLayer(rig, "idle", running ? 0.42 + rpm01 * 0.45 : 0, 0.78 + rpm01 * 0.4, interiorFilter);
        this.setLayer(rig, "power", running ? (listenerInside ? 0.18 : 0.4 + rpm01 * 0.3) : 0, 0.85 + rpm01 * 0.3, interiorFilter);
        this.setLayer(rig, "aux", running ? (listenerInside ? 0.55 : 0.18) : 0, 0.82 + rpm01 * 0.38, listenerInside ? 4_600 : 13_000);
        this.setLayer(rig, "roll", speed01 * (listenerInside ? 0.22 : 0.4), 0.9 + speed01 * 0.4, interiorFilter);
        break;
      }

      case "combineGlider":
        this.driveEngine(rig, running, rpm01, interiorFilter);
        this.setLayer(
          rig,
          "aux",
          running ? 0.24 + rpm01 * 0.28 + (telemetry.grounded ? 0.18 : 0) : 0,
          0.82 + speed01 * 0.46,
          listenerInside ? 7_200 : 16_000,
        );
        break;

      case "combineSwimmer": {
        const alive = !vehicle.isWreckage();
        const hurt = 1 - vehicle.damage.getZoneFraction("hull");
        // Un bicho respira aunque esté quieto y apagado; sólo el cadáver se
        // calla. Herido respira más rápido y más agudo.
        this.setLayer(rig, "idle", alive ? 0.26 + rpm01 * 0.5 : 0, 0.72 + rpm01 * 0.85 + hurt * 0.24, listenerInside ? 7_200 : 16_000);
        this.setLayer(
          rig,
          "aux",
          running ? 0.2 + rpm01 * 0.26 + (telemetry.grounded ? 0.14 : 0) : 0,
          0.84 + speed01 * 0.4,
          listenerInside ? 7_200 : 16_000,
        );
        // El chillido no acompaña al acelerador: aparece recién cuando se lo
        // fuerza, que es lo que convierte correr en maltratar a algo.
        this.setLayer(
          rig,
          "power",
          alive ? Math.min(0.62, Math.max(0, rpm01 - 0.45) * 1.15 + hurt * 0.22) : 0,
          0.9 + rpm01 * 0.5 - hurt * 0.18,
          listenerInside ? 7_200 : 16_000,
        );
        break;
      }
    }
  }

  impact(vehicle: VehicleEntity, intensity: number): void {
    this.playOneShot(
      ArchetypeOneShotAudio[vehicle.preset.archetype].impact,
      vehicle,
      {
        volume: Math.min(1, Math.max(0.15, intensity)),
        playbackRate: 0.82 + Math.random() * 0.3,
        refDistance: 2,
        maxDistance: 34,
      },
    );
  }

  crash(vehicle: VehicleEntity): void {
    this.playOneShot(
      ArchetypeOneShotAudio[vehicle.preset.archetype].crash,
      vehicle,
      { volume: 1, refDistance: 4, maxDistance: 80 },
    );
  }

  horn(vehicle: VehicleEntity): void {
    const horn = ArchetypeOneShotAudio[vehicle.preset.archetype].horn;
    if (!horn) {
      return;
    }
    // La alarma, reproducida grave y sin loop, funciona como bocina industrial
    // sin sumar una voz o un asset duplicado.
    this.playOneShot([horn], vehicle, {
      loop: false,
      playbackRate: 0.52,
      volume: 0.56,
      refDistance: 3,
      maxDistance: 45,
    });
  }

  clear(): void {
    this.rigs.forEach((rig) => {
      rig.layers.forEach((layer) => layer.dispose());
    });
    this.rigs.clear();
    this.releaseClips?.();
    this.releaseClips = null;
  }

  dispose(): void {
    this.clear();
  }

  /**
   * Ralentí y aceleración se cruzan: a bajas vueltas manda el primero y a
   * altas el segundo, sin que ninguno de los dos desaparezca del todo.
   */
  private driveEngine(
    rig: VehicleAudioRig,
    running: boolean,
    rpm01: number,
    lowpass: number,
  ): void {
    this.setLayer(rig, "idle", running ? 0.55 * (1 - rpm01 * 0.8) : 0, 0.85 + rpm01 * 0.35, lowpass);
    this.setLayer(rig, "power", running ? 0.15 + rpm01 * 0.75 : 0, 0.7 + rpm01 * 0.85, lowpass);
  }

  private setLayer(
    rig: VehicleAudioRig,
    name: LayerName,
    volume: number,
    playbackRate: number,
    lowpass: number,
  ): void {
    const layer = rig.layers.get(name);
    if (!layer) {
      return;
    }
    layer.setVolume(Math.max(0, volume));
    layer.setPlaybackRate(playbackRate);
    layer.setLowpassFrequency(lowpass);
  }

  /** Arranque y apagado: el motor tiene un antes y un después, no un fade. */
  private handleIgnition(
    vehicle: VehicleEntity,
    rig: VehicleAudioRig,
    running: boolean,
  ): void {
    if (running === rig.engineWasOn) {
      return;
    }
    rig.engineWasOn = running;
    const oneShots = ArchetypeOneShotAudio[rig.archetype];
    const soundId = running ? oneShots.start : oneShots.stop;
    if (soundId) {
      this.playOneShot([soundId], vehicle, {
        loop: false,
        volume: 0.8,
        refDistance: 3,
        maxDistance: 46,
      });
    }
  }

  private playOneShot(
    ids: readonly string[],
    vehicle: VehicleEntity,
    options: {
      volume: number;
      playbackRate?: number;
      refDistance: number;
      maxDistance: number;
      loop?: boolean;
    },
  ): void {
    const available = ids.filter((id) => this.sounds.hasSound(id));
    const soundId = available[Math.floor(Math.random() * available.length)];
    if (!soundId) {
      return;
    }
    this.positional.playAt(soundId, vehicle.getWorldPosition(), {
      bus: "vehicles",
      ...options,
    });
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

function loopOptions(archetype: VehicleArchetypeId) {
  const maxDistance =
    archetype === "helicopter"
      ? 95
      : archetype === "combineGlider" || archetype === "combineSwimmer"
        ? 58
        : 48;
  return {
    bus: "vehicles" as const,
    loop: true,
    volume: 0,
    refDistance: archetype === "helicopter" ? 5 : 2.4,
    maxDistance,
    rolloffFactor: 1.05,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
