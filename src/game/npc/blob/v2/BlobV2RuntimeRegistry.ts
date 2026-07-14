import type {
  BlobDamageImpact,
  BlobOrganismController,
  BlobOrganismEvent,
} from "@engine/blob/v2";
import type { BlobV2DebugSource } from "@game/debug/BlobV2Debug";

export interface BlobV2RuntimeRegistration {
  readonly id: string;
  readonly controller: BlobOrganismController;
  readonly events: BlobOrganismEvent[];
  diagnostics?: () => unknown;
  fixedStep?: (steps: number) => unknown;
  scenario?: (name: string) => unknown;
  camera?: (name: string) => unknown;
  prepareEvidence?: () => unknown;
  resetEvidence?: () => unknown;
}

/** Live registry used only by the dev/test console; gameplay never queries it. */
export class BlobV2RuntimeRegistry {
  private readonly runtimes = new Map<string, BlobV2RuntimeRegistration>();

  register(registration: BlobV2RuntimeRegistration): () => void {
    if (!registration.id || this.runtimes.has(registration.id)) {
      throw new Error(`Blob V2 runtime id is empty or duplicated: ${registration.id}`);
    }
    this.runtimes.set(registration.id, registration);
    return () => {
      if (this.runtimes.get(registration.id) === registration) {
        this.runtimes.delete(registration.id);
      }
    };
  }

  appendEvents(id: string, events: readonly BlobOrganismEvent[]): void {
    const runtime = this.runtimes.get(id);
    if (!runtime || events.length === 0) return;
    runtime.events.push(...events);
    if (runtime.events.length > 256) runtime.events.splice(0, runtime.events.length - 256);
  }

  debugSources(): readonly BlobV2DebugSource[] {
    return [...this.runtimes.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((runtime) => ({
        id: runtime.id,
        snapshot: () => runtime.controller.snapshot(),
        telemetry: () => runtime.controller.telemetry.snapshot(),
        ...(runtime.diagnostics ? { diagnostics: runtime.diagnostics } : {}),
        events: () => Object.freeze([...runtime.events]),
        freeze: (frozen: boolean) => runtime.controller.setOverrideState(frozen ? "Frozen" : "None"),
        fixedStep: (steps: number) => {
          if (runtime.fixedStep) return runtime.fixedStep(steps);
          for (let index = 0; index < steps; index += 1) runtime.controller.step(1 / 30);
          return runtime.controller.snapshot();
        },
        impact: (impact: unknown) => runtime.controller.applyImpact(validateImpact(impact)),
        split: (components: number) => runtime.controller.splitScripted(components),
        merge: () => runtime.controller.requestScriptedMerge(),
        ...(runtime.scenario ? { scenario: runtime.scenario } : {}),
        ...(runtime.camera ? { camera: runtime.camera } : {}),
        ...(runtime.prepareEvidence
          ? { prepareEvidence: runtime.prepareEvidence }
          : {}),
        ...(runtime.resetEvidence
          ? { resetEvidence: runtime.resetEvidence }
          : {}),
      }));
  }

  reset(): void {
    this.runtimes.clear();
  }
}

export const blobV2Runtimes = new BlobV2RuntimeRegistry();

function validateImpact(value: unknown): BlobDamageImpact {
  if (!value || typeof value !== "object") throw new TypeError("Blob debug impact must be an object");
  const impact = value as Partial<BlobDamageImpact>;
  if (!impact.point || !impact.direction || typeof impact.damage !== "number") {
    throw new TypeError("Blob debug impact requires point, direction and damage");
  }
  return impact as BlobDamageImpact;
}
