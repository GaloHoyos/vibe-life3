import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  type MeshBasicMaterial,
  type Object3D,
  CatmullRomCurve3,
  Vector3,
} from "three";
import { makeSeededRandom } from "@shared/math/Random";
import { BlobConfig } from "@game/config/blob.config";
import {
  createBlobEnergyMaterial,
  sampleBlobVeinColor,
} from "./BlobVisual";

export interface NeuralTendrilTarget {
  id: number;
  position: Vector3;
}

export interface BlobNeuralTendrilsOptions {
  name: string;
  seed: number;
}

type TendrilPhase = "idle" | "travel" | "hold" | "fade";

interface TendrilSlot {
  phase: TendrilPhase;
  remaining: number;
  duration: number;
  targetId: number | null;
  targetPoint: Vector3;
  wavePhaseA: number;
  wavePhaseB: number;
  waveJitter: number;
  brightness: number;
  normalHint: Vector3;
  curvePoints: [Vector3, Vector3, Vector3, Vector3];
  curve: CatmullRomCurve3;
}

const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);
const scratchAxis = new Vector3();
const scratchU = new Vector3();
const scratchV = new Vector3();
const scratchPoint = new Vector3();
const scratchTangent = new Vector3();
const scratchNormal = new Vector3();
const scratchBinormal = new Vector3();
const scratchColor = new Color();

/**
 * Neuron-style discharges from the brain to the physical shell spheres. One
 * additive mesh holds every filament slot; per frame the active slots rewrite
 * their tube positions along an undulating curve between the live endpoints
 * and paint a traveling pulse via vertex colors. Idle slots stay black, which
 * under additive blending means invisible.
 */
export class BlobNeuralTendrils {
  readonly object: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly slots: TendrilSlot[] = [];
  private readonly random: () => number;
  private readonly rings = Math.max(4, BlobConfig.visual.neuralRingCount);
  private readonly radialSegments = Math.max(
    3,
    BlobConfig.visual.neuralRadialSegments,
  );
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private clock = 0;
  private disposed = false;

  constructor(options: BlobNeuralTendrilsOptions) {
    this.random = makeSeededRandom(options.seed);
    const slotCount = Math.max(1, BlobConfig.visual.neuralSlotCount);
    const vertsPerSlot = this.rings * this.radialSegments;
    this.positions = new Float32Array(slotCount * vertsPerSlot * 3);
    this.colors = new Float32Array(slotCount * vertsPerSlot * 3);

    const geometry = new BufferGeometry();
    const positionAttribute = new BufferAttribute(this.positions, 3);
    positionAttribute.setUsage(DynamicDrawUsage);
    const colorAttribute = new BufferAttribute(this.colors, 3);
    colorAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute("position", positionAttribute);
    geometry.setAttribute("color", colorAttribute);
    geometry.setIndex(this.buildIndex(slotCount));

    const material = createBlobEnergyMaterial();
    material.side = DoubleSide;
    this.object = new Mesh(geometry, material);
    this.object.name = options.name;
    this.object.castShadow = false;
    this.object.receiveShadow = false;
    // Los extremos siguen cuerpos físicos: el bounding estático no sirve.
    this.object.frustumCulled = false;

    for (let index = 0; index < slotCount; index += 1) {
      const curvePoints: [Vector3, Vector3, Vector3, Vector3] = [
        new Vector3(),
        new Vector3(),
        new Vector3(),
        new Vector3(),
      ];
      this.slots.push({
        phase: "idle",
        remaining: this.randomIdleSeconds() * this.random(),
        duration: 1,
        targetId: null,
        targetPoint: new Vector3(),
        wavePhaseA: this.random() * Math.PI * 2,
        wavePhaseB: this.random() * Math.PI * 2,
        waveJitter: 1,
        brightness: 1,
        normalHint: new Vector3(0, 1, 0),
        curvePoints,
        curve: new CatmullRomCurve3(curvePoints),
      });
    }
  }

  attachTo(parent: Object3D): void {
    if (this.object.parent !== parent) parent.add(this.object);
  }

  /** Fires up to `count` idle slots almost immediately (damage reaction). */
  burst(count: number): void {
    if (this.disposed) return;
    let remaining = Math.max(0, Math.floor(count));
    for (const slot of this.slots) {
      if (remaining <= 0) break;
      if (slot.phase !== "idle") continue;
      slot.remaining = Math.min(slot.remaining, this.random() * 0.08);
      remaining -= 1;
    }
  }

