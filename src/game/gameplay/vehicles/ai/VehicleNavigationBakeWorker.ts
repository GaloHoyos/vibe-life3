import type {
  VehicleNavigationBake,
  VehicleNavigationBakeInput,
} from './VehicleAiTypes';
import { bakeVehicleNavigation } from './VehicleNavigationBake';

interface VehicleNavigationBakeWorkerRequest {
  id: number;
  input: VehicleNavigationBakeInput;
  expectedHash: string;
}

interface VehicleNavigationBakeWorkerResponse {
  id: number;
  navigation?: VehicleNavigationBake;
  error?: string;
}

interface VehicleNavigationWorkerScope {
  onmessage: ((event: MessageEvent<VehicleNavigationBakeWorkerRequest>) => void) | null;
  postMessage(message: VehicleNavigationBakeWorkerResponse): void;
}

const workerScope = globalThis as unknown as VehicleNavigationWorkerScope;

workerScope.onmessage = (event): void => {
  try {
    workerScope.postMessage({
      id: event.data.id,
      navigation: bakeVehicleNavigation(event.data.input, event.data.expectedHash),
    });
  } catch (error) {
    workerScope.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
