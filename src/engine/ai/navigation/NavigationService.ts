import {
  Crowd,
  type CrowdAgent,
  NavMeshQuery,
  type NavMesh,
  type Obstacle,
  type TileCache,
  importTileCache,
  getNavMeshPositionsAndIndices,
  init as initRecast,
} from "recast-navigation";
import { createDefaultTileCacheMeshProcess, generateTileCache } from "recast-navigation/generators";
import { Vector3 } from "three";
import type { Raycast } from "@engine/physics/Raycast";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { NavigationGeometryData } from "./NavigationGeometry";
import { AirNavigationDomain } from "./AirNavigationDomain";
import { navigationBuildConfig, navigationGeometryHash } from "./NavigationBuildConfig";
import { readNavigationCache, writeNavigationCache } from "./NavigationCache";
import type {
  NavAgentProfile,
  NavigationActionLink,
  NavigationDebugSnapshot,
  NavigationPath,
  NavigationSample,
  NavigationStatus,
} from "./NavigationTypes";

interface GroundDomain {
  profileId: string;
  profile: NavAgentProfile;
  navMesh: NavMesh;
  tileCache: TileCache;
  query: NavMeshQuery;
  crowd: Crowd;
  samples: NavigationSample[];
  triangleCount: number;
  obstacles: Map<string, Obstacle>;
  importedResources?: unknown[];
}

export interface NavigationAgentHandle {
  readonly id: string;
  readonly profile: NavAgentProfile;
  setGoal(goal: Vector3): boolean;
  cancelGoal(): void;
  syncPosition(position: Vector3): void;
  velocity(out?: Vector3): Vector3;
  corners(): Vector3[];
  status(): NavigationStatus;
  dispose(): void;
}

export interface NavigationMeshDebugGeometry {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

export interface NavigationServiceOptions {
  geometry: NavigationGeometryData;
  groundProfiles: readonly NavAgentProfile[];
  raycast: Raycast;
  physics: PhysicsWorld;
  maxAgents?: number;
  assetKey?: string;
  openDoor?: (doorId: string, ownerId: string) => void;
  isDoorPassable?: (doorId: string) => boolean;
  metadataAt?: (position: Vector3) => { buildingId: string | null; roomId: string | null };
}

/**
 * Fachada multidominio. Recast/Detour gestiona tierra y crowds; el dominio
 * aéreo usa un volumen disperso. Los portales viven como action links runtime
 * para poder moverse sin reconstruir tiles.
 */
export class NavigationService {
  private readonly domains = new Map<string, GroundDomain>();
  private readonly air: AirNavigationDomain;
  private readonly agents = new Map<string, NavigationAgentHandle>();
  private readonly traversalLinks: NavigationActionLink[] = [];
  private semanticActionLinks: NavigationActionLink[] = [];
  private dynamicActionLinks: NavigationActionLink[] = [];
  private accumulator = 0;
  private obstacleScanAccumulator = 0;
  private lastUpdateMs = 0;
  private readonly updateTimings: number[] = [];
  private pendingRequests = 0;
  private readonly dynamicObstacleStates = new Map<number, {
    id: string;
    sleepFor: number;
    registered: boolean;
  }>();
  private readonly reservations = new Map<string, {
    owner: string | null;
    queue: string[];
    expiresAt: number;
  }>();

  private constructor(private readonly options: NavigationServiceOptions) {
    this.air = new AirNavigationDomain(options.raycast);
  }

  static async create(options: NavigationServiceOptions): Promise<NavigationService> {
    await initRecast();
    const service = new NavigationService(options);
    const groundProfiles = options.groundProfiles.filter(
      (profile) => profile.domain !== "air" && profile.domain !== "stationary",
    );
    const hash = navigationGeometryHash(options.geometry.positions, options.geometry.indices, groundProfiles);
    const cacheKey = `${options.assetKey ?? "runtime"}:${hash}`;
    let serialized = await loadPrebakedDomains(options.assetKey, hash, groundProfiles);
    serialized ??= await readNavigationCache(cacheKey);
    if (!serialized && typeof Worker !== "undefined") {
      serialized = await generateDomainsInWorker(options.geometry, groundProfiles);
      if (serialized) void writeNavigationCache(cacheKey, serialized);
    }
    try {
      for (const profile of groundProfiles) {
        const bytes = serialized?.get(profile.id);
        service.buildGroundDomain(profile, bytes);
      }
    } catch (error) {
      // Bytes serializados corruptos (prebake viejo, fallback SPA que sirvió
      // HTML con 200, caché dañada): descartar y rebakear desde la geometría.
      console.warn(`[NavigationService] Import serializado falló, rebake local: ${String(error)}`);
      service.dispose();
      serialized = typeof Worker !== "undefined"
        ? await generateDomainsInWorker(options.geometry, groundProfiles)
        : null;
      for (const profile of groundProfiles) {
        service.buildGroundDomain(profile, serialized?.get(profile.id));
      }
      if (serialized) void writeNavigationCache(cacheKey, serialized);
    }
    service.classifyCrouchSamples();
    for (const profile of options.groundProfiles) service.generateTraversalLinks(profile);
    return service;
  }

