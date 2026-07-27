import {
  cloneJsonValue,
  type JsonValue,
} from "./JsonValue";
import {
  SAVE_RESTORE_PHASES,
  type SaveRestorePhase,
  type SaveEntityRegistry,
} from "./SaveEntityRegistry";
import {
  SaveOperationBarrier,
} from "./SaveOperationBarrier";
import {
  SaveRepository,
  SaveRepositoryError,
} from "./SaveRepository";
import type {
  LevelSourceRef,
  SaveEnvelopeV1,
  SaveMetadata,
  SaveSlotKind,
  WorldSaveState,
} from "./SaveTypes";

type MaybePromise<T> = Promise<T> | T;

export type WorldSaveBaseState = Omit<WorldSaveState, "entities">;

export interface SaveRestoreContext {
  envelope: SaveEnvelopeV1;
  sourceDocument: JsonValue | null;
}

export interface SaveWorldAdapter {
  captureWorldBase(): MaybePromise<WorldSaveBaseState>;
  validateRestore(context: SaveRestoreContext): MaybePromise<void>;
  /**
   * Descarga el mundo anterior, construye el nuevo y registra sus serializers.
   * La barrera ya está tomada y los eventos deben continuar suspendidos.
   */
  prepareRestore(context: SaveRestoreContext): MaybePromise<void>;
  restorePhase(
    phase: SaveRestorePhase,
    context: SaveRestoreContext,
  ): MaybePromise<void>;
  completeRestore(context: SaveRestoreContext): MaybePromise<void>;
  abortRestore(error: unknown, context: SaveRestoreContext): MaybePromise<void>;
}

export interface CaptureSaveRequest {
  kind: SaveSlotKind;
  gameBuild: string;
  source: LevelSourceRef;
  metadata: SaveMetadata;
  overwriteId?: string;
  sourceDocument?: unknown;
}

export class SaveCoordinator {
  constructor(
    private readonly repository: SaveRepository,
    private readonly entities: SaveEntityRegistry,
    private readonly world: SaveWorldAdapter,
    private readonly barrier: SaveOperationBarrier = new SaveOperationBarrier(),
  ) {}

  capture(request: CaptureSaveRequest): Promise<SaveEnvelopeV1> {
    return this.barrier.run("capture", async () => {
      await this.resolveCaptureDocument(request.source, request.sourceDocument);
      const [base, entities] = await Promise.all([
        this.world.captureWorldBase(),
        this.entities.captureAll(),
      ]);
      return this.repository.save(
        request.kind,
        {
          gameBuild: request.gameBuild,
          source: request.source,
          metadata: request.metadata,
          world: {
            ...base,
            entities,
          },
        },
        { overwriteId: request.overwriteId },
      );
    });
  }

  restore(saveId: string): Promise<SaveEnvelopeV1> {
    return this.barrier.run("restore", async () => {
      const envelope = await this.repository.require(saveId);
      const sourceDocument = await this.resolveRestoreDocument(envelope.source);
      const context: SaveRestoreContext = {
        envelope,
        sourceDocument,
      };

      await this.world.validateRestore(context);
      let prepareStarted = false;
      try {
        prepareStarted = true;
        await this.world.prepareRestore(context);
        const preparedEntities = this.entities.prepareRestore(
          envelope.world.entities,
        );
        for (const phase of SAVE_RESTORE_PHASES) {
          await this.world.restorePhase(phase, context);
          await this.entities.restorePhase(
            preparedEntities,
            phase,
            envelope,
            sourceDocument,
          );
        }
        await this.world.completeRestore(context);
        return envelope;
      } catch (error) {
        if (prepareStarted) {
          try {
            await this.world.abortRestore(error, context);
          } catch {
            // Se conserva el error original; el bootstrap decide el fallback.
          }
        }
        throw error;
      }
    });
  }

  async restoreMostRecent(): Promise<SaveEnvelopeV1> {
    const recent = await this.repository.mostRecent();
    if (!recent) {
      throw new SaveRepositoryError(
        "save-not-found",
        "No hay guardados disponibles",
      );
    }
    return this.restore(recent.id);
  }

  private async resolveCaptureDocument(
    source: LevelSourceRef,
    supplied: unknown,
  ): Promise<void> {
    if (source.kind === "built-in") {
      if (supplied !== undefined) {
        throw new SaveRepositoryError(
          "document-hash-mismatch",
          "Un nivel built-in no debe incluir un documento embebido",
        );
      }
      return;
    }
    if (supplied === undefined) {
      await this.repository.requireDocument(source.documentHash);
      return;
    }
    await this.repository.storeDocument(supplied, source.documentHash);
  }

  private async resolveRestoreDocument(
    source: LevelSourceRef,
  ): Promise<JsonValue | null> {
    if (source.kind === "built-in") return null;
    return cloneJsonValue(
      await this.repository.requireDocument(source.documentHash),
    );
  }
}
