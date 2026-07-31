import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
  type Scene,
} from "three";
import type RAPIER from "@dimforge/rapier3d-compat";
import type { Faction } from "@engine/ai/Faction";
import type { Raycast, RaycastHit } from "@engine/physics/Raycast";
import type { PortalRaycast } from "@engine/portals/PortalRaycast";
import type { GameEventBus } from "@game/GameEvents";
import type { GrenadeOwnerKind } from "@game/gameplay/weapons/grenade/Grenade";
import {
  assertFiniteNumber,
  assertNonNegativeNumber,
  assertSnapshotVersion,
  captureQuaternion,
  captureVector3,
  restoreQuaternion,
  restoreVector3,
  type QuaternionSaveState,
  type Vector3SaveState,
} from "@game/gameplay/weapons/ProjectileSaveState";
import type { Disposable } from "@shared/types/lifecycle";

const BOLT_GRAVITY = 4;
const HARD_LIFETIME = 6;
/** Segundos que el bolt queda clavado en la superficie antes de desaparecer. */
const STICK_DURATION = 4;
const MAX_IGNORED_HITS = 4;
const CAST_EPSILON = 0.05;
/** El bolt procedural apunta sobre +X local (igual que el cohete). */
const LOCAL_X = new Vector3(1, 0, 0);

const tmpDir = new Vector3();
const tmpCastOrigin = new Vector3();

export interface BoltSpawnOptions {
  origin: Vector3;
  direction: Vector3;
  /** Velocidad inicial (m/s). */
  speed: number;
  damage: number;
  impulse: number;
  weaponName: string;
  sourceId?: string;
  ownerKind?: GrenadeOwnerKind;
  sourceFaction?: Faction;
  now: number;
}

interface ActiveBolt {
  position: Vector3;
  velocity: Vector3;
  damage: number;
  impulse: number;
  weaponName: string;
  sourceId?: string;
  ownerKind: GrenadeOwnerKind;
  sourceFaction?: Faction;
  hardExpiresAt: number;
  mesh: Object3D;
  /** Una vez clavado deja de moverse; se dispone al vencer `stuckUntil`. */
  stuck: boolean;
  stuckUntil: number;
}

export interface BoltSaveState {
  position: Vector3SaveState;
  rotation: QuaternionSaveState;
  velocity: Vector3SaveState;
  damage: number;
  impulse: number;
  weaponName: string;
  sourceId: string | null;
  ownerKind: GrenadeOwnerKind;
  sourceFaction: Faction | null;
  hardExpiresAt: number;
  stuck: boolean;
  stuckUntil: number;
}

export interface BoltSystemSaveState {
  version: 1;
  bolts: BoltSaveState[];
}

/**
 * Proyectil balístico del crossbow: viaja en arco (gravedad), aplica daño
 * directo en el primer impacto (sin AoE, igual que un hitscan) y deja el bolt
 * clavado en la superficie unos segundos. Espeja la estructura del
 * `RocketSystem` pero sin homing ni detonación.
 */
export class BoltSystem implements Disposable {
  private readonly bolts: ActiveBolt[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly raycast: Raycast,
    private readonly eventBus: GameEventBus,
    private readonly portals?: PortalRaycast,
  ) {}

  spawn(options: BoltSpawnOptions): void {
    this.spawnActive(options);
  }

  capture(): BoltSystemSaveState {
    return {
      version: 1,
      bolts: this.bolts.map((bolt) => ({
        position: captureVector3(bolt.position),
        rotation: captureQuaternion(bolt.mesh.quaternion),
        velocity: captureVector3(bolt.velocity),
        damage: bolt.damage,
        impulse: bolt.impulse,
        weaponName: bolt.weaponName,
        sourceId: bolt.sourceId ?? null,
        ownerKind: bolt.ownerKind,
        sourceFaction: bolt.sourceFaction ?? null,
        hardExpiresAt: bolt.hardExpiresAt,
        stuck: bolt.stuck,
        stuckUntil: bolt.stuckUntil,
      })),
    };
  }

