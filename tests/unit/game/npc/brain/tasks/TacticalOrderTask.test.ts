import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { Brain } from '@engine/ai/brain/Brain';
import { NO_CONDITIONS } from '@engine/ai/brain/Condition';
import type { ScheduleDefinition, Task } from '@engine/ai/brain/Task';
import type { NpcBrainContext } from '@game/npc/brain/NpcBrainContext';
import { condMask } from '@game/npc/brain/NpcConditions';
import { createTacticalOrderTask } from '@game/npc/brain/tasks/CoreTasks';
import type { NpcScriptOrder } from '@game/script/NpcScriptOrder';
import {
  scriptedSchedules,
  tacticalOrderSchedule,
} from '@game/npc/presets/commonSchedules';

function makeContext(options: {
  target?: Vector3;
  self?: Vector3;
  stuck?: boolean;
  project?: boolean;
} = {}) {
  const complete = vi.fn();
  const target = options.target ?? new Vector3(8, 0, 0);
  const self = options.self ?? new Vector3();
  const context = {
    delta: 0.1,
    elapsed: 0,
    self: {
      id: 'npc',
      position: self,
      facing: new Vector3(0, 0, 1),
      faction: 'combine',
      isAlive: true,
      health: 100,
      maxHealth: 100,
      radius: 0.35,
    },
    tacticalOrder: {
      commandId: 'continue-1',
      target,
      arriveRadius: 1,
      complete,
    },
    navigation: {
      projectPoint: (point: Vector3) =>
        options.project === false ? null : point.clone(),
    },
    navigationProfile: { stepHeight: 0.4 },
    locomotion: {
      moveTo: vi.fn(),
      stop: vi.fn(),
      isStuck: () => options.stuck ?? false,
    },
    script: null,
  } as unknown as NpcBrainContext;
  return { context, complete };
}

describe('createTacticalOrderTask', () => {
  it('confirma la llegada al target world-space', () => {
    const { context, complete } = makeContext({
      target: new Vector3(0.5, 0, 0),
    });
    const task = createTacticalOrderTask();

    task.init(context);

    expect(task.tick(context)).toBe('success');
    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith('completed');
    expect(context.locomotion.stop).toHaveBeenCalledOnce();
  });

  it('no confunde estar debajo del target con haber llegado', () => {
    const { context, complete } = makeContext({
      target: new Vector3(0.5, 5, 0),
    });
    const task = createTacticalOrderTask();

    task.init(context);

    expect(task.tick(context)).toBe('running');
    expect(complete).not.toHaveBeenCalled();
    expect(context.locomotion.moveTo).toHaveBeenCalledOnce();
  });

  it('reporta failed cuando no existe un punto navegable', () => {
    const { context, complete } = makeContext({ project: false });
    const task = createTacticalOrderTask();

    task.init(context);

    expect(task.tick(context)).toBe('failure');
    expect(complete).toHaveBeenCalledWith('failed');
  });

  it('reporta failed cuando la locomoción agotó su recovery', () => {
    const { context, complete } = makeContext({ stuck: true });
    const task = createTacticalOrderTask();

    task.init(context);

    expect(task.tick(context)).toBe('failure');
    expect(complete).toHaveBeenCalledWith('failed');
    expect(context.locomotion.moveTo).not.toHaveBeenCalled();
  });
});

describe('tacticalOrderSchedule', () => {
  it('se pausa durante combate sin resolver la orden y luego la retoma', () => {
    const { context, complete } = makeContext();
    const combat: ScheduleDefinition<NpcBrainContext> = {
      id: 'combat',
      priority: 600,
      required: condMask('SeeEnemy'),
      blockedBy: NO_CONDITIONS,
      interrupts: NO_CONDITIONS,
      tasks: [runningTask('combat')],
    };
    const brain = new Brain<NpcBrainContext>([
      tacticalOrderSchedule(),
      combat,
    ]);

    brain.update(context, 0.1, condMask('TacticalOrder'));
    expect(brain.snapshot().schedule).toBe('tacticalOrder');

    brain.update(context, 0.1, condMask('TacticalOrder', 'SeeEnemy'));
    expect(brain.snapshot().schedule).toBe('combat');
    expect(complete).not.toHaveBeenCalled();

    brain.update(context, 0.1, condMask('TacticalOrder'));
    expect(brain.snapshot().schedule).toBe('tacticalOrder');
    expect(context.locomotion.moveTo).toHaveBeenCalledTimes(2);
    expect(complete).not.toHaveBeenCalled();
  });

  it('cede ante scripted_sequence y conserva la orden para después', () => {
    const { context, complete } = makeContext();
    context.script = fakeScriptOrder();
    const brain = new Brain<NpcBrainContext>([
      ...scriptedSchedules(),
      tacticalOrderSchedule(),
    ]);

    brain.update(
      context,
      0.1,
      condMask('TacticalOrder', 'ScriptActive'),
    );

    expect(brain.snapshot().schedule).toBe('scripted');
    expect(complete).not.toHaveBeenCalled();

    context.script = null;
    brain.update(context, 0.1, condMask('TacticalOrder'));
    brain.update(context, 0.1, condMask('TacticalOrder'));

    expect(brain.snapshot().schedule).toBe('tacticalOrder');
    expect(complete).not.toHaveBeenCalled();
  });
});

function runningTask(id: string): Task<NpcBrainContext> {
  return {
    id,
    init: () => undefined,
    tick: () => 'running',
    abort: () => undefined,
  };
}

function fakeScriptOrder(): NpcScriptOrder {
  return {
    sequenceName: 'test',
    moveMode: 'none',
    movePosition: null,
    faceYaw: null,
    steps: [],
    overrideAi: false,
    isCuePending: () => false,
    consumeCue: () => undefined,
    notifyArrived: () => undefined,
    notifyDone: () => undefined,
  };
}
