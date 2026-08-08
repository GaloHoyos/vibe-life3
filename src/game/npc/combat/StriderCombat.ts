import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { isHostileTo, type Faction } from "@engine/ai/Faction";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { isSolidWorldKind } from "@engine/physics/metadataKinds";
import type { Damageable } from "@shared/types/lifecycle";
import type { GameEventBus } from "@game/GameEvents";
import type {
  NpcCombatHandle,
  NpcCombatIntent,
  NpcCombatTickArgs,
} from "@game/npc/brain/NpcBrainContext";

export interface StriderCombatOptions {
  id: string;
  characterId: CharacterId;
  faction: Faction;
  body: RAPIER.RigidBody;
  physics: PhysicsWorld;
  eventBus: GameEventBus;
  onMinigunShot?: () => void;
  onCannonCharge?: () => void;
  onCannonShot?: () => void;
  onStomp?: () => void;
}

interface DamageTarget {
  damageable: Damageable;
  targetId: string;
  surfaceKind: PhysicsMetadata["kind"];
  bodyPartName?: string;
  damage: number;
  direction: Vector3;
  point: Vector3;
}

const MINIGUN_NAME = "Strider Minigun";
const CANNON_NAME = "Strider Cannon";
const STOMP_NAME = "Strider Stomp";

const MINIGUN_RANGE = 75;
const MINIGUN_DAMAGE = 6;
const MINIGUN_RATE = 7;
const MINIGUN_TELEGRAPH = 0.35;
const MINIGUN_BASE_BURST = 2.4;
const MINIGUN_RANDOM_BURST = 0.6;
const MINIGUN_DOWNTIME = 1.1;
const MINIGUN_ON_TARGET_TIME = 0.45;
const MINIGUN_SPREAD = 0.018;
const MINIGUN_MAX_HITS_PER_TARGET = 6;
const AIM_HOLD_GRACE = 0.55;

const CANNON_RANGE = 85;
const CANNON_COOLDOWN = 8;
const CANNON_BRACE = 1;
const CANNON_CHARGE = 1.25;
const CANNON_HIT_DELAY = 0.2;
const CANNON_DAMAGE = 140;
const CANNON_RADIUS = 5.5;
const CANNON_IMPULSE = 26;

const STOMP_TRIGGER_RANGE = 6;
const STOMP_RADIUS = 3.2;
const STOMP_WINDUP = 0.65;
const STOMP_COOLDOWN = 5;
const STOMP_DAMAGE_CENTER = 170;
const STOMP_DAMAGE_EDGE = 60;
const STOMP_IMPULSE = 14;

const tmpOrigin = new Vector3();
const tmpDirection = new Vector3();
const tmpRight = new Vector3();
const tmpUp = new Vector3(0, 1, 0);
const tmpTarget = new Vector3();
const tmpAnchor = new Vector3();
const tmpNormal = new Vector3();
const tmpOffset = new Vector3();
const tmpPoint = new Vector3();
const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 } as const;

export class StriderCombat implements NpcCombatHandle {
  private readonly aimTarget = new Vector3();
  private readonly position = new Vector3();
  private readonly facing = new Vector3(0, 0, 1);
  private readonly minigunAnchor = new Vector3();
  private readonly cannonTarget = new Vector3();
  private readonly cannonImpact = new Vector3();
  private readonly cannonFireOrigin = new Vector3();
  private readonly cannonNormal = new Vector3(0, 1, 0);
  private readonly stompPoint = new Vector3();
  private readonly burstHits = new Map<string, number>();

  private threat: NpcCombatTickArgs["threat"] = null;
  private intent: NpcCombatIntent = "primary";
  private now = 0;
  private lastAimAt = -Infinity;
  private hasAim = false;

  private minigunPrefireUntil = -Infinity;
  private minigunCooldownUntil = 0;
  private minigunBlockedUntil = 0;
  private minigunBurstUntil = -Infinity;
  private minigunBurstStartedAt = -Infinity;
  private minigunBurstDuration = 0;
  private nextMinigunShotAt = 0;

  private cannonState: "idle" | "brace" | "charge" | "delay" = "idle";
  private cannonPhaseUntil = 0;
  private cannonCooldownUntil = 0;

  private stompState: "idle" | "windup" = "idle";
  private stompImpactAt = 0;
  private stompCooldownUntil = 0;

  constructor(private readonly opts: StriderCombatOptions) {}