  isReady(): boolean { return this.domains.size > 0; }

  projectPoint(position: Vector3, profile: NavAgentProfile): Vector3 | null {
    if (profile.domain === "air") return position.clone();
    if (profile.domain === "stationary") return null;
    const domain = this.domainFor(profile);
    if (!domain) return null;
    const result = domain.query.findClosestPoint(position, {
      halfExtents: { x: 4, y: Math.max(4, profile.standingHeight), z: 4 },
    });
    return result.success
      ? new Vector3(result.point.x, result.point.y, result.point.z)
      : null;
  }

  requestPath(profile: NavAgentProfile, from: Vector3, to: Vector3): NavigationPath | null {
    this.pendingRequests += 1;
    try {
      if (profile.domain === "stationary") return null;
      const compute = profile.domain === "air"
        ? (a: Vector3, b: Vector3) => this.air.findPath(a, b, profile)
        : (a: Vector3, b: Vector3) => this.computeGroundPath(profile, a, b);
      const direct = compute(from, to);
      let best = direct;
      const candidates = this.getActionLinks()
        .filter((link) => linkAllowed(link, profile) && profileAllowsLink(profile, link))
        .flatMap(directedLinkVariants)
        .map((link) => ({
          link,
          lowerBound: from.distanceTo(link.start) + link.cost + link.end.distanceTo(to),
        }))
        .filter(({ lowerBound }) => !best || best.partial || lowerBound < best.length)
        .sort((a, b) => a.lowerBound - b.lowerBound)
        .slice(0, 16);
      for (const { link } of candidates) {
        const first = compute(from, link.start);
        const second = compute(link.end, to);
        if (!first || !second) continue;
        const candidate = joinThroughLink(first, second, link);
        if (
          !best ||
          (best.partial && !candidate.partial) ||
          (best.partial === candidate.partial && candidate.length < best.length)
        ) best = candidate;
      }
      return best;
    } finally {
      this.pendingRequests -= 1;
    }
  }

  pathDistance(profile: NavAgentProfile, from: Vector3, to: Vector3): number | null {
    return this.requestPath(profile, from, to)?.length ?? null;
  }

  sampleReachablePoint(
    profile: NavAgentProfile,
    center: Vector3,
    radius: number,
  ): Vector3 | null {
    if (profile.domain === "air") return center.clone();
    const domain = this.domainFor(profile);
    if (!domain) return null;
    const result = domain.query.findRandomPointAroundCircle(center, radius, {
      halfExtents: { x: 4, y: Math.max(4, profile.standingHeight), z: 4 },
    });
    return result.success
      ? new Vector3(result.randomPoint.x, result.randomPoint.y, result.randomPoint.z)
      : null;
  }

  setActionLinks(links: readonly NavigationActionLink[]): void {
    this.dynamicActionLinks = links.map((link) => ({
      ...link,
      start: link.start.clone(),
      traverseStart: link.traverseStart?.clone(),
      end: link.end.clone(),
    }));
  }

  setSemanticActionLinks(links: readonly NavigationActionLink[]): void {
    this.semanticActionLinks = cloneLinks(links);
    for (const domain of this.domains.values()) {
      for (const sample of domain.samples) {
        if (this.semanticActionLinks.some((link) =>
          link.kind === "door" && planarDistance(sample.position, link.start) <= link.width + 0.8
        )) sample.area = "door";
      }
    }
  }

  activateAction(link: NavigationActionLink, ownerId: string): void {
    if (link.kind === "door" && link.doorId) this.options.openDoor?.(link.doorId, ownerId);
  }

  isActionReady(link: NavigationActionLink): boolean {
    if (link.kind !== "door" || !link.doorId) return true;
    return this.options.isDoorPassable?.(link.doorId) ?? true;
  }

  reserveAction(link: NavigationActionLink, ownerId: string): boolean {
    const key = reservationKey(link);
    let reservation = this.reservations.get(key);
    if (!reservation) {
      reservation = { owner: null, queue: [], expiresAt: 0 };
      this.reservations.set(key, reservation);
    }
    const now = performance.now() / 1000;
    if (reservation.owner && reservation.expiresAt <= now) reservation.owner = null;
    if (!reservation.owner) {
      const next = reservation.queue.shift();
      if (next && next !== ownerId) {
        reservation.owner = next;
        reservation.expiresAt = now + 4;
      } else {
        reservation.owner = ownerId;
        reservation.expiresAt = now + 4;
      }
    }
    if (reservation.owner === ownerId) {
      reservation.expiresAt = now + 4;
      return true;
    }
    if (!reservation.queue.includes(ownerId)) reservation.queue.push(ownerId);
    return false;
  }