  restore(state: BoltSystemSaveState): void {
    assertSnapshotVersion(state.version, 1, "El estado de virotes");
    for (const [index, bolt] of state.bolts.entries()) {
      this.validateSaveState(bolt, index);
      restoreVector3(bolt.position, `bolts[${index}].position`);
      restoreQuaternion(bolt.rotation, `bolts[${index}].rotation`);
      restoreVector3(bolt.velocity, `bolts[${index}].velocity`);
    }

    this.clear();
    try {
      for (const [index, saved] of state.bolts.entries()) {
        const position = restoreVector3(
          saved.position,
          `bolts[${index}].position`,
        );
        const velocity = restoreVector3(
          saved.velocity,
          `bolts[${index}].velocity`,
        );
        const speed = velocity.length();
        const bolt = this.spawnActive({
          origin: position,
          direction:
            speed > 1e-8 ? velocity.clone().divideScalar(speed) : new Vector3(),
          speed,
          damage: saved.damage,
          impulse: saved.impulse,
          weaponName: saved.weaponName,
          sourceId: saved.sourceId ?? undefined,
          ownerKind: saved.ownerKind,
          sourceFaction: saved.sourceFaction ?? undefined,
          now: saved.hardExpiresAt - HARD_LIFETIME,
        });
        bolt.velocity.copy(velocity);
        bolt.hardExpiresAt = saved.hardExpiresAt;
        bolt.stuck = saved.stuck;
        bolt.stuckUntil = saved.stuckUntil;
        bolt.mesh.position.copy(position);
        bolt.mesh.quaternion.copy(
          restoreQuaternion(saved.rotation, `bolts[${index}].rotation`),
        );
      }
    } catch (error) {
      this.clear();
      throw error;
    }
  }

  private spawnActive(options: BoltSpawnOptions): ActiveBolt {
    const direction = normalizedOrForward(options.direction);
    const mesh = createBoltMesh();
    mesh.position.copy(options.origin);
    mesh.quaternion.setFromUnitVectors(LOCAL_X, direction);
    this.scene.add(mesh);

    const bolt: ActiveBolt = {
      position: options.origin.clone(),
      velocity: direction.multiplyScalar(options.speed),
      damage: options.damage,
      impulse: options.impulse,
      weaponName: options.weaponName,
      sourceId: options.sourceId,
      ownerKind: options.ownerKind ?? "player",
      sourceFaction: options.sourceFaction ?? "player",
      hardExpiresAt: options.now + HARD_LIFETIME,
      mesh,
      stuck: false,
      stuckUntil: 0,
    };
    this.bolts.push(bolt);
    return bolt;
  }

  update(delta: number, elapsed: number): void {
    for (let i = this.bolts.length - 1; i >= 0; i -= 1) {
      const bolt = this.bolts[i];

      if (bolt.stuck) {
        if (elapsed >= bolt.stuckUntil) {
          this.disposeBolt(bolt);
          this.bolts.splice(i, 1);
        }
        continue;
      }

      if (elapsed >= bolt.hardExpiresAt) {
        this.disposeBolt(bolt);
        this.bolts.splice(i, 1);
        continue;
      }

      bolt.velocity.y -= BOLT_GRAVITY * delta;
      const speed = bolt.velocity.length();
      const travel = speed * delta;
      if (travel <= 0) {
        continue;
      }
      tmpDir.copy(bolt.velocity).divideScalar(speed);

      const hit = this.castImpact(bolt, tmpDir, travel);
      // Portal jump: rebasa posición/dirección y rota la velocidad completa
      // (la rapidez se conserva — la transformación es una isometría).
      const leftover = this.portals?.projectileStep(
        bolt.position,
        tmpDir,
        travel,
        hit ? hit.toi : null,
      );
      if (leftover !== null && leftover !== undefined) {
        bolt.velocity.copy(tmpDir).multiplyScalar(speed);
        bolt.position.addScaledVector(tmpDir, leftover);
        bolt.mesh.position.copy(bolt.position);
        bolt.mesh.quaternion.setFromUnitVectors(LOCAL_X, tmpDir);
        continue;
      }
      if (hit) {
        this.resolveImpact(bolt, hit, tmpDir);
        this.stickBolt(bolt, hit, tmpDir, elapsed);
        continue;
      }

      bolt.position.addScaledVector(tmpDir, travel);
      bolt.mesh.position.copy(bolt.position);
      bolt.mesh.quaternion.setFromUnitVectors(LOCAL_X, tmpDir);
    }
  }

  clear(): void {
    while (this.bolts.length > 0) {
      const bolt = this.bolts.pop();
      if (bolt) {
        this.disposeBolt(bolt);
      }
    }
  }

  dispose(): void {
    this.clear();
  }

  private validateSaveState(state: BoltSaveState, index: number): void {
    const label = `bolts[${index}]`;
    assertNonNegativeNumber(state.damage, `${label}.damage`);
    assertNonNegativeNumber(state.impulse, `${label}.impulse`);
    assertFiniteNumber(state.hardExpiresAt, `${label}.hardExpiresAt`);
    assertFiniteNumber(state.stuckUntil, `${label}.stuckUntil`);
    if (state.weaponName.length === 0) {
      throw new Error(`${label}.weaponName no puede estar vacío.`);
    }
  }

