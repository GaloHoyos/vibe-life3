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

    const start = (args: InputArgs): void => {
      if (activeOrder !== null) return; // ya corriendo
      if (hasRun && !def.repeatable) return;
      const npc = this.directory.firstAlive(def.targetNpc);
      if (!npc) {
        console.warn(`[Sequence] '${name}': NPC objetivo '${def.targetNpc}' no encontrado`);
        return;
      }
      hasRun = true;
      const npcId = npc.id;
      // Un NPC sólo puede ejecutar una secuencia a la vez. Cancelar la anterior
      // mantiene consistentes sus outputs y evita handles activos huérfanos.
      this.ordersByNpcId.get(npcId)?.notifyDone('canceled');
      activeOrder = this.buildOrder(def, source, args.activator, () => {
        if (this.ordersByNpcId.get(npcId) === activeOrder) {
          this.ordersByNpcId.delete(npcId);
        }
        activeOrder = null;
      });
      this.ordersByNpcId.set(npcId, activeOrder);
      this.io.fireOutput(source, 'OnBegin', args.activator);
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