  releaseAction(link: NavigationActionLink, ownerId: string): void {
    const reservation = this.reservations.get(reservationKey(link));
    if (!reservation) return;
    reservation.queue = reservation.queue.filter((id) => id !== ownerId);
    if (reservation.owner === ownerId) reservation.owner = null;
    if (!reservation.owner && reservation.queue.length === 0) {
      this.reservations.delete(reservationKey(link));
    }
  }

  releaseAgentReservations(ownerId: string): void {
    for (const [key, reservation] of this.reservations) {
      reservation.queue = reservation.queue.filter((id) => id !== ownerId);
      if (reservation.owner === ownerId) reservation.owner = null;
      if (!reservation.owner && reservation.queue.length === 0) this.reservations.delete(key);
    }
  }

  getActionLinks(): readonly NavigationActionLink[] {
    return [...this.traversalLinks, ...this.semanticActionLinks, ...this.dynamicActionLinks];
  }

  createAgent(id: string, profile: NavAgentProfile, position: Vector3): NavigationAgentHandle | null {
    this.agents.get(id)?.dispose();
    if (profile.domain === "stationary" || profile.domain === "air") return null;
    const domain = this.domainFor(profile);
    const projected = this.projectPoint(position, profile);
    if (!domain || !projected) return null;
    const crowdAgent = domain.crowd.addAgent(projected, {
      radius: profile.radius,
      height: profile.standingHeight,
      maxAcceleration: profile.acceleration,
      maxSpeed: profile.maxSpeed,
      collisionQueryRange: Math.max(profile.radius * 8, 2.5),
      pathOptimizationRange: Math.max(profile.radius * 18, 6),
      separationWeight: 1.8,
    });
    let hasGoal = false;
    let disposed = false;
    const handle: NavigationAgentHandle = {
      id,
      profile,
      setGoal: (goal) => {
        hasGoal = crowdAgent.requestMoveTarget(goal);
        return hasGoal;
      },
      cancelGoal: () => {
        hasGoal = false;
        crowdAgent.resetMoveTarget();
      },
      syncPosition: (actual) => {
        if (crowdAgent.position().x === undefined) return;
        const simulated = crowdAgent.position();
        if (distanceSquared(simulated, actual) > 0.36) crowdAgent.teleport(actual);
      },
      velocity: (out = new Vector3()) => {
        const v = crowdAgent.desiredVelocityObstacleAdjusted();
        return out.set(v.x, v.y, v.z);
      },
      corners: () => crowdAgent.corners().map((p) => new Vector3(p.x, p.y, p.z)),
      status: () => {
        if (!hasGoal) return "idle";
        return crowdAgent.state() === 2 ? "traversing" : "moving";
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        domain.crowd.removeAgent(crowdAgent);
        this.agents.delete(id);
      },
    };
    this.agents.set(id, handle);
    return handle;
  }

  registerBoxObstacle(id: string, position: Vector3, size: Vector3, angleY = 0): boolean {
    let added = false;
    for (const domain of this.domains.values()) {
      const previous = domain.obstacles.get(id);
      if (previous) domain.tileCache.removeObstacle(previous);
      const result = domain.tileCache.addBoxObstacle(position, {
        x: size.x / 2,
        y: size.y / 2,
        z: size.z / 2,
      }, angleY);
      if (result.success) {
        domain.obstacles.set(id, result.obstacle);
        added = true;
      }
    }
    return added;
  }

  removeObstacle(id: string): void {
    for (const domain of this.domains.values()) {
      const obstacle = domain.obstacles.get(id);
      if (!obstacle) continue;
      domain.tileCache.removeObstacle(obstacle);
      domain.obstacles.delete(id);
    }
  }

  update(delta: number): void {
    const started = performance.now();
    // El scan recorre todos los bodies del mundo (cruces WASM): a 4 Hz alcanza,
    // el registro ya espera 0.5 s de sueño antes de bloquear tiles.
    this.obstacleScanAccumulator += delta;
    if (this.obstacleScanAccumulator >= 0.25) {
      this.syncDynamicObstacles(this.obstacleScanAccumulator);
      this.obstacleScanAccumulator = 0;
    }
    this.accumulator += Math.min(delta, 0.1);
    const fixed = 1 / 30;
    let steps = 0;
    while (this.accumulator >= fixed && steps < 3) {
      for (const domain of this.domains.values()) {
        domain.tileCache.update(domain.navMesh);
        domain.crowd.update(fixed);
      }
      this.accumulator -= fixed;
      steps += 1;
    }
    this.lastUpdateMs = performance.now() - started;
    this.updateTimings.push(this.lastUpdateMs);
    if (this.updateTimings.length > 120) this.updateTimings.shift();
  }

  getSamples(profileId?: string): readonly NavigationSample[] {
    if (profileId) {
      return this.domains.get(profileId)?.samples ?? this.domains.values().next().value?.samples ?? [];
    }
    return this.domains.values().next().value?.samples ?? [];
  }

