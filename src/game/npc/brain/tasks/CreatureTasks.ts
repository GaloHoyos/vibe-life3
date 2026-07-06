import type { Task, TaskStatus } from '@engine/ai/brain/Task';
import { threatNavPosition, type NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import type { NpcLeapProfile } from '@game/npc/presets/NpcPreset';

type NpcTask = Task<NpcBrainContext>;

/**
 * Embiste al threat sin frenar (manhack): re-encara su posicion actual cada
 * tick y dispara el mordisco (gated por cooldown del combat, conecta por
 * contacto). Como nunca para, el flyer mantiene su altura de hover y rebota
 * contra el player / paredes en vez de quedar flotando bajo. Corre indefinido;
 * el schedule sale por sus `interrupts` (LostEnemy / EnemyDead).
 */
export function createChargeAttackTask(gait: 'walk' | 'sprint' = 'sprint'): NpcTask {
  return {
    id: 'chargeAttack',
    init: () => {},
    tick: (ctx): TaskStatus => {
      // Terrestre: persigue la posición navegable real (ghost → ruta por A*).
      const target = threatNavPosition(ctx);
      if (!target) {
        ctx.locomotion.stop();
        return 'failure';
      }
      ctx.locomotion.moveTo(target, { gait });
      ctx.combat.tryFire();
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

/**
 * Persecucion pura de un volador (manhack): vuela a la posicion del threat sin
 * frenar y sin disparar mordisco — el daño de contacto lo hace el **slice del
 * motor** (cuchilla por contacto), no el combat del brain (evita doble daño).
 * Corre indefinido; el schedule sale por sus `interrupts`.
 */
export function createFlyerPursuitTask(gait: 'walk' | 'sprint' = 'sprint'): NpcTask {
  return {
    id: 'flyerPursuit',
    init: () => {},
    tick: (ctx): TaskStatus => {
      const target = ctx.threat?.position ?? ctx.threatLastKnown;
      if (!target) {
        ctx.locomotion.stop();
        return 'failure';
      }
      ctx.locomotion.moveTo(target, { gait });
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

/**
 * Salto de pounce estilo headcrab HL2: encara al threat (`windup`), se lanza en
 * parabola hacia su posicion y queda `running` hasta aterrizar.
 *
 * El daño NO lo aplica este task: al lanzarse abre la ventana de ataque del
 * combat (`tryFire`), y como el headcrab tiene `windup: 0` + `hitWindow` largo,
 * el `NpcCombat` conecta el mordisco solo cuando el cuerpo entra en `range`
 * durante el vuelo — contacto real, sin codigo de daño nuevo aca.
 */
export function createLeapTask(profile: NpcLeapProfile): NpcTask {
  let phase: 'windup' | 'air' = 'windup';
  let elapsed = 0;
  return {
    id: 'leap',
    init: (ctx) => {
      elapsed = 0;
      // Si re-entramos al schedule con un salto ya en curso (preempt + re-pick),
      // no relanzar: continuar esperando el aterrizaje.
      if (ctx.locomotion.isLeaping()) {
        phase = 'air';
        return;
      }
      phase = 'windup';
      ctx.locomotion.stop();
      const target = ctx.threat?.position ?? ctx.threatLastKnown;
      if (target) ctx.locomotion.face(target);
    },
    tick: (ctx): TaskStatus => {
      if (phase === 'air') {
        return ctx.locomotion.isLeaping() ? 'running' : 'success';
      }
      const target = ctx.threat?.position ?? ctx.threatLastKnown;
      if (!target) return 'failure';
      ctx.locomotion.face(target);
      elapsed += ctx.delta;
      if (elapsed < profile.windup) return 'running';
      // Lanzamiento: abrir el mordisco y saltar a la posicion del threat.
      ctx.combat.tryFire();
      ctx.locomotion.leap(target, {
        upSpeed: profile.upSpeed,
        maxForwardSpeed: profile.maxForwardSpeed,
      });
      phase = 'air';
      return 'running';
    },
    abort: (ctx) => {
      // El salto fisico lo termina el motor aunque se aborte el task; solo
      // soltamos el goal de locomotion por prolijidad.
      ctx.locomotion.stop();
    },
  };
}
