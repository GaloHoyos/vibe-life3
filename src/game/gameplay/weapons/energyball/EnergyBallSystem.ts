import {
  AdditiveBlending,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PointLight,
  SphereGeometry,
  Vector3,
  type Scene,
} from "three";
import { isHostileTo, type Faction } from "@engine/ai/Faction";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { Raycast } from "@engine/physics/Raycast";
import type { PortalRaycast } from "@engine/portals/PortalRaycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { GameEventBus } from "@game/GameEvents";
import type { GrenadeOwnerKind } from "@game/gameplay/weapons/grenade/Grenade";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import {
  assertFiniteNumber,
  assertNonNegativeNumber,
  assertSnapshotVersion,
  captureVector3,
  restoreVector3,
  type Vector3SaveState,
} from "@game/gameplay/weapons/ProjectileSaveState";
import type { Disposable } from "@shared/types/lifecycle";

/** Daño garantizado-letal: la bola vaporiza cualquier orgánico hostil de un toque. */
const VAPORIZE_DAMAGE = 1000;
/** Rebotes antes de detonar. */
const MAX_BOUNCES = 12;
/** Vida dura (s) — al expirar detona con una onda chica. */
const HARD_LIFETIME = 6;
/** Pasos de raycast por frame (atravesar pickups/enemigos en línea). */
const MAX_STEPS = 6;
const SURFACE_EPS = 0.04;
/** Corrección máxima de trayectoria hacia el enemigo al rebotar (rad ≈ 10°). */
const MAX_NUDGE_RAD = 0.1745;
/** Radio de búsqueda del enemigo más cercano para el nudge. */
const NUDGE_RANGE = 40;
const CYAN = new Color(0x8fe6ff);
const FLYBY_SOUNDS = [
  "weapons.energyball.hl2.flyby1",
  "weapons.energyball.hl2.flyby2",
] as const;
const BOUNCE_SOUNDS = [
  "weapons.energyball.hl2.bounce1",
  "weapons.energyball.hl2.bounce2",
] as const;
const DISINTEGRATE_SOUNDS = [
  "weapons.energyball.hl2.disintegrate1",
  "weapons.energyball.hl2.disintegrate2",
] as const;

const tmpDir = new Vector3();
const tmpOrigin = new Vector3();
const tmpReflect = new Vector3();
const tmpDesired = new Vector3();

/** Mínimo estructural para apuntar el nudge: cualquier NPC sirve. */
export interface EnergyBallTarget {
  readonly position: Vector3;
  readonly faction: Faction;
  isAlive(): boolean;
}

export interface EnergyBallSpawnOptions {
  origin: Vector3;
  direction: Vector3;
  speed: number;
  sourceId?: string;
  ownerKind?: GrenadeOwnerKind;
  sourceFaction?: Faction;
  now: number;
}

interface ActiveBall {
  position: Vector3;
  velocity: Vector3;
  sourceId?: string;
  ownerKind: GrenadeOwnerKind;
  sourceFaction: Faction;
  bouncesLeft: number;
  hardExpiresAt: number;
  flybySoundId: (typeof FLYBY_SOUNDS)[number];
  root: Object3D;
  core: Object3D;
  glow: Object3D;
  light: PointLight;
}

export interface EnergyBallSaveState {
  position: Vector3SaveState;
  velocity: Vector3SaveState;
  sourceId: string | null;
  ownerKind: GrenadeOwnerKind;
  sourceFaction: Faction;
  bouncesLeft: number;
  hardExpiresAt: number;
  flybySoundId: (typeof FLYBY_SOUNDS)[number];
}

export interface EnergyBallSystemSaveState {
  version: 1;
  balls: EnergyBallSaveState[];
}

/**
 * Bola de energía Combine (secundario del AR3, estilo AR2 de HL2). Viaja recto,
 * **rebota elásticamente** en geometría del mundo, **vaporiza** orgánicos hostiles
 * al contacto (atravesando varios en línea) y al rebotar corrige su rumbo hacia
 * el enemigo más cercano. Tras agotar rebotes o su vida, detona con una onda chica.
 * No daña al jugador (excluido por `sourceId`) ni a aliados (chequeo de facción).
 */