  /** Cancels every active discharge (teleports, portals, freezes). */
  reset(): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      slot.phase = "idle";
      slot.remaining = this.randomIdleSeconds();
      slot.targetId = null;
    }
    this.colors.fill(0);
    this.object.geometry.getAttribute("color").needsUpdate = true;
  }

  update(
    elapsed: number,
    brain: Vector3,
    targets: readonly NeuralTendrilTarget[],
    life: number,
  ): void {
    if (this.disposed) return;
    this.object.visible = true;
    this.clock += elapsed;
    const vitality = Math.max(0, Math.min(1, life));
    let geometryDirty = false;

    for (let index = 0; index < this.slots.length; index += 1) {
      const slot = this.slots[index];
      slot.remaining -= elapsed;

      if (slot.phase === "idle") {
        if (slot.remaining <= 0 && vitality >= 1 && targets.length > 0) {
          this.fire(slot, brain, targets);
        }
        if (slot.phase === "idle") continue;
      } else if (vitality < 1 && slot.phase !== "fade") {
        // La muerte corta la actividad: lo encendido se apaga, nada nuevo.
        this.enterPhase(slot, "fade");
      }

      const target = slot.targetId !== null
        ? targets.find((candidate) => candidate.id === slot.targetId)
        : undefined;
      if (target) {
        slot.targetPoint.copy(target.position);
      } else if (slot.phase !== "fade") {
        // La esfera se desprendió o murió: descarga interrumpida.
        this.enterPhase(slot, "fade");
      }

      if (slot.remaining <= 0 && this.advancePhase(slot)) {
        this.wipeSlotColors(index);
        geometryDirty = true;
        continue;
      }

      this.writeSlotGeometry(index, slot, brain, vitality);
      geometryDirty = true;
    }

    if (geometryDirty) {
      this.object.geometry.getAttribute("position").needsUpdate = true;
      this.object.geometry.getAttribute("color").needsUpdate = true;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
  }

  private fire(
    slot: TendrilSlot,
    brain: Vector3,
    targets: readonly NeuralTendrilTarget[],
  ): void {
    const visual = BlobConfig.visual;
    const chosen = this.pickTarget(brain, targets);
    if (!chosen) {
      slot.remaining = 0.3;
      return;
    }
    slot.targetId = chosen.id;
    slot.targetPoint.copy(chosen.position);
    slot.wavePhaseA = this.random() * Math.PI * 2;
    slot.wavePhaseB = this.random() * Math.PI * 2;
    slot.waveJitter = 0.7 + this.random() * 0.6;
    slot.brightness = 1.05 + this.random() * 0.4;
    slot.phase = "travel";
    slot.duration = visual.neuralTravelSeconds * (0.8 + this.random() * 0.4);
    slot.remaining = slot.duration;
  }

  /** Prefers long arcs and spheres not already claimed by another slot. */
  private pickTarget(
    brain: Vector3,
    targets: readonly NeuralTendrilTarget[],
  ): NeuralTendrilTarget | null {
    let chosen: NeuralTendrilTarget | null = null;
    let chosenDistance = -1;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = targets[Math.floor(this.random() * targets.length)];
      if (!candidate) continue;
      const taken = this.slots.some(
        (other) => other.phase !== "idle" && other.targetId === candidate.id,
      );
      if (taken && chosen) continue;
      const distance = candidate.position.distanceToSquared(brain);
      if (!taken && distance > chosenDistance) {
        chosen = candidate;
        chosenDistance = distance;
      } else if (!chosen) {
        chosen = candidate;
        chosenDistance = distance;
      }
    }
    return chosen;
  }

  /** Returns true when the slot cycled back to idle. */
  private advancePhase(slot: TendrilSlot): boolean {
    if (slot.phase === "travel") {
      this.enterPhase(slot, "hold");
    } else if (slot.phase === "hold") {
      this.enterPhase(slot, "fade");
    } else if (slot.phase === "fade") {
      slot.phase = "idle";
      slot.targetId = null;
      slot.remaining = this.randomIdleSeconds();
      return true;
    }
    return false;
  }

  private enterPhase(slot: TendrilSlot, phase: "hold" | "fade"): void {
    const visual = BlobConfig.visual;
    slot.phase = phase;
    slot.duration =
      phase === "hold" ? visual.neuralHoldSeconds : visual.neuralFadeSeconds;
    slot.remaining = slot.duration;
  }

  private randomIdleSeconds(): number {
    const visual = BlobConfig.visual;
    return (
      visual.neuralIdleSecondsMin +
      this.random() *
        Math.max(0, visual.neuralIdleSecondsMax - visual.neuralIdleSecondsMin)
    );
  }

  private writeSlotGeometry(
    slotIndex: number,
    slot: TendrilSlot,
    brain: Vector3,
    vitality: number,
  ): void {
    const visual = BlobConfig.visual;
    scratchAxis.copy(slot.targetPoint).sub(brain);
    const span = scratchAxis.length();
    if (span <= 1e-4) {
      this.wipeSlotColors(slotIndex);
      return;
    }
    scratchAxis.multiplyScalar(1 / span);
    scratchU.crossVectors(
      scratchAxis,
      Math.abs(scratchAxis.y) < 0.9 ? UP : RIGHT,
    ).normalize();
    scratchV.crossVectors(scratchAxis, scratchU).normalize();

    const amplitude = span * visual.neuralWaveAmplitude * slot.waveJitter;
    const speed = visual.neuralWaveSpeed;
    const [a, m1, m2, b] = slot.curvePoints;
    // Arranca apenas adentro del cerebro y termina en el centro de la esfera.
    a.copy(brain).addScaledVector(scratchAxis, BlobConfig.core.radius * 0.55);
    b.copy(slot.targetPoint);
    m1.copy(brain)
      .addScaledVector(scratchAxis, span * 0.35)
      .addScaledVector(
        scratchU,
        Math.sin(this.clock * speed + slot.wavePhaseA) * amplitude * 0.9,
      )
      .addScaledVector(
        scratchV,
        Math.cos(this.clock * speed * 0.77 + slot.wavePhaseB) * amplitude * 0.5,
      );
    m2.copy(brain)
      .addScaledVector(scratchAxis, span * 0.7)
      .addScaledVector(
        scratchU,
        Math.sin(this.clock * speed * 0.9 + slot.wavePhaseB) * amplitude,
      )
      .addScaledVector(
        scratchV,
        Math.sin(this.clock * speed * 1.13 + slot.wavePhaseA) * amplitude * 0.6,
      );

    const rings = this.rings;
    const radialSegments = this.radialSegments;
    const baseVertex = slotIndex * rings * radialSegments;
    const progress = 1 - slot.remaining / Math.max(1e-4, slot.duration);
    scratchNormal.copy(slot.normalHint);

    for (let ring = 0; ring < rings; ring += 1) {
      const along = ring / (rings - 1);
      slot.curve.getPoint(along, scratchPoint);
      slot.curve.getTangent(along, scratchTangent);
      // Transporte paralelo del normal para que el tubo no se retuerza.
      scratchNormal
        .addScaledVector(
          scratchTangent,
          -scratchNormal.dot(scratchTangent),
        )
        .normalize();
      if (scratchNormal.lengthSq() < 0.5) {
        scratchNormal.copy(scratchU);
      }
      if (ring === 0) slot.normalHint.copy(scratchNormal);
      scratchBinormal.crossVectors(scratchTangent, scratchNormal).normalize();

      const radius = lerp(
        visual.neuralThickness,
        visual.neuralTipThickness,
        along,
      );
      const intensity = this.pulseIntensity(slot.phase, progress, along);
      const glow = 0.3 + 0.7 * (1 - along);
      sampleBlobVeinColor(scratchColor, glow).multiplyScalar(
        intensity * slot.brightness * vitality,
      );

      for (let segment = 0; segment < radialSegments; segment += 1) {
        const angle = (segment / radialSegments) * Math.PI * 2;
        const offset = (baseVertex + ring * radialSegments + segment) * 3;
        this.positions[offset] =
          scratchPoint.x +
          (scratchNormal.x * Math.cos(angle) +
            scratchBinormal.x * Math.sin(angle)) *
            radius;
        this.positions[offset + 1] =
          scratchPoint.y +
          (scratchNormal.y * Math.cos(angle) +
            scratchBinormal.y * Math.sin(angle)) *
            radius;
        this.positions[offset + 2] =
          scratchPoint.z +
          (scratchNormal.z * Math.cos(angle) +
            scratchBinormal.z * Math.sin(angle)) *
            radius;
        this.colors[offset] = scratchColor.r;
        this.colors[offset + 1] = scratchColor.g;
        this.colors[offset + 2] = scratchColor.b;
      }
    }
  }

  /**
   * Brightness along the filament. Travel: a hot head racing to the sphere
   * with an exponential tail. Hold: the whole line lit plus a synapse flash
   * on the sphere end. Fade: everything dims uniformly.
   */
  private pulseIntensity(
    phase: TendrilPhase,
    progress: number,
    along: number,
  ): number {
    const tail = BlobConfig.visual.neuralTailLength;
    if (phase === "travel") {
      const front = progress;
      if (along <= front) {
        return 1.35 * Math.exp(-(front - along) / Math.max(1e-3, tail));
      }
      const lead = (along - front) / 0.05;
      return 1.35 * Math.exp(-lead * lead);
    }
    if (phase === "hold") {
      const line = (1 - progress * 0.35) * (0.7 + 0.3 * (1 - along));
      const synapse = (1 - along) / 0.1;
      return line + Math.exp(-synapse) * 1.1 * (1 - progress);
    }
    if (phase === "fade") {
      return (1 - progress) * (0.55 + 0.3 * (1 - along));
    }
    return 0;
  }

  private wipeSlotColors(slotIndex: number): void {
    const vertsPerSlot = this.rings * this.radialSegments;
    this.colors.fill(
      0,
      slotIndex * vertsPerSlot * 3,
      (slotIndex + 1) * vertsPerSlot * 3,
    );
  }

  private buildIndex(slotCount: number): BufferAttribute {
    const rings = this.rings;
    const radialSegments = this.radialSegments;
    const triangles: number[] = [];
    for (let slot = 0; slot < slotCount; slot += 1) {
      const base = slot * rings * radialSegments;
      for (let ring = 0; ring < rings - 1; ring += 1) {
        for (let segment = 0; segment < radialSegments; segment += 1) {
          const current = base + ring * radialSegments + segment;
          const next =
            base + ring * radialSegments + ((segment + 1) % radialSegments);
          triangles.push(current, current + radialSegments, next);
          triangles.push(next, current + radialSegments, next + radialSegments);
        }
      }
    }
    return new BufferAttribute(new Uint16Array(triangles), 1);
  }
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}
