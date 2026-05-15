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
import type { GameEventBus } from "../../engine/GameEvents";

const worldUp = new Vector3(0, 1, 0);
const worldForward = new Vector3(0, 0, 1);
const tempDirection = new Vector3();

interface TrackedEffect {
  mesh: Mesh;
  material: MeshBasicMaterial;
  remaining: number;
  duration: number;
}

export class WeaponEffects {
  private readonly traces: TrackedEffect[] = [];
  private readonly decals: TrackedEffect[] = [];
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly scene: Scene,
    eventBus: GameEventBus,
  ) {
    this.unsubscribers.push(
      eventBus.on("weapon.fired", (payload) =>
        this.createTracer(payload.origin, payload.direction, payload.range),
      ),
      eventBus.on("weapon.hit", (payload) =>
        this.createDecal(payload.point, payload.normal, payload.surfaceKind),
      ),
    );
  }

  update(delta: number): void {
    this.updateEffects(this.traces, delta);
    this.updateEffects(this.decals, delta);
  }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.clearEffects(this.traces);
    this.clearEffects(this.decals);
  }

  private createTracer(
    origin: Vector3,
    direction: Vector3,
    range: number,
  ): void {
    const length = Math.max(Math.min(range * 0.18, 12), 0.35);
    const normalizedDirection = tempDirection.copy(direction).normalize();
    const geometry = new CylinderGeometry(0.012, 0.018, 1, 6, 1, true);
    const material = new MeshBasicMaterial({
      color: 0xffc46a,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: AdditiveBlending,
    });

    const mesh = new Mesh(geometry, material);
    const midpoint = origin
      .clone()
      .addScaledVector(normalizedDirection, length * 0.5);
    mesh.position.copy(midpoint);
    mesh.quaternion.setFromUnitVectors(worldUp, normalizedDirection);
    mesh.scale.setScalar(1);
    mesh.scale.y = length;
    mesh.renderOrder = 40;
    this.scene.add(mesh);

    this.traces.push({ mesh, material, remaining: 0.06, duration: 0.06 });
    this.enforceLimit(this.traces, 24);
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

    this.decals.push({ mesh, material, remaining: 16, duration: 16 });
    this.enforceLimit(this.decals, 48);
  }

  private updateEffects(effects: TrackedEffect[], delta: number): void {
    for (let index = effects.length - 1; index >= 0; index -= 1) {
      const effect = effects[index];
      effect.remaining -= delta;

      if (effect.remaining <= 0) {
        this.disposeEffect(effect);
        effects.splice(index, 1);
        continue;
      }

      const progress = effect.remaining / effect.duration;
      effect.material.opacity = Math.max(0, progress);

      if (effect.mesh.geometry instanceof CylinderGeometry) {
        effect.mesh.scale.setScalar(0.9 + progress * 0.35);
        effect.mesh.scale.y *= Math.max(0.2, progress);
      }
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
