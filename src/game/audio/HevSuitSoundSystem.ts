import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { GameEventBus } from "@game/GameEvents";
import {
  HevDamageConfig,
  HevDamageDiagnosis,
  HevSuitAudio,
  type SoundRef,
} from "@game/config/audio.config";
import type { HazardKind } from "@game/levels/HazardVolumeSystem";
import { HevVoiceQueue, type HevVoice } from "./HevVoiceQueue";
import type { DamageType, Disposable } from "@shared/types/lifecycle";

/** Prioridad de la cola para los diagnósticos de daño (bajo las alertas de vida). */
const DamagePriority = 40;

/**
 * Especificación de un anuncio de voz del traje. La `key` agrupa el de-dup por
 * cooldown y `priority` decide el turno en la cola cuando varios coinciden.
 */
interface VoiceLine {
  readonly ref: SoundRef;
  readonly priority: number;
  readonly key: string;
  readonly noRepeatSeconds: number;
  readonly interrupt?: boolean;
}

/**
 * Prioridades: más alto = más urgente. La muerte interrumpe todo; las alertas de
 * salud pesan más que las de daño puntual o pickups.
 */
const VoiceLines = {
  healthPickup: { ref: HevSuitAudio.healthPickup, priority: 30, key: "pickup", noRepeatSeconds: 1 },
  armorGone: { ref: HevSuitAudio.armorGone, priority: 70, key: "armorGone", noRepeatSeconds: 6 },
  powerRestored: {
    ref: HevSuitAudio.powerRestored,
    priority: 50,
    key: "powerRestored",
    noRepeatSeconds: 4,
  },
  healthCritical: {
    ref: HevSuitAudio.healthCritical,
    priority: 80,
    key: "healthCritical",
    noRepeatSeconds: 8,
  },
  nearDeath: { ref: HevSuitAudio.nearDeath, priority: 90, key: "nearDeath", noRepeatSeconds: 8 },
  auxDepleted: { ref: HevSuitAudio.auxDepleted, priority: 25, key: "aux", noRepeatSeconds: 5 },
  flatline: {
    ref: HevSuitAudio.flatline,
    priority: 1000,
    key: "death",
    noRepeatSeconds: 0,
    interrupt: true,
  },
} as const satisfies Record<string, VoiceLine>;

const HazardVoice: Record<HazardKind, VoiceLine> = {
  fire: { ref: HevSuitAudio.hazardFire, priority: 60, key: "hazard:fire", noRepeatSeconds: 4 },
  toxic: { ref: HevSuitAudio.hazardToxic, priority: 60, key: "hazard:toxic", noRepeatSeconds: 4 },
  electric: {
    ref: HevSuitAudio.hazardElectric,
    priority: 60,
    key: "hazard:electric",
    noRepeatSeconds: 4,
  },
  void: { ref: HevSuitAudio.hazardVoid, priority: 60, key: "hazard:void", noRepeatSeconds: 4 },
};

const AllVoiceRefs: readonly SoundRef[] = [
  ...Object.values(VoiceLines).map((line) => line.ref),
  ...Object.values(HazardVoice).map((line) => line.ref),
  ...Object.values(HevDamageDiagnosis),
];

