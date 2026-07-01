import type RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { isHostileTo, type Faction } from "@engine/ai/Faction";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { Raycast } from "@engine/physics/Raycast";
import type { GameEventBus } from "@game/GameEvents";
import type { NpcCombatHandle, NpcCombatTickArgs } from "@game/npc/brain/NpcBrainContext";

export interface GunshipCannonCombatOptions {
  id: string;
  characterId: CharacterId;
  faction: Faction;
  body: RAPIER.RigidBody;
  raycast: Raycast;
  eventBus: GameEventBus;
  eyeHeight: number;
  onShot?: () => void;
}

const WEAPON_NAME = "Gunship Cannon";
const RANGE = 60;
const DAMAGE = 6;
const SPREAD = 0.035;
const TELEGRAPH_TIME = 0.45;
const BURST_SIZE = 15;
const SHOT_INTERVAL = 0.075;
const PAUSE_BETWEEN_BURSTS = 1.6;
const AIM_HOLD_GRACE = 0.55;
const MAX_HITS_PER_TARGET_PER_BURST = 5;

const tmpOrigin = new Vector3();
const tmpDir = new Vector3();
const tmpTarget = new Vector3();
const tmpStart = new Vector3();
const tmpEnd = new Vector3();
const spreadRight = new Vector3();
const spreadUp = new Vector3();
const Y_AXIS = new Vector3(0, 1, 0);

export class GunshipCannonCombat implements NpcCombatHandle {
  private readonly aimTarget = new Vector3();
  private readonly stitchStart = new Vector3();
  private readonly stitchEnd = new Vector3();
  private readonly burstHits = new Map<string, number>();

  private hasAim = false;
  private now = 0;
  private lastAimAt = -Infinity;
  private prefireUntil = -Infinity;
  private cooldownUntil = 0;
  private burstShotsLeft = 0;
  private nextShotAt = 0;
  private burstShotIndex = 0;

  constructor(private readonly opts: GunshipCannonCombatOptions) {}

  tick(args: NpcCombatTickArgs): void {
    this.now = args.elapsed;
    tmpOrigin.copy(args.position);
    tmpOrigin.y += this.opts.eyeHeight;

    if (!this.hasFreshAim()) {
      this.abortBurst();
      return;
    }

    while (this.burstShotsLeft > 0 && this.now >= this.nextShotAt) {
      const progress = BURST_SIZE <= 1 ? 1 : this.burstShotIndex / (BURST_SIZE - 1);
      tmpTarget.copy(this.stitchStart).lerp(this.stitchEnd, progress);
      this.fireOneShot(tmpOrigin, tmpTarget);
      this.burstShotsLeft -= 1;
      this.burstShotIndex += 1;
      this.nextShotAt += SHOT_INTERVAL;
      if (this.burstShotsLeft === 0) {
        this.cooldownUntil = this.now + PAUSE_BETWEEN_BURSTS;
      }
    }
  }

  aim(target: Vector3): void {
    this.aimTarget.copy(target);
    this.aimTarget.y += 1.0;
    this.stitchEnd.copy(this.aimTarget);
    this.hasAim = true;
    this.lastAimAt = this.now;
  }

  tryFire(): boolean {
    if (!this.hasFreshAim()) return false;
    if (this.burstShotsLeft > 0) return true;
    if (this.now < this.cooldownUntil) return false;

    if (this.prefireUntil === -Infinity) {
      this.prefireUntil = this.now + TELEGRAPH_TIME;
      this.opts.eventBus.emit("npc.attack", {
        id: this.opts.id,
        characterId: this.opts.characterId,
      });
      return false;
    }
    if (this.now < this.prefireUntil) return false;

    this.startBurst();
    return true;
  }

  reload(): void {}

  isReloading(): boolean {
    return false;
  }

  magazineEmpty(): boolean {
    return false;
  }

  effectiveRange(): number {
    return RANGE;
  }

  scan(): void {
    this.prefireUntil = -Infinity;
  }