  /** Geometría triangulada vigente del navmesh para overlays de diagnóstico. */
  getDebugMeshGeometry(profileId: string): NavigationMeshDebugGeometry | null {
    const domain = this.domains.get(profileId);
    if (!domain) return null;
    const [positions, indices] = getNavMeshPositionsAndIndices(domain.navMesh);
    return { positions, indices };
  }

  /** Isla de conectividad del navmesh en `position`, o null si no hay polígono cerca. */
  componentAt(position: Vector3, profile: NavAgentProfile): number | null {
    const domain = this.domainFor(profile);
    if (!domain) return null;
    let best: NavigationSample | null = null;
    let bestDistance = Infinity;
    for (const sample of domain.samples) {
      const dx = sample.position.x - position.x;
      const dz = sample.position.z - position.z;
      const dy = sample.position.y - position.y;
      const distance = dx * dx + dz * dz + dy * dy * 0.25;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = sample;
      }
    }
    return best && bestDistance <= 9 ? best.componentId : null;
  }

  debugSnapshot(): NavigationDebugSnapshot {
    const sortedTimings = [...this.updateTimings].sort((a, b) => a - b);
    return {
      ready: this.isReady(),
      profiles: [...this.domains.values()].map((domain) => ({
        id: domain.profileId,
        triangleCount: domain.triangleCount,
        obstacleCount: domain.obstacles.size,
      })),
      pendingRequests: this.pendingRequests,
      activeReservations: this.reservations.size,
      lastUpdateMs: this.lastUpdateMs,
      averageUpdateMs: this.updateTimings.length > 0
        ? this.updateTimings.reduce((sum, value) => sum + value, 0) / this.updateTimings.length
        : 0,
      p95UpdateMs: sortedTimings.length > 0
        ? sortedTimings[Math.min(sortedTimings.length - 1, Math.floor(sortedTimings.length * 0.95))]
        : 0,
    };
  }

  dispose(): void {
    for (const agent of [...this.agents.values()]) agent.dispose();
    for (const domain of this.domains.values()) {
      domain.crowd.destroy();
      domain.query.destroy();
      domain.tileCache.destroy();
      domain.navMesh.destroy();
      for (const resource of domain.importedResources ?? []) {
        disposeImportedResource(resource);
      }
    }
    this.domains.clear();
    this.reservations.clear();
  }

  private computeGroundPath(profile: NavAgentProfile, from: Vector3, to: Vector3): NavigationPath | null {
    const domain = this.domainFor(profile);
    if (!domain) return null;
    const result = domain.query.computePath(from, to, {
      halfExtents: { x: 4, y: Math.max(4, profile.standingHeight), z: 4 },
      maxPathPolys: 512,
      maxStraightPathPoints: 128,
    });
    if (!result.success || result.path.length === 0) return null;
    let points = result.path.map((point) => new Vector3(point.x, point.y, point.z));
    let actions: NavigationPath["actions"] = [];
    if (profile.canCrouch) {
      const annotated = this.annotateCrouchPath(from, points, profile);
      points = annotated.points;
      actions = annotated.actions;
    }
    if (this.semanticActionLinks.length > 0) {
      const annotated = this.annotateSemanticActions(from, points, actions, profile);
      points = annotated.points;
      actions = annotated.actions;
    }
    const last = points[points.length - 1];
    const partial = !last || last.distanceTo(to) > Math.max(profile.radius * 2, 0.75);
    return { points, actions, length: pathLength(from, points), partial };
  }

  private annotateSemanticActions(
    from: Vector3,
    rawPoints: readonly Vector3[],
    rawActions: NavigationPath["actions"],
    profile: NavAgentProfile,
  ): Pick<NavigationPath, "points" | "actions"> {
    const points: Vector3[] = [];
    const actions: NavigationPath["actions"] = [];
    let previous = from;
    for (let sourceIndex = 0; sourceIndex < rawPoints.length; sourceIndex += 1) {
      const end = rawPoints[sourceIndex];
      for (const link of this.semanticActionLinks) {
        if (!linkAllowed(link, profile) || !profileAllowsLink(profile, link)) continue;
        const crossing = segmentLinkCrossing(previous, end, link);
        if (!crossing) continue;
        const pointIndex = points.length;
        points.push(crossing);
        actions.push({ pointIndex, link });
      }
      const pointIndex = points.length;
      points.push(end.clone());
      for (const action of rawActions) {
        if (action.pointIndex === sourceIndex) actions.push({ ...action, pointIndex });
      }
      previous = end;
    }
    return { points, actions };
  }