  tick(args: NpcCombatTickArgs): void {
    this.now = args.elapsed;
    this.position.copy(args.position);
    this.facing.copy(args.facing);
    this.threat = args.threat;

    this.tickCannon();
    this.tickStomp();
    this.tickMinigun();
  }

  aim(target: Vector3): void {
    this.aimTarget.copy(target);
    this.aimTarget.y += 1.0;
    this.hasAim = true;
    this.lastAimAt = this.now;
  }

  setIntent(intent: NpcCombatIntent): void {
    if (intent !== this.intent && intent !== "primary") {
      this.minigunPrefireUntil = -Infinity;
    }
    this.intent = intent;
  }

  canUseIntent(intent: NpcCombatIntent): boolean {
    if (intent === "primary") {
      return this.cannonState === "idle" && this.stompState === "idle" && this.now >= this.minigunBlockedUntil;
    }
    if (intent === "secondary") {
      return this.cannonState === "idle" && this.stompState === "idle" && this.now >= this.cannonCooldownUntil;
    }
    return (
      this.cannonState === "idle" &&
      this.stompState === "idle" &&
      this.now >= this.stompCooldownUntil &&
      this.threatInStompRange()
    );
  }

  tryFire(): boolean {
    if (this.intent === "secondary") return this.tryStartCannon();
    if (this.intent === "melee") return this.tryStartStomp();
    return this.tryStartMinigun();
  }

  reload(): void {}

  isReloading(): boolean {
    return false;
  }

  magazineEmpty(): boolean {
    return false;
  }

  effectiveRange(): number {
    return CANNON_RANGE;
  }

  scan(): void {
    this.minigunPrefireUntil = -Infinity;
  }

  private tryStartMinigun(): boolean {
    if (!this.hasFreshAim() || !this.canUseIntent("primary")) return false;
    if (this.isMinigunShooting()) return true;
    if (this.now < this.minigunCooldownUntil) return false;
    if (this.minigunPrefireUntil === -Infinity) {
      this.minigunPrefireUntil = this.now + MINIGUN_TELEGRAPH;
      this.opts.eventBus.emit("npc.attack", {
        id: this.opts.id,
        characterId: this.opts.characterId,
        position: this.position.clone(),
      });
      return false;
    }
    if (this.now < this.minigunPrefireUntil) return false;
    this.startMinigunBurst();
    return true;
  }

  private startMinigunBurst(): void {
    this.minigunPrefireUntil = -Infinity;
    this.minigunBurstStartedAt = this.now;
    this.minigunBurstDuration = MINIGUN_BASE_BURST + Math.random() * MINIGUN_RANDOM_BURST;
    this.minigunBurstUntil = this.now + this.minigunBurstDuration;
    this.nextMinigunShotAt = this.now;
    this.burstHits.clear();

    const muzzle = this.minigunOrigin();
    tmpAnchor.copy(this.aimTarget).sub(muzzle);
    const planar = Math.hypot(tmpAnchor.x, tmpAnchor.z);
    const offset = Math.max(5, Math.min(13, planar * 0.22));
    const side = Math.random() < 0.5 ? -1 : 1;
    if (planar > 0.001) {
      tmpRight.set(tmpAnchor.z / planar, 0, -tmpAnchor.x / planar);
    } else {
      tmpRight.set(1, 0, 0);
    }
    this.minigunAnchor.copy(this.aimTarget).addScaledVector(tmpRight, offset * side);
    this.minigunAnchor.y -= 0.8;
  }

  private tickMinigun(): void {
    if (!this.isMinigunShooting()) return;
    if (!this.hasFreshAim() || this.cannonState !== "idle" || this.stompState !== "idle") {
      this.finishMinigunBurst();
      return;
    }
    if (this.now >= this.minigunBurstUntil) {
      this.finishMinigunBurst();
      return;
    }
    let guard = 0;
    while (this.nextMinigunShotAt <= this.now && guard < 8) {
      const timeIntoBurst = Math.max(0, this.nextMinigunShotAt - this.minigunBurstStartedAt);
      const stitchDuration = Math.max(0.1, this.minigunBurstDuration - MINIGUN_ON_TARGET_TIME);
      const progress = Math.min(1, timeIntoBurst / stitchDuration);
      tmpTarget.copy(this.minigunAnchor).lerp(this.aimTarget, progress);
      this.fireMinigunShot(tmpTarget);
      this.nextMinigunShotAt += 1 / MINIGUN_RATE;
      guard += 1;
    }
  }

  private finishMinigunBurst(): void {
    this.minigunBurstUntil = -Infinity;
    this.minigunCooldownUntil = this.now + MINIGUN_DOWNTIME;
  }

