import {
  AdditiveBlending,
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Scene,
  Vector3,
} from "three";
import type { Faction } from "@engine/ai/Faction";
import type { Raycast } from "@engine/physics/Raycast";
import { WeaponEffectsConfig } from "@game/config/weapons.config";
import type { CombatEventSourceKind } from "@game/GameEvents";
import type { GameEventBus } from "@game/GameEvents";

const WORLD_UP = new Vector3(0, 1, 0);
const worldForward = new Vector3(0, 0, 1);

/** Colores de tracer por bando (cálido aliado / rojo hostil). */
const PLAYER_TRACER_COLOR = 0xfff0b8;
const ALLY_TRACER_COLOR = 0x9fd4ff;
const ENEMY_TRACER_COLOR = 0xff6a44;

const TRACER_RADIUS = 0.022;
const TRACER_DURATION = WeaponEffectsConfig.tracerDuration;
const TRACER_OPACITY = 0.95;
/** Adelanto del raycast del tracer para librar la cápsula del tirador. */
const TRACER_CAST_OFFSET = 0.45;
/** Cap del pool de líneas (tracers de bala + beam del cañón). */
const MAX_BEAMS = WeaponEffectsConfig.maxTracers;

/** Beam de energía del cañón del strider (más gordo y duradero que un tracer). */
const CANNON_BEAM_DURATION = 0.14;
const CANNON_BEAM_OPACITY = 0.9;
const CANNON_BEAM_RADIUS = 0.14;

const tmpDir = new Vector3();
const tmpRight = new Vector3();
const tmpUp = new Vector3();
const tmpStart = new Vector3();
const tmpEnd = new Vector3();
const tmpCastOrigin = new Vector3();
const tmpBeamDir = new Vector3();

interface TrackedEffect {
  mesh: Mesh;
  material: MeshBasicMaterial;
  remaining: number;
  duration: number;
  /** Opacidad inicial desde la que se desvanece (beams). */
  peakOpacity?: number;
}

/**
 * Render de tracers (player + NPCs) y decals al disparar.
 *
 * Tracers y el beam del cañón del strider comparten la misma primitiva: una
 * línea aditiva de largo fijo (muzzle → impacto) que se desvanece adelgazándose.
 * El endpoint sale de un raycast sobre la misma dirección del disparo, así el
 * tracer termina justo en lo que la bala pegó (pared, NPC), no en el aire.
 *
 * Se suscribe a `weapon.fired` / `weapon.hit` en el constructor y guarda las
 * funciones de unsubscribe. Ownership: `Game.dispose()` lo libera.
 */
