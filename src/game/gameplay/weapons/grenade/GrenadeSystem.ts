import RAPIER from "@dimforge/rapier3d-compat";
import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  type Scene,
  Vector3,
} from "three";
import type { AssetManager } from "@engine/assets/AssetManager";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import type { PortalPairState } from "@engine/portals/PortalFrame";
import { intersectRayPortal } from "@engine/portals/PortalMath";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { Damageable, Disposable } from "@shared/types/lifecycle";
import type { GameEventBus } from "@game/GameEvents";
import type { ActiveGrenade, ExplosionParams, GrenadeSpawnOptions } from "./Grenade";
import { GrenadeRenderTuning } from "./GrenadeRenderTuning";

const DEFAULT_FUSE_SECONDS = 3.5;
const IMPACT_HARD_TIMEOUT = 6;
const FUSE_HARD_TIMEOUT_BUFFER = 1.5;
/** Intervalo inicial entre beeps; baja exponencialmente a `MIN_BEEP_INTERVAL`. */
const INITIAL_BEEP_INTERVAL = 0.6;
const MIN_BEEP_INTERVAL = 0.12;
const BEEP_INTERVAL_DECAY = 0.78;
const GRENADE_RADIUS = 0.11;
const GRENADE_DENSITY = 800;
const GRENADE_RESTITUTION = 0.18;
const GRENADE_FRICTION = 1.8;
const GRENADE_ANGULAR_DAMPING = 3.2;
const GRENADE_LINEAR_DAMPING = 0.7;

const SOUND_BEEP = "weapons.grenade.beep";
const SOUND_EXPLOSION = "weapons.grenade.explosion";

const tmpExplosionPos = new Vector3();
const tmpOffset = new Vector3();
const tmpDirection = new Vector3();
const tmpRayDir = new Vector3();
const tmpPortalLocal = new Vector3();
const tmpPortalInvQ = new Quaternion();
/** Holgura lateral/axial del gate "cruzando un portal" del detector de impacto. */
const PORTAL_MOUTH_MARGIN = 0.25;
const PORTAL_MOUTH_DEPTH = 0.6;

interface SpawnedMesh {
  root: Object3D;
  fallback: boolean;
}

interface ExplosionDamageTarget {
  damageable: Damageable;
  targetId: string;
  surfaceKind: PhysicsMetadata["kind"];
  bodyPartName?: string;
  damage: number;
  direction: Vector3;
  point: Vector3;
}

type ExplosionTargetKey = Damageable | string;

/**
 * Owner de las granadas activas en el mundo (fuse + impact). Cada `update`
 * tickea fuse + beeps, chequea contacto para `impact`, y dispara la
 * explosin (dao radial + impulso a dynamics + sonido positional).
 *
 * `spawn` es sincrnico: crea body+mesh fallback inmediato, y swappea al
 * GLB cuando termina de cargar (el `AssetManager` ya cachea, as que en
 * la prctica el swap pasa el mismo frame).
 */
