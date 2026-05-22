import { Vector3 } from "three";
import type { NavGraph } from "@engine/ai/NavGraph";
import type { Raycast } from "@engine/physics/Raycast";
import {
  NpcPathFollower,
  type NpcPathDebugSnapshot,
  type NpcPathResolveResult,
} from "./NpcPathFollower";
import { NpcSteering, type SteeringNeighbor } from "./NpcSteering";

export interface NpcNavigatorOptions {
  repathInterval?: number;
  repathDistance?: number;
  arriveDistance?: number;
  arriveVerticalDistance?: number;
  stuckRepathTime?: number;
}

export interface NpcNavigatorResult {
  target: Vector3;
  route: NpcPathResolveResult;
  shouldMove: boolean;
  stuckReason: string | null;
}

export class NpcNavigator {
  private readonly pathFollower: NpcPathFollower;
  private readonly steering: NpcSteering;

  constructor(raycast: Raycast, options: NpcNavigatorOptions = {}) {
    this.pathFollower = new NpcPathFollower(
      options.repathInterval,
      options.repathDistance,
      options.arriveDistance,
      options.arriveVerticalDistance,
      options.stuckRepathTime,
    );
    this.steering = new NpcSteering(raycast);
  }

  resolve(
    navGraph: NavGraph,
    npcPosition: Vector3,
    destination: Vector3,
    neighbors: SteeringNeighbor[],
    elapsed: number,
  ): NpcNavigatorResult {
    const route = this.pathFollower.resolve(
      navGraph,
      npcPosition,
      destination,
      elapsed,
    );
    if (!route.shouldMove) {
      return {
        target: npcPosition.clone(),
        route,
        shouldMove: false,
        stuckReason: route.reason,
      };
    }

    const steeringOptions = route.targetIsStair
      ? {
          maxTargetDistance: 0.55,
          avoidObstacles: false,
          maxDeviationRadians: Math.PI / 10,
        }
      : route.pathUsed
        ? {
            maxTargetDistance: 1.8,
            avoidObstacles: true,
            maxDeviationRadians: Math.PI / 5,
          }
        : {};

    const target = this.steering.steer(
      npcPosition,
      route.target,
      neighbors,
      steeringOptions,
    );
    return {
      target,
      route,
      shouldMove: true,
      stuckReason: null,
    };
  }

  reset(): void {
    this.pathFollower.reset();
  }

  getDebugSnapshot(): NpcPathDebugSnapshot {
    return this.pathFollower.getDebugSnapshot();
  }

  isDestinationUnreachable(): boolean {
    return this.pathFollower.isDestinationUnreachable();
  }
}