  private isMinigunShooting(): boolean {
    return this.minigunBurstUntil > this.now;
  }

  private fireMinigunShot(target: Vector3): void {
    const origin = this.minigunOrigin();
    tmpDirection.copy(target).sub(origin);
    if (tmpDirection.lengthSq() < 0.001) return;
    tmpDirection.normalize();
    const shotDir = applySpread(tmpDirection, MINIGUN_SPREAD);
    const hit = this.castShot(origin, shotDir, MINIGUN_RANGE);

    this.opts.onMinigunShot?.();
    this.opts.eventBus.emit("weapon.fired", {
      weaponName: MINIGUN_NAME,
      weaponType: "hitscan",
      ammo: 0,
      origin: origin.clone(),
      direction: shotDir.clone(),
      range: MINIGUN_RANGE,
      sourceId: this.opts.id,
      sourceKind: "npc",
      sourceFaction: this.opts.faction,
    });
    this.opts.eventBus.emit("world.noise", {
      kind: "gunshot",
      position: origin.clone(),
      radius: 55,
      sourceId: this.opts.id,
      sourceFaction: this.opts.faction,
    });
    if (!hit) return;
    this.applyHitscanDamage(hit.metadata, hit.point, hit.normal, shotDir, MINIGUN_DAMAGE, MINIGUN_NAME);
  }

  private tryStartCannon(): boolean {
    if (!this.hasFreshAim() || !this.canUseIntent("secondary")) return false;
    this.cannonState = "brace";
    this.cannonPhaseUntil = this.now + CANNON_BRACE;
    this.cannonTarget.copy(this.aimTarget);
    this.minigunPrefireUntil = -Infinity;
    this.finishMinigunBurst();
    this.opts.eventBus.emit("npc.attack", {
      id: this.opts.id,
      characterId: this.opts.characterId,
      position: this.position.clone(),
    });
    return true;
  }

  private tickCannon(): void {
    if (this.cannonState === "idle") return;
    // Trackea el objetivo durante el telegraph (brace+charge ~2.25 s). Sin esto
    // el cañon dispara a la posicion lockeada al inicio del brace y nunca le
    // pega a un player que se mueve. El counterplay es romper la linea de vista
    // durante la carga (el `castShot` pega en la pared, no en el player).
    if (
      (this.cannonState === "brace" || this.cannonState === "charge") &&
      this.hasFreshAim()
    ) {
      this.cannonTarget.copy(this.aimTarget);
    }
    if (this.cannonState === "brace" && this.now >= this.cannonPhaseUntil) {
      this.cannonState = "charge";
      this.cannonPhaseUntil = this.now + CANNON_CHARGE;
      this.opts.onCannonCharge?.();
      this.opts.eventBus.emit("npc.charge", {
        id: this.opts.id,
        characterId: this.opts.characterId,
        position: this.position.clone(),
      });
      return;
    }
    if (this.cannonState === "charge" && this.now >= this.cannonPhaseUntil) {
      this.fireCannon();
      this.cannonState = "delay";
      this.cannonPhaseUntil = this.now + CANNON_HIT_DELAY;
      return;
    }
    if (this.cannonState === "delay" && this.now >= this.cannonPhaseUntil) {
      this.opts.eventBus.emit("strider.cannon.impact", {
        point: this.cannonImpact.clone(),
        origin: this.cannonFireOrigin.clone(),
        normal: this.cannonNormal.clone(),
        damage: CANNON_DAMAGE,
        radius: CANNON_RADIUS,
        impulse: CANNON_IMPULSE,
        sourceId: this.opts.id,
        sourceFaction: this.opts.faction,
      });
      this.cannonState = "idle";
      this.cannonCooldownUntil = this.now + CANNON_COOLDOWN;
      this.minigunBlockedUntil = this.now + 1;
    }
  }

