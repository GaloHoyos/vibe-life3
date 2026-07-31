import { Vector3 } from 'three';
import { tupleToVector3 } from '@shared/math/VectorTuple';
import type { GameEventBus } from '@game/GameEvents';
import type { ActivatorRef, EntityHandle, EntityIOSystem, InputArgs } from './EntityIOSystem';
import type { NpcDirectory } from './NpcDirectory';
import type { NpcScriptOrder, ResolvedSequenceStep } from './NpcScriptOrder';
import type { ScriptedSequenceDefinition, SequenceStep } from './ScriptedSequenceTypes';
import { effectiveName } from './EntityIOTypes';

/** Orden interna: agrega `raiseCue` (que el input `Cue` dispara) a la cara pública. */
type SequenceOrder = NpcScriptOrder & { raiseCue(): void };

/**
 * Runtime de las secuencias guionadas (scripted_sequence). Cada secuencia es un
 * `EntityHandle` con inputs `Start`/`Cancel`/`Cue`; al arrancar resuelve su NPC
 * objetivo vía `NpcDirectory`, materializa una `NpcScriptOrder` (resolviendo
 * markers a puntos) y la publica para que los `ScriptTasks` del brain la
 * ejecuten. Los outputs `OnBegin`/`OnArrived`/`OnEnd`/`OnCanceled` cierran el
 * ciclo hacia el resto del grafo de I/O.
 */
export class ScriptedSequenceSystem {
  private readonly ordersByNpcId = new Map<string, NpcScriptOrder>();

  constructor(
    private readonly io: EntityIOSystem,
    private readonly directory: NpcDirectory,
    private readonly markers: ReadonlyMap<string, Vector3>,
    private readonly eventBus: GameEventBus,
  ) {}

  register(def: ScriptedSequenceDefinition): void {
    this.io.registerEntity(this.createHandle(def));
    this.io.registerConnections(
      { key: def.id, name: effectiveName(def) },
      def.connections ?? [],
    );
  }

  orderFor(npcId: string): NpcScriptOrder | null {
    return this.ordersByNpcId.get(npcId) ?? null;
  }

  clear(): void {
    this.ordersByNpcId.clear();
  }

  private createHandle(def: ScriptedSequenceDefinition): EntityHandle {
    const name = effectiveName(def);
    const source = { key: def.id, name };
    let hasRun = false;
    let activeOrder: SequenceOrder | null = null;
    let activeActivator: ActivatorRef | null = null;

    // Devuelve la orden creada: `restoreState` la necesita para re-emitir el cue
    // pendiente, y leer `activeOrder` ahí no sirve porque TS lo tiene angostado
    // a `null` por el guard previo (no ve la reasignación desde este closure).
    const start = (args: InputArgs, restoring = false): SequenceOrder | null => {
      if (activeOrder !== null) return null; // ya corriendo
      if (hasRun && !def.repeatable) return null;
      const npc = this.directory.firstAlive(def.targetNpc);
      if (!npc) {
        console.warn(`[Sequence] '${name}': NPC objetivo '${def.targetNpc}' no encontrado`);
        return null;
      }
      hasRun = true;
      activeActivator = args.activator;
      const npcId = npc.id;
      // Un NPC sólo puede ejecutar una secuencia a la vez. Cancelar la anterior
      // mantiene consistentes sus outputs y evita handles activos huérfanos.
      this.ordersByNpcId.get(npcId)?.notifyDone('canceled');
      activeOrder = this.buildOrder(def, source, args.activator, () => {
        if (this.ordersByNpcId.get(npcId) === activeOrder) {
          this.ordersByNpcId.delete(npcId);
        }
        activeOrder = null;
        activeActivator = null;
      });
      this.ordersByNpcId.set(npcId, activeOrder);
      if (!restoring) {
        this.io.fireOutput(source, 'OnBegin', args.activator);
      }
      return activeOrder;
    };

    return {
      key: def.id,
      name,
      classId: 'sequence',
      acceptInput: (input, args) => {
        switch (input) {
          case 'Start':
            start(args);
            return;
          case 'Cancel':
            activeOrder?.notifyDone('canceled');
            return;
          case 'Cue':
            activeOrder?.raiseCue();
            return;
        }
      },
      captureState: () => ({
        hasRun,
        active: activeOrder !== null,
        cuePending: activeOrder?.isCuePending() ?? false,
        activatorKind: activeActivator?.kind ?? 'none',
        activatorName:
          activeActivator?.kind === 'entity' ? activeActivator.name : null,
        activatorKey:
          activeActivator?.kind === 'entity'
            ? activeActivator.key ?? null
            : null,
      }),
      restoreState: (state) => {
        const savedHasRun =
          typeof state.hasRun === 'boolean' ? state.hasRun : false;
        hasRun = savedHasRun;
        if (state.active !== true || activeOrder !== null) return;
        const activator: ActivatorRef =
          state.activatorKind === 'player'
            ? { kind: 'player' }
            : state.activatorKind === 'entity' &&
                typeof state.activatorName === 'string'
              ? {
                  kind: 'entity',
                  name: state.activatorName,
                  ...(typeof state.activatorKey === 'string'
                    ? { key: state.activatorKey }
                    : {}),
                }
              : { kind: 'none' };
        hasRun = false;
        const restored = start({ activator, caller: source.name }, true);
        hasRun = savedHasRun;
        if (state.cuePending === true) restored?.raiseCue();
      },
    };
  }

  private buildOrder(
    def: ScriptedSequenceDefinition,
    source: { key: string; name: string },
    activator: ActivatorRef,
    onFinish: () => void,
  ): SequenceOrder {
    const movePosition = def.moveMode === 'none' ? null : tupleToVector3(def.position);
    const faceYaw = def.rotation ? def.rotation[1] : null;
    const steps = (def.steps ?? []).map((step) => this.resolveStep(step, source.name));
    let cuePending = false;
    let finished = false;

    return {
      sequenceName: source.name,
      moveMode: def.moveMode,
      movePosition,
      faceYaw,
      steps,
      overrideAi: def.overrideAi ?? false,
      isCuePending: () => cuePending,
      consumeCue: () => {
        cuePending = false;
      },
      raiseCue: () => {
        cuePending = true;
      },
      notifyArrived: () => {
        this.io.fireOutput(source, 'OnArrived', activator);
      },
      notifyDone: (status) => {
        if (finished) return;
        finished = true;
        onFinish();
        const output = status === 'completed' ? 'OnEnd' : 'OnCanceled';
        this.io.fireOutput(source, output, activator);
      },
    };
  }

  private resolveStep(step: SequenceStep, seqName: string): ResolvedSequenceStep {
    switch (step.kind) {
      case 'gesture':
        return { kind: 'gesture', gesture: step.gesture, duration: step.duration ?? 1 };
      case 'wait':
        return { kind: 'wait', seconds: step.seconds };
      case 'waitForCue':
        return { kind: 'waitForCue' };
      case 'say':
        return { kind: 'say', text: step.text, speaker: step.speaker, duration: step.duration };
      case 'face': {
        if (step.target === '!player') return { kind: 'face', target: 'player' };
        const marker = this.markers.get(step.target);
        if (!marker) {
          console.warn(`[Sequence] '${seqName}': marker '${step.target}' del paso face no existe`);
          return { kind: 'face', target: 'player' };
        }
        return { kind: 'face', target: marker.clone() };
      }
    }
  }
}
