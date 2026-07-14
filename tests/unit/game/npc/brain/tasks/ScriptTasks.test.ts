import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import { Brain } from "@engine/ai/brain/Brain";
import { NO_CONDITIONS } from "@engine/ai/brain/Condition";
import type { ScheduleDefinition, Task } from "@engine/ai/brain/Task";
import type { NpcBrainContext } from "@game/npc/brain/NpcBrainContext";
import { condMask, type CondKey } from "@game/npc/brain/NpcConditions";
import type { NpcScriptOrder, ResolvedSequenceStep, ScriptMoveMode } from "@game/script/NpcScriptOrder";
import { createScriptMoveTask, createScriptStepsTask } from "@game/npc/brain/tasks/ScriptTasks";
import { deadSchedule, scriptedSchedules } from "@game/npc/presets/commonSchedules";

interface FakeOrder extends NpcScriptOrder {
  arrived: number;
  done: string | null;
  cue: boolean;
}

function makeOrder(opts: {
  moveMode?: ScriptMoveMode;
  movePosition?: Vector3 | null;
  faceYaw?: number | null;
  steps?: ResolvedSequenceStep[];
  overrideAi?: boolean;
}): FakeOrder {
  const order: FakeOrder = {
    sequenceName: "seq",
    moveMode: opts.moveMode ?? "none",
    movePosition: opts.movePosition ?? null,
    faceYaw: opts.faceYaw ?? null,
    steps: opts.steps ?? [],
    overrideAi: opts.overrideAi ?? false,
    arrived: 0,
    done: null,
    cue: false,
    isCuePending: () => order.cue,
    consumeCue: () => {
      order.cue = false;
    },
    notifyArrived: () => {
      order.arrived += 1;
    },
    notifyDone: (status) => {
      order.done ??= status;
    },
  };
  return order;
}

function makeContext(order: NpcScriptOrder, teleport?: (p: Vector3, yaw: number) => void): NpcBrainContext {
  const ctx = {
    delta: 0.1,
    elapsed: 0,
    self: {
      id: "npc",
      position: new Vector3(0, 0, 0),
      facing: new Vector3(0, 0, 1),
      faction: "resistance" as const,
      isAlive: true,
      health: 100,
      maxHealth: 100,
      radius: 0.35,
    },
    threat: null,
    threatLastKnown: null,
    threatSuspected: null,
    anchorPosition: null,
    anchorOffset: null,
    player: {
      id: "player",
      position: new Vector3(2, 0, 2),
      faction: "player" as const,
      entity: { applyDamage: vi.fn(), isAlive: () => true },
      isAlive: true,
      radius: 0.35,
    },
    patrolRoute: null,
    noise: { combat: null, suspicious: null },
    tactical: null,
    squad: null,
    slots: null,
    medic: null,
    script: order,
    gesture: vi.fn(),
    conditions: NO_CONDITIONS,
    navigation: { projectPoint: (p: Vector3) => p },
    navigationProfile: {} as NpcBrainContext["navigationProfile"],
    buildingRegistry: {} as NpcBrainContext["buildingRegistry"],
    locomotion: {
      moveTo: vi.fn(),
      stop: vi.fn(),
      distanceToTarget: () => 0,
      hasPath: () => true,
      isStuck: () => false,
      face: vi.fn(),
      leap: vi.fn(),
      isLeaping: () => false,
      teleport,
    },
    combat: {} as NpcBrainContext["combat"],
    eventBus: { emit: vi.fn() } as unknown as NpcBrainContext["eventBus"],
  };
  return ctx as unknown as NpcBrainContext;
}