  private fireCannon(): void {
    const origin = this.cannonOrigin();
    this.cannonFireOrigin.copy(origin);
    tmpDirection.copy(this.cannonTarget).sub(origin);
    if (tmpDirection.lengthSq() < 0.001) tmpDirection.copy(this.facing);
    tmpDirection.normalize();
    const hit = this.castShot(origin, tmpDirection, CANNON_RANGE);
    if (hit) {
      this.cannonImpact.copy(hit.point);
      this.cannonNormal.copy(hit.normal ?? tmpNormal.copy(tmpDirection).multiplyScalar(-1));
      this.emitWeaponHit(CANNON_NAME, hit.metadata, hit.point, hit.normal, 0);
    } else {
      this.cannonImpact.copy(origin).addScaledVector(tmpDirection, CANNON_RANGE);
      this.cannonNormal.copy(tmpDirection).multiplyScalar(-1);
    }
    this.opts.onCannonShot?.();
    this.opts.eventBus.emit("weapon.fired", {
      weaponName: CANNON_NAME,
      weaponType: "hitscan",
      ammo: 0,
      origin: origin.clone(),
      direction: tmpDirection.clone(),
      range: CANNON_RANGE,
      sourceId: this.opts.id,
      sourceKind: "npc",
      sourceFaction: this.opts.faction,
    });
    this.opts.eventBus.emit("world.noise", {
      kind: "gunshot",
      position: origin.clone(),
      radius: 85,
      sourceId: this.opts.id,
      sourceFaction: this.opts.faction,
    });
  }

  private tryStartStomp(): boolean {
    if (!this.canUseIntent("melee")) return false;
    this.stompState = "windup";
    this.stompImpactAt = this.now + STOMP_WINDUP;
    this.stompCooldownUntil = this.now + STOMP_COOLDOWN;
    this.stompPoint.copy(this.threat?.position ?? this.position);
    this.opts.onStomp?.();
    this.opts.eventBus.emit("npc.attack", {
      id: this.opts.id,
      characterId: this.opts.characterId,
      position: this.position.clone(),
    });
    return true;
  }

  private tickStomp(): void {
    if (this.stompState !== "windup" || this.now < this.stompImpactAt) return;
    this.applyStompDamage(this.stompPoint);
    this.stompState = "idle";
  }

  private applyStompDamage(point: Vector3): void {
    const sphere = new RAPIER.Ball(STOMP_RADIUS);
    const seen = new Set<number>();
    const targets = new Map<Damageable, DamageTarget>();
    this.opts.physics.world.intersectionsWithShape(
      point,
      IDENTITY_ROTATION,
      sphere,
      (collider) => {
        if (seen.has(collider.handle)) return true;
        seen.add(collider.handle);
        const metadata = this.opts.physics.getColliderMetadata(collider);
        if (!metadata || metadata.id === this.opts.id || !metadata.damageable) return true;
        const targetFaction = metadata.faction ?? (metadata.kind === "player" ? "player" : null);
        if (targetFaction && !isHostileTo(this.opts.faction, targetFaction)) return true;

        const parent = collider.parent();
        const parentPos = parent?.translation();
        if (!parentPos) return true;
        tmpOffset.set(parentPos.x - point.x, parentPos.y - point.y, parentPos.z - point.z);
        const distance = tmpOffset.length();
        const falloff = Math.min(1, distance / STOMP_RADIUS);
        const baseDamage = STOMP_DAMAGE_EDGE + (STOMP_DAMAGE_CENTER - STOMP_DAMAGE_EDGE) * (1 - falloff);
        const damage = baseDamage * (metadata.bodyPart?.damageMultiplier ?? 1);
        const direction =
          tmpOffset.lengthSq() > 1e-4 ? tmpOffset.clone().normalize() : new Vector3(0, 1, 0);
        if (parent?.isDynamic()) {
          parent.applyImpulse(
            {
              x: direction.x * STOMP_IMPULSE,
              y: Math.max(0.4, direction.y) * STOMP_IMPULSE,
              z: direction.z * STOMP_IMPULSE,
            },
            true,
          );
        }
        collectTarget(targets, {
          damageable: metadata.damageable,
          targetId: metadata.id,
          surfaceKind: metadata.kind,
          bodyPartName: metadata.bodyPart?.name,
          damage,
          direction,
          point: new Vector3(parentPos.x, parentPos.y, parentPos.z),
        });
        return true;
      },
    );
    targets.forEach((target) => {
      target.damageable.applyDamage(
        target.damage,
        target.direction.clone(),
        target.bodyPartName,
        this.opts.id,
        target.point.clone(),
      );
      this.opts.eventBus.emit("weapon.hit", {
        weaponName: STOMP_NAME,
        targetId: target.targetId,
        surfaceKind: target.surfaceKind,
        point: target.point.clone(),
        normal: target.direction.clone(),
        damage: target.damage,
        sourceId: this.opts.id,
        sourceKind: "npc",
        sourceFaction: this.opts.faction,
      });
    });
    this.opts.eventBus.emit("world.noise", {
      kind: "impact",
      position: point.clone(),
      radius: 36,
      sourceId: this.opts.id,
      sourceFaction: this.opts.faction,
    });
  }