export class EnergyBallSystem implements Disposable {
  private readonly balls: ActiveBall[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly raycast: Raycast,
    private readonly eventBus: GameEventBus,
    private readonly grenades: GrenadeSystem,
    private readonly vfx: VfxSystem,
    private readonly positionalSounds: PositionalSoundManager,
    private readonly portals?: PortalRaycast,
  ) {}

  spawn(options: EnergyBallSpawnOptions): void {
    this.spawnActive(options);
  }

  capture(): EnergyBallSystemSaveState {
    return {
      version: 1,
      balls: this.balls.map((ball) => ({
        position: captureVector3(ball.position),
        velocity: captureVector3(ball.velocity),
        sourceId: ball.sourceId ?? null,
        ownerKind: ball.ownerKind,
        sourceFaction: ball.sourceFaction,
        bouncesLeft: ball.bouncesLeft,
        hardExpiresAt: ball.hardExpiresAt,
        flybySoundId: ball.flybySoundId,
      })),
    };
  }

  restore(state: EnergyBallSystemSaveState): void {
    assertSnapshotVersion(state.version, 1, "El estado de bolas de energía");
    for (const [index, ball] of state.balls.entries()) {
      this.validateSaveState(ball, index);
      restoreVector3(ball.position, `energyBalls[${index}].position`);
      restoreVector3(ball.velocity, `energyBalls[${index}].velocity`);
    }

    this.clear();
    try {
      for (const [index, saved] of state.balls.entries()) {
        const velocity = restoreVector3(
          saved.velocity,
          `energyBalls[${index}].velocity`,
        );
        const speed = velocity.length();
        const ball = this.spawnActive(
          {
            origin: restoreVector3(
              saved.position,
              `energyBalls[${index}].position`,
            ),
            direction:
              speed > 1e-8
                ? velocity.clone().divideScalar(speed)
                : new Vector3(),
            speed,
            sourceId: saved.sourceId ?? undefined,
            ownerKind: saved.ownerKind,
            sourceFaction: saved.sourceFaction,
            now: saved.hardExpiresAt - HARD_LIFETIME,
          },
          saved.flybySoundId,
        );
        ball.velocity.copy(velocity);
        ball.bouncesLeft = saved.bouncesLeft;
        ball.hardExpiresAt = saved.hardExpiresAt;
      }
    } catch (error) {
      this.clear();
      throw error;
    }
  }

  private spawnActive(
    options: EnergyBallSpawnOptions,
    restoredFlybySoundId?: (typeof FLYBY_SOUNDS)[number],
  ): ActiveBall {
    const direction = normalizedOrForward(options.direction);
    const { root, core, glow, light } = createBallMesh();
    root.position.copy(options.origin);
    this.scene.add(root);
    const flybySoundId =
      restoredFlybySoundId ?? this.pickRandom(FLYBY_SOUNDS);
    this.positionalSounds.attachToObject(flybySoundId, root, {
      loop: true,
      refDistance: 1.8,
      maxDistance: 35,
      volume: 0.38,
    });

    const ball: ActiveBall = {
      position: options.origin.clone(),
      velocity: direction.multiplyScalar(options.speed),
      sourceId: options.sourceId,
      ownerKind: options.ownerKind ?? "player",
      sourceFaction: options.sourceFaction ?? "player",
      bouncesLeft: MAX_BOUNCES,
      hardExpiresAt: options.now + HARD_LIFETIME,
      flybySoundId,
      root,
      core,
      glow,
      light,
    };
    this.balls.push(ball);
    return ball;
  }

  update(delta: number, elapsed: number, targets: readonly EnergyBallTarget[]): void {
    for (let i = this.balls.length - 1; i >= 0; i -= 1) {
      const ball = this.balls[i];

      if (elapsed >= ball.hardExpiresAt) {
        this.detonate(ball, ball.position);
        this.balls.splice(i, 1);
        continue;
      }

      const expired = this.advance(ball, delta, targets);
      if (expired) {
        this.balls.splice(i, 1);
        continue;
      }

      this.animate(ball, elapsed);
    }
  }

  clear(): void {
    while (this.balls.length > 0) {
      const ball = this.balls.pop();
      if (ball) {
        this.disposeBall(ball);
      }
    }
  }

  dispose(): void {
    this.clear();
  }

