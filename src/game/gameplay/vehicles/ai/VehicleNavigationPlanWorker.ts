import type { VehicleNavigationPlanWorkerRequest } from './VehicleNavigationPlanClient';
import type { VehicleNavigationPlanWorkerResponse } from './VehicleNavigationPlanClient';
import { VehicleNavigationPlanner } from './VehicleNavigationPlanner';

interface VehicleNavigationPlanWorkerScope {
  onmessage:
    | ((event: MessageEvent<VehicleNavigationPlanWorkerRequest>) => void)
    | null;
  postMessage(message: VehicleNavigationPlanWorkerResponse): void;
}

const workerScope = globalThis as unknown as VehicleNavigationPlanWorkerScope;
let planner: VehicleNavigationPlanner | null = null;

workerScope.onmessage = (event): void => {
  const request = event.data;
  if (request.type === 'initialize') {
    try {
      planner = new VehicleNavigationPlanner(
        request.navigation,
        request.profiles,
      );
      workerScope.postMessage({ type: 'initialized' });
    } catch (error) {
      planner = null;
      workerScope.postMessage({
        type: 'initializationError',
        error: errorMessage(
          'No se pudo inicializar la planificación vehicular.',
          error,
        ),
      });
    }
    return;
  }

  if (!planner) {
    workerScope.postMessage({
      type: 'planError',
      id: request.id,
      error: 'El Worker de planificación vehicular no está inicializado.',
    });
    return;
  }
  try {
    workerScope.postMessage({
      type: 'planResult',
      id: request.id,
      route: planner.plan(
        request.profileId,
        request.start,
        request.goal,
        request.options,
      ),
    });
  } catch (error) {
    workerScope.postMessage({
      type: 'planError',
      id: request.id,
      error: errorMessage('Falló la planificación vehicular.', error),
    });
  }
};

function errorMessage(message: string, cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return detail ? `${message} ${detail}` : message;
}
