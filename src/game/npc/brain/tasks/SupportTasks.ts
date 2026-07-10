import type { Task, TaskStatus } from '@engine/ai/brain/Task';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';

type NpcTask = Task<NpcBrainContext>;

/**
 * Curacion de medic: corre hasta el aliado herido (`ctx.medic.target`,
 * re-resuelto por frame — sigue al objetivo si se mueve), "castea" `castTime`
 * encarandolo y aplica el heal via `ctx.medic.heal` (emite `npc.heal` y
 * arranca el cooldown). Moverse lejos del alcance reinicia el cast.
 */
export function createHealAllyTask(castTime = 1.2, reachDistance = 1.9): NpcTask {
  let casting = 0;
  return {
    id: 'healAlly',
    init: () => {
      casting = 0;
    },
    tick: (ctx): TaskStatus => {
      const medic = ctx.medic;
      if (!medic || !medic.target.isAlive) {
        ctx.locomotion.stop();
        return 'failure';
      }
      const target = medic.target;
      const dx = target.position.x - ctx.self.position.x;
      const dz = target.position.z - ctx.self.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > reachDistance) {
        casting = 0;
        ctx.locomotion.moveTo(target.position, { gait: 'sprint' });
        if (ctx.locomotion.isStuck()) return 'failure';
        return 'running';
      }
      ctx.locomotion.stop();
      ctx.locomotion.face(target.position);
      casting += ctx.delta;
      if (casting < castTime) return 'running';
      return medic.heal(ctx.elapsed) ? 'success' : 'failure';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}