  private annotateCrouchPath(
    from: Vector3,
    rawPoints: readonly Vector3[],
    profile: NavAgentProfile,
  ): Pick<NavigationPath, "points" | "actions"> {
    const standing = profile.standingProfileId ? this.domains.get(profile.standingProfileId) : undefined;
    if (!standing) return { points: rawPoints.map((point) => point.clone()), actions: [] };
    const points: Vector3[] = [];
    const actions: NavigationPath["actions"] = [];
    const isLow = (point: Vector3): boolean => {
      const projected = standing.query.findClosestPoint(point, {
        halfExtents: {
          x: profile.radius * 0.75,
          // Los puntos iniciales pueden estar a la altura del centro de la
          // cápsula. Hay que alcanzar el navmesh del piso para comparar X/Z.
          y: Math.max(1, profile.standingHeight),
          z: profile.radius * 0.75,
        },
      });
      // `from` llega como centro de la cápsula, mientras el navmesh vive sobre
      // el piso. La diferencia vertical no implica techo bajo; sólo importa si
      // el perfil de pie no tiene superficie en la misma posición planar.
      return !projected.success || planarDistance(projected.point, point) >= 0.5;
    };
    let previous = from;
    for (const end of rawPoints) {
      const distance = previous.distanceTo(end);
      const steps = Math.max(1, Math.ceil(distance / 0.45));
      for (let step = 1; step <= steps; step += 1) {
        const point = previous.clone().lerp(end, step / steps);
        const low = isLow(point);
        if (!low && step < steps) continue;
        const pointIndex = points.length;
        points.push(point);
        if (low) {
          actions.push({
            pointIndex,
            link: {
              id: `crouch-${pointIndex}`,
              kind: "crouch",
              start: point.clone(),
              end: point.clone(),
              bidirectional: true,
              cost: profile.areaCosts.crouch ?? 1.25,
              width: profile.radius * 2,
              profileIds: [profile.id],
            },
          });
        }
      }
      previous = end;
    }
    return { points, actions };
  }

  private syncDynamicObstacles(delta: number): void {
    const alive = new Set<number>();
    this.options.physics.world.bodies.forEach((body) => {
      if (!body.isDynamic() || body.numColliders() === 0) return;
      const metadata = this.options.physics.getColliderMetadata(body.collider(0));
      const size = metadata?.navigationObstacleSize;
      if (!metadata || !size || Math.max(size[0], size[2]) < 1) return;
      alive.add(body.handle);
      let state = this.dynamicObstacleStates.get(body.handle);
      if (!state) {
        state = { id: `dynamic-${body.handle}`, sleepFor: 0, registered: false };
        this.dynamicObstacleStates.set(body.handle, state);
      }
      if (!body.isSleeping()) {
        state.sleepFor = 0;
        if (state.registered) {
          this.removeObstacle(state.id);
          state.registered = false;
        }
        return;
      }
      state.sleepFor += delta;
      if (state.registered || state.sleepFor < 0.5) return;
      const p = body.translation();
      const q = body.rotation();
      const yaw = Math.atan2(
        2 * (q.w * q.y + q.x * q.z),
        1 - 2 * (q.y * q.y + q.z * q.z),
      );
      state.registered = this.registerBoxObstacle(
        state.id,
        new Vector3(p.x, p.y, p.z),
        new Vector3(size[0], size[1], size[2]),
        yaw,
      );
    });
    for (const [handle, state] of this.dynamicObstacleStates) {
      if (alive.has(handle)) continue;
      if (state.registered) this.removeObstacle(state.id);
      this.dynamicObstacleStates.delete(handle);
    }
  }

  private classifyCrouchSamples(): void {
    for (const crouched of this.domains.values()) {
      if (!crouched.profile.canCrouch || !crouched.profile.standingProfileId) continue;
      const standing = this.domains.get(crouched.profile.standingProfileId);
      if (!standing) continue;
      for (const sample of crouched.samples) {
        const projected = standing.query.findClosestPoint(sample.position, {
          halfExtents: { x: 0.3, y: 0.35, z: 0.3 },
        });
        if (!projected.success || distanceSquared(projected.point, sample.position) > 0.25) {
          sample.area = "crouch";
        }
      }
    }
  }

