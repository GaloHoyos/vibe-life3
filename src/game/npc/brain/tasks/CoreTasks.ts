import { Vector3 } from 'three';
import type { Task, TaskStatus } from '@engine/ai/brain/Task';
import { task } from '@engine/ai/brain/Task';
import { threatNavPosition, type NpcBrainContext } from '@game/npc/brain/NpcBrainContext';

type NpcTask = Task<NpcBrainContext>;

/**
 * Wait estatico: success tras `duration` segundos. Util para schedules de
 * Idle / Alert / Investigate.
 */
export function createWaitTask(duration: number): NpcTask {
  let remaining = duration;
  return {
    id: 'wait',
    init: () => {
      remaining = duration;
    },
    tick: (ctx) => {
      remaining -= ctx.delta;
      return remaining <= 0 ? 'success' : 'running';
    },
    abort: () => {},
  };
}

/**
 * Encara al threat actual. Falla si no hay threat — el caller debe
 * encolarla cuando `SeeEnemy` o `LostEnemy` esten activos.
 */
export const FaceThreatTask: NpcTask = task<NpcBrainContext>('faceThreat', (ctx) => {
  const target = ctx.threat?.position ?? ctx.threatLastKnown;
  if (!target) return 'failure';
  ctx.locomotion.face(target);
  return 'success';
});

/**
 * Mueve al NPC hacia el threat (su posicion actual o lastKnown). Success
 * cuando esta dentro de `tolerance` (default 1.5 m). Failure si no hay
 * threat ni memoria.
 */