describe("createScriptMoveTask", () => {
  it("moveMode 'none' llega de inmediato y notifica", () => {
    const order = makeOrder({ moveMode: "none" });
    const ctx = makeContext(order);
    const task = createScriptMoveTask();
    task.init(ctx);
    expect(task.tick(ctx)).toBe("success");
    expect(order.arrived).toBe(1);
  });

  it("moveMode 'teleport' usa el teleport del motor y notifica", () => {
    const teleport = vi.fn();
    const order = makeOrder({ moveMode: "teleport", movePosition: new Vector3(9, 0, 9), faceYaw: 1 });
    const ctx = makeContext(order, teleport);
    const task = createScriptMoveTask();
    task.init(ctx);
    expect(task.tick(ctx)).toBe("success");
    expect(teleport).toHaveBeenCalledWith(order.movePosition, 1);
    expect(order.arrived).toBe(1);
  });

  it("walk llega cuando está dentro del radio", () => {
    const order = makeOrder({ moveMode: "walk", movePosition: new Vector3(0, 0, 0) });
    const ctx = makeContext(order);
    const task = createScriptMoveTask();
    task.init(ctx);
    // El goal coincide con self.position → dentro del radio de llegada.
    expect(task.tick(ctx)).toBe("success");
    expect(order.arrived).toBe(1);
  });

  it("abort cancela la orden", () => {
    const order = makeOrder({ moveMode: "walk", movePosition: new Vector3(50, 0, 50) });
    const ctx = makeContext(order);
    const task = createScriptMoveTask();
    task.init(ctx);
    task.abort(ctx);
    expect(order.done).toBe("canceled");
  });

  it("detiene la locomoción si Cancel limpió la orden entre frames", () => {
    const order = makeOrder({ moveMode: "walk", movePosition: new Vector3(50, 0, 0) });
    const ctx = makeContext(order);
    const task = createScriptMoveTask();
    task.init(ctx);

    expect(task.tick(ctx)).toBe("running");
    expect(ctx.locomotion.moveTo).toHaveBeenCalled();
    ctx.script = null;
    expect(task.tick(ctx)).toBe("success");
    expect(ctx.locomotion.stop).toHaveBeenCalled();
  });
});

describe("createScriptStepsTask", () => {
  it("ejecuta los pasos en orden y termina con completed", () => {
    const order = makeOrder({
      steps: [
        { kind: "gesture", gesture: "point", duration: 0.1 },
        { kind: "wait", seconds: 0.1 },
      ],
    });
    const ctx = makeContext(order);
    const task = createScriptStepsTask();
    task.init(ctx);

    // gesture (dispara y espera su duración)
    expect(task.tick(ctx)).toBe("running");
    expect(ctx.gesture).toHaveBeenCalledWith("point", 0.1);
    // wait
    expect(task.tick(ctx)).toBe("running");
    // pasos agotados
    expect(task.tick(ctx)).toBe("success");
    expect(order.done).toBe("completed");
  });

  it("waitForCue bloquea hasta que llega la señal", () => {
    const order = makeOrder({ steps: [{ kind: "waitForCue" }] });
    const ctx = makeContext(order);
    const task = createScriptStepsTask();
    task.init(ctx);

    expect(task.tick(ctx)).toBe("running");
    expect(task.tick(ctx)).toBe("running");
    order.cue = true;
    expect(task.tick(ctx)).toBe("running"); // consume el cue, avanza
    expect(task.tick(ctx)).toBe("success");
    expect(order.done).toBe("completed");
  });
});

describe("scriptedSchedules con el Brain real", () => {
  it.each(["SeeEnemy", "JustHit"] satisfies CondKey[])(
    "%s interrumpe una secuencia sin override y cancela su orden",
    (interrupt) => {
      const order = makeOrder({ moveMode: "walk", movePosition: new Vector3(50, 0, 0) });
      const ctx = makeContext(order);
      const reaction = runningTask("reaction");
      const reactionSchedule: ScheduleDefinition<NpcBrainContext> = {
        id: "reaction",
        priority: 800,
        required: condMask(interrupt),
        blockedBy: NO_CONDITIONS,
        interrupts: NO_CONDITIONS,
        tasks: [reaction],
      };
      const brain = new Brain<NpcBrainContext>([
        ...scriptedSchedules(),
        reactionSchedule,
      ]);

      brain.update(ctx, 0.1, condMask("ScriptActive"));
      expect(brain.snapshot().schedule).toBe("scripted");

      brain.update(ctx, 0.1, condMask("ScriptActive", interrupt));

      expect(brain.snapshot().schedule).toBe("reaction");
      expect(order.done).toBe("canceled");
      expect(ctx.locomotion.stop).toHaveBeenCalled();
    },
  );

  it("la muerte cancela incluso una secuencia override", () => {
    const order = makeOrder({
      moveMode: "walk",
      movePosition: new Vector3(50, 0, 0),
      overrideAi: true,
    });
    const ctx = makeContext(order);
    const brain = new Brain<NpcBrainContext>([
      ...scriptedSchedules(),
      deadSchedule(),
    ]);

    brain.update(ctx, 0.1, condMask("ScriptActive", "ScriptUninterruptible"));
    expect(brain.snapshot().schedule).toBe("scriptedOverride");

    brain.update(ctx, 0.1, condMask("IsDead"));

    expect(brain.snapshot().schedule).toBeNull();
    expect(brain.snapshot().previousSchedule).toBe("dead");
    expect(order.done).toBe("canceled");
    expect(ctx.locomotion.stop).toHaveBeenCalled();
  });
});

function runningTask(id: string): Task<NpcBrainContext> {
  return {
    id,
    init: () => undefined,
    tick: () => "running",
    abort: () => undefined,
  };
}