export class WeaponEffects {
  private readonly decals: TrackedEffect[] = [];
  private readonly beams: TrackedEffect[] = [];
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly scene: Scene,
    eventBus: GameEventBus,
    private readonly raycast: Raycast,
  ) {
    this.unsubscribers.push(
      eventBus.on("weapon.fired", (payload) => {
        if (payload.weaponType !== "hitscan") return;
        // El cañón del strider usa un beam dedicado (ver Game → strider.cannon.impact).
        if (payload.weaponName === "Strider Cannon") return;
        this.createTracer(
          payload.origin,
          payload.direction,
          payload.range,
          payload.sourceKind,
          payload.sourceFaction,
          payload.sourceId,
        );
      }),
      eventBus.on("weapon.tracer", (payload) => {
        this.createTracer(
          payload.origin,
          payload.direction,
          payload.range,
          payload.sourceKind,
          payload.sourceFaction,
          payload.sourceId,
        );
      }),
      eventBus.on("weapon.hit", (payload) =>
        this.createDecal(payload.point, payload.normal, payload.surfaceKind),
      ),
    );
  }

  update(delta: number): void {
    this.updateDecals(delta);
    this.updateBeams(delta);
  }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers.length = 0;
    this.clearEffects(this.decals);
    this.clearEffects(this.beams);
  }

  /** Limpia tracers/decals vivos sin desuscribir del bus (recarga de nivel in-place). */
  clear(): void {
    this.clearEffects(this.decals);
    this.clearEffects(this.beams);
  }

  /**
   * Beam grueso aditivo de `from` a `to` (tracer de energía del cañón del
   * strider). Conserva su largo completo y se desvanece adelgazándose.
   */
  beam(from: Vector3, to: Vector3, color: number, radius = CANNON_BEAM_RADIUS): void {
    this.pushBeam(from, to, color, radius, CANNON_BEAM_DURATION, CANNON_BEAM_OPACITY);
  }

  private createTracer(
    origin: Vector3,
    direction: Vector3,
    range: number,
    sourceKind: CombatEventSourceKind | undefined,
    sourceFaction: Faction | undefined,
    sourceId: string | undefined,
  ): void {
    const endpoint = this.resolveEndpoint(origin, direction, range, sourceId);
    // El player dispara desde la cámara: arrancar el tracer en el cañón del
    // view-model (abajo-derecha) en vez del centro de la pantalla. Los NPCs ya
    // emiten desde su boca.
    const start = sourceKind === "player" ? this.playerMuzzle(origin, direction) : origin;
    const color = tracerColor(sourceKind, sourceFaction);
    this.pushBeam(start, endpoint, color, TRACER_RADIUS, TRACER_DURATION, TRACER_OPACITY);
  }

  /**
   * Punto donde el disparo realmente pega (mismo rayo), o el alcance máximo.
   * Excluye los colliders propios del tirador (`sourceId`): un cuerpo grande
   * como el strider tiene part-followers por delante de su boca.
   */
  private resolveEndpoint(
    origin: Vector3,
    direction: Vector3,
    range: number,
    sourceId: string | undefined,
  ): Vector3 {
    tmpDir.copy(direction).normalize();
    tmpCastOrigin.copy(origin).addScaledVector(tmpDir, TRACER_CAST_OFFSET);
    const maxDist = Math.max(0, range - TRACER_CAST_OFFSET);
    const hit = this.raycast.cast(tmpCastOrigin, tmpDir, maxDist, undefined, sourceId);
    if (hit && hit.metadata?.kind !== "player") return hit.point;
    return tmpEnd.copy(tmpCastOrigin).addScaledVector(tmpDir, maxDist);
  }

  /** Boca aproximada del arma del jugador, derivada de cámara + dirección. */
  private playerMuzzle(origin: Vector3, direction: Vector3): Vector3 {
    tmpDir.copy(direction).normalize();
    tmpRight.crossVectors(tmpDir, WORLD_UP);
    if (tmpRight.lengthSq() < 1e-4) tmpRight.set(1, 0, 0);
    tmpRight.normalize();
    tmpUp.crossVectors(tmpRight, tmpDir).normalize();
    return tmpStart
      .copy(origin)
      .addScaledVector(tmpDir, 0.5)
      .addScaledVector(tmpRight, 0.22)
      .addScaledVector(tmpUp, -0.18);
  }

  private pushBeam(
    from: Vector3,
    to: Vector3,
    color: number,
    radius: number,
    duration: number,
    opacity: number,
  ): void {
    tmpBeamDir.copy(to).sub(from);
    const length = tmpBeamDir.length();
    if (length < 1e-3) return;
    tmpBeamDir.divideScalar(length);

    const geometry = new CylinderGeometry(radius, radius, 1, 8, 1, true);
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(from).addScaledVector(tmpBeamDir, length * 0.5);
    mesh.quaternion.setFromUnitVectors(WORLD_UP, tmpBeamDir);
    mesh.scale.y = length;
    mesh.renderOrder = 40;
    this.scene.add(mesh);

    this.beams.push({ mesh, material, remaining: duration, duration, peakOpacity: opacity });
    this.enforceLimit(this.beams, MAX_BEAMS);
  }

  private updateBeams(delta: number): void {
    for (let index = this.beams.length - 1; index >= 0; index -= 1) {
      const effect = this.beams[index];
      effect.remaining -= delta;
      if (effect.remaining <= 0) {
        this.disposeEffect(effect);
        this.beams.splice(index, 1);
        continue;
      }
      const progress = effect.remaining / effect.duration;
      effect.material.opacity = (effect.peakOpacity ?? 0.9) * progress;
      // Adelgaza al desvanecerse, conservando el largo.
      const width = Math.max(0.2, progress);
      effect.mesh.scale.x = width;
      effect.mesh.scale.z = width;
    }
  }

  private createDecal(
    point: Vector3,
    normal: Vector3 | undefined,
    surfaceKind:
      | "static"
      | "dynamic"
      | "door"
      | "npc"
      | "player"
      | "ragdoll"
      | "weaponPickup"
      | undefined,
  ): void {
    if (surfaceKind !== "static" && surfaceKind !== "door") {
      return;
    }

    const impactNormal = (normal ?? worldForward).clone().normalize();
    const geometry = new CircleGeometry(0.05 + Math.random() * 0.015, 10);
    const material = new MeshBasicMaterial({
      color: 0x28140d,
      transparent: true,
      opacity: 0.88,
      side: DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    const mesh = new Mesh(geometry, material);
    mesh.position.copy(point).addScaledVector(impactNormal, 0.01);
    mesh.quaternion.setFromUnitVectors(worldForward, impactNormal);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.scale.setScalar(1 + Math.random() * 0.4);
    mesh.renderOrder = 41;
    this.scene.add(mesh);

    this.decals.push({
      mesh,
      material,
      remaining: WeaponEffectsConfig.decalDuration,
      duration: WeaponEffectsConfig.decalDuration,
    });
    this.enforceLimit(this.decals, WeaponEffectsConfig.maxDecals);
  }

  private updateDecals(delta: number): void {
    for (let index = this.decals.length - 1; index >= 0; index -= 1) {
      const effect = this.decals[index];
      effect.remaining -= delta;
      if (effect.remaining <= 0) {
        this.disposeEffect(effect);
        this.decals.splice(index, 1);
        continue;
      }
      effect.material.opacity = Math.max(0, effect.remaining / effect.duration);
    }
  }

  private clearEffects(effects: TrackedEffect[]): void {
    while (effects.length > 0) {
      const effect = effects.pop();
      if (effect) {
        this.disposeEffect(effect);
      }
    }
  }

  private disposeEffect(effect: TrackedEffect): void {
    effect.mesh.removeFromParent();
    effect.mesh.geometry.dispose();
    effect.material.dispose();
  }

  private enforceLimit(effects: TrackedEffect[], limit: number): void {
    while (effects.length > limit) {
      const effect = effects.shift();
      if (effect) {
        this.disposeEffect(effect);
      }
    }
  }
}

function tracerColor(
  sourceKind: CombatEventSourceKind | undefined,
  sourceFaction: Faction | undefined,
): number {
  if (sourceKind === "player") return PLAYER_TRACER_COLOR;
  if (sourceFaction === "player" || sourceFaction === "resistance") return ALLY_TRACER_COLOR;
  return ENEMY_TRACER_COLOR;
}