  /** Raycast por el segmento recorrido, atravesando pickups de armas. */
  private castImpact(
    bolt: ActiveBolt,
    direction: Vector3,
    distance: number,
  ): RaycastHit | null {
    tmpCastOrigin.copy(bolt.position);
    let remaining = distance;

    for (let i = 0; i < MAX_IGNORED_HITS && remaining > 0; i += 1) {
      const hit = this.raycast.cast(
        tmpCastOrigin,
        direction,
        remaining,
        undefined,
        bolt.sourceId,
      );
      if (!hit) {
        return null;
      }
      if (hit.metadata?.kind === "weaponPickup") {
        const advance = Math.min(
          remaining,
          Math.max(hit.toi + CAST_EPSILON, CAST_EPSILON),
        );
        tmpCastOrigin.addScaledVector(direction, advance);
        remaining -= advance;
        continue;
      }
      return hit;
    }
    return null;
  }

  /** Aplica daño + impulso en el impacto, idéntico al patrón del hitscan. */
  private resolveImpact(
    bolt: ActiveBolt,
    hit: RaycastHit,
    direction: Vector3,
  ): void {
    if (hit.metadata?.kind === "player") {
      return;
    }

    const parent = hit.collider.parent();
    if (parent && parent.isDynamic()) {
      const impulseScale =
        hit.metadata?.kind === "ragdoll"
          ? Math.min(bolt.impulse, 1.25)
          : bolt.impulse;
      this.applyImpulse(parent, direction, impulseScale);
    }

    const damageMultiplier = hit.metadata?.bodyPart?.damageMultiplier ?? 1;
    hit.metadata?.damageable?.applyDamage(
      bolt.damage * damageMultiplier,
      direction.clone(),
      hit.metadata?.bodyPart?.name,
      bolt.sourceId ?? (bolt.ownerKind === "player" ? "player" : undefined),
      hit.point,
    );

    this.eventBus.emit("weapon.hit", {
      weaponName: bolt.weaponName,
      targetId: hit.metadata?.id,
      surfaceKind: hit.metadata?.kind,
      point: hit.point,
      normal: hit.normal,
      damage: bolt.damage * damageMultiplier,
      sourceId: bolt.sourceId,
      sourceKind: bolt.ownerKind,
      sourceFaction: bolt.sourceFaction,
    });
  }

  /** Deja el bolt clavado en el punto de impacto, orientado según el viaje. */
  private stickBolt(
    bolt: ActiveBolt,
    hit: RaycastHit,
    direction: Vector3,
    elapsed: number,
  ): void {
    bolt.stuck = true;
    bolt.stuckUntil = elapsed + STICK_DURATION;
    bolt.position.copy(hit.point);
    bolt.mesh.position.copy(hit.point);
    bolt.mesh.quaternion.setFromUnitVectors(LOCAL_X, direction);
  }

  private applyImpulse(
    rigidBody: RAPIER.RigidBody,
    direction: Vector3,
    impulseScale: number,
  ): void {
    rigidBody.applyImpulse(
      {
        x: direction.x * impulseScale,
        y: direction.y * impulseScale,
        z: direction.z * impulseScale,
      },
      true,
    );
  }

  private disposeBolt(bolt: ActiveBolt): void {
    this.scene.remove(bolt.mesh);
    bolt.mesh.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) {
          material.forEach((entry) => entry.dispose());
        } else {
          material.dispose();
        }
      }
    });
  }
}

function normalizedOrForward(direction: Vector3): Vector3 {
  if (direction.lengthSq() < 1e-6) {
    return new Vector3(0, 0, -1);
  }
  return direction.clone().normalize();
}

/** Bolt procedural: vástago fino + punta cónica, eje sobre +X local. */
function createBoltMesh(): Object3D {
  const root = new Group();
  const shaft = new Mesh(
    new CylinderGeometry(0.012, 0.012, 0.5, 8),
    new MeshStandardMaterial({ color: 0x3a3024, roughness: 0.7, metalness: 0.2 }),
  );
  shaft.rotation.z = Math.PI / 2;
  const tip = new Mesh(
    new ConeGeometry(0.022, 0.09, 8),
    new MeshStandardMaterial({ color: 0xc9d6e0, roughness: 0.35, metalness: 0.7 }),
  );
  tip.rotation.z = -Math.PI / 2;
  tip.position.x = 0.29;
  root.add(shaft, tip);
  return root;
}
