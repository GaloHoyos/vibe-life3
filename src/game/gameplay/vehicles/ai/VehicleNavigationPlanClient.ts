import type { Disposable } from '@shared/types/lifecycle';
import type {
  VehicleNavigationBake,
  VehicleNavigationProfile,
  VehiclePose2D,
} from './VehicleAiTypes';
import type {
  VehicleNavigationPlanner,
  VehicleNavigationPlannerOptions,
  VehiclePlannedRoute,
} from './VehicleNavigationPlanner';

export interface VehicleNavigationPlanInitializeRequest {
  type: 'initialize';
  navigation: VehicleNavigationBake;
  profiles: readonly VehicleNavigationProfile[];
}

export interface VehicleNavigationPlanRequest {
  type: 'plan';
  id: number;
  profileId: string;
  start: VehiclePose2D;
  goal: VehiclePose2D;
  options?: VehicleNavigationPlannerOptions;
}

export type VehicleNavigationPlanWorkerRequest =
  | VehicleNavigationPlanInitializeRequest
  | VehicleNavigationPlanRequest;

export type VehicleNavigationPlanWorkerResponse =
  | { type: 'initialized' }
  | { type: 'initializationError'; error: string }
  | { type: 'planResult'; id: number; route: VehiclePlannedRoute | null }
  | { type: 'planError'; id: number; error: string };

export interface VehicleNavigationPlanClientOptions {
  forceInline?: boolean;
  initializationTimeoutMs?: number;
}

export interface VehicleNavigationPlanService extends Disposable {
  plan(
    profileId: string,
    start: VehiclePose2D,
    goal: VehiclePose2D,
    options?: VehicleNavigationPlannerOptions,
  ): Promise<VehiclePlannedRoute | null>;
}

export type VehicleNavigationPlanClientFactory = (
  navigation: VehicleNavigationBake,
  profiles: readonly VehicleNavigationProfile[],
  inlinePlanner: VehicleNavigationPlanner,
  options?: VehicleNavigationPlanClientOptions,
) => Promise<VehicleNavigationPlanService>;

interface PendingPlan {
  request: VehicleNavigationPlanRequest;
  resolve(route: VehiclePlannedRoute | null): void;
  reject(error: Error): void;
}

export class VehicleNavigationPlanClient implements VehicleNavigationPlanService {
  private readonly pending = new Map<number, PendingPlan>();
  private worker: Worker | null;
  private nextRequestId = 1;
  private disposed = false;

  constructor(
    private readonly inlinePlanner: VehicleNavigationPlanner,
    worker: Worker | null,
  ) {
    this.worker = worker;
    if (worker) this.attachWorker(worker);
  }

  plan(
    profileId: string,
    start: VehiclePose2D,
    goal: VehiclePose2D,
    options?: VehicleNavigationPlannerOptions,
  ): Promise<VehiclePlannedRoute | null> {
    if (this.disposed) {
      return Promise.reject(
        new Error('El cliente de planificación vehicular ya fue descartado.'),
      );
    }
    const worker = this.worker;
    if (!worker) return this.planInline(profileId, start, goal, options);

    const request: VehicleNavigationPlanRequest = {
      type: 'plan',
      id: this.nextRequestId++,
      profileId,
      start,
      goal,
      ...(options ? { options } : {}),
    };
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { request, resolve, reject });
      try {
        worker.postMessage(request satisfies VehicleNavigationPlanWorkerRequest);
      } catch {
        this.fallbackAfterWorkerFailure();
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    const error = new Error(
      'La planificación vehicular fue cancelada porque el cliente se descartó.',
    );
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  private attachWorker(worker: Worker): void {
    worker.onmessage = (
      event: MessageEvent<VehicleNavigationPlanWorkerResponse>,
    ): void => {
      const response = event.data;
      if (response.type === 'planResult') {
        const pending = this.pending.get(response.id);
        if (!pending) return;
        this.pending.delete(response.id);
        pending.resolve(response.route);
        return;
      }
      if (response.type === 'planError') {
        const pending = this.pending.get(response.id);
        if (!pending) return;
        this.pending.delete(response.id);
        this.completeInline(pending);
      }
    };
    worker.onerror = (): void => {
      this.fallbackAfterWorkerFailure();
    };
    worker.onmessageerror = (): void => {
      this.fallbackAfterWorkerFailure();
    };
  }

  private fallbackAfterWorkerFailure(): void {
    if (this.disposed) return;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    }
    const pendingPlans = [...this.pending.values()];
    this.pending.clear();
    for (const pending of pendingPlans) this.completeInline(pending);
  }

