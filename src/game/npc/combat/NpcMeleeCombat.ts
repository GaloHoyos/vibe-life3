import { Vector3 } from 'three';
import type { NpcCombatHandle, NpcCombatTickArgs } from '@game/npc/brain/NpcBrainContext';
import type { ActorSnapshot } from '@game/npc/core/INpc';
import type { NpcCombat } from '@game/npc/combat/NpcCombat';

/**
 * Adapter melee: expone el `NpcCombat` clasico (cooldown / windup /
 * hit-window / LOS) como `NpcCombatHandle` para el brain. `tryFire()` inicia
 * el golpe; el avance del ataque y la aplicacion de danio ocurren en `tick`,
 * que corre cada frame independientemente del schedule activo (un golpe ya
 * iniciado conecta aunque el brain cambie de schedule a mitad del swing).
 */
export class NpcMeleeCombat implements NpcCombatHandle {
  private threat: ActorSnapshot | null = null;
  private readonly position = new Vector3();
  private readonly facing = new Vector3();

  constructor(
    private readonly combat: NpcCombat,
    private readonly range: number,
    private readonly onAttackStart?: () => void,
  ) {}

  tick(args: NpcCombatTickArgs): void {
    this.threat = args.threat;
    this.position.copy(args.position);
    this.facing.copy(args.facing);
    this.combat.tickCooldown(args.delta);
    if (this.combat.isAttacking() && this.threat) {
      this.combat.tickAttack(args.delta, {
        npcPosition: this.position,
        npcForward: this.facing,
        targetPosition: this.threat.position,
        target: this.threat.entity,
        targetId: this.threat.id,
        balanceLocked: false,
      });
    }
  }

  aim(): void {}

  tryFire(): boolean {
    if (!this.threat || this.combat.isAttacking() || !this.combat.isReady()) return false;
    const started = this.combat.start(this.position);
    if (started) this.onAttackStart?.();
    return started;
  }

  reload(): void {}

  isReloading(): boolean {
    return false;
  }

  magazineEmpty(): boolean {
    return false;
  }

  effectiveRange(): number {
    return this.range;
  }

  isAttacking(): boolean {
    return this.combat.isAttacking();
  }
}