export class HevSuitSoundSystem implements Disposable {
  private healthCurrent: number | null = null;
  private healthMax = 100;
  private armorCurrent: number | null = null;
  private staminaDepleted: boolean | null = null;
  private activeChargerLoop: string | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
    private readonly voice: HevVoice = new HevVoiceQueue(sounds),
  ) {
    AllVoiceRefs.forEach((ref) => this.voice.warm(ref));

    this.disposers.push(
      eventBus.on("player.pickup.health", () => {
        this.speak(VoiceLines.healthPickup);
      }),
      eventBus.on("player.pickup.armor", () => {
        this.playDevice(HevSuitAudio.armorPickup);
      }),
      eventBus.on("charger.started", ({ kind }) => {
        this.startChargerLoop(
          kind === "armor" ? HevSuitAudio.armorChargerLoop : HevSuitAudio.healthChargerLoop,
        );
      }),
      eventBus.on("charger.stopped", ({ depleted }) => {
        this.stopChargerLoop();
        if (depleted) {
          this.playDevice(HevSuitAudio.chargerDone);
        }
      }),
      eventBus.on("charger.denied", () => {
        this.playDevice(HevSuitAudio.chargerDenied);
      }),
      eventBus.on("player.health.changed", ({ current, max }) => {
        this.handleHealthChanged(current, max);
      }),
      eventBus.on("player.armor.changed", ({ current }) => {
        this.handleArmorChanged(current);
      }),
      eventBus.on("player.damaged", ({ amount, damageType }) => {
        this.handleDamage(amount, damageType);
      }),
      eventBus.on("player.hazard", ({ kind }) => {
        this.speak(HazardVoice[kind]);
      }),
      eventBus.on("player.stamina.changed", ({ depleted }) => {
        this.handleStaminaChanged(depleted);
      }),
      eventBus.on("player.dead", () => {
        this.stopChargerLoop();
        this.speak(VoiceLines.flatline);
      }),
    );
  }

  private handleHealthChanged(current: number, max: number): void {
    const previous = this.healthCurrent;
    this.healthCurrent = current;
    this.healthMax = max;
    if (previous === null || current >= previous) {
      return;
    }
    if (previous > 10 && current <= 10) {
      this.speak(VoiceLines.nearDeath);
      return;
    }
    if (previous > 25 && current <= 25) {
      this.speak(VoiceLines.healthCritical);
    }
  }

  private handleArmorChanged(current: number): void {
    const previous = this.armorCurrent;
    this.armorCurrent = current;
    if (previous === null) {
      return;
    }
    if (previous > 0 && current <= 0) {
      this.speak(VoiceLines.armorGone);
    } else if (previous <= 0 && current > 0) {
      this.speak(VoiceLines.powerRestored);
    }
  }

  /**
   * Diagnóstico de daño al estilo Half-Life: el traje calla si la herida es
   * trivial (vida alta o golpe chico) y, si no, elige la línea por tipo de daño
   * con una ventana larga de no-repetición. Así deja de comentar cada bala.
   */
  private handleDamage(amount: number, damageType?: DamageType): void {
    if (amount <= 0) {
      return;
    }
    const healthPercent =
      this.healthCurrent === null ? 100 : (this.healthCurrent / this.healthMax) * 100;
    if (
      healthPercent > HevDamageConfig.trivialHealthPercent ||
      amount < HevDamageConfig.trivialDamage
    ) {
      return;
    }
    const major = amount > HevDamageConfig.majorDamage;
    const ref = diagnosisFor(damageType, major);
    this.voice.request({
      ids: ref,
      priority: DamagePriority,
      key: ref,
      noRepeatSeconds: HevDamageConfig.repeatSeconds,
    });
  }

  private handleStaminaChanged(depleted: boolean): void {
    const previous = this.staminaDepleted;
    this.staminaDepleted = depleted;
    if (previous === false && depleted) {
      this.speak(VoiceLines.auxDepleted);
    }
  }

  private speak(line: VoiceLine): void {
    this.voice.request({
      ids: line.ref,
      priority: line.priority,
      key: line.key,
      noRepeatSeconds: line.noRepeatSeconds,
      interrupt: line.interrupt,
    });
  }

  private startChargerLoop(ref: SoundRef): void {
    const soundId = this.firstAvailable(ref);
    if (!soundId) {
      return;
    }
    if (this.activeChargerLoop === soundId) {
      return;
    }
    this.stopChargerLoop();
    this.activeChargerLoop = soundId;
    this.sounds.playLoop(soundId, { bus: "ui", fadeIn: 0.08 });
  }

  private stopChargerLoop(): void {
    if (!this.activeChargerLoop) {
      return;
    }
    this.sounds.fadeOut(this.activeChargerLoop, 0.12);
    this.activeChargerLoop = null;
  }

  private playDevice(ref: SoundRef): void {
    const soundId = this.firstAvailable(ref);
    if (!soundId) {
      return;
    }
    this.sounds.play(soundId);
  }

  private firstAvailable(ref: SoundRef): string | null {
    const ids = typeof ref === "string" ? [ref] : ref;
    return ids.find((id) => this.sounds.hasSound(id)) ?? null;
  }

  dispose(): void {
    this.disposers.forEach((dispose) => dispose());
    this.disposers.length = 0;
    this.voice.dispose();
  }
}

/** Elige la línea de diagnóstico según el tipo de daño (mapeo de `player.cpp`). */
function diagnosisFor(damageType: DamageType | undefined, major: boolean): string {
  switch (damageType) {
    case "bullet":
      return HevDamageDiagnosis.bullet;
    case "melee":
      return major ? HevDamageDiagnosis.meleeMajor : HevDamageDiagnosis.meleeMinor;
    case "explosive":
    case "physics":
      return major ? HevDamageDiagnosis.fractureMajor : HevDamageDiagnosis.fractureMinor;
    default:
      return HevDamageDiagnosis.generic;
  }
}
