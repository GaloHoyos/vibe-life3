import { Vector3 } from 'three';
import type { CharacterId } from '@engine/characters/CharacterDefinition';
import type { RaycastSource } from '@engine/physics/Raycast';
import type { GameEventBus } from '@game/GameEvents';
import { BlobConfig } from '@game/config/blob.config';
import type { NpcCombatHandle, NpcCombatTickArgs } from '@game/npc/brain/NpcBrainContext';
import type { BlobSwarmState } from './BlobSwarmState';
import type { BlobOrganismRuntime } from '@engine/blob/BlobOrganismRuntime';

export interface BlobContactCombatOptions {
  id: string;
  characterId: CharacterId;
  eventBus: GameEventBus;
  /** LOS portal-aware: el contacto respeta paredes (no consume a través). */
  raycast: RaycastSource;
  state: BlobSwarmState;
  runtime: BlobOrganismRuntime;
  eyeHeight: number;
}

const TMP_ORIGIN = new Vector3();
const TMP_DIR = new Vector3();

/**
 * Combate por contacto del blob: sin swing ni facing — la masa amorfa daña a
 * intervalos a todo threat dentro de su alcance (fiel al npc_blob original,
 * que hacía daño continuo al cubrir a su presa). Corre entero en `tick` (cada
 * frame, independiente del schedule); las tasks no disparan nada. Además
 * detecta el kill propio y lo "consume": crece vía `BlobSwarmState` y se cura
 * emitiendo `npc.heal` sobre sí mismo (Game resuelve el heal por targetId).
 */
export class BlobContactCombat implements NpcCombatHandle {
  private damageTimer = 0;
  private soundTimer = 0;

  constructor(private readonly opts: BlobContactCombatOptions) {}

  tick(args: NpcCombatTickArgs): void {
    this.damageTimer = Math.max(0, this.damageTimer - args.delta);
    this.soundTimer = Math.max(0, this.soundTimer - args.delta);

    const threat = args.threat;
    if (!threat || !threat.isAlive) {
      this.opts.state.setThreat(null);
      return;
    }
    this.opts.state.setThreat(threat.position);

    if (this.damageTimer > 0) {
      return;
    }
    const dx = threat.position.x - args.position.x;
    const dz = threat.position.z - args.position.z;
    if (!this.touchesThreat(threat.position, threat.radius)) {
      return;
    }
    if (!this.hasLineOfSight(args.position, threat.position, threat.id)) {
      return;
    }

    this.damageTimer = BlobConfig.contact.interval;
    TMP_DIR.set(dx, 0, dz);
    if (TMP_DIR.lengthSq() < 1e-6) {
      TMP_DIR.set(0, 0, 1);
    } else {
      TMP_DIR.normalize();
    }
    threat.entity.applyDamage(
      BlobConfig.contact.damage * this.opts.state.damageMultiplier,
      TMP_DIR.clone(),
      undefined,
      this.opts.id,
      threat.position.clone(),
      'melee',
    );

    if (this.soundTimer <= 0) {
      this.soundTimer = BlobConfig.contact.attackSoundInterval;
      this.opts.eventBus.emit('npc.attack', {
        id: this.opts.id,
        characterId: this.opts.characterId,
        position: args.position.clone(),
      });
    }

    if (!threat.entity.isAlive()) {
      this.opts.state.noteKill();
      this.opts.eventBus.emit('npc.heal', {
        medicId: this.opts.id,
        characterId: this.opts.characterId,
        targetId: this.opts.id,
        amount: BlobConfig.growth.healPerKill,
        position: args.position.clone(),
      });
    }
  }

  aim(): void {}

  tryFire(): boolean {
    return true;
  }

  reload(): void {}

  isReloading(): boolean {
    return false;
  }

  magazineEmpty(): boolean {
    return false;
  }

  effectiveRange(): number {
    return this.opts.state.contactRange;
  }

  private hasLineOfSight(
    position: Vector3,
    targetPosition: Vector3,
    targetId: string,
  ): boolean {
    TMP_ORIGIN.copy(position);
    TMP_ORIGIN.y += this.opts.eyeHeight;
    TMP_DIR.copy(targetPosition).sub(TMP_ORIGIN);
    const distance = TMP_DIR.length();
    if (distance <= 1e-4) {
      return true;
    }
    TMP_DIR.divideScalar(distance);
    const hit = this.opts.raycast.cast(
      TMP_ORIGIN,
      TMP_DIR,
      distance + 0.2,
      undefined,
      this.opts.id,
      (metadata) => metadata?.blobPermeable !== true,
    );
    // Como en NpcCombat: el contacto vale si lo primero en la línea es el
    // propio target (una pared/reja intermedia lo bloquea).
    return (hit?.metadata?.ownerId ?? hit?.metadata?.id) === targetId;
  }

  private touchesThreat(position: Vector3, radius: number): boolean {
    const padding = Math.max(0.2, radius);
    for (let index = 0; index < this.opts.runtime.particleCount; index++) {
      const particle = this.opts.runtime.particles[index];
      if (!particle.active || particle.scale <= 0.15) continue;
      const reach = padding + particle.radius * 1.8;
      if (particle.position.distanceToSquared(position) <= reach * reach) return true;
    }
    return false;
  }
}
