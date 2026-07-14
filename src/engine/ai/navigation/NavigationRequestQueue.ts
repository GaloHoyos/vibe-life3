import { Vector3 } from "three";
import type { NavAgentProfile, NavigationPath } from "./NavigationTypes";
import type { NavigationService } from "./NavigationService";

export type NavigationPriority = 0 | 1 | 2;

export interface NavigationRequest {
  ownerId: string;
  profile: NavAgentProfile;
  from: Vector3;
  to: Vector3;
  priority: NavigationPriority;
  onResolve: (path: NavigationPath | null) => void;
}

/** Presupuesto por frame con reemplazo de requests obsoletos por owner. */
export class NavigationRequestQueue {
  private readonly buckets: NavigationRequest[][] = [[], [], []];
  private readonly owners = new Map<string, NavigationRequest>();

  constructor(
    private readonly navigation: NavigationService,
    private readonly budgetPerFrame = 3,
  ) {}

  pending(): number { return this.owners.size; }

  enqueue(request: NavigationRequest): void {
    this.cancel(request.ownerId);
    this.owners.set(request.ownerId, request);
    this.buckets[request.priority].push(request);
  }

  cancel(ownerId: string): void {
    const request = this.owners.get(ownerId);
    if (!request) return;
    this.owners.delete(ownerId);
    const bucket = this.buckets[request.priority];
    const index = bucket.indexOf(request);
    if (index >= 0) bucket.splice(index, 1);
  }

  process(): number {
    let processed = 0;
    for (let priority = 2; priority >= 0 && processed < this.budgetPerFrame; priority -= 1) {
      const bucket = this.buckets[priority];
      while (bucket.length > 0 && processed < this.budgetPerFrame) {
        const request = bucket.shift()!;
        if (this.owners.get(request.ownerId) !== request) continue;
        this.owners.delete(request.ownerId);
        request.onResolve(
          this.navigation.requestPath(request.profile, request.from, request.to),
        );
        processed += 1;
      }
    }
    return processed;
  }
}