  private validateSaveState(state: EnergyBallSaveState, index: number): void {
    const label = `energyBalls[${index}]`;
    assertNonNegativeInteger(state.bouncesLeft, `${label}.bouncesLeft`);
    assertFiniteNumber(state.hardExpiresAt, `${label}.hardExpiresAt`);
    if (!FLYBY_SOUNDS.includes(state.flybySoundId)) {
      throw new Error(`${label}.flybySoundId no es válido.`);
    }
  }

  /** Mueve la bola un frame resolviendo impactos. Devuelve true si detonó. */
  private advance(
    ball: ActiveBall,
    delta: number,
    targets: readonly EnergyBallTarget[],
  ): boolean {
    const speed = ball.velocity.length();
    if (speed <= 0) {
      return false;
    }
    tmpDir.copy(ball.velocity).divideScalar(speed);
    tmpOrigin.copy(ball.position);
    let remaining = speed * delta;

    for (let step = 0; step < MAX_STEPS && remaining > 0; step += 1) {
      const hit = this.raycast.cast(
        tmpOrigin,
        tmpDir,
        remaining,
        undefined,
        ball.sourceId,
      );

      // Portal antes que el rebote: la bola cruza en vez de rebotar contra la
      // pared que respalda el disco; la velocidad rota completa.
      const leftover = this.portals?.projectileStep(
        tmpOrigin,
        tmpDir,
        remaining,
        hit ? hit.toi : null,
      );
      if (leftover !== null && leftover !== undefined) {
        ball.velocity.copy(tmpDir).multiplyScalar(speed);
        remaining = leftover;
        continue;
      }

      if (!hit) {
        tmpOrigin.addScaledVector(tmpDir, remaining);
        break;
      }

      const meta = hit.metadata;
      const advance = Math.max(hit.toi, 0);
      const isNpc = meta?.kind === "npc" || meta?.kind === "ragdoll";
      const hostile =
        isNpc &&
        !!meta?.damageable &&
        isHostileTo(ball.sourceFaction, meta.faction ?? "neutral");

      // Atraviesa pickups y orgánicos NO hostiles (aliados/neutrales) sin efecto.
      if (meta?.kind === "weaponPickup" || (isNpc && !hostile)) {
        tmpOrigin.addScaledVector(tmpDir, advance + SURFACE_EPS);
        remaining -= advance + SURFACE_EPS;
        continue;
      }

      // Orgánico hostil → vaporiza y sigue de largo (encadena enemigos en línea).
      if (hostile) {
        meta?.damageable?.applyDamage(
          VAPORIZE_DAMAGE,
          tmpDir.clone(),
          undefined,
          ball.sourceId ??
            (ball.ownerKind === "player" ? "player" : undefined),
          hit.point,
        );
        this.vfx.explosion(hit.point, { scale: 1.1, color: CYAN });
        this.playRandomAt(DISINTEGRATE_SOUNDS, hit.point, 0.75);
        tmpOrigin.copy(hit.point).addScaledVector(tmpDir, 0.4);
        remaining -= advance + 0.4;
        continue;
      }

      // Geometría del mundo → rebote elástico + corrección de rumbo.
      reflect(ball.velocity, hit.normal ?? tmpDir);
      this.playRandomAt(BOUNCE_SOUNDS, hit.point, 0.62);
      tmpOrigin.copy(hit.point).addScaledVector(hit.normal ?? tmpDir, SURFACE_EPS);
      ball.bouncesLeft -= 1;
      this.nudgeTowardHostile(ball, tmpOrigin, targets);

      if (ball.bouncesLeft <= 0) {
        this.detonate(ball, tmpOrigin);
        return true;
      }
      break;
    }

    ball.position.copy(tmpOrigin);
    ball.root.position.copy(ball.position);
    return false;
  }