  private completeInline(pending: PendingPlan): void {
    const { profileId, start, goal, options } = pending.request;
    void this.planInline(profileId, start, goal, options).then(
      pending.resolve,
      pending.reject,
    );
  }

  private planInline(
    profileId: string,
    start: VehiclePose2D,
    goal: VehiclePose2D,
    options?: VehicleNavigationPlannerOptions,
  ): Promise<VehiclePlannedRoute | null> {
    return Promise.resolve().then(() =>
      this.inlinePlanner.plan(profileId, start, goal, options),
    ).catch((error: unknown) => {
      throw planningError(
        'Falló la planificación vehicular en el hilo principal.',
        error,
      );
    });
  }
}

export async function createVehicleNavigationPlanClient(
  navigation: VehicleNavigationBake,
  profiles: readonly VehicleNavigationProfile[],
  inlinePlanner: VehicleNavigationPlanner,
  options: VehicleNavigationPlanClientOptions = {},
): Promise<VehicleNavigationPlanClient> {
  if (options.forceInline || typeof Worker === 'undefined') {
    return new VehicleNavigationPlanClient(inlinePlanner, null);
  }

  let worker: Worker | null = null;
  try {
    worker = new Worker(
      new URL('./VehicleNavigationPlanWorker.ts', import.meta.url),
      { type: 'module' },
    );
    await initializeWorker(
      worker,
      navigation,
      profiles,
      options.initializationTimeoutMs,
    );
    return new VehicleNavigationPlanClient(inlinePlanner, worker);
  } catch {
    worker?.terminate();
    return new VehicleNavigationPlanClient(inlinePlanner, null);
  }
}

function initializeWorker(
  worker: Worker,
  navigation: VehicleNavigationBake,
  profiles: readonly VehicleNavigationProfile[],
  timeoutMs?: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(
        new Error(
          'El Worker de planificación vehicular agotó el tiempo de inicialización.',
        ),
      );
    }, Math.max(1_000, timeoutMs ?? 15_000));
    const finish = (action: () => void): void => {
      globalThis.clearTimeout(timeout);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      action();
    };
    worker.onmessage = (
      event: MessageEvent<VehicleNavigationPlanWorkerResponse>,
    ): void => {
      const response = event.data;
      if (response.type === 'initialized') {
        finish(resolve);
      } else if (response.type === 'initializationError') {
        finish(() => reject(new Error(response.error)));
      }
    };
    worker.onerror = (): void => {
      finish(() =>
        reject(new Error('Falló el Worker de planificación vehicular.')),
      );
    };
    worker.onmessageerror = (): void => {
      finish(() =>
        reject(
          new Error(
            'El Worker devolvió una respuesta de planificación vehicular inválida.',
          ),
        ),
      );
    };
    const request: VehicleNavigationPlanInitializeRequest = {
      type: 'initialize',
      navigation,
      profiles,
    };
    try {
      worker.postMessage(request satisfies VehicleNavigationPlanWorkerRequest);
    } catch (error) {
      finish(() =>
        reject(
          planningError(
            'No se pudo inicializar el Worker de planificación vehicular.',
            error,
          ),
        ),
      );
    }
  });
}

function planningError(message: string, cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new Error(detail ? `${message} ${detail}` : message);
}