  private generateTraversalLinks(profile: NavAgentProfile): void {
    if ((!profile.canJump && !profile.canDrop) || profile.domain === "largeGround") return;
    const domain = this.domainFor(profile);
    if (!domain) return;
    const samples = domain.samples;
    const bucketSize = Math.max(1.5, profile.maxJumpDistance);
    const buckets = new Map<string, NavigationSample[]>();
    for (const sample of samples) {
      const key = `${Math.floor(sample.position.x / bucketSize)}:${Math.floor(sample.position.z / bucketSize)}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(sample);
      else buckets.set(key, [sample]);
    }
    let serial = 0;
    const maxLinks = profile.maxTraversalLinks ?? 128;
    const sourceStride = Math.max(5, Math.ceil(samples.length / 512));
    for (let i = 0; i < samples.length && serial < maxLinks; i += sourceStride) {
      const from = samples[i].position;
      const bx = Math.floor(from.x / bucketSize);
      const bz = Math.floor(from.z / bucketSize);
      for (let ox = -1; ox <= 1 && serial < maxLinks; ox += 1) {
        for (let oz = -1; oz <= 1 && serial < maxLinks; oz += 1) {
          const candidates = buckets.get(`${bx + ox}:${bz + oz}`) ?? [];
          const candidateStride = Math.max(1, Math.ceil(candidates.length / 20));
          for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += candidateStride) {
            const candidate = candidates[candidateIndex];
            if (serial >= maxLinks) break;
            if (candidate.id === samples[i].id) continue;
            const to = candidate.position;
            const planar = Math.hypot(to.x - from.x, to.z - from.z);
            const dy = to.y - from.y;
            if (planar < 0.9 || planar > profile.maxJumpDistance) continue;
            const kind = dy < -profile.stepHeight - 0.15
              ? "drop"
              : dy > profile.stepHeight + 0.15 || planar > 1.4
              ? "jump"
              : null;
            if (!kind || (kind === "jump" && !profile.canJump) || (kind === "drop" && !profile.canDrop)) continue;
            if (kind === "drop" && -dy > profile.safeDropHeight) continue;
            if (kind === "jump" && dy > jumpApex(profile.jumpSpeed)) continue;
            const normal = domain.query.computePath(from, to, {
              halfExtents: { x: 1, y: Math.max(2, profile.standingHeight), z: 1 },
              maxPathPolys: 64,
              maxStraightPathPoints: 32,
            });
            if (normal.success) {
              const normalPoints = normal.path.map((p) => new Vector3(p.x, p.y, p.z));
              const reachesTarget = normalPoints.at(-1)?.distanceTo(to) ?? Infinity;
              const normalLength = pathLength(from, normalPoints);
              if (reachesTarget <= Math.max(profile.radius * 2, 0.75) && normalLength <= planar * 1.8 + 0.5) continue;
            }
            if (!this.trajectoryClear(from, to, profile, kind)) continue;
            this.traversalLinks.push({
              id: `${kind}-${profile.id}-${serial++}`,
              kind,
              start: from.clone(),
              end: to.clone(),
              bidirectional: kind === "jump" && Math.abs(dy) <= profile.stepHeight,
              cost: planar + Math.max(0, Math.abs(dy) * 0.5) + 0.5,
              width: profile.radius * 2,
              profileIds: [profile.id],
            });
          }
        }
      }
    }
  }

  private trajectoryClear(
    fromFloor: Vector3,
    toFloor: Vector3,
    profile: NavAgentProfile,
    kind: "jump" | "drop",
  ): boolean {
    const from = fromFloor.clone().add(new Vector3(0, profile.standingHeight * 0.5, 0));
    const to = toFloor.clone().add(new Vector3(0, profile.standingHeight * 0.5, 0));
    const planar = Math.hypot(to.x - from.x, to.z - from.z);
    const gravity = 28;
    const upSpeed = kind === "jump" ? profile.jumpSpeed : 0.1;
    const discriminant = upSpeed * upSpeed - 2 * gravity * (to.y - from.y);
    if (discriminant < 0) return false;
    const flightTime = Math.max(0.15, (upSpeed + Math.sqrt(discriminant)) / gravity);
    if (planar / flightTime > Math.max(profile.maxSpeed * 1.35, 4)) return false;
    let previous = from;
    for (let i = 1; i <= 10; i += 1) {
      const t = flightTime * (i / 10);
      const alpha = i / 10;
      const point = new Vector3(
        from.x + (to.x - from.x) * alpha,
        from.y + upSpeed * t - 0.5 * gravity * t * t,
        from.z + (to.z - from.z) * alpha,
      );
      const direction = point.clone().sub(previous);
      const distance = direction.length();
      if (distance > 1e-4) {
        direction.divideScalar(distance);
        for (const offset of [0, profile.radius * 0.8, -profile.radius * 0.8]) {
          const origin = previous.clone();
          origin.y += offset;
          const hit = this.options.raycast.cast(origin, direction, Math.max(0, distance - 0.04));
          const hitKind = hit?.metadata?.kind;
          if (hit && hitKind !== "npc" && hitKind !== "player" && hitKind !== "ragdoll") return false;
        }
      }
      previous = point;
    }
    return true;
  }

  private domainFor(profile: NavAgentProfile): GroundDomain | undefined {
    const direct = this.domains.get(profile.id);
    if (direct) return direct;
    return profile.fallbackProfileId ? this.domains.get(profile.fallbackProfileId) : undefined;
  }

  private buildGroundDomain(profile: NavAgentProfile, serialized?: Uint8Array): void {
    let navMesh: NavMesh;
    let tileCache: TileCache;
    let importedResources: GroundDomain["importedResources"];
    if (serialized) {
      const meshProcess = createDefaultTileCacheMeshProcess();
      const imported = importTileCache(serialized, meshProcess);
      navMesh = imported.navMesh;
      tileCache = imported.tileCache;
      importedResources = [meshProcess, imported.allocator, imported.compressor];
    } else {
      const result = generateTileCache(
        this.options.geometry.positions,
        this.options.geometry.indices,
        navigationBuildConfig(profile),
      );
      if (!result.success) {
        throw new Error(`[NavigationService] No se pudo generar ${profile.id}: ${result.error}`);
      }
      navMesh = result.navMesh;
      tileCache = result.tileCache;
    }
    const query = new NavMeshQuery(navMesh, { maxNodes: 4096 });
    const [positions, indices] = getNavMeshPositionsAndIndices(navMesh);
    this.domains.set(profile.id, {
      profileId: profile.id,
      profile,
      navMesh,
      tileCache,
      query,
      crowd: new Crowd(navMesh, {
        maxAgents: this.options.maxAgents ?? 60,
        maxAgentRadius: Math.max(profile.radius, 0.1),
      }),
      samples: extractSamples(positions, indices, this.options.metadataAt),
      triangleCount: indices.length / 3,
      obstacles: new Map(),
      importedResources,
    });
  }
}

function extractSamples(
  positions: readonly number[],
  indices: readonly number[],
  metadataAt?: NavigationServiceOptions["metadataAt"],
): NavigationSample[] {
  const componentIds = computeTriangleComponents(positions, indices);
  const result: NavigationSample[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    const position = new Vector3(
      (positions[ia] + positions[ib] + positions[ic]) / 3,
      (positions[ia + 1] + positions[ib + 1] + positions[ic + 1]) / 3,
      (positions[ia + 2] + positions[ib + 2] + positions[ic + 2]) / 3,
    );
    const metadata = metadataAt?.(position);
    const ab = new Vector3(
      positions[ib] - positions[ia],
      positions[ib + 1] - positions[ia + 1],
      positions[ib + 2] - positions[ia + 2],
    );
    const ac = new Vector3(
      positions[ic] - positions[ia],
      positions[ic + 1] - positions[ia + 1],
      positions[ic + 2] - positions[ia + 2],
    );
    const slopeY = Math.abs(ab.cross(ac).normalize().y);
    result.push({
      id: i / 3,
      position,
      componentId: componentIds[i / 3],
      area: slopeY < 0.94 ? "stairs" : "ground",
      roomId: metadata?.roomId ?? null,
      buildingId: metadata?.buildingId ?? null,
    });
  }
  return result;
}

/**
 * Islas de conectividad por triángulos que comparten vértices. Los tiles de
 * Detour duplican vértices en los bordes, así que se sueldan por posición
 * cuantizada antes del union-find.
 */
function computeTriangleComponents(
  positions: readonly number[],
  indices: readonly number[],
): number[] {
  const triangleCount = indices.length / 3;
  const parent = new Array<number>(triangleCount);
  for (let i = 0; i < triangleCount; i += 1) parent[i] = i;
  const find = (node: number): number => {
    let root = node;
    while (parent[root] !== root) root = parent[root];
    while (parent[node] !== root) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };
  const byVertex = new Map<string, number>();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = indices[triangle * 3 + corner] * 3;
      const key =
        `${Math.round(positions[vertex] * 10)}:` +
        `${Math.round(positions[vertex + 1] * 10)}:` +
        `${Math.round(positions[vertex + 2] * 10)}`;
      const owner = byVertex.get(key);
      if (owner === undefined) byVertex.set(key, triangle);
      else union(owner, triangle);
    }
  }
  const componentByRoot = new Map<number, number>();
  const result = new Array<number>(triangleCount);
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const root = find(triangle);
    let componentId = componentByRoot.get(root);
    if (componentId === undefined) {
      componentId = componentByRoot.size;
      componentByRoot.set(root, componentId);
    }
    result[triangle] = componentId;
  }
  return result;
}

function joinThroughLink(
  first: NavigationPath,
  second: NavigationPath,
  link: NavigationActionLink,
): NavigationPath {
  const points = [...first.points.map((p) => p.clone())];
  if (points.length === 0 || points[points.length - 1].distanceToSquared(link.start) > 0.01) {
    points.push(link.start.clone());
  }
  const actionIndex = points.length - 1;
  if (link.traverseStart) points.push(link.traverseStart.clone());
  const traverseIndex = link.traverseStart ? points.length - 1 : actionIndex;
  const secondOffset = points.length + 1;
  points.push(link.end.clone(), ...second.points.map((p) => p.clone()));
  return {
    points,
    actions: [
      ...first.actions,
      { pointIndex: traverseIndex, link },
      ...second.actions.map((action) => ({
        ...action,
        pointIndex: action.pointIndex + secondOffset,
      })),
    ],
    length: first.length + link.cost + second.length,
    partial: first.partial || second.partial,
  };
}

function pathLength(from: Vector3, points: readonly Vector3[]): number {
  let length = 0;
  let previous = from;
  for (const point of points) {
    length += previous.distanceTo(point);
    previous = point;
  }
  return length;
}
function linkAllowed(link: NavigationActionLink, profile: NavAgentProfile): boolean {
  return !link.profileIds || link.profileIds.includes(profile.id);
}
function cloneLinks(links: readonly NavigationActionLink[]): NavigationActionLink[] {
  return links.map((link) => ({
    ...link,
    start: link.start.clone(),
    traverseStart: link.traverseStart?.clone(),
    end: link.end.clone(),
  }));
}
function segmentLinkCrossing(
  from: Vector3,
  to: Vector3,
  link: NavigationActionLink,
): Vector3 | null {
  const axis = link.end.clone().sub(link.start);
  const axisLengthSq = axis.lengthSq();
  if (axisLengthSq < 1e-4) return null;
  const center = link.start.clone().add(link.end).multiplyScalar(0.5);
  const fromSide = from.clone().sub(center).dot(axis);
  const toSide = to.clone().sub(center).dot(axis);
  if (fromSide * toSide > 0) return null;
  const segment = to.clone().sub(from);
  const denominator = segment.dot(axis);
  if (Math.abs(denominator) < 1e-5) return null;
  const t = -fromSide / denominator;
  if (t < 0 || t > 1) return null;
  const crossing = from.clone().addScaledVector(segment, t);
  if (planarDistance(crossing, center) > link.width * 0.75 + 0.4) return null;
  return crossing;
}
function profileAllowsLink(profile: NavAgentProfile, link: NavigationActionLink): boolean {
  switch (link.kind) {
    case "jump": return profile.canJump;
    case "drop": return profile.canDrop;
    case "crouch": return profile.canCrouch;
    case "door": return profile.canOpenDoors;
    case "portal": return profile.canUsePortals;
  }
}
function directedLinkVariants(link: NavigationActionLink): NavigationActionLink[] {
  if (!link.bidirectional) return [link];
  return [
    link,
    {
      ...link,
      id: `${link.id}-reverse`,
      start: link.end,
      traverseStart: undefined,
      end: link.start,
      bidirectional: false,
    },
  ];
}
function jumpApex(upSpeed: number): number {
  return (upSpeed * upSpeed) / (2 * 28);
}
function distanceSquared(a: { x: number; y: number; z: number }, b: Vector3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
function planarDistance(
  a: { x: number; z: number },
  b: { x: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function reservationKey(link: NavigationActionLink): string {
  const center = link.start.clone().add(link.end).multiplyScalar(0.5);
  return `${link.kind}:${Math.round(center.x * 2)}:${Math.round(center.y * 2)}:${Math.round(center.z * 2)}`;
}

function disposeImportedResource(resource: unknown): void {
  const disposable = resource as { delete?: () => void; destroy?: () => void };
  disposable.destroy?.();
  disposable.delete?.();
}

async function loadPrebakedDomains(
  assetKey: string | undefined,
  hash: string,
  profiles: readonly NavAgentProfile[],
): Promise<Map<string, Uint8Array> | null> {
  if (!assetKey || typeof fetch === "undefined") return null;
  try {
    const entries = await Promise.all(profiles.map(async (profile) => {
      const response = await fetch(`/navigation/${assetKey}.${hash}.${profile.id}.navbin`);
      // El fallback SPA (Cloudflare Pages) responde 200 con index.html para
      // assets inexistentes: un hash desactualizado debe caer al rebake, no
      // entrar como bytes al importador WASM.
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || contentType.includes("text/html")) {
        throw new Error(`${response.status} ${contentType}`);
      }
      return [profile.id, new Uint8Array(await response.arrayBuffer())] as const;
    }));
    return new Map(entries);
  } catch {
    return null;
  }
}

async function generateDomainsInWorker(
  geometry: NavigationGeometryData,
  profiles: readonly NavAgentProfile[],
): Promise<Map<string, Uint8Array> | null> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./NavigationBakeWorker.ts", import.meta.url), { type: "module" });
    const timeout = globalThis.setTimeout(() => {
      worker.terminate();
      resolve(null);
    }, 120_000);
    worker.onmessage = (event: MessageEvent<{
      success: boolean;
      error?: string;
      domains?: Array<{ profileId: string; data: ArrayBuffer }>;
    }>) => {
      globalThis.clearTimeout(timeout);
      worker.terminate();
      if (!event.data.success || !event.data.domains) {
        console.warn(`[NavigationService] Worker fallback: ${event.data.error ?? "error desconocido"}`);
        resolve(null);
        return;
      }
      resolve(new Map(event.data.domains.map(({ profileId, data }) => [profileId, new Uint8Array(data)])));
    };
    worker.onerror = (event) => {
      globalThis.clearTimeout(timeout);
      worker.terminate();
      console.warn(`[NavigationService] Worker fallback: ${event.message}`);
      resolve(null);
    };
    const positions = geometry.positions.buffer.slice(
      geometry.positions.byteOffset,
      geometry.positions.byteOffset + geometry.positions.byteLength,
    ) as ArrayBuffer;
    const indices = geometry.indices.buffer.slice(
      geometry.indices.byteOffset,
      geometry.indices.byteOffset + geometry.indices.byteLength,
    ) as ArrayBuffer;
    worker.postMessage({ positions, indices, profiles }, [positions, indices]);
  });
}
