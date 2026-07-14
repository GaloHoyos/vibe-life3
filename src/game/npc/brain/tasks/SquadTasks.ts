import type { Task, TaskStatus } from '@engine/ai/brain/Task';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';

type NpcTask = Task<NpcBrainContext>;

/** Veda del slot de granada para toda la squad tras un lanzamiento (s). */
const GRENADE_SLOT_LOCKOUT = 6;

/**
 * Overwatch estilo HL2: reclama el slot unico de la squad y sostiene la mira
 * sobre la ultima posicion conocida del threat mientras el resto avanza a
 * buscar. Si el enemigo reaparece, `SeeEnemy` interrumpe el schedule y el
 * engage retoma. Cooldown por NPC tras completar, para que el rol rote entre
 * miembros en vez de que el mismo lo re-reclame siempre.
 */
/**
 * Lanza una granada de flush-out a la LKP: reclama el slot unico de granada,
 * windup encarando el punto, emite la granada fisica (via `slots.throwGrenade`,
 * que ademas arranca el cooldown del NPC) y libera el slot con lockout para
 * que la squad espacie los lanzamientos. Abort libera sin castigo.
 */
export function createThrowGrenadeTask(windup = 0.5): NpcTask {
  let elapsed = 0;
  let claimed = false;
  return {
    id: 'throwGrenade',
    init: (ctx) => {
      elapsed = 0;
      claimed = ctx.slots?.claimGrenade() ?? false;
      if (claimed) ctx.locomotion.stop();
    },
    tick: (ctx): TaskStatus => {
      if (!claimed) return 'failure';
      const target = ctx.threatLastKnown;
      if (!target) {
        ctx.slots?.releaseGrenade();
        claimed = false;
        return 'failure';
      }
      ctx.locomotion.face(target);
      elapsed += ctx.delta;
      if (elapsed < windup) return 'running';
      const thrown = ctx.slots?.throwGrenade(ctx.elapsed) ?? false;
      ctx.slots?.releaseGrenade(thrown ? GRENADE_SLOT_LOCKOUT : 0);
      claimed = false;
      return thrown ? 'success' : 'failure';
    },
    abort: (ctx) => {
      if (claimed) {
        ctx.slots?.releaseGrenade();
        claimed = false;
      }
    },
  };
}

export function createOverwatchTask(duration = 5): NpcTask {
  let elapsed = 0;
  let claimed = false;
  let cooldownUntil = -Infinity;
  return {
    id: 'overwatch',
    init: (ctx) => {
      elapsed = 0;
      claimed = ctx.elapsed >= cooldownUntil && (ctx.slots?.claimOverwatch() ?? false);
      if (claimed) ctx.locomotion.stop();
    },
    tick: (ctx): TaskStatus => {
      if (!claimed) return 'failure';
      const watch = ctx.threatLastKnown;
      if (!watch) {
        ctx.slots?.releaseOverwatch();
        claimed = false;
        return 'failure';
      }
      ctx.locomotion.face(watch);
      ctx.combat.aim(watch);
      elapsed += ctx.delta;
      if (elapsed >= duration) {
        ctx.slots?.releaseOverwatch();
        claimed = false;
        cooldownUntil = ctx.elapsed + duration * 2;
        return 'success';
      }
      return 'running';
    },
    abort: (ctx) => {
      if (claimed) {
        ctx.slots?.releaseOverwatch();
        claimed = false;
      }
    },
  };
}