export function createMoveToThreatTask(tolerance = 1.5, gait: 'walk' | 'sprint' = 'walk'): NpcTask {
  return {
    id: 'moveToThreat',
    init: () => {},
    tick: (ctx): TaskStatus => {
      // Goal navegable: contra un ghost de portal se persigue la posición real
      // y el A* elige la ruta (por el portal si es más corta).
      const target = threatNavPosition(ctx);
      if (!target) {
        ctx.locomotion.stop();
        return 'failure';
      }
      ctx.locomotion.moveTo(target, { gait });
      if (ctx.locomotion.distanceToTarget() <= tolerance) {
        ctx.locomotion.stop();
        return 'success';
      }
      if (ctx.locomotion.isStuck()) return 'failure';
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

const tmpVec = new Vector3();

/**
 * Mueve a un punto fijo, capturado al `init`. Usado por tasks de patrol /
 * cover / sweep que requieren un destino estable.
 */
export function createMoveToPointTask(
  resolver: (ctx: NpcBrainContext) => Vector3 | null,
  tolerance = 1.0,
): NpcTask {
  let target: Vector3 | null = null;
  return {
    id: 'moveToPoint',
    init: (ctx) => {
      const resolved = resolver(ctx);
      target = resolved ? tmpVec.copy(resolved).clone() : null;
    },
    tick: (ctx): TaskStatus => {
      if (!target) return 'failure';
      ctx.locomotion.moveTo(target);
      if (ctx.locomotion.distanceToTarget() <= tolerance) {
        ctx.locomotion.stop();
        return 'success';
      }
      if (ctx.locomotion.isStuck()) return 'failure';
      return 'running';
    },
    abort: (ctx) => {
      target = null;
      ctx.locomotion.stop();
    },
  };
}

/**
 * Ejecuta una orden táctica persistente. Abort sólo frena: el dueño del NPC
 * conserva la orden para retomarla cuando termine combate o scripting.
 */
export function createTacticalOrderTask(): NpcTask {
  return {
    id: 'tacticalOrder',
    init: () => {},
    tick: (ctx): TaskStatus => {
      const order = ctx.tacticalOrder;
      if (!order) {
        ctx.locomotion.stop();
        return 'success';
      }
      const target = ctx.navigation.projectPoint(order.target, ctx.navigationProfile);
      if (!target) {
        ctx.locomotion.stop();
        order.complete('failed');
        return 'failure';
      }
      const dx = target.x - ctx.self.position.x;
      const dz = target.z - ctx.self.position.z;
      const verticalTolerance = Math.max(
        1.2,
        ctx.navigationProfile.stepHeight + 0.8,
      );
      if (
        dx * dx + dz * dz <= order.arriveRadius * order.arriveRadius &&
        Math.abs(target.y - ctx.self.position.y) <= verticalTolerance
      ) {
        ctx.locomotion.stop();
        order.complete('completed');
        return 'success';
      }
      if (ctx.locomotion.isStuck()) {
        ctx.locomotion.stop();
        order.complete('failed');
        return 'failure';
      }
      ctx.locomotion.moveTo(target, { gait: 'sprint' });
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

/**
 * Apunta al threat por hasta `settle` segundos antes de devolver success.
 * Si pierde el threat o entra en cover_blown, falla.
 */
export function createAimTask(settle: number): NpcTask {
  let elapsed = 0;
  return {
    id: 'aim',
    init: () => {
      elapsed = 0;
    },
    tick: (ctx): TaskStatus => {
      const target = ctx.threat?.position;
      if (!target) return 'failure';
      ctx.combat.aim(target);
      elapsed += ctx.delta;
      return elapsed >= settle ? 'success' : 'running';
    },
    abort: () => {},
  };
}

/**
 * Dispara una rafaga. Success cuando el subsistema combat reporta que
 * arranco el fire (la duracion de la rafaga la maneja el combat por
 * separado y el siguiente tick lo refleja). Failure si magazine vacio o el
 * threat quedo fuera del rango util del arma (mantiene la mira sin gastar
 * municion; el schedule re-selecciona).
 */
export const FireBurstTask: NpcTask = task<NpcBrainContext>('fireBurst', (ctx) => {
  if (ctx.combat.magazineEmpty()) return 'failure';
  if (!ctx.threat) return 'failure';
  ctx.combat.aim(ctx.threat.position);
  const dx = ctx.threat.position.x - ctx.self.position.x;
  const dz = ctx.threat.position.z - ctx.self.position.z;
  if (Math.sqrt(dx * dx + dz * dz) > ctx.combat.effectiveRange()) return 'failure';
  ctx.combat.tryFire();
  return 'success';
});

/**
 * Avanza esprintando hacia el threat hasta quedar dentro de `fraction` del
 * rango util del arma (85% deja margen para que no vuelva a salirse con un
 * paso del target). Para `closeDistance` cuando el enemigo esta a la vista
 * pero fuera de alcance.
 */
export function createMoveIntoRangeTask(fraction = 0.85): NpcTask {
  return {
    id: 'moveIntoRange',
    init: () => {},
    tick: (ctx): TaskStatus => {
      const goal = threatNavPosition(ctx);
      const shootAt = ctx.threat?.position ?? goal;
      if (!goal || !shootAt) {
        ctx.locomotion.stop();
        return 'failure';
      }
      const dx = shootAt.x - ctx.self.position.x;
      const dz = shootAt.z - ctx.self.position.z;
      if (Math.sqrt(dx * dx + dz * dz) <= ctx.combat.effectiveRange() * fraction) {
        ctx.locomotion.stop();
        return 'success';
      }
      ctx.locomotion.moveTo(goal, { gait: 'sprint' });
      if (ctx.locomotion.isStuck()) return 'failure';
      return 'running';
    },
    abort: (ctx) => ctx.locomotion.stop(),
  };
}

/**
 * Recarga el arma. Success cuando el combat reporta listo.
 */
export const ReloadWeaponTask: NpcTask = {
  id: 'reload',
  init: (ctx) => ctx.combat.reload(),
  tick: (ctx) => (ctx.combat.isReloading() ? 'running' : 'success'),
  abort: () => {},
};

/**
 * Marca animacion de death. La transicion a `isAlive=false` la hace
 * `applyDamage` cuando la salud llega a 0; este task solo espera la
 * animacion para liberar el slot del schedule.
 */
export const PlayDeathTask: NpcTask = task<NpcBrainContext>('playDeath', () => 'success');

export function createFlinchTask(duration = 0.2): NpcTask {
  return createWaitTask(duration);
}

/**
 * Reaccion a una sospecha (acumulador de deteccion sub-umbral): frena y
 * encara el punto sospechado durante `duration`, dandole presencia al "algo
 * vi" antes de la deteccion plena. Falla si la sospecha se disipo.
 */
export function createFaceSuspicionTask(duration = 0.8): NpcTask {
  let elapsed = 0;
  return {
    id: 'faceSuspicion',
    init: (ctx) => {
      elapsed = 0;
      ctx.locomotion.stop();
    },
    tick: (ctx): TaskStatus => {
      const target = ctx.threatSuspected;
      if (!target) return 'failure';
      ctx.locomotion.face(target);
      elapsed += ctx.delta;
      return elapsed >= duration ? 'success' : 'running';
    },
    abort: () => {},
  };
}