  /** Inclina la velocidad hacia el hostil vivo más cercano, cap a `MAX_NUDGE_RAD`. */
  private nudgeTowardHostile(
    ball: ActiveBall,
    from: Vector3,
    targets: readonly EnergyBallTarget[],
  ): void {
    let nearest: EnergyBallTarget | null = null;
    let nearestSq = NUDGE_RANGE * NUDGE_RANGE;
    for (const target of targets) {
      if (
        !target.isAlive() ||
        !isHostileTo(ball.sourceFaction, target.faction)
      ) {
        continue;
      }
      const distSq = target.position.distanceToSquared(from);
      if (distSq < nearestSq) {
        nearestSq = distSq;
        nearest = target;
      }
    }
    if (!nearest) {
      return;
    }

    const speed = ball.velocity.length();
    if (speed <= 0) {
      return;
    }
    tmpDir.copy(ball.velocity).divideScalar(speed);
    tmpDesired.copy(nearest.position).sub(from);
    if (tmpDesired.lengthSq() < 1e-4) {
      return;
    }
    tmpDesired.normalize();
    const dot = Math.min(1, Math.max(-1, tmpDir.dot(tmpDesired)));
    const angle = Math.acos(dot);
    if (angle < 1e-3) {
      return;
    }
    const t = Math.min(1, MAX_NUDGE_RAD / angle);
    tmpDir.lerp(tmpDesired, t).normalize();
    ball.velocity.copy(tmpDir).multiplyScalar(speed);
  }

  private detonate(ball: ActiveBall, point: Vector3): void {
    this.vfx.explosion(point, { scale: 1.6, color: CYAN });
    this.positionalSounds.playAt("weapons.energyball.hl2.explosion", point, {
      refDistance: 2.2,
      maxDistance: 42,
      volume: 0.82,
    });
    this.grenades.detonate(point.clone(), {
      damage: 35,
      radius: 2.2,
      impulse: 6,
      ownerKind: ball.ownerKind,
      sourceId: ball.sourceId,
      sourceFaction: ball.sourceFaction,
      weaponName: "AR3 Energy Ball",
      // Pulso de energía, no explosivo: no daña a jefes solo-explosivo.
      damageType: "energy",
    });
    this.disposeBall(ball);
  }

  private animate(ball: ActiveBall, elapsed: number): void {
    const pulse = 1 + Math.sin(elapsed * 20) * 0.12;
    ball.core.scale.setScalar(pulse);
    ball.glow.scale.setScalar(pulse * 1.08);
    ball.light.intensity = 5.5 * (0.85 + Math.sin(elapsed * 20) * 0.15);
  }

  private disposeBall(ball: ActiveBall): void {
    this.positionalSounds.stopAttached(ball.root);
    this.scene.remove(ball.root);
    ball.root.traverse((object) => {
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

  private playRandomAt(
    soundIds: readonly string[],
    point: Vector3,
    volume: number,
  ): void {
    this.positionalSounds.playAt(this.pickRandom(soundIds), point, {
      refDistance: 1.6,
      maxDistance: 32,
      volume,
    });
  }

  private pickRandom<T extends string>(soundIds: readonly T[]): T {
    return soundIds[Math.floor(Math.random() * soundIds.length)] ?? soundIds[0]!;
  }
}

function reflect(velocity: Vector3, normal: Vector3): void {
  tmpReflect.copy(normal).normalize();
  const vn = velocity.dot(tmpReflect);
  velocity.addScaledVector(tmpReflect, -2 * vn);
}

function normalizedOrForward(direction: Vector3): Vector3 {
  if (direction.lengthSq() < 1e-6) {
    return new Vector3(0, 0, -1);
  }
  return direction.clone().normalize();
}

function assertNonNegativeInteger(value: number, label: string): void {
  assertNonNegativeNumber(value, label);
  if (!Number.isInteger(value)) {
    throw new Error(`${label} debe ser un entero.`);
  }
}

interface BallParts {
  root: Object3D;
  core: Object3D;
  glow: Object3D;
  light: PointLight;
}

/** Orbe procedural: núcleo blanco aditivo + glow cian translúcido + luz puntual. */
function createBallMesh(): BallParts {
  const root = new Group();
  const core = new Mesh(
    new SphereGeometry(0.16, 16, 12),
    new MeshBasicMaterial({ color: 0xffffff, blending: AdditiveBlending, depthWrite: false }),
  );
  const glow = new Mesh(
    new SphereGeometry(0.3, 16, 12),
    new MeshBasicMaterial({
      color: CYAN.clone(),
      transparent: true,
      opacity: 0.4,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  const light = new PointLight(0x9fe8ff, 5.5, 9, 2);
  root.add(core, glow, light);
  return { root, core, glow, light };
}
