import { Vector3 } from 'three';
import type { NavSpace, NavPath } from './NavSpace';
import type { PathFilter } from './AStar';
import { PERMISSIVE_FILTER } from './AStar';

export type PathPriority = 0 | 1 | 2;

export interface PathRequest {
  /** Id estable del solicitante — permite cancelar requests previos. */
  ownerId: string;
  from: Vector3;
  to: Vector3;
  priority: PathPriority;
  filter?: PathFilter;
  /** Se invoca al resolver el path (puede ser null si no hay ruta). */
  onResolve: (path: NavPath | null) => void;
}

/**
 * Cuota de A* por frame. Cada NPC encola sus requests y la queue las procesa
 * en orden de prioridad. NPCs `near` (prioridad 2) entran primero, `far`
 * (prioridad 0) ultimo y solo si sobra cuota. Si un owner encola un nuevo
 * request mientras tiene uno pendiente, el viejo se descarta para evitar
 * stale paths.
 */
export class PathRequestQueue {
  private readonly buckets: PathRequest[][] = [[], [], []];
  private readonly owners = new Map<string, PathRequest>();

  constructor(
    private readonly navSpace: NavSpace,
    private readonly budgetPerFrame: number = 3,
  ) {}

  pending(): number {
    return this.buckets[0].length + this.buckets[1].length + this.buckets[2].length;
  }

  enqueue(request: PathRequest): void {
    const previous = this.owners.get(request.ownerId);
    if (previous) {
      const bucket = this.buckets[previous.priority];
      const idx = bucket.indexOf(previous);
      if (idx >= 0) bucket.splice(idx, 1);
    }
    this.owners.set(request.ownerId, request);
    this.buckets[request.priority].push(request);
  }

  cancel(ownerId: string): void {
    const request = this.owners.get(ownerId);
    if (!request) return;
    this.owners.delete(ownerId);
    const bucket = this.buckets[request.priority];
    const idx = bucket.indexOf(request);
    if (idx >= 0) bucket.splice(idx, 1);
  }

  /**
   * Procesa hasta `budgetPerFrame` requests. Devuelve la cantidad procesada
   * por si el caller quiere logear/profile.
   */
  process(): number {
    let processed = 0;
    for (let priority = 2; priority >= 0 && processed < this.budgetPerFrame; priority -= 1) {
      const bucket = this.buckets[priority];
      while (bucket.length > 0 && processed < this.budgetPerFrame) {
        const request = bucket.shift()!;
        if (this.owners.get(request.ownerId) !== request) continue;
        this.owners.delete(request.ownerId);
        const path = this.navSpace.findPath(request.from, request.to, request.filter ?? PERMISSIVE_FILTER);
        request.onResolve(path);
        processed += 1;
      }
    }
    return processed;
  }
}
