import {
  CircleGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  type Scene,
  Vector3,
} from "three";
import type { Raycast } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { Disposable } from "@shared/types/lifecycle";
import type { GameEventBus } from "@game/GameEvents";
import { CharacterPresets } from "@game/characters/CharacterPresets";

const BLOOD_COLOR = new Color(0x6f0710);
const DECAL_COLOR = 0x2a0307;
const DECAL_DURATION = 24;
const MAX_DECALS = 64;
const MAX_BURSTS_PER_NPC_FRAME = 4;
const MAX_DECALS_PER_NPC_FRAME = 2;
const DIRECT_DECAL_RANGE = 3.2;
const FLOOR_DECAL_RANGE = 2.4;
const WORLD_FORWARD = new Vector3(0, 0, 1);
const WORLD_DOWN = new Vector3(0, -1, 0);
const tmpOrigin = new Vector3();

interface BloodDecal {
  mesh: Mesh;
  material: MeshBasicMaterial;
  remaining: number;
  duration: number;
}

export class NpcBloodEffects implements Disposable {
  private readonly decals: BloodDecal[] = [];
  private readonly burstsThisFrame = new Map<string, number>();
  private readonly decalsThisFrame = new Map<string, number>();
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly scene: Scene,
    eventBus: GameEventBus,
    private readonly raycast: Raycast,
    private readonly vfx: VfxSystem,
  ) {
    this.unsubscribers.push(
      eventBus.on("npc.damaged", (payload) => {
        if (payload.amount <= 0 || !payload.point) return;
        if (!isOrganicNpc(payload.characterId)) return;

        const direction = payload.direction?.clone() ?? new Vector3(0, 0.35, 1);
        const scale = Math.max(0.65, Math.min(2.2, 0.72 + payload.amount / 65));
        const variant = payload.amount >= 45 && !payload.bodyPart ? "radial" : "direct";

        if (this.consumeQuota(this.burstsThisFrame, payload.id, MAX_BURSTS_PER_NPC_FRAME)) {
          this.vfx.bloodImpact(payload.point, direction, {
            color: BLOOD_COLOR,
            scale,
            variant,
          });
        }

        if (this.consumeQuota(this.decalsThisFrame, payload.id, MAX_DECALS_PER_NPC_FRAME)) {
          this.projectBloodDecal(payload.id, payload.point, direction, scale);
        }
      }),
    );
  }

  update(delta: number): void {
    this.updateDecals(delta);
    this.burstsThisFrame.clear();
    this.decalsThisFrame.clear();
  }

  clear(): void {
    while (this.decals.length > 0) {
      const decal = this.decals.pop();
      if (decal) this.disposeDecal(decal);
    }
    this.burstsThisFrame.clear();
    this.decalsThisFrame.clear();
  }

  dispose(): void {
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers.length = 0;
    this.clear();
  }

  private projectBloodDecal(npcId: string, point: Vector3, direction: Vector3, scale: number): void {
    const dir = direction.lengthSq() > 0.001
      ? direction.clone().normalize()
      : new Vector3(0, 0.35, 1).normalize();
    tmpOrigin.copy(point).addScaledVector(dir, 0.08);
    const direct = this.raycast.cast(tmpOrigin, dir, DIRECT_DECAL_RANGE, undefined, npcId);
    if (direct && isDecalSurface(direct.metadata?.kind)) {
      this.createDecal(direct.point, direct.normal, scale);
      return;
    }

    tmpOrigin.copy(point);
    tmpOrigin.y += 0.18;
    const floor = this.raycast.cast(tmpOrigin, WORLD_DOWN, FLOOR_DECAL_RANGE, undefined, npcId);
    if (floor && isDecalSurface(floor.metadata?.kind)) {
      this.createDecal(floor.point, floor.normal, scale);
    }
  }

  private createDecal(point: Vector3, normal: Vector3 | undefined, scale: number): void {
    const radius = Math.max(0.08, Math.min(0.34, scale * (0.1 + Math.random() * 0.08)));
    const geometry = new CircleGeometry(radius, 12);
    const material = new MeshBasicMaterial({
      color: DECAL_COLOR,
      transparent: true,
      opacity: 0.86,
      side: DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    const impactNormal = (normal ?? WORLD_FORWARD).clone().normalize();
    const mesh = new Mesh(geometry, material);
    mesh.position.copy(point).addScaledVector(impactNormal, 0.012);
    mesh.quaternion.setFromUnitVectors(WORLD_FORWARD, impactNormal);
    mesh.rotateZ(Math.random() * Math.PI * 2);
    mesh.renderOrder = 42;
    this.scene.add(mesh);

    this.decals.push({
      mesh,
      material,
      remaining: DECAL_DURATION,
      duration: DECAL_DURATION,
    });
    this.enforceLimit();
  }

  private updateDecals(delta: number): void {
    for (let index = this.decals.length - 1; index >= 0; index -= 1) {
      const decal = this.decals[index];
      decal.remaining -= delta;
      if (decal.remaining <= 0) {
        this.disposeDecal(decal);
        this.decals.splice(index, 1);
        continue;
      }
      decal.material.opacity = Math.max(0, 0.86 * (decal.remaining / decal.duration));
    }
  }

  private enforceLimit(): void {
    while (this.decals.length > MAX_DECALS) {
      const decal = this.decals.shift();
      if (decal) this.disposeDecal(decal);
    }
  }

  private disposeDecal(decal: BloodDecal): void {
    decal.mesh.removeFromParent();
    decal.mesh.geometry.dispose();
    decal.material.dispose();
  }

  private consumeQuota(map: Map<string, number>, id: string, limit: number): boolean {
    const used = map.get(id) ?? 0;
    if (used >= limit) return false;
    map.set(id, used + 1);
    return true;
  }
}

function isOrganicNpc(characterId: string): boolean {
  const type = CharacterPresets[characterId]?.type;
  return type === "humanoid" || type === "creature";
}

function isDecalSurface(kind: string | undefined): boolean {
  return kind === "static" || kind === "door";
}
