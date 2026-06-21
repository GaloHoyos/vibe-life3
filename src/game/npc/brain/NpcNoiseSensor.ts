import { Vector3 } from 'three';
import { isHostileTo } from '@engine/ai/Faction';
import type { Faction } from '@engine/ai/Faction';
import type { GameEventBus } from '@game/GameEvents';

export interface NoiseSnapshot {
  /** Posicion del ultimo ruido de combate oido (disparo/explosion hostil). */
  combat: Vector3 | null;
  /** Posicion del ultimo ruido sospechoso (impactos, movimiento). */
  suspicious: Vector3 | null;
}

export interface NpcNoiseSensorOptions {
  ownId: string;
  faction: Faction;
  /** Radio de oido propio: ruidos "blandos" mas alla de esto se ignoran. */
  hearingRadius: number;
  /** Radio dentro del cual escucha los `npc.threat.spotted` de aliados. */
  commsRadius?: number;
  getPosition: () => Vector3;
}

/** Cuanto persiste un ruido de combate antes de descartarse. */
const COMBAT_NOISE_TTL = 8;
/** Cuanto persiste un ruido sospechoso. */
const SUSPICIOUS_NOISE_TTL = 6;
const DEFAULT_COMMS_RADIUS = 35;

/**
 * Oido del NPC: escucha `world.noise` (ya emitido por armas del player,
 * granadas y combate de NPCs) y `npc.threat.spotted` (intel de aliados) y
 * los condensa en un snapshot que los sensors traducen a `HeardCombat` /
 * `HeardSuspicious`.
 *
 * Un ruido es audible si esta dentro del radio de propagacion del ruido o
 * del oido del NPC, lo que sea mayor permite que presets "orejudos"
 * (zombies) detecten ruidos suaves cerca. Los ruidos de la propia faccion
 * se ignoran: los aliados ya comunican threats via `npc.threat.spotted`.
 */
export class NpcNoiseSensor {
  private readonly disposers: Array<() => void> = [];
  private combatNoise: Vector3 | null = null;
  private combatAge = 0;
  private suspiciousNoise: Vector3 | null = null;
  private suspiciousAge = 0;

  constructor(eventBus: GameEventBus, private readonly opts: NpcNoiseSensorOptions) {
    this.disposers.push(
      eventBus.on('world.noise', (noise) => {
        if (noise.sourceId === this.opts.ownId) return;
        if (noise.sourceFaction && !isHostileTo(this.opts.faction, noise.sourceFaction)) return;
        const dist = this.distanceTo(noise.position);
        if (dist > Math.max(noise.radius, this.opts.hearingRadius)) return;
        if (noise.kind === 'gunshot' || noise.kind === 'explosion') {
          this.recordCombat(noise.position);
        } else {
          this.recordSuspicious(noise.position);
        }
      }),
      eventBus.on('npc.threat.spotted', (spotted) => {
        if (spotted.spotterId === this.opts.ownId) return;
        if (spotted.spotterFaction !== this.opts.faction) return;
        const comms = this.opts.commsRadius ?? DEFAULT_COMMS_RADIUS;
        if (this.distanceTo(spotted.spotterPosition) > comms) return;
        this.recordCombat(spotted.threatPosition);
      }),
    );
  }

  tick(delta: number): void {
    if (this.combatNoise) {
      this.combatAge += delta;
      if (this.combatAge > COMBAT_NOISE_TTL) this.combatNoise = null;
    }
    if (this.suspiciousNoise) {
      this.suspiciousAge += delta;
      if (this.suspiciousAge > SUSPICIOUS_NOISE_TTL) this.suspiciousNoise = null;
    }
  }

  snapshot(): NoiseSnapshot {
    return {
      combat: this.combatNoise,
      suspicious: this.suspiciousNoise,
    };
  }

  /** Descarta los ruidos pendientes (e.g. tras llegar a investigarlos). */
  clear(): void {
    this.combatNoise = null;
    this.suspiciousNoise = null;
  }

  dispose(): void {
    this.disposers.forEach((dispose) => dispose());
    this.disposers.length = 0;
  }

  private recordCombat(position: Vector3): void {
    if (!this.combatNoise) this.combatNoise = position.clone();
    else this.combatNoise.copy(position);
    this.combatAge = 0;
  }

  private recordSuspicious(position: Vector3): void {
    if (!this.suspiciousNoise) this.suspiciousNoise = position.clone();
    else this.suspiciousNoise.copy(position);
    this.suspiciousAge = 0;
  }

  private distanceTo(point: Vector3): number {
    const pos = this.opts.getPosition();
    const dx = point.x - pos.x;
    const dz = point.z - pos.z;
    return Math.sqrt(dx * dx + dz * dz);
  }
}