  private applyHitscanDamage(
    metadata: PhysicsMetadata | undefined,
    point: Vector3,
    normal: Vector3 | undefined,
    direction: Vector3,
    baseDamage: number,
    weaponName: string,
  ): void {
    if (!metadata) return;
    if (isSolidWorldKind(metadata.kind) && !metadata.damageable) {
      this.emitWeaponHit(weaponName, metadata, point, normal, 0);
      return;
    }
    const damageable = metadata.damageable;
    if (!damageable) return;
    const targetFaction = metadata.faction ?? (metadata.kind === "player" ? "player" : null);
    if (targetFaction && !isHostileTo(this.opts.faction, targetFaction)) return;

    const targetId = metadata.id ?? "unknown";
    const previous = this.burstHits.get(targetId) ?? 0;
    const damage =
      previous >= MINIGUN_MAX_HITS_PER_TARGET
        ? 0
        : baseDamage * (metadata.bodyPart?.damageMultiplier ?? 1);
    if (damage > 0) {
      this.burstHits.set(targetId, previous + 1);
      damageable.applyDamage(damage, direction.clone(), metadata.bodyPart?.name, this.opts.id, point);
    }
    this.emitWeaponHit(weaponName, metadata, point, normal, damage);
  }

  private emitWeaponHit(
    weaponName: string,
    metadata: PhysicsMetadata | undefined,
    point: Vector3,
    normal: Vector3 | undefined,
    damage: number,
  ): void {
    this.opts.eventBus.emit("weapon.hit", {
      weaponName,
      targetId: metadata?.id,
      surfaceKind: metadata?.kind,
      point: point.clone(),
      normal: normal?.clone(),
      damage,
      sourceId: this.opts.id,
      sourceKind: "npc",
      sourceFaction: this.opts.faction,
    });
  }

  private castShot(
    origin: Vector3,
    direction: Vector3,
    range: number,
  ): { metadata?: PhysicsMetadata; point: Vector3; normal?: Vector3 } | null {
    const ray = new RAPIER.Ray(origin, direction);
    const hit = this.opts.physics.world.castRayAndGetNormal(
      ray,
      range,
      true,
      undefined,
      undefined,
      undefined,
      this.opts.body,
      (collider) => this.opts.physics.getColliderMetadata(collider)?.id !== this.opts.id,
    );
    if (!hit) return null;
    return {
      metadata: this.opts.physics.getColliderMetadata(hit.collider),
      point: origin.clone().addScaledVector(direction, hit.timeOfImpact),
      normal: new Vector3(hit.normal.x, hit.normal.y, hit.normal.z),
    };
  }

  private minigunOrigin(): Vector3 {
    tmpRight.crossVectors(this.facing, tmpUp).normalize();
    return tmpOrigin
      .copy(this.position)
      .addScaledVector(this.facing, 2.9)
      .addScaledVector(tmpRight, 0.25)
      .add(new Vector3(0, -0.45, 0))
      .clone();
  }

  private cannonOrigin(): Vector3 {
    return tmpOrigin
      .copy(this.position)
      .addScaledVector(this.facing, 2.65)
      .add(new Vector3(0, -0.75, 0))
      .clone();
  }

  private hasFreshAim(): boolean {
    return this.hasAim && this.now - this.lastAimAt <= AIM_HOLD_GRACE;
  }

  private threatInStompRange(): boolean {
    if (!this.threat?.isAlive) return false;
    const dx = this.threat.position.x - this.position.x;
    const dz = this.threat.position.z - this.position.z;
    return Math.hypot(dx, dz) <= STOMP_TRIGGER_RANGE && Math.abs(this.threat.position.y - this.position.y) < 8;
  }
}

function applySpread(direction: Vector3, spread: number): Vector3 {
  if (spread <= 0) return direction.clone().normalize();
  tmpRight.crossVectors(direction, tmpUp);
  if (tmpRight.lengthSq() < 0.001) tmpRight.set(1, 0, 0);
  tmpRight.normalize();
  const spreadUp = tmpOffset.crossVectors(tmpRight, direction).normalize();
  return direction
    .clone()
    .addScaledVector(tmpRight, (Math.random() - 0.5) * spread)
    .addScaledVector(spreadUp, (Math.random() - 0.5) * spread)
    .normalize();
}

function collectTarget(targets: Map<Damageable, DamageTarget>, candidate: DamageTarget): void {
  const existing = targets.get(candidate.damageable);
  if (!existing || candidate.damage > existing.damage) {
    targets.set(candidate.damageable, candidate);
  }
}