  private startBurst(): void {
    this.prefireUntil = -Infinity;
    this.burstShotsLeft = BURST_SIZE;
    this.burstShotIndex = 0;
    this.nextShotAt = this.now;
    this.burstHits.clear();

    tmpStart.copy(this.aimTarget).sub(tmpOrigin);
    const planarDistance = Math.hypot(tmpStart.x, tmpStart.z);
    const side = Math.random() < 0.5 ? -1 : 1;
    const offset = Math.max(6, Math.min(14, planarDistance * 0.28));
    if (planarDistance > 0.001) {
      spreadRight.set(tmpStart.z / planarDistance, 0, -tmpStart.x / planarDistance);
    } else {
      spreadRight.set(1, 0, 0);
    }
    this.stitchStart.copy(this.aimTarget).addScaledVector(spreadRight, offset * side);
    this.stitchEnd.copy(this.aimTarget).addScaledVector(spreadRight, -offset * 0.35 * side);
  }

  private abortBurst(): void {
    this.prefireUntil = -Infinity;
    this.burstShotsLeft = 0;
    this.burstShotIndex = 0;
  }

  private hasFreshAim(): boolean {
    return this.hasAim && this.now - this.lastAimAt <= AIM_HOLD_GRACE;
  }

  private fireOneShot(origin: Vector3, target: Vector3): void {
    tmpDir.copy(target).sub(origin);
    const distance = tmpDir.length();
    if (distance < 0.01) return;
    tmpDir.divideScalar(distance);
    const shotDir = applySpread(tmpDir, SPREAD);
    const rayOrigin = origin.clone().addScaledVector(shotDir, 0.7);
    const hit = this.opts.raycast.cast(rayOrigin, shotDir, RANGE, this.opts.body);

    this.opts.onShot?.();
    this.opts.eventBus.emit("weapon.fired", {
      weaponName: WEAPON_NAME,
      weaponType: "hitscan",
      ammo: 0,
      origin: rayOrigin.clone(),
      direction: shotDir.clone(),
      range: RANGE,
      sourceId: this.opts.id,
      sourceKind: "npc",
      sourceFaction: this.opts.faction,
    });
    this.opts.eventBus.emit("world.noise", {
      kind: "gunshot",
      position: rayOrigin.clone(),
      radius: 45,
      sourceId: this.opts.id,
      sourceFaction: this.opts.faction,
    });

    if (!hit) return;
    const meta = hit.metadata;
    if (meta?.kind === "static" || meta?.kind === "door") {
      this.emitHit(meta.id, meta.kind, hit.point, hit.normal, 0);
      return;
    }

    const damageable = meta?.damageable;
    if (!damageable) return;
    const targetFaction = meta.faction ?? (meta.kind === "player" ? "player" : null);
    if (targetFaction && !isHostileTo(this.opts.faction, targetFaction)) return;

    const targetId = meta.id ?? "unknown";
    const previousHits = this.burstHits.get(targetId) ?? 0;
    const partMul = meta.bodyPart?.damageMultiplier ?? 1;
    const damage = previousHits >= MAX_HITS_PER_TARGET_PER_BURST ? 0 : DAMAGE * partMul;
    if (damage > 0) {
      this.burstHits.set(targetId, previousHits + 1);
      damageable.applyDamage(damage, shotDir.clone(), meta.bodyPart?.name, this.opts.id, hit.point);
    }
    this.emitHit(targetId, meta.kind, hit.point, hit.normal, damage);
  }

  private emitHit(
    targetId: string | undefined,
    surfaceKind: "static" | "dynamic" | "door" | "npc" | "player" | "ragdoll" | "weaponPickup" | undefined,
    point: Vector3,
    normal: Vector3 | undefined,
    damage: number,
  ): void {
    this.opts.eventBus.emit("weapon.hit", {
      weaponName: WEAPON_NAME,
      targetId,
      surfaceKind,
      point: point.clone(),
      normal: normal?.clone(),
      damage,
      sourceId: this.opts.id,
      sourceKind: "npc",
      sourceFaction: this.opts.faction,
    });
  }
}

function applySpread(direction: Vector3, spread: number): Vector3 {
  if (spread <= 0) return direction.clone().normalize();
  spreadRight.crossVectors(direction, Y_AXIS);
  if (spreadRight.lengthSq() < 0.001) spreadRight.set(1, 0, 0);
  spreadRight.normalize();
  spreadUp.crossVectors(spreadRight, direction).normalize();
  return direction
    .clone()
    .addScaledVector(spreadRight, (Math.random() - 0.5) * spread)
    .addScaledVector(spreadUp, (Math.random() - 0.5) * spread)
    .normalize();
}