export class GrenadeSystem implements Disposable {
  private readonly grenades: ActiveGrenade[] = [];
  private nextId = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly scene: Scene,
    private readonly assets: AssetManager,
    private readonly raycast: Raycast,
    private readonly eventBus: GameEventBus,
    private readonly positionalSounds: PositionalSoundManager,
    private readonly vfx: VfxSystem,
    /** Par de portales linked: las granadas `impact` no detonan al entrar. */
    private readonly portalPair: PortalPairState | null = null,
  ) {
    void this.assets.loadModel("grenadePrimed");
  }

  spawn(options: GrenadeSpawnOptions): void {
    const body = this.createBody(options);
    const meshHandle = this.createMesh();
    meshHandle.root.position.set(
      options.origin.x,
      options.origin.y,
      options.origin.z,
    );
    this.scene.add(meshHandle.root);

    // Visual registrado por body: el sistema de clones de portales lo usa para
    // que la granada asome por los dos lados mientras cruza, como todo prop.
    this.physics.setBodyVisual(body, meshHandle.root);

    const id = `grenade-${this.nextId++}`;
    const fuseSeconds =
      options.mode === "fuse"
        ? options.fuseSeconds ?? DEFAULT_FUSE_SECONDS
        : Number.POSITIVE_INFINITY;
    const now = options.now;
    const grenade: ActiveGrenade = {
      id,
      mode: options.mode,
      body,
      mesh: meshHandle.root,
      damage: options.damage,
      radius: options.radius,
      impulse: options.impulse,
      spawnedAt: now,
      fuseEndsAt:
        options.mode === "fuse" ? now + fuseSeconds : Number.POSITIVE_INFINITY,
      hardExpiresAt:
        options.mode === "impact"
          ? now + IMPACT_HARD_TIMEOUT
          : now + fuseSeconds + FUSE_HARD_TIMEOUT_BUFFER,
      nextBeepAt: now + INITIAL_BEEP_INTERVAL * 0.5,
      beepCount: 0,
      ownerKind: options.ownerKind,
      sourceId: options.sourceId,
      sourceFaction: options.sourceFaction,
      weaponName: options.weaponName,
      exploded: false,
    };
    this.grenades.push(grenade);

    if (meshHandle.fallback) {
      void this.swapToLoadedMesh(grenade);
    }
  }

  update(delta: number, elapsed: number): void {
    for (let i = this.grenades.length - 1; i >= 0; i -= 1) {
      const grenade = this.grenades[i];
      if (grenade.exploded) {
        this.grenades.splice(i, 1);
        continue;
      }

      this.syncMeshToBody(grenade);

      if (elapsed > grenade.hardExpiresAt && grenade.mode === "impact") {
        this.removeQuietly(grenade);
        this.grenades.splice(i, 1);
        continue;
      }

      if (grenade.mode === "fuse") {
        this.tickFuse(grenade, elapsed);
      } else {
        this.tickImpact(grenade, delta);
      }
    }
  }

  dispose(): void {
    this.clear();
  }

  /**
   * Remueve las granadas vivas (mesh + body) sin desuscribir. Llamar ANTES de
   * `PhysicsWorld.reset()`: `removeQuietly` toca el mundo de física actual.
   */
  clear(): void {
    this.grenades.forEach((grenade) => this.removeQuietly(grenade));
    this.grenades.length = 0;
  }

  private tickFuse(grenade: ActiveGrenade, elapsed: number): void {
    if (elapsed >= grenade.fuseEndsAt) {
      const pos = grenade.body.translation();
      this.explode(grenade, new Vector3(pos.x, pos.y, pos.z));
      return;
    }

    if (elapsed >= grenade.nextBeepAt) {
      const pos = grenade.body.translation();
      tmpExplosionPos.set(pos.x, pos.y, pos.z);
      this.positionalSounds.playAt(SOUND_BEEP, tmpExplosionPos.clone(), {
        refDistance: 2,
        maxDistance: 18,
        bus: "weapons",
      });
      grenade.beepCount += 1;
      const interval = Math.max(
        MIN_BEEP_INTERVAL,
        INITIAL_BEEP_INTERVAL * Math.pow(BEEP_INTERVAL_DECAY, grenade.beepCount),
      );
      grenade.nextBeepAt = elapsed + interval;
    }
  }

  private tickImpact(grenade: ActiveGrenade, delta: number): void {
    // Cruzando la boca de un portal (straddle/clon): el detector se desarma —
    // el rayo saldría desde dentro de la pared suprimida (toi 0) y detonaría
    // a mitad del cruce.
    {
      const pos = grenade.body.translation();
      tmpExplosionPos.set(pos.x, pos.y, pos.z);
      if (this.insidePortalMouth(tmpExplosionPos)) {
        return;
      }
    }

    const v = grenade.body.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed < 0.05) {
      // En reposo total tras spawn pegado a una pared: explota igual para no quedar tirada.
      const pos = grenade.body.translation();
      this.explode(grenade, new Vector3(pos.x, pos.y, pos.z));
      return;
    }

    tmpRayDir.set(v.x / speed, v.y / speed, v.z / speed);
    const pos = grenade.body.translation();
    tmpExplosionPos.set(pos.x, pos.y, pos.z);
    const castDistance = Math.max(speed * delta * 2 + GRENADE_RADIUS, 0.2);
    const hit = this.raycast.cast(
      tmpExplosionPos,
      tmpRayDir,
      castDistance,
      grenade.body,
    );

    if (!hit) {
      return;
    }
    if (hit.metadata?.kind === "weaponPickup") {
      return;
    }
    // El "hit" es la pared de respaldo DENTRO de la boca de un portal linked
    // (el hueco es supresión de contactos; los raycasts ven la pared sólida).
    // No detonar: la granada cruza el portal como cualquier cuerpo dinámico.
    if (this.rayEntersPortal(tmpExplosionPos, tmpRayDir, hit.toi)) {
      return;
    }

    this.explode(grenade, hit.point);
  }

  /** True si el rayo entra por el óvalo de un portal linked antes del hit. */
  private rayEntersPortal(
    origin: Vector3,
    direction: Vector3,
    hitToi: number,
  ): boolean {
    if (!this.portalPair?.linked) {
      return false;
    }
    for (const frame of [this.portalPair.a, this.portalPair.b]) {
      if (!frame) {
        continue;
      }
      if (intersectRayPortal(origin, direction, hitToi + 0.05, frame) !== null) {
        return true;
      }
    }
    return false;
  }

  /** True si el centro está dentro del óvalo de un portal linked, cerca del plano. */
  private insidePortalMouth(position: Vector3): boolean {
    if (!this.portalPair?.linked) {
      return false;
    }
    for (const frame of [this.portalPair.a, this.portalPair.b]) {
      if (!frame) {
        continue;
      }
      tmpPortalLocal
        .copy(position)
        .sub(frame.position)
        .applyQuaternion(tmpPortalInvQ.copy(frame.quaternion).invert());
      if (Math.abs(tmpPortalLocal.z) > PORTAL_MOUTH_DEPTH) {
        continue;
      }
      const ex = tmpPortalLocal.x / (frame.halfWidth + PORTAL_MOUTH_MARGIN);
      const ey = tmpPortalLocal.y / (frame.halfHeight + PORTAL_MOUTH_MARGIN);
      if (ex * ex + ey * ey <= 1) {
        return true;
      }
    }
    return false;
  }

  /**
   * Explosión genérica en un punto: sonido posicional + ruido de percepción +
   * impulso a dynamics + daño radial con falloff a todo `Damageable` en el
   * radio. Reusable por cualquier fuente (granadas, barriles explosivos, etc.).
   */
  detonate(point: Vector3, params: ExplosionParams): void {
    this.positionalSounds.playAt(params.explosionSound ?? SOUND_EXPLOSION, point.clone(), {
      refDistance: 6,
      maxDistance: params.soundMaxDistance ?? 60,
      rolloffFactor: 1.1,
      volume: 1,
      bus: "weapons",
    });
    this.vfx.explosion(point, { scale: params.radius, color: params.color });
    this.eventBus.emit("world.noise", {
      kind: "explosion",
      position: point.clone(),
      radius: Math.max(24, params.radius * 12),
      sourceId:
        params.sourceId ?? (params.ownerKind === "player" ? "player" : undefined),
      sourceFaction:
        params.sourceFaction ??
        (params.ownerKind === "player" ? "player" : undefined),
    });

    const sphere = new RAPIER.Ball(params.radius);
    const seenColliders = new Set<number>();
    const impulseBodies = new Map<number, RAPIER.RigidBody>();
    const damageTargets = new Map<ExplosionTargetKey, ExplosionDamageTarget>();

    this.physics.world.intersectionsWithShape(
      { x: point.x, y: point.y, z: point.z },
      { x: 0, y: 0, z: 0, w: 1 },
      sphere,
      (collider) => {
        if (seenColliders.has(collider.handle)) {
          return true;
        }
        seenColliders.add(collider.handle);
        const metadata = this.physics.getColliderMetadata(collider);
        const parent = collider.parent();

        if (parent && parent.isDynamic() && parent !== params.ignoreBody) {
          impulseBodies.set(parent.handle, parent);
        }

        const damageable = metadata?.explosionDamageable ?? metadata?.damageable;
        if (!metadata || !damageable) {
          return true;
        }

        const bodyPos = parent?.translation();
        if (!bodyPos) {
          return true;
        }
        tmpOffset.set(
          bodyPos.x - point.x,
          bodyPos.y - point.y,
          bodyPos.z - point.z,
        );
        const distance = tmpOffset.length();
        const damage = this.computeRadialDamage(
          params.damage,
          distance,
          params.radius,
        );
        if (damage <= 0) {
          return true;
        }

        const direction = tmpOffset.lengthSq() > 1e-4
          ? tmpOffset.clone().normalize()
          : new Vector3(0, 1, 0);
        this.collectDamageTarget(
          damageTargets,
          metadata.explosionGroupId ?? damageable,
          {
          damageable,
          targetId: metadata.ownerId ?? metadata.id,
          surfaceKind: metadata.kind,
          bodyPartName: metadata.bodyPart?.name,
          damage,
          direction,
          point: new Vector3(bodyPos.x, bodyPos.y, bodyPos.z),
          },
        );
        return true;
      },
    );

    impulseBodies.forEach((body) => {
      this.applyExplosionImpulse(body, point, params.impulse);
    });

    damageTargets.forEach((target) => {
      target.damageable.applyDamage(
        target.damage,
        target.direction.clone(),
        target.bodyPartName,
        params.sourceId,
        target.point.clone(),
        params.damageType ?? "explosive",
      );
      this.eventBus.emit("weapon.hit", {
        weaponName: params.weaponName,
        targetId: target.targetId,
        surfaceKind: target.surfaceKind,
        point: target.point.clone(),
        normal: target.direction.clone(),
        damage: target.damage,
        sourceId: params.sourceId,
        sourceKind: params.ownerKind,
        sourceFaction: params.sourceFaction,
      });
    });
  }

  private explode(grenade: ActiveGrenade, point: Vector3): void {
    if (grenade.exploded) {
      return;
    }
    grenade.exploded = true;
    this.detonate(point, {
      damage: grenade.damage,
      radius: grenade.radius,
      impulse: grenade.impulse,
      ownerKind: grenade.ownerKind,
      sourceId: grenade.sourceId,
      sourceFaction: grenade.sourceFaction,
      weaponName: grenade.weaponName,
      ignoreBody: grenade.body,
    });
    this.removeQuietly(grenade);
  }

  private collectDamageTarget(
    targets: Map<ExplosionTargetKey, ExplosionDamageTarget>,
    key: ExplosionTargetKey,
    candidate: ExplosionDamageTarget,
  ): void {
    const existing = targets.get(key);
    if (existing && existing.damage >= candidate.damage) {
      return;
    }
    targets.set(key, {
      ...candidate,
      direction: candidate.direction.clone(),
      point: candidate.point.clone(),
    });
  }

  private applyExplosionImpulse(
    body: RAPIER.RigidBody,
    point: Vector3,
    baseImpulse: number,
  ): void {
    const bodyPos = body.translation();
    tmpDirection.set(
      bodyPos.x - point.x,
      bodyPos.y - point.y + 0.3,
      bodyPos.z - point.z,
    );
    const distance = tmpDirection.length();
    if (distance < 1e-4) {
      tmpDirection.set(0, 1, 0);
    } else {
      tmpDirection.normalize();
    }
    const falloff = Math.max(0.15, 1 - distance * 0.18);
    const magnitude = baseImpulse * falloff;
    body.applyImpulse(
      {
        x: tmpDirection.x * magnitude,
        y: tmpDirection.y * magnitude,
        z: tmpDirection.z * magnitude,
      },
      true,
    );
  }

  private computeRadialDamage(
    maxDamage: number,
    distance: number,
    radius: number,
  ): number {
    if (distance >= radius) {
      return 0;
    }
    const t = 1 - distance / radius;
    return Math.max(0, Math.round(maxDamage * t));
  }

  private removeQuietly(grenade: ActiveGrenade): void {
    this.physics.clearBodyVisual(grenade.body);
    this.scene.remove(grenade.mesh);
    grenade.mesh.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose?.();
        const material = object.material;
        if (Array.isArray(material)) {
          material.forEach((m) => m.dispose?.());
        } else {
          material?.dispose?.();
        }
      }
    });
    this.physics.removeDynamicBody(grenade.body);
  }

  private createBody(options: GrenadeSpawnOptions): RAPIER.RigidBody {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(options.origin.x, options.origin.y, options.origin.z)
      .setLinvel(options.velocity.x, options.velocity.y, options.velocity.z)
      .setAngularDamping(GRENADE_ANGULAR_DAMPING)
      .setLinearDamping(GRENADE_LINEAR_DAMPING)
      .setCcdEnabled(true);
    const body = this.physics.world.createRigidBody(desc);
    const colliderDesc = RAPIER.ColliderDesc.ball(GRENADE_RADIUS)
      .setDensity(GRENADE_DENSITY)
      .setRestitution(GRENADE_RESTITUTION)
      .setFriction(GRENADE_FRICTION);
    const collider = this.physics.world.createCollider(colliderDesc, body);
    this.physics.registerCollider(collider, {
      id: `grenade-${this.nextId}`,
      kind: "dynamic",
      // HL2 no calcula el golpe de la frag por masa: manda apenas 0.1 de
      // DMG_CRUSH para que el personaje reaccione al "bonk".
      impactDamageOverride: 0.1,
    });
    return body;
  }

  private createMesh(): SpawnedMesh {
    const mesh = new Mesh(
      new BoxGeometry(GRENADE_RADIUS * 2, GRENADE_RADIUS * 2, GRENADE_RADIUS * 2),
      new MeshStandardMaterial({ color: 0x3a4f2f, roughness: 0.65 }),
    );
    mesh.castShadow = true;
    return { root: mesh, fallback: true };
  }

  private async swapToLoadedMesh(grenade: ActiveGrenade): Promise<void> {
    const instance = await this.assets.instantiateModel("grenadePrimed");
    if (grenade.exploded || !instance.root) {
      return;
    }
    const previous = grenade.mesh;
    const fresh = instance.root;
    fresh.position.copy(previous.position);
    fresh.quaternion.copy(previous.quaternion);
    this.scene.add(fresh);
    this.scene.remove(previous);
    previous.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose?.();
        const material = object.material;
        if (Array.isArray(material)) {
          material.forEach((m) => m.dispose?.());
        } else {
          material?.dispose?.();
        }
      }
    });
    grenade.mesh = fresh;
    this.physics.setBodyVisual(grenade.body, fresh);
  }

  private syncMeshToBody(grenade: ActiveGrenade): void {
    const pos = grenade.body.translation();
    const rot = grenade.body.rotation();
    grenade.mesh.position.set(pos.x, pos.y, pos.z);
    grenade.mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    // Re-aplica scale por frame para que el debug tuner pueda tunear en vivo.
    grenade.mesh.scale.setScalar(GrenadeRenderTuning.thrownScale);
  }
}
