import type { VehicleNavPoint } from './VehicleAiTypes';

export interface VehicleProgressObservation {
  position: VehicleNavPoint;
  goalDistance: number | null;
  routeProgress?: number | null;
  wantsMove: boolean;
}

export interface VehicleProgressSnapshot {
  stalledSeconds: number;
  displacement: number;
  goalProgress: number;
  routeProgress: number;
  stuck: boolean;
}

interface ProgressSample {
  elapsed: number;
  position: VehicleNavPoint;
  goalDistance: number | null;
  routeProgress: number | null;
}

const WINDOW_SECONDS = 2;
const MIN_DISPLACEMENT = 1.25;
const MIN_GOAL_PROGRESS = 1;

/**
 * Measures sustained planar progress. Instantaneous speed is unsuitable here:
 * suspension settling can report several m/s while the vehicle gains no ground.
 */
export class VehicleProgressMonitor {
  private readonly samples: ProgressSample[] = [];
  private stalledSeconds = 0;

  update(
    delta: number,
    elapsed: number,
    observation: VehicleProgressObservation,
  ): VehicleProgressSnapshot {
    const safeDelta = Math.max(0, Math.min(delta, 0.25));
    if (!observation.wantsMove) {
      this.reset();
      return emptySnapshot();
    }

    this.samples.push({
      elapsed,
      position: [...observation.position],
      goalDistance: observation.goalDistance,
      routeProgress: observation.routeProgress ?? null,
    });
    const cutoff = elapsed - WINDOW_SECONDS;
    while (this.samples.length > 2 && (this.samples[1]?.elapsed ?? elapsed) <= cutoff) {
      this.samples.shift();
    }

    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (!first || !last) return emptySnapshot();
    const displacement = Math.hypot(
      last.position[0] - first.position[0],
      last.position[2] - first.position[2],
    );
    const goalProgress =
      first.goalDistance !== null && last.goalDistance !== null
        ? first.goalDistance - last.goalDistance
        : 0;
    const routeProgress =
      first.routeProgress !== null && last.routeProgress !== null
        ? last.routeProgress - first.routeProgress
        : 0;
    const windowFilled = last.elapsed - first.elapsed >= WINDOW_SECONDS * 0.9;
    const progressed = first.routeProgress !== null && last.routeProgress !== null
      ? routeProgress >= MIN_GOAL_PROGRESS
      : first.goalDistance !== null && last.goalDistance !== null
        ? goalProgress >= MIN_GOAL_PROGRESS
        : displacement >= MIN_DISPLACEMENT;
    this.stalledSeconds = progressed
      ? 0
      : this.stalledSeconds + safeDelta;

    return {
      stalledSeconds: this.stalledSeconds,
      displacement,
      goalProgress,
      routeProgress,
      stuck: windowFilled && !progressed,
    };
  }

  reset(): void {
    this.samples.length = 0;
    this.stalledSeconds = 0;
  }
}

function emptySnapshot(): VehicleProgressSnapshot {
  return {
    stalledSeconds: 0,
    displacement: 0,
    goalProgress: 0,
    routeProgress: 0,
    stuck: false,
  };
}
