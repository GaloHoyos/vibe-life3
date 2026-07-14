import { Vector3 } from 'three';
import type { Task, TaskStatus } from '@engine/ai/brain/Task';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import type { NpcScriptOrder, ResolvedSequenceStep } from '@game/script/NpcScriptOrder';

type NpcTask = Task<NpcBrainContext>;

/** Radio de llegada al punto de una secuencia guionada. */
const ARRIVE_RADIUS = 0.8;
/** Tiempo que un paso `face` mantiene el encare (el motor gira gradual). */
const FACE_HOLD = 0.6;

/**
 * Move-to del scripted_sequence: lleva al NPC al punto de la orden (walk/run/
 * teleport/none), lo encara al `faceYaw` y emite `OnArrived`. Éxito = en
 * posición; `failure` si se traba (y cancela la orden).
 */
export function createScriptMoveTask(): NpcTask {
  const facePoint = new Vector3();
  return {
    id: 'scriptMove',
    init: () => {},
    tick: (ctx): TaskStatus => {
      const order = ctx.script;
      if (!order) {
        // Cancel puede limpiar la orden entre frames mientras el path sigue
        // vivo. El task debe ser dueño de detener esa locomoción residual.
        ctx.locomotion.stop();
        return 'success';
      }

      if (order.moveMode === 'none') {
        faceFinal(ctx, order, facePoint);
        order.notifyArrived();
        return 'success';
      }

      if (order.moveMode === 'teleport' && order.movePosition && ctx.locomotion.teleport) {
        ctx.locomotion.teleport(order.movePosition, order.faceYaw ?? currentYaw(ctx));
        order.notifyArrived();
        return 'success';
      }

      const goal = order.movePosition;
      if (!goal) {
        order.notifyArrived();
        return 'success';
      }
      const target = ctx.navigation.projectPoint(goal, ctx.navigationProfile) ?? goal;
      const dx = target.x - ctx.self.position.x;
      const dz = target.z - ctx.self.position.z;
      if (Math.sqrt(dx * dx + dz * dz) <= ARRIVE_RADIUS) {
        ctx.locomotion.stop();
        faceFinal(ctx, order, facePoint);
        order.notifyArrived();
        return 'success';
      }
      ctx.locomotion.moveTo(target, { gait: order.moveMode === 'run' ? 'sprint' : 'walk' });
      if (ctx.locomotion.isStuck()) {
        ctx.locomotion.stop();
        order.notifyDone('failed');
        return 'failure';
      }
      return 'running';
    },
    abort: (ctx) => {
      ctx.locomotion.stop();
      ctx.script?.notifyDone('canceled');
    },
  };
}

/**
 * Ejecuta los pasos de la secuencia en orden (gesto / espera / cue / decir /
 * encarar). Al agotarlos emite `OnEnd` (`notifyDone('completed')`).
 */
export function createScriptStepsTask(): NpcTask {
  let index = 0;
  let elapsed = 0;
  let started = false;
  const faceTarget = new Vector3();
  return {
    id: 'scriptSteps',
    init: () => {
      index = 0;
      elapsed = 0;
      started = false;
    },
    tick: (ctx): TaskStatus => {
      const order = ctx.script;
      if (!order) {
        ctx.locomotion.stop();
        return 'success';
      }
      if (index >= order.steps.length) {
        order.notifyDone('completed');
        return 'success';
      }
      const step = order.steps[index];
      if (!started) {
        enterStep(ctx, step);
        started = true;
        elapsed = 0;
      }
      elapsed += ctx.delta;
      if (tickStep(ctx, order, step, elapsed, faceTarget)) {
        index += 1;
        started = false;
      }
      return 'running';
    },
    abort: (ctx) => {
      ctx.locomotion.stop();
      ctx.script?.notifyDone('canceled');
    },
  };
}

function enterStep(ctx: NpcBrainContext, step: ResolvedSequenceStep): void {
  switch (step.kind) {
    case 'gesture':
      ctx.gesture(step.gesture, step.duration);
      return;
    case 'say':
      ctx.eventBus.emit('dialogue.show', {
        speaker: step.speaker,
        text: step.text,
        duration: step.duration,
      });
      return;
    default:
      return;
  }
}

/** Devuelve true cuando el paso terminó. */
function tickStep(
  ctx: NpcBrainContext,
  order: NpcScriptOrder,
  step: ResolvedSequenceStep,
  elapsed: number,
  faceTarget: Vector3,
): boolean {
  switch (step.kind) {
    case 'gesture':
      return elapsed >= step.duration;
    case 'wait':
      return elapsed >= step.seconds;
    case 'say':
      return elapsed >= step.duration;
    case 'waitForCue':
      if (order.isCuePending()) {
        order.consumeCue();
        return true;
      }
      return false;
    case 'face': {
      const point = step.target === 'player' ? ctx.player.position : faceTarget.copy(step.target);
      ctx.locomotion.face(point);
      return elapsed >= FACE_HOLD;
    }
  }
}

function faceFinal(ctx: NpcBrainContext, order: NpcScriptOrder, out: Vector3): void {
  if (order.faceYaw === null) return;
  out.set(
    ctx.self.position.x + Math.sin(order.faceYaw) * 5,
    ctx.self.position.y,
    ctx.self.position.z + Math.cos(order.faceYaw) * 5,
  );
  ctx.locomotion.face(out);
}

function currentYaw(ctx: NpcBrainContext): number {
  const f = ctx.self.facing;
  return Math.atan2(f.x, f.z);
}
