import RAPIER from "@dimforge/rapier3d-compat";
import {
  Color,
  Mesh,
  MeshPhysicalMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Group,
} from "three";
import type { Faction } from "@engine/ai/Faction";
import {
  DynamicBlobSurface,
  type DynamicBlobSample,
} from "@engine/blob/DynamicBlobSurface";
import type { NavigationService } from "@engine/ai/navigation/NavigationService";
import type { NavigationRequestQueue } from "@engine/ai/navigation/NavigationRequestQueue";
import {
  type PhysicsMetadata,
  type PhysicsWorld,
} from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import { CHARACTER_MEDIUM_COLLISION_GROUPS } from "@engine/physics/CollisionGroups";
import type { Damageable } from "@shared/types/lifecycle";
import type {
  AnimationFrame,
  NpcAnimator,
} from "@game/npc/animation/NpcAnimator";
import { BlobConfig } from "@game/config/blob.config";
import { BlobChunkNavigator } from "@game/npc/blob/BlobChunkNavigator";

// `released` conserva el mismo body físico. BlobChunkNavigator decide la ruta
// del racimo; este archivo mantiene cohesión, magnetismo y reintegración.
type BlobArmorPartState = "attached" | "yielding" | "released";

interface BlobArmorPart {
  index: number;
  layer: number;
  coreAnchorEligible: boolean;
  radius: number;
  mesh: Mesh<SphereGeometry, MeshPhysicalMaterial>;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  damageable: Damageable;
  joint: RAPIER.ImpulseJoint | null;
  state: BlobArmorPartState;
  anchorFrom: Vector3;
  anchorTo: Vector3;
  detachedElapsed: number;
  resistanceFramesRemaining: number;
  cohesionWaveId: number | null;
  reassemblyCooldownRemaining: number;
  yieldFinalized: boolean;
  hangingLoadFatigue: number;
}

interface BlobCohesionBond {
  partA: BlobArmorPart;
  partB: BlobArmorPart;
  restLength: number;
  joint: RAPIER.ImpulseJoint | null;
  mixedElapsed: number;
  resistanceFramesRemaining: number;
  tearArmed: boolean;
  snapArmed: boolean;
  loadFatigue: number;
  passiveProtectionRemaining: number;
  lastRelativeVelocity: Vector3;
}

interface ReassemblyCandidate {
  partA: BlobArmorPart;
  partB: BlobArmorPart;
  distance: number;
}

interface CoreDockCandidate {
  part: BlobArmorPart;
  anchor: Vector3;
  target: Vector3;
  distance: number;
}

interface ReleasedComponentGraph {
  componentByPart: Map<BlobArmorPart, number>;
  components: Map<number, BlobArmorPart[]>;
}

interface GelPlacement {
  anchor: Vector3;
  layer: number;
  coreAnchored: boolean;
}

interface GelLayerDefinition {
  count: number;
  radius: number;
  phase: number;
}

interface MainShapeSlot {
  target: Vector3;
  layer: number;
}

interface FeedingTarget {
  position: Vector3;
  radius: number;
  requestedCoverage: number;
}

type BlobDetachCause = "impact" | "cohesion" | "load" | "lifecycle";

export interface BlobArmorAnimatorOptions {
  id: string;
  faction: Faction;
  visualGroup: Group;
  coreBody: RAPIER.RigidBody;
  position: Vector3;
  physics: PhysicsWorld;
  owner: Damageable;
  navigation?: NavigationService;
  navigationRequests?: NavigationRequestQueue;
}

export interface BlobArmorDebugSnapshot {
  attachedCount: number;
  totalCount: number;
  coreJointCount: number;
  attachedIndices: number[];
  coreAnchoredIndices: number[];
  layers: number[];
  cohesionBondCount: number;
  cohesionPairs: Array<[number, number]>;
  anchors: Vector3[];
  bodyHandles: number[];
}

const ZERO_ANCHOR = { x: 0, y: 0, z: 0 } as const;
const ARMOR_COLOR = new Color(BlobConfig.visual.surfaceColor);
const ARMOR_ROUGHNESS = 0.18;
const ARMOR_METALNESS = 0;
const WITHER_COLOR = new Color(BlobConfig.armor.detachedWitherColor);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const BLOB_CHARACTER_CONTACT = {
  speedScale: BlobConfig.contact.characterSpeedScale,
  damping: BlobConfig.contact.characterDamping,
  landingImpactScale: BlobConfig.contact.landingImpactScale,
  passThrough: BlobConfig.contact.passThrough,
  fullImmersionCount: BlobConfig.contact.fullImmersionCount,
  verticalDamping: BlobConfig.contact.verticalDamping,
  pushAcceleration: BlobConfig.contact.pushAcceleration,
} as const;

/**
 * Physical shell for the Blob NPC. Hidden dynamic nodes drive one continuous
 * metaball skin. Core springs hold the shell; weaker neighbor springs let an
 * impacted part resist, tear nearby parts away, and leave physical droplets.
 */
export class BlobArmorAnimator implements NpcAnimator {
  private readonly geometry = new SphereGeometry(1, 18, 14);
  private readonly gelMaterial: MeshPhysicalMaterial;
  private readonly gelSurface: DynamicBlobSurface;
  private readonly gelSamples: DynamicBlobSample[] = [];
  private readonly gelCenter = new Vector3();
  private readonly materials = new Set<MeshPhysicalMaterial>();
  private readonly parts: BlobArmorPart[] = [];
  private nextPartIndex = 0;
  private readonly raycast: Raycast;
  private readonly chunkNavigator: BlobChunkNavigator | null;
  private cohesionBonds: BlobCohesionBond[] = [];
  private currentCohesionWaveId = 0;
  private impactWaveOpen = false;
  private meshesAttachedToScene = false;
  private reflowDelayRemaining = 0;
  private reflowElapsed = 0;
  private reflowActive = false;
  private shapeHealElapsed = 0;
  private mainShapeHealingRemaining = 0;
  private loadSheddingCooldownRemaining = 0;
  private loadFatigueGraceRemaining: number =
    BlobConfig.armor.cohesionLoadInitialGraceSeconds;
  private readonly previousHeldVelocities = new Map<number, Vector3>();
  private readonly maneuverAccelerationVector = new Vector3();
  private heldBodyManeuverAcceleration = 0;
  private mainBodyHeldThisFrame = false;
  private mainBodySupportedThisFrame = false;
  private mainShapeLoadScale = 1;
  private maneuverLoadFatigue = 0;
  private readonly passiveLoadShedIndices = new Set<number>();
  private fullySupportedElapsed = 0;
  private readonly mainShapeAssignments = new Map<number, Vector3>();
  private readonly fragmentShapeAssignments = new Map<
    string,
    Map<number, Vector3>
  >();
  private feedingTarget: FeedingTarget | null = null;
  private feedingCoverage = 0;
  private readonly feedingPartIndices = new Set<number>();
  private readonly feedingAssignments = new Map<number, Vector3>();
  private readonly feedingCoreAssignments = new Map<number, Vector3>();
  private mainLayerRadii: number[] = [...BlobConfig.armor.layerRadii];
  private mainOuterLayer = BlobConfig.armor.layerCounts.length - 1;
  private mainOuterRadius: number = BlobConfig.armor.outerRadius;
  private layerSurfaceSpacings = gelLayerSurfaceSpacings();
  private enabled = true;
  private dead = false;
  private disposed = false;

  constructor(private readonly options: BlobArmorAnimatorOptions) {
    const visual = BlobConfig.visual;
    this.gelMaterial = createGelMaterial();
    this.gelSurface = new DynamicBlobSurface(this.gelMaterial, {
      name: `${options.id}-gel-surface`,
      resolution: visual.surfaceResolution,
      domainSize: visual.surfaceDomainSize,
      maxPolyCount: visual.surfaceMaxPolyCount,
    });
    this.gelSurface.object.castShadow = false;
    this.gelSurface.object.receiveShadow = true;
    this.gelSurface.object.renderOrder = 1;
    this.raycast = new Raycast(options.physics);
    this.chunkNavigator =
      options.navigation && options.navigationRequests
        ? new BlobChunkNavigator({
            ownerId: options.id,
            navigation: options.navigation,
            requests: options.navigationRequests,
            physics: options.physics,
          })
        : null;
    this.buildArmor();
    this.rebuildMainShapeAssignments();
  }

  updateFromMotor(frame: AnimationFrame): void {
    if (this.disposed) return;
    this.ensureMeshesInScene();
    if (!this.enabled || this.dead) return;
    this.updateDetachment(frame.delta);
    this.updateReleasedLifetime(frame.delta);
    this.updateReassembly(frame.delta);
    this.updateChunkNavigation(frame.delta);
    this.updateReflow(frame.delta);
    this.updateShapeRelaxation(frame.delta);
    this.updateShapeHealing(frame.delta);
    this.syncGravityScales();
    this.closeImpactWave();
    if (frame.visible !== false) this.updateGelSurface();
  }

  updateStandalone(delta: number, opts: { dead?: boolean } = {}): void {
    if (this.disposed) return;
    this.ensureMeshesInScene();
    if (opts.dead && !this.dead) this.notifyDeath();
    if (this.dead) {
      this.updateReleasedLifetime(delta);
    } else if (this.enabled) {
      this.updateGelSurface();
    }
  }

  notifyDeath(): void {
    if (this.dead || this.disposed) return;
    this.dead = true;
    if (this.options.coreBody.isValid()) {
      this.options.coreBody.setGravityScale(1, true);
    }
    this.gelSurface.object.visible = false;
    this.releaseAll();
  }

  /**
   * Convierte biomasa digerida en nodos fisicos nuevos. Los indices nunca se
   * reciclan: rutas, metadata y firmas de racimos siguen siendo estables aunque
   * otros nodos se hayan marchitado antes. Cada esfera nace unida al perimetro
   * vivo y el shape field la redistribuye en una cascara uniforme.
   */
  addOrganicMass(nodeCount: number): number {
    if (
      !Number.isFinite(nodeCount) ||
      nodeCount <= 0 ||
      this.disposed ||
      this.dead ||
      !this.enabled ||
      !this.options.coreBody.isValid()
    ) {
      return 0;
    }
    const requested = Math.floor(nodeCount);
    let added = 0;
    for (let offset = 0; offset < requested; offset += 1) {
      const host = this.findGrowthHost(this.nextPartIndex);
      if (!host) break;
      const index = this.nextPartIndex;
      const radius = radiusForIndex(
        index,
        BlobConfig.armor.minRadius,
        BlobConfig.armor.maxRadius,
      );
      const direction = growthDirectionForIndex(index);
      const corePosition = vectorFromRapier(this.options.coreBody.translation());
      const hostPosition = vectorFromRapier(host.body.translation());
      const hostRadial = hostPosition.clone().sub(corePosition);
      if (hostRadial.lengthSq() <= 1e-8) hostRadial.copy(direction);
      hostRadial.normalize();
      const spawnDirection = hostRadial
        .clone()
        .multiplyScalar(2)
        .add(direction)
        .normalize();
      const spawnPosition = hostPosition.addScaledVector(
        spawnDirection,
        host.radius + radius + BlobConfig.armor.growthSpawnPadding,
      );
      const attachedCount = this.parts.filter(
        (part) => part.state === "attached" && part.body.isValid(),
      ).length;
      const layout = adaptiveGelLayers(attachedCount + 1);
      const layer = Math.max(0, layout.length - 1);
      const anchor = direction.multiplyScalar(
        layout[layer]?.radius ?? this.mainOuterRadius,
      );
      const part = this.createArmorPart(
        index,
        { anchor, layer, coreAnchored: false },
        spawnPosition,
      );
      this.nextPartIndex += 1;
      this.parts.push(part);
      if (this.meshesAttachedToScene) {
        this.options.visualGroup.parent?.add(part.mesh);
      }
      this.connectGrowthPart(part, host);
      added += 1;
    }
    if (added > 0) {
      this.fragmentShapeAssignments.clear();
      this.armMainShapeHealing();
      this.scheduleReflow();
    }
    return added;
  }

  /**
   * Redistribuye una porcion de las capas media/externa hacia una presa. La
   * posicion se refresca cada frame porque puede pertenecer a un NPC vivo o al
   * centro de masa de un ragdoll en movimiento.
   */
  setFeedingTarget(
    position: Vector3,
    radius: number,
    requestedCoverage01: number,
  ): void {
    if (this.disposed || this.dead || !this.enabled) return;
    const requestedCoverage = clamp(requestedCoverage01, 0, 1);
    if (!this.feedingTarget) {
      this.feedingTarget = {
        position: position.clone(),
        radius: Math.max(0.1, radius),
        requestedCoverage,
      };
    } else {
      this.feedingTarget.position.copy(position);
      this.feedingTarget.radius = Math.max(0.1, radius);
      this.feedingTarget.requestedCoverage = requestedCoverage;
    }
    // El estiramiento es deliberado, no fatiga ambiental: el cerebro controla
    // esos nodos mientras construye el puente y el abrazo.
    this.loadFatigueGraceRemaining = Math.max(
      this.loadFatigueGraceRemaining,
      0.25,
    );
  }

  clearFeedingTarget(): void {
    if (!this.feedingTarget && this.feedingPartIndices.size === 0) return;
    this.feedingTarget = null;
    this.feedingCoverage = 0;
    this.feedingPartIndices.clear();
    this.feedingAssignments.clear();
    this.feedingCoreAssignments.clear();
    if (!this.disposed && !this.dead && this.enabled) {
      // Los nodos prestados vuelven a ocupar slots uniformes y reconstruyen
      // sus crosslinks al entrar otra vez en alcance del cuerpo.
      this.armMainShapeHealing();
      this.scheduleReflow();
    }
  }

  getFeedingCoverage(): number {
    return this.feedingCoverage;
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    if (this.options.coreBody.isValid()) {
      this.options.coreBody.setGravityScale(1, true);
    }
    this.gelSurface.object.visible = false;
    this.releaseAll();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.chunkNavigator?.dispose();
    this.removeAllCohesionBonds();
    for (const part of this.parts) {
      this.removeCoreJoint(part);
    }
    for (const part of this.parts) {
      if (part.body.isValid()) {
        this.options.physics.removeBody(part.body);
      }
      part.mesh.removeFromParent();
    }
    this.parts.length = 0;
    this.mainShapeAssignments.clear();
    this.fragmentShapeAssignments.clear();
    this.feedingTarget = null;
    this.feedingCoverage = 0;
    this.feedingPartIndices.clear();
    this.feedingAssignments.clear();
    this.feedingCoreAssignments.clear();
    this.gelSamples.length = 0;
    this.gelSurface.dispose();
    this.gelMaterial.dispose();
    this.geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.materials.clear();
  }

  getDebugSnapshot(): BlobArmorDebugSnapshot {
    const activeBonds = this.cohesionBonds.filter(
      (bond) => bond.joint?.isValid(),
    );
    const highestIndex = this.parts.reduce(
      (highest, part) => Math.max(highest, part.index),
      -1,
    );
    const layers = Array.from({ length: highestIndex + 1 }, () => -1);
    for (const part of this.parts) layers[part.index] = part.layer;
    return {
      attachedCount: this.parts.filter((part) => part.state !== "released")
        .length,
      totalCount: this.parts.length,
      coreJointCount: this.parts.filter((part) => part.joint?.isValid()).length,
      attachedIndices: this.parts
        .filter((part) => part.state !== "released")
        .map((part) => part.index),
      coreAnchoredIndices: this.parts
        .filter((part) => part.joint?.isValid())
        .map((part) => part.index),
      layers,
      cohesionBondCount: activeBonds.length,
      cohesionPairs: activeBonds.map((bond) => [
        bond.partA.index,
        bond.partB.index,
      ]),
      anchors: this.parts
        .filter((part) => part.state === "attached" && part.joint?.isValid())
        .map((part) => vectorFromRapier(part.joint!.anchor1())),
      bodyHandles: this.parts.map((part) => part.body.handle),
    };
  }

  // Blob has no weapon, pose, or authored animation layers.
  setAiming(): void {}
  setActivity(): void {}
  notifyShot(): void {}
  notifyReload(): void {}
  notifyAttack(): void {}
  notifyHit(): void {}

  private buildArmor(): void {
    const config = BlobConfig.armor;
    const placements = gelPlacements(
      config.layerCounts,
      config.layerRadii,
      config.layerPhases,
    );
    if (
      placements.length !== config.count ||
      placements.filter((placement) => placement.coreAnchored).length !==
        config.coreAnchorCount
    ) {
      throw new Error("Blob gel layout: cantidad de nodos inconsistente");
    }

    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
      this.parts.push(
        this.createArmorPart(
          index,
          placement,
          this.options.position.clone().add(placement.anchor),
        ),
      );
      this.nextPartIndex = index + 1;
    }
    this.initializeCohesionGraph();
  }

  private createArmorPart(
    index: number,
    placement: GelPlacement,
    position: Vector3,
  ): BlobArmorPart {
    const config = BlobConfig.armor;
    const anchor = placement.anchor;
    const radius = radiusForIndex(index, config.minRadius, config.maxRadius);
    const material = createGelMaterial();
    this.materials.add(material);
    const mesh = new Mesh(this.geometry, material);
    mesh.name = `${this.options.id}-blob-${index}`;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.scale.setScalar(detachedVisualRadius(radius));
    mesh.position.copy(position);
    mesh.visible = false;

    let part!: BlobArmorPart;
    const damageable: Damageable = {
      applyDamage: (amount, hitDirection) => {
        if (
          amount <= 0 ||
          this.dead ||
          !this.enabled ||
          this.disposed ||
          !part.body.isValid() ||
          !this.options.owner.isAlive()
        ) {
          return;
        }
        if (part.state === "attached") {
          this.detach(part, hitDirection);
        } else {
          // Las armas aplican el impulso antes del daño. Leer la velocidad
          // aquí captura impactos posteriores sobre un racimo ya desprendido.
          this.resetReassemblyCooldownForComponent(part);
          this.armCohesionFromImpact(part, "fragment");
        }
      },
      // Un fragmento desprendido sigue siendo golpeable: su "vida" física
      // termina recién al destruir el NPC o remover este rigid body.
      isAlive: () =>
        this.enabled &&
        !this.dead &&
        !this.disposed &&
        part.body.isValid() &&
        this.options.owner.isAlive(),
    };
    const body = this.options.physics.createDynamicSphere(
      {
        id: `${this.options.id}-blob-${index}`,
        position: mesh.position.clone(),
        radius,
        mass: config.mass,
        metadata: this.attachedMetadata(index, damageable, radius),
      },
      mesh,
    );
    body.setLinearDamping(config.linearDamping);
    body.setAngularDamping(config.angularDamping);
    body.setGravityScale(config.attachedGravityScale, true);
    body.enableCcd(true);
    const collider = body.collider(0);
    collider.setCollisionGroups(CHARACTER_MEDIUM_COLLISION_GROUPS);
    collider.setFriction(BlobConfig.contact.friction);
    collider.setRestitution(BlobConfig.contact.restitution);
    const joint = placement.coreAnchored
      ? this.createCoreJoint(body, anchor)
      : null;

    part = {
      index,
      layer: placement.layer,
      coreAnchorEligible: placement.coreAnchored,
      radius,
      mesh,
      body,
      collider,
      damageable,
      joint,
      state: "attached",
      anchorFrom: anchor.clone(),
      anchorTo: anchor.clone(),
      detachedElapsed: 0,
      resistanceFramesRemaining: 0,
      cohesionWaveId: null,
      reassemblyCooldownRemaining: 0,
      yieldFinalized: false,
      hangingLoadFatigue: 0,
    };
    return part;
  }

  private initializeCohesionGraph(): void {
    const pairs = structuralNeighborPairs(
      this.parts,
      BlobConfig.armor.cohesionNeighborCount,
      BlobConfig.armor.cohesionLayerNeighborCount,
      BlobConfig.armor.cohesionAttachMaxDistance,
    );
    for (const [partA, partB] of pairs) {
      this.addCohesionBond(partA, partB);
    }
  }

  private findGrowthHost(index: number): BlobArmorPart | null {
    const corePosition = vectorFromRapier(this.options.coreBody.translation());
    const direction = growthDirectionForIndex(index);
    return (
      this.parts
        .filter((part) => part.state === "attached" && part.body.isValid())
        .map((part) => {
          const radial = vectorFromRapier(part.body.translation()).sub(
            corePosition,
          );
          const distance = radial.length();
          if (distance > 1e-5) radial.multiplyScalar(1 / distance);
          return {
            part,
            score:
              radial.dot(direction) +
              distance / Math.max(0.1, this.mainOuterRadius) * 0.08,
          };
        })
        .sort((a, b) => b.score - a.score || a.part.index - b.part.index)[0]
        ?.part ?? null
    );
  }

  private connectGrowthPart(
    part: BlobArmorPart,
    guaranteedHost: BlobArmorPart,
  ): void {
    const maxBonds = Math.max(
      1,
      Math.floor(BlobConfig.armor.growthInitialBondCount),
    );
    const candidates = this.parts
      .filter(
        (candidate) =>
          candidate !== part &&
          candidate.state === "attached" &&
          candidate.body.isValid(),
      )
      .map((candidate) => ({
        part: candidate,
        distance: rapierDistance(
          part.body.translation(),
          candidate.body.translation(),
        ),
      }))
      .filter(
        (candidate) =>
          candidate.part === guaranteedHost ||
          candidate.distance <= BlobConfig.armor.cohesionAttachMaxDistance,
      )
      .sort(
        (a, b) =>
          (a.part === guaranteedHost ? -1 : 0) -
            (b.part === guaranteedHost ? -1 : 0) ||
          a.distance - b.distance ||
          a.part.index - b.part.index,
      );
    let added = 0;
    for (const candidate of candidates) {
      if (added >= maxBonds) break;
      if (this.addCohesionBond(part, candidate.part, 1)) added += 1;
    }
  }

  private attachedMetadata(
    index: number,
    damageable: Damageable,
    radius = radiusForIndex(
      index,
      BlobConfig.armor.minRadius,
      BlobConfig.armor.maxRadius,
    ),
  ): PhysicsMetadata {
    const diameter = radius * 2;
    return {
      id: `${this.options.id}-blob-${index}`,
      ownerId: this.options.id,
      kind: "npc",
      damageable,
      characterId: "blob",
      faction: this.options.faction,
      selfPortalTraversal: true,
      bodyPart: {
        name: `blob-armor-${index}`,
        damageMultiplier: 1,
      },
      navigationObstacleSize: [diameter, diameter, diameter],
      characterContact: BLOB_CHARACTER_CONTACT,
    };
  }

  private createCoreJoint(
    body: RAPIER.RigidBody,
    anchor: Vector3,
  ): RAPIER.ImpulseJoint {
    const config = BlobConfig.armor;
    const joint = this.options.physics.world.createImpulseJoint(
      RAPIER.JointData.spring(
        config.springRestLength,
        config.springStiffness,
        config.springDamping,
        anchor,
        ZERO_ANCHOR,
      ),
      this.options.coreBody,
      body,
      true,
    );
    joint.setContactsEnabled(false);
    return joint;
  }

  private ensureMeshesInScene(): void {
    if (this.meshesAttachedToScene) return;
    const parent = this.options.visualGroup.parent;
    if (!parent) return;
    this.gelSurface.attachTo(parent);
    for (const part of this.parts) {
      parent.add(part.mesh);
    }
    this.meshesAttachedToScene = true;
  }

  private detach(
    part: BlobArmorPart,
    hitDirection?: Vector3,
    cause: BlobDetachCause = "impact",
    inheritedWaveId: number | null = null,
  ): void {
    if (part.state !== "attached" || this.disposed) return;
    part.state = "yielding";
    part.detachedElapsed = 0;
    part.yieldFinalized = false;
    part.reassemblyCooldownRemaining =
      cause === "lifecycle" ? 0 : BlobConfig.armor.reassemblyDelaySeconds;
    if (cause === "impact") {
      part.cohesionWaveId = this.currentCohesionWaveId;
      this.impactWaveOpen = true;
    } else if (cause === "cohesion") {
      part.cohesionWaveId = inheritedWaveId;
    } else {
      part.cohesionWaveId = null;
    }
    // El impacto ocurre antes de updateFromMotor y el solver corre después.
    // Saltar esa primera actualización garantiza al menos un paso físico con
    // el resorte al core, incluso si el frame que recibió el disparo fue largo.
    part.resistanceFramesRemaining = cause === "impact" ? 1 : 0;
    if (cause === "impact") {
      // Hitscan, melee y explosiones aplican su impulso antes de Damageable.
      // La proyección de esa velocidad decide qué enlaces cargó el impacto.
      this.armCohesionFromImpact(part, "direct");
    }

    if (
      cause === "cohesion" ||
      cause === "load" ||
      cause === "lifecycle"
    ) {
      // El umbral de tensión ya representa la rotura del anclaje: mantener el
      // resorte otra décima haría que el vecino arrancado vuelva al core.
      this.finalizeYield(part);
    }

    // El impulso físico original (bala, explosión, punt) ya vive en el body y
    // primero trabaja contra los resortes antes de que cedan. Este empujón
    // auxiliar es radial: así los daños sin fuerza propia (Ice Gun) abren el
    // hueco en vez de lanzar la esfera a través del cerebro.
    if (cause === "impact") {
      const corePosition = this.options.coreBody.translation();
      const partPosition = part.body.translation();
      const direction = new Vector3(
        partPosition.x - corePosition.x,
        partPosition.y - corePosition.y,
        partPosition.z - corePosition.z,
      );
      if (direction.lengthSq() < 1e-5) {
        direction.copy(part.anchorFrom);
      }
      if (direction.lengthSq() < 1e-5 && hitDirection) {
        direction.copy(hitDirection).negate();
      }
      if (direction.lengthSq() > 1e-5) {
        direction.normalize().multiplyScalar(BlobConfig.armor.detachImpulse);
        part.body.applyImpulse(direction, true);
      }
    }

    this.scheduleReflow();
  }

  private releaseAll(): void {
    this.chunkNavigator?.clear();
    for (const part of this.parts) {
      this.removeCoreJoint(part);
    }
    this.removeAllCohesionBonds();
    for (const part of this.parts) {
      this.markPartReleased(part, 0);
    }
    this.reflowDelayRemaining = 0;
    this.reflowElapsed = 0;
    this.reflowActive = false;
    this.shapeHealElapsed = 0;
    this.mainShapeHealingRemaining = 0;
    this.loadSheddingCooldownRemaining = 0;
    this.loadFatigueGraceRemaining = 0;
    this.heldBodyManeuverAcceleration = 0;
    this.mainBodyHeldThisFrame = false;
    this.mainBodySupportedThisFrame = false;
    this.mainShapeLoadScale = 1;
    this.maneuverLoadFatigue = 0;
    this.maneuverAccelerationVector.set(0, 0, 0);
    this.previousHeldVelocities.clear();
    this.passiveLoadShedIndices.clear();
    this.fullySupportedElapsed = 0;
    this.mainShapeAssignments.clear();
    this.fragmentShapeAssignments.clear();
    this.feedingTarget = null;
    this.feedingCoverage = 0;
    this.feedingPartIndices.clear();
    this.feedingAssignments.clear();
    this.feedingCoreAssignments.clear();
  }

  private removeCoreJoint(part: BlobArmorPart): void {
    const joint = part.joint;
    part.joint = null;
    if (joint?.isValid()) {
      this.options.physics.world.removeImpulseJoint(joint, true);
    }
  }

  private finalizeYield(part: BlobArmorPart): void {
    if (part.state !== "yielding" || part.yieldFinalized) return;
    this.removeCoreJoint(part);
    part.yieldFinalized = true;
  }

  private markPartReleased(
    part: BlobArmorPart,
    cooldown: number = BlobConfig.armor.reassemblyDelaySeconds,
  ): void {
    const firstRelease = part.state !== "released";
    this.removeCoreJoint(part);
    part.state = "released";
    part.mesh.visible = true;
    if (firstRelease) {
      part.detachedElapsed = 0;
      this.restorePartVitalityVisual(part);
    }
    part.yieldFinalized = true;
    part.hangingLoadFatigue = 0;
    part.reassemblyCooldownRemaining = Math.max(
      part.reassemblyCooldownRemaining,
      cooldown,
    );
    // Mientras el resorte al core sigue vivo conservamos metadata NPC. Si se
    // marcara como dynamic antes, PropImpactSystem podría usar la propia esfera
    // como proyectil contra el cerebro del Blob.
    this.options.physics.registerCollider(part.collider, {
      id: `${this.options.id}-chunk-${part.index}`,
      impactOwnerId: this.options.id,
      kind: "dynamic",
      damageable: part.damageable,
      characterContact: BLOB_CHARACTER_CONTACT,
    });
    if (this.options.physics.isHeldBody(part.body.handle)) {
      this.options.physics.setHeldRestoreGravityScale(part.body.handle, 1);
    } else {
      part.body.setGravityScale(1, true);
    }
  }

  private updateDetachment(delta: number): void {
    const elapsed = Number.isFinite(delta)
      ? Math.min(Math.max(0, delta), 1 / 20)
      : 0;
    const config = BlobConfig.armor;
    this.loadSheddingCooldownRemaining = Math.max(
      0,
      this.loadSheddingCooldownRemaining - elapsed,
    );
    this.loadFatigueGraceRemaining = Math.max(
      0,
      this.loadFatigueGraceRemaining - elapsed,
    );
    this.updateHeldBodyManeuverAcceleration(elapsed);

    for (const part of this.parts) {
      if (part.state === "attached") continue;
      part.reassemblyCooldownRemaining = Math.max(
        0,
        part.reassemblyCooldownRemaining - elapsed,
      );
      if (part.state === "released") continue;
      if (part.resistanceFramesRemaining > 0) {
        part.resistanceFramesRemaining -= 1;
        continue;
      }
      part.detachedElapsed += elapsed;
      if (
        part.state === "yielding" &&
        !part.yieldFinalized &&
        part.detachedElapsed >= config.detachResistanceSeconds
      ) {
        this.finalizeYield(part);
      }
    }

    this.updateEnvironmentalLoadFatigue(elapsed);
    this.updateManeuverLoadFatigue(elapsed);

    const cohesionTears = new Map<BlobArmorPart, number | null>();
    let passiveBreak: { bond: BlobCohesionBond; score: number } | null = null;
    for (const bond of this.cohesionBonds) {
      if (!bond.joint?.isValid()) {
        this.removeCohesionBond(bond);
        continue;
      }
      if (bond.passiveProtectionRemaining > 0) {
        bond.passiveProtectionRemaining = Math.max(
          0,
          bond.passiveProtectionRemaining - elapsed,
        );
        bond.loadFatigue = 0;
        bond.lastRelativeVelocity.copy(
          relativeVelocityVector(bond.partA, bond.partB),
        );
        continue;
      }
      if (bond.resistanceFramesRemaining > 0) {
        bond.resistanceFramesRemaining -= 1;
        bond.lastRelativeVelocity.copy(
          relativeVelocityVector(bond.partA, bond.partB),
        );
        continue;
      }
      const aAttached = bond.partA.state === "attached";
      const bAttached = bond.partB.state === "attached";
      const extension = cohesionBondExtension(bond);

      if (aAttached !== bAttached) {
        bond.loadFatigue = Math.max(
          0,
          bond.loadFatigue - config.cohesionLoadRecoveryPerSecond * elapsed,
        );
        bond.lastRelativeVelocity.copy(
          relativeVelocityVector(bond.partA, bond.partB),
        );
        bond.mixedElapsed += elapsed;
        if (bond.snapArmed) {
          this.removeCohesionBond(bond, true);
          continue;
        }
        if (
          bond.tearArmed &&
          bond.mixedElapsed >= config.cohesionTearDelaySeconds
        ) {
          const attached = aAttached ? bond.partA : bond.partB;
          const detached = aAttached ? bond.partB : bond.partA;
          cohesionTears.set(attached, detached.cohesionWaveId);
          continue;
        }
        if (bond.mixedElapsed >= config.cohesionShellFatigueSeconds) {
          this.removeCohesionBond(bond);
        }
        continue;
      }

      if (aAttached) {
        const score = this.updateCohesionLoadFatigue(
          bond,
          extension,
          elapsed,
        );
        if (
          score >= config.cohesionLoadFatigueSeconds &&
          (!passiveBreak || score > passiveBreak.score)
        ) {
          passiveBreak = { bond, score };
        }
        continue;
      }

      if (
        !aAttached &&
        (bond.snapArmed ||
          (bond.partA.state === "released" &&
            bond.partB.state === "released" &&
            extension >= config.cohesionFragmentBreakStretch))
      ) {
        this.removeCohesionBond(bond, true);
      } else {
        bond.lastRelativeVelocity.copy(
          relativeVelocityVector(bond.partA, bond.partB),
        );
      }
    }
    if (
      passiveBreak &&
      this.loadSheddingCooldownRemaining <= 0
    ) {
      const orphans = this.passiveCutOrphans(passiveBreak.bond);
      const attachedCount = this.parts.filter(
        (part) => part.state === "attached",
      ).length;
      const newOrphans = orphans.filter(
        (part) => !this.passiveLoadShedIndices.has(part.index),
      );
      // Cortar un enlace redundante (sin orphan) es el ceder gradual que
      // permite arrancar con suavidad un blob con varios vecinos. Cuando el
      // corte ya desprende masa, en cambio, toda la closure debe ser exterior.
      const onlyPeelsOuterShell =
        orphans.length === 0 ||
        orphans.every(
          (part) => part.layer === this.mainOuterLayer,
        );
      if (
        onlyPeelsOuterShell &&
        attachedCount > config.cohesionLoadMinimumAttachedCount &&
        this.passiveLoadShedIndices.size < config.cohesionLoadMaxChunkSize &&
        orphans.length <= config.cohesionLoadMaxChunkSize &&
        attachedCount - orphans.length >=
          config.cohesionLoadMinimumAttachedCount &&
        this.passiveLoadShedIndices.size + newOrphans.length <=
          config.cohesionLoadMaxChunkSize
      ) {
        for (const part of newOrphans) {
          this.passiveLoadShedIndices.add(part.index);
        }
        this.protectPassivePatchBonds(orphans);
        this.removeCohesionBond(passiveBreak.bond);
        this.loadSheddingCooldownRemaining = config.cohesionLoadBreakCooldown;
        this.fullySupportedElapsed = 0;
      } else {
        passiveBreak.bond.loadFatigue =
          config.cohesionLoadFatigueSeconds * 0.5;
      }
    }
    for (const [part, waveId] of cohesionTears) {
      this.detach(part, undefined, "cohesion", waveId);
    }
    this.cohesionBonds = this.cohesionBonds.filter(
      (bond) => bond.joint?.isValid(),
    );
    this.reconcileMainBodyConnectivity();
  }

  private updateReleasedLifetime(delta: number): void {
    const elapsed = finitePhysicsElapsed(delta);
    if (elapsed <= 0) return;
    const config = BlobConfig.armor;
    const lifetime = Math.max(0, config.detachedLifetimeSeconds);
    const witherDuration = Math.max(
      1e-4,
      Math.min(lifetime, config.detachedWitherSeconds),
    );
    const witherStart = Math.max(0, lifetime - witherDuration);
    const doomed: BlobArmorPart[] = [];

    for (const part of this.parts) {
      if (part.state !== "released") continue;
      if (!part.body.isValid()) {
        doomed.push(part);
        continue;
      }
      part.detachedElapsed += elapsed;
      const progress = clamp(
        (part.detachedElapsed - witherStart) / witherDuration,
        0,
        1,
      );
      if (progress > 0) this.applyPartWitherVisual(part, progress);
      if (part.detachedElapsed >= lifetime) doomed.push(part);
    }

    if (doomed.length > 0) this.removeWitheredParts(doomed);
  }

  private applyPartWitherVisual(
    part: BlobArmorPart,
    progress: number,
  ): void {
    const eased = progress * progress * (3 - 2 * progress);
    const minimumScale = BlobConfig.armor.detachedWitherMinimumScale;
    const visualScale = 1 - (1 - minimumScale) * eased;
    part.mesh.scale.setScalar(detachedVisualRadius(part.radius) * visualScale);
    part.mesh.material.color.lerpColors(ARMOR_COLOR, WITHER_COLOR, eased);
    part.mesh.material.roughness =
      ARMOR_ROUGHNESS +
      (BlobConfig.armor.detachedWitherRoughness - ARMOR_ROUGHNESS) * eased;
    part.mesh.material.metalness = ARMOR_METALNESS * (1 - eased);
  }

  private restorePartVitalityVisual(part: BlobArmorPart): void {
    part.mesh.scale.setScalar(detachedVisualRadius(part.radius));
    part.mesh.material.color.copy(ARMOR_COLOR);
    part.mesh.material.roughness = ARMOR_ROUGHNESS;
    part.mesh.material.metalness = ARMOR_METALNESS;
  }

  private removeWitheredParts(doomed: BlobArmorPart[]): void {
    const doomedSet = new Set(doomed);
    for (const bond of [...this.cohesionBonds]) {
      if (doomedSet.has(bond.partA) || doomedSet.has(bond.partB)) {
        this.removeCohesionBond(bond);
      }
    }
    this.cohesionBonds = this.cohesionBonds.filter(
      (bond) => bond.joint?.isValid(),
    );

    for (const part of doomed) {
      this.removeCoreJoint(part);
      this.previousHeldVelocities.delete(part.body.handle);
      this.passiveLoadShedIndices.delete(part.index);
      this.mainShapeAssignments.delete(part.index);
      part.mesh.removeFromParent();
      this.materials.delete(part.mesh.material);
      part.mesh.material.dispose();
      if (part.body.isValid()) this.options.physics.removeBody(part.body);
    }
    for (let index = this.parts.length - 1; index >= 0; index -= 1) {
      if (doomedSet.has(this.parts[index])) this.parts.splice(index, 1);
    }
    // Las firmas de los racimos incluyen sus indices. La siguiente pasada
    // reconstruye tanto su forma como su ruta desde los sobrevivientes.
    this.fragmentShapeAssignments.clear();
  }

  private updateHeldBodyManeuverAcceleration(elapsed: number): void {
    if (elapsed <= 0) {
      this.heldBodyManeuverAcceleration = 0;
      this.mainBodyHeldThisFrame = false;
      this.maneuverAccelerationVector.set(0, 0, 0);
      return;
    }
    const heldBodies: RAPIER.RigidBody[] = [];
    if (
      this.options.coreBody.isValid() &&
      this.options.physics.isHeldBody(this.options.coreBody.handle)
    ) {
      heldBodies.push(this.options.coreBody);
    }
    for (const part of this.parts) {
      if (
        part.state === "attached" &&
        part.body.isValid() &&
        this.options.physics.isHeldBody(part.body.handle)
      ) {
        heldBodies.push(part.body);
      }
    }
    this.mainBodyHeldThisFrame = heldBodies.length > 0;
    const activeHandles = new Set<number>();
    let strongest = new Vector3();
    for (const body of heldBodies) {
      activeHandles.add(body.handle);
      const velocity = vectorFromRapier(body.linvel());
      const previous = this.previousHeldVelocities.get(body.handle);
      if (previous) {
        const acceleration = velocity.clone().sub(previous).multiplyScalar(
          1 / elapsed,
        );
        if (acceleration.lengthSq() > strongest.lengthSq()) {
          strongest = acceleration;
        }
        previous.copy(velocity);
      } else {
        this.previousHeldVelocities.set(body.handle, velocity);
      }
    }
    for (const handle of this.previousHeldVelocities.keys()) {
      if (!activeHandles.has(handle)) {
        this.previousHeldVelocities.delete(handle);
      }
    }
    this.maneuverAccelerationVector.copy(strongest);
    this.heldBodyManeuverAcceleration = strongest.length();
  }

  private updateEnvironmentalLoadFatigue(elapsed: number): void {
    this.mainBodySupportedThisFrame = false;
    this.mainShapeLoadScale = 1;
    if (elapsed <= 0 || !this.options.coreBody.isValid()) return;
    const config = BlobConfig.armor;
    const attached = this.parts.filter(
      (part) => part.state === "attached" && part.body.isValid(),
    );
    const recover = (part: BlobArmorPart) => {
      part.hangingLoadFatigue = Math.max(
        0,
        part.hangingLoadFatigue -
          config.hangingLoadRecoveryPerSecond * elapsed,
      );
    };
    if (attached.length === 0 || this.loadFatigueGraceRemaining > 0) {
      this.fullySupportedElapsed = 0;
      for (const part of attached) recover(part);
      return;
    }

    const coreHeld = this.options.physics.isHeldBody(
      this.options.coreBody.handle,
    );
    const shellHeld = attached.some((part) =>
      this.options.physics.isHeldBody(part.body.handle),
    );
    const coreGroundSupported = this.hasExternalSupportBelow(
      this.options.coreBody,
      BlobConfig.core.radius + config.hangingLoadSupportProbe,
    );
    const shellGroundSupported = attached.some((part) =>
      this.hasExternalSupportBelow(
        part.body,
        partRadius(part) + config.hangingLoadSupportProbe,
      ),
    );
    const externallyConstrained =
      coreHeld || shellHeld || !this.options.coreBody.isDynamic();
    const suspended =
      externallyConstrained &&
      !coreGroundSupported &&
      !shellGroundSupported;
    this.mainBodySupportedThisFrame =
      externallyConstrained || coreGroundSupported || shellGroundSupported;
    if (!this.mainBodySupportedThisFrame) {
      this.fullySupportedElapsed = 0;
      for (const part of attached) recover(part);
      return;
    }

    const corePosition = vectorFromRapier(this.options.coreBody.translation());
    const worldGravity = this.options.physics.world.gravity;
    const gravityStrength =
      (Math.hypot(worldGravity.x, worldGravity.y, worldGravity.z) / 20.5) *
      config.attachedGravityScale;
    const hanging = new Set<BlobArmorPart>();
    let candidate: BlobArmorPart | null = null;
    for (const part of attached) {
      if (
        part.layer < this.mainOuterLayer ||
        this.passiveLoadShedIndices.has(part.index)
      ) {
        recover(part);
        continue;
      }
      if (
        !suspended &&
        this.hasExternalSupportBelow(
          part.body,
          config.hangingLoadGroundProbeDepth,
        )
      ) {
        recover(part);
        continue;
      }
      hanging.add(part);

      const position = vectorFromRapier(part.body.translation());
      const radialDistance = position.distanceTo(corePosition);
      const distanceFactor = clamp(
        (radialDistance / this.mainOuterRadius - 0.55) / 0.45,
        0,
        1.8,
      );
      const downwardFactor = clamp(
        0.45 + (corePosition.y - position.y) / this.mainOuterRadius,
        0.25,
        1.5,
      );
      part.hangingLoadFatigue +=
        (elapsed *
          config.hangingLoadRate *
          gravityStrength *
          distanceFactor *
          downwardFactor) /
        passivePartToughness(part.index);
      if (
        part.hangingLoadFatigue >= config.hangingLoadFatigueSeconds &&
        (!candidate ||
          part.hangingLoadFatigue > candidate.hangingLoadFatigue)
      ) {
        candidate = part;
      }
    }
    if (suspended || hanging.size > 0) {
      this.mainShapeLoadScale = config.mainShapeLoadedScale;
    }

    if (hanging.size === 0 && !this.mainBodyHeldThisFrame) {
      this.fullySupportedElapsed += elapsed;
      if (this.fullySupportedElapsed >= 2) {
        this.passiveLoadShedIndices.clear();
      }
    } else {
      this.fullySupportedElapsed = 0;
    }

    const minimumCoverCapacity =
      attached.length - config.cohesionLoadMinimumAttachedCount;
    if (
      candidate &&
      minimumCoverCapacity > 0 &&
      this.passiveLoadShedIndices.size < config.cohesionLoadMaxChunkSize &&
      this.loadSheddingCooldownRemaining <= 0
    ) {
      const patch = [candidate];
      const desiredPatchSize = Math.min(
        passivePatchSize(candidate.index, config.hangingLoadMaxPatchSize),
        minimumCoverCapacity,
        config.cohesionLoadMaxChunkSize - this.passiveLoadShedIndices.size,
      );
      const neighbors = this.cohesionBonds
        .filter(
          (bond) =>
            bond.joint?.isValid() &&
            (bond.partA === candidate || bond.partB === candidate),
        )
        .map((bond) =>
          bond.partA === candidate ? bond.partB : bond.partA,
        )
        .filter(
          (part) =>
            hanging.has(part) &&
            part.hangingLoadFatigue >=
              config.hangingLoadFatigueSeconds * 0.6,
        )
        .sort(
          (a, b) =>
            b.hangingLoadFatigue - a.hangingLoadFatigue ||
            a.index - b.index,
        );
      for (const neighbor of neighbors) {
        if (
          patch.length >= desiredPatchSize ||
          this.passiveLoadShedIndices.size + patch.length >=
            config.cohesionLoadMaxChunkSize
        ) {
          break;
        }
        patch.push(neighbor);
      }
      const detachablePatch = this.resolvePassivePatch(patch);
      if (!detachablePatch) {
        candidate.hangingLoadFatigue =
          config.hangingLoadFatigueSeconds * 0.5;
        return;
      }
      this.protectPassivePatchBonds(detachablePatch);
      for (const part of detachablePatch) {
        part.hangingLoadFatigue = 0;
        this.passiveLoadShedIndices.add(part.index);
        this.detach(part, undefined, "load");
      }
      this.loadSheddingCooldownRemaining = config.cohesionLoadBreakCooldown;
    }
  }

  private updateManeuverLoadFatigue(elapsed: number): void {
    const config = BlobConfig.armor;
    const load = Math.max(
      0,
      this.heldBodyManeuverAcceleration /
        config.cohesionHeldBodyAcceleration -
        1,
    );
    if (
      !this.mainBodyHeldThisFrame ||
      this.loadFatigueGraceRemaining > 0 ||
      load <= 0
    ) {
      this.maneuverLoadFatigue = Math.max(
        0,
        this.maneuverLoadFatigue -
          config.cohesionManeuverRecoveryPerSecond * elapsed,
      );
      return;
    }
    this.maneuverLoadFatigue += elapsed * load;
    const attachedCount = this.parts.filter(
      (part) => part.state === "attached",
    ).length;
    const patchCapacity = Math.min(
      attachedCount - config.cohesionLoadMinimumAttachedCount,
      config.cohesionLoadMaxChunkSize - this.passiveLoadShedIndices.size,
    );
    if (
      this.maneuverLoadFatigue < config.cohesionManeuverFatigueSeconds ||
      this.loadSheddingCooldownRemaining > 0 ||
      patchCapacity < 2
    ) {
      return;
    }

    const corePosition = vectorFromRapier(this.options.coreBody.translation());
    const trailing = this.maneuverAccelerationVector.clone().negate();
    if (trailing.lengthSq() <= 1e-8) return;
    trailing.normalize();
    const candidates = this.parts
      .filter(
        (part) =>
          part.state === "attached" &&
          part.body.isValid() &&
          part.layer === this.mainOuterLayer &&
          !this.passiveLoadShedIndices.has(part.index),
      )
      .map((part) => {
        const radial = vectorFromRapier(part.body.translation()).sub(
          corePosition,
        );
        const distance = radial.length();
        if (distance > 1e-5) radial.multiplyScalar(1 / distance);
        return {
          part,
          score:
            radial.dot(trailing) +
            (distance / this.mainOuterRadius) * 0.12 +
            (this.options.physics.isHeldBody(part.body.handle) ? 2 : 0) -
            passivePartToughness(part.index) * 0.04,
        };
      })
      .sort((a, b) => b.score - a.score || a.part.index - b.part.index);
    const seed = candidates[0]?.part;
    if (!seed) return;

    const desiredPatchSize = Math.max(
      2,
      Math.min(
        passivePatchSize(seed.index, config.hangingLoadMaxPatchSize),
        patchCapacity,
      ),
    );
    const patch = [seed];
    const patchSet = new Set(patch);
    while (
      patch.length < desiredPatchSize &&
      this.passiveLoadShedIndices.size + patch.length <
        config.cohesionLoadMaxChunkSize
    ) {
      const next = this.cohesionBonds
        .filter(
          (bond) =>
            bond.joint?.isValid() &&
            ((patchSet.has(bond.partA) && !patchSet.has(bond.partB)) ||
              (patchSet.has(bond.partB) && !patchSet.has(bond.partA))),
        )
        .map((bond) =>
          patchSet.has(bond.partA) ? bond.partB : bond.partA,
        )
        .filter(
          (part) =>
            part.state === "attached" &&
            part.layer === this.mainOuterLayer &&
            !this.passiveLoadShedIndices.has(part.index),
        )
        .sort((a, b) => {
          const scoreA =
            candidates.find(({ part }) => part === a)?.score ??
            Number.NEGATIVE_INFINITY;
          const scoreB =
            candidates.find(({ part }) => part === b)?.score ??
            Number.NEGATIVE_INFINITY;
          return scoreB - scoreA || a.index - b.index;
        })[0];
      if (!next) break;
      patch.push(next);
      patchSet.add(next);
    }

    const detachablePatch = this.resolvePassivePatch(patch);
    if (!detachablePatch) {
      this.maneuverLoadFatigue = config.cohesionManeuverFatigueSeconds * 0.5;
      return;
    }
    this.protectPassivePatchBonds(detachablePatch);
    for (const part of detachablePatch) {
      this.passiveLoadShedIndices.add(part.index);
      this.detach(part, undefined, "load");
    }
    this.maneuverLoadFatigue = 0;
    this.loadSheddingCooldownRemaining = config.cohesionLoadBreakCooldown;
    this.fullySupportedElapsed = 0;
  }

  private hasExternalSupportBelow(
    body: RAPIER.RigidBody,
    maxDistance: number,
  ): boolean {
    if (!body.isValid() || maxDistance <= 0) return false;
    const origin = vectorFromRapier(body.translation());
    const hit = this.raycast.cast(
      origin,
      new Vector3(0, -1, 0),
      maxDistance,
      body,
      this.options.id,
      (metadata) =>
        metadata?.impactOwnerId !== this.options.id &&
        (metadata?.kind === "static" ||
          metadata?.kind === "door" ||
          metadata?.kind === "dynamic"),
    );
    return hit !== null && (hit.normal?.y ?? 0) > 0.35;
  }

  private updateCohesionLoadFatigue(
    bond: BlobCohesionBond,
    extension: number,
    elapsed: number,
  ): number {
    if (elapsed <= 0) return bond.loadFatigue;
    const config = BlobConfig.armor;
    const relativeVelocity = relativeVelocityVector(bond.partA, bond.partB);
    const relativeAcceleration = relativeVelocity
      .clone()
      .sub(bond.lastRelativeVelocity)
      .length() / elapsed;
    bond.lastRelativeVelocity.copy(relativeVelocity);
    if (
      this.loadFatigueGraceRemaining > 0 ||
      (!this.mainBodySupportedThisFrame && !this.mainBodyHeldThisFrame) ||
      Math.max(bond.partA.layer, bond.partB.layer) <
        this.mainOuterLayer
    ) {
      bond.loadFatigue = Math.max(
        0,
        bond.loadFatigue - config.cohesionLoadRecoveryPerSecond * elapsed,
      );
      return bond.loadFatigue;
    }

    const positionA = vectorFromRapier(bond.partA.body.translation());
    const positionB = vectorFromRapier(bond.partB.body.translation());
    const axis = positionB.clone().sub(positionA);
    const distance = axis.length();
    const separatingSpeed =
      distance > 1e-5
        ? Math.max(0, relativeVelocity.dot(axis.multiplyScalar(1 / distance)))
        : relativeVelocity.length();
    const rawLoad = Math.max(
      Math.max(0, extension) /
        (this.mainBodyHeldThisFrame
          ? config.cohesionHeldStretchStart
          : config.cohesionLoadStretchStart),
      this.mainBodyHeldThisFrame
        ? 0
        : separatingSpeed / config.cohesionLoadSeparationSpeed,
      this.mainBodyHeldThisFrame
        ? 0
        : (relativeAcceleration / config.cohesionLoadRelativeAcceleration) *
          0.55,
    );

    const corePosition = vectorFromRapier(this.options.coreBody.translation());
    const radialFactor =
      Math.max(
        positionA.distanceTo(corePosition),
        positionB.distanceTo(corePosition),
      ) / this.mainOuterRadius;
    const leverage = clamp(
      0.72 + Math.max(0, radialFactor - 0.65) * 0.72,
      0.72,
      1.65,
    );
    const toughness = passiveBondToughness(bond.partA.index, bond.partB.index);
    const effectiveLoad = (rawLoad * leverage) / toughness;

    if (effectiveLoad > 1) {
      bond.loadFatigue += elapsed * effectiveLoad;
    } else {
      bond.loadFatigue = Math.max(
        0,
        bond.loadFatigue - config.cohesionLoadRecoveryPerSecond * elapsed,
      );
    }
    return bond.loadFatigue;
  }

  private passiveCutOrphans(ignored: BlobCohesionBond): BlobArmorPart[] {
    const attached = this.parts.filter((part) => part.state === "attached");
    const reachable = new Set<BlobArmorPart>();
    const pending = attached.filter((part) => part.joint?.isValid());
    while (pending.length > 0) {
      const part = pending.pop()!;
      if (reachable.has(part)) continue;
      reachable.add(part);
      for (const bond of this.cohesionBonds) {
        if (bond === ignored || !bond.joint?.isValid()) continue;
        if (bond.partA === part && bond.partB.state === "attached") {
          pending.push(bond.partB);
        } else if (bond.partB === part && bond.partA.state === "attached") {
          pending.push(bond.partA);
        }
      }
    }
    return attached.filter((part) => !reachable.has(part));
  }

  private resolvePassivePatch(
    requested: BlobArmorPart[],
  ): BlobArmorPart[] | null {
    const config = BlobConfig.armor;
    const selected = [...new Set(requested)].filter(
      (part) => part.state === "attached" && part.body.isValid(),
    );
    if (selected.length === 0) return null;

    const excluded = new Set(selected);
    const attached = this.parts.filter(
      (part) => part.state === "attached" && part.body.isValid(),
    );
    const reachable = new Set<BlobArmorPart>();
    const pending = attached.filter(
      (part) => !excluded.has(part) && part.joint?.isValid(),
    );
    while (pending.length > 0) {
      const part = pending.pop()!;
      if (reachable.has(part) || excluded.has(part)) continue;
      reachable.add(part);
      for (const bond of this.cohesionBonds) {
        if (!bond.joint?.isValid()) continue;
        if (
          bond.partA === part &&
          bond.partB.state === "attached" &&
          !excluded.has(bond.partB)
        ) {
          pending.push(bond.partB);
        } else if (
          bond.partB === part &&
          bond.partA.state === "attached" &&
          !excluded.has(bond.partA)
        ) {
          pending.push(bond.partA);
        }
      }
    }

    const closure = [
      ...selected,
      ...attached.filter(
        (part) => !excluded.has(part) && !reachable.has(part),
      ),
    ];
    const newMembers = closure.filter(
      (part) => !this.passiveLoadShedIndices.has(part.index),
    );
    if (
      closure.some(
        (part) => part.layer < this.mainOuterLayer,
      ) ||
      attached.length - closure.length <
        config.cohesionLoadMinimumAttachedCount ||
      this.passiveLoadShedIndices.size + newMembers.length >
        config.cohesionLoadMaxChunkSize
    ) {
      return null;
    }
    return closure;
  }

  private protectPassivePatchBonds(patch: BlobArmorPart[]): void {
    if (patch.length < 2) return;
    const members = new Set(patch);
    for (const bond of this.cohesionBonds) {
      if (
        !bond.joint?.isValid() ||
        !members.has(bond.partA) ||
        !members.has(bond.partB)
      ) {
        continue;
      }
      bond.mixedElapsed = 0;
      bond.tearArmed = false;
      bond.snapArmed = false;
      bond.loadFatigue = 0;
      bond.passiveProtectionRemaining = Math.max(
        bond.passiveProtectionRemaining,
        BlobConfig.armor.cohesionLoadPatchProtectionSeconds,
      );
      bond.lastRelativeVelocity.copy(
        relativeVelocityVector(bond.partA, bond.partB),
      );
    }
  }

  private reconcileMainBodyConnectivity(): void {
    const reachable = new Set<BlobArmorPart>();
    const pending = this.parts.filter(
      (part) => part.state !== "released" && part.joint?.isValid(),
    );
    while (pending.length > 0) {
      const part = pending.pop()!;
      if (reachable.has(part) || part.state === "released") continue;
      reachable.add(part);
      for (const bond of this.cohesionBonds) {
        if (!bond.joint?.isValid()) continue;
        if (bond.partA === part && bond.partB.state !== "released") {
          pending.push(bond.partB);
        } else if (bond.partB === part && bond.partA.state !== "released") {
          pending.push(bond.partA);
        }
      }
    }

    const orphaned = this.parts.filter(
      (part) =>
        part.state !== "released" &&
        !reachable.has(part) &&
        !this.feedingPartIndices.has(part.index),
    );
    if (orphaned.length === 0) return;
    for (const part of orphaned) {
      this.markPartReleased(part);
    }
    this.armMainShapeHealing(false);
    this.scheduleReflow();
  }

  private updateReassembly(delta: number): void {
    const elapsed = Number.isFinite(delta)
      ? Math.min(Math.max(0, delta), 1 / 20)
      : 0;
    if (elapsed <= 0 || !this.options.coreBody.isValid()) return;

    const graph = releasedComponentGraph(this.parts, this.cohesionBonds);
    const readyComponents = [...graph.components.entries()].filter(([, parts]) =>
      parts.every((part) => part.reassemblyCooldownRemaining <= 0),
    );
    const mainParts = this.parts.filter((part) => part.state === "attached");
    const queuedBodyImpulses = new Map<BlobArmorPart, Vector3>();
    let reattached = false;

    for (const [, component] of readyComponents) {
      const bodyCandidate = closestBodyDockCandidate(
        component,
        mainParts,
        BlobConfig.armor.reassemblyAttractionRadius,
        (part, target) => this.hasClearWorldPath(part, target),
      );
      const coreCandidate = closestCoreDockCandidate(
        component,
        this.options.coreBody,
        (part, target) => this.hasClearWorldPath(part, target),
      );
      const bodyApproach = bodyCandidate
        ? Math.max(
            0,
            bodyCandidate.distance -
              partRadius(bodyCandidate.partA) -
              partRadius(bodyCandidate.partB),
          )
        : Number.POSITIVE_INFINITY;
      const coreApproach = coreCandidate?.distance ?? Number.POSITIVE_INFINITY;

      // Si un nodo interno ya llegó a la cubierta del cerebro, recupera su
      // root antes de considerar un bridge lateral. Así el gel no erosiona sus
      // pocos anclajes al core después de ciclos repetidos de desprendimiento.
      if (
        coreCandidate &&
        coreCandidate.distance <=
          BlobConfig.armor.reassemblyCoreCaptureDistance
      ) {
        this.attachComponentToCore(
          component,
          coreCandidate.part,
          coreCandidate.anchor,
          mainParts,
        );
        mainParts.push(...component);
        reattached = true;
        continue;
      }

      if (bodyCandidate && bodyApproach <= coreApproach) {
        const captureDistance =
          partRadius(bodyCandidate.partA) +
          partRadius(bodyCandidate.partB) +
          BlobConfig.armor.reassemblyJoinPadding;
        if (bodyCandidate.distance <= captureDistance) {
          this.attachComponentToBody(
            component,
            bodyCandidate.partA,
            bodyCandidate.partB,
            mainParts,
          );
          mainParts.push(...component);
          reattached = true;
        } else {
          this.queuePartAttraction(
            bodyCandidate.partA,
            bodyCandidate.partB,
            bodyCandidate.distance,
            elapsed,
            queuedBodyImpulses,
          );
        }
        continue;
      }

      if (coreCandidate) {
        this.attractPartToCore(
          coreCandidate.part,
          coreCandidate.target,
          elapsed,
        );
      }
    }
    this.applyQueuedAttraction(queuedBodyImpulses, elapsed);

    const recoveredCoreAnchors = this.recoverNearbyCoreAnchors();
    if (reattached || recoveredCoreAnchors) this.scheduleReflow();
    this.updateFragmentReassembly(elapsed);
  }

  private updateChunkNavigation(delta: number): void {
    if (!this.chunkNavigator || !this.options.coreBody.isValid()) return;
    const elapsed = finitePhysicsElapsed(delta);
    if (elapsed <= 0) return;
    const mainParts = this.parts.filter(
      (part) => part.state === "attached" && part.body.isValid(),
    );
    const components = [
      ...releasedComponentGraph(
        this.parts,
        this.cohesionBonds,
      ).components.values(),
    ]
      .filter((component) =>
        component.every(
          (part) =>
            part.body.isValid() &&
            part.reassemblyCooldownRemaining <= 0,
        ),
      )
      // Dentro del rango de acople, updateReassembly ya aplicó el impulso de
      // gel. El follower se retira para no sumar dos locomociones distintas.
      .filter(
        (component) =>
          closestBodyDockCandidate(
            component,
            mainParts,
            BlobConfig.armor.reassemblyAttractionRadius,
            (part, target) => this.hasClearWorldPath(part, target),
          ) === null &&
          closestCoreDockCandidate(
            component,
            this.options.coreBody,
            (part, target) => this.hasClearWorldPath(part, target),
          ) === null,
      )
      .map((component) =>
        component.map((part) => ({
          index: part.index,
          body: part.body,
          supported: this.hasExternalSupportBelow(
            part.body,
            partRadius(part) +
              BlobConfig.armor.chunkNavigationSupportProbe,
          ),
        })),
      );
    this.chunkNavigator.update(
      elapsed,
      components,
      vectorFromRapier(this.options.coreBody.translation()),
    );
  }

  private updateFragmentReassembly(elapsed: number): void {
    const config = BlobConfig.armor;
    const graph = releasedComponentGraph(this.parts, this.cohesionBonds);
    const readyComponents = new Set(
      [...graph.components.entries()]
        .filter(([, parts]) =>
          parts.every((part) => part.reassemblyCooldownRemaining <= 0),
        )
        .map(([id]) => id),
    );
    const candidates = new Map<string, ReassemblyCandidate>();
    const released = this.parts.filter(
      (part) =>
        part.state === "released" &&
        part.body.isValid() &&
        readyComponents.has(graph.componentByPart.get(part) ?? -1),
    );

    for (let from = 0; from < released.length; from += 1) {
      for (let to = from + 1; to < released.length; to += 1) {
        const partA = released[from];
        const partB = released[to];
        const componentA = graph.componentByPart.get(partA);
        const componentB = graph.componentByPart.get(partB);
        if (
          componentA === undefined ||
          componentB === undefined ||
          componentA === componentB
        ) {
          continue;
        }
        const distance = rapierDistance(
          partA.body.translation(),
          partB.body.translation(),
        );
        if (
          distance > config.reassemblyAttractionRadius ||
          !this.hasClearWorldPath(
            partA,
            vectorFromRapier(partB.body.translation()),
          )
        ) {
          continue;
        }
        const key = `${Math.min(componentA, componentB)}:${Math.max(componentA, componentB)}`;
        const previous = candidates.get(key);
        if (
          !previous ||
          distance < previous.distance ||
          (distance === previous.distance &&
            cohesionPairKey(partA, partB) <
              cohesionPairKey(previous.partA, previous.partB))
        ) {
          candidates.set(key, { partA, partB, distance });
        }
      }
    }

    const componentSets = new NumericDisjointSet(graph.components.keys());
    const sorted = [...candidates.values()].sort(
      (a, b) =>
        a.distance - b.distance ||
        cohesionPairKey(a.partA, a.partB).localeCompare(
          cohesionPairKey(b.partA, b.partB),
      ),
    );
    const selected: ReassemblyCandidate[] = [];
    const queuedImpulses = new Map<BlobArmorPart, Vector3>();
    for (const candidate of sorted) {
      const componentA = graph.componentByPart.get(candidate.partA)!;
      const componentB = graph.componentByPart.get(candidate.partB)!;
      const rootA = componentSets.find(componentA);
      const rootB = componentSets.find(componentB);
      if (rootA === rootB) continue;

      // Kruskal sobre los componentes cercanos: el bosque conserva puentes
      // como A-B-C-D mientras cada pareja se compacta. Un matching de una sola
      // pareja por componente podía cortar la cadena en dos mini-racimos.
      componentSets.union(componentA, componentB);
      selected.push(candidate);
      this.queuePartAttraction(
        candidate.partA,
        candidate.partB,
        candidate.distance,
        elapsed,
        queuedImpulses,
      );
    }
    this.applyQueuedAttraction(queuedImpulses, elapsed);

    for (const candidate of selected) {
      const joinDistance =
        partRadius(candidate.partA) +
        partRadius(candidate.partB) +
        config.reassemblyJoinPadding;
      if (
        candidate.distance > joinDistance ||
        relativeSpeed(candidate.partA, candidate.partB) >
          config.reassemblyJoinMaxRelativeSpeed
      ) {
        continue;
      }

      const bond: BlobCohesionBond = {
        partA: candidate.partA,
        partB: candidate.partB,
        restLength: candidate.distance,
        joint: null,
        mixedElapsed: 0,
        resistanceFramesRemaining: 1,
        tearArmed: false,
        snapArmed: false,
        loadFatigue: 0,
        passiveProtectionRemaining: 0,
        lastRelativeVelocity: relativeVelocityVector(
          candidate.partA,
          candidate.partB,
        ),
      };
      this.createCohesionBond(bond);
      this.cohesionBonds.push(bond);
    }
  }

  private queuePartAttraction(
    partA: BlobArmorPart,
    partB: BlobArmorPart,
    distance: number,
    elapsed: number,
    queuedImpulses: Map<BlobArmorPart, Vector3>,
  ): void {
    if (distance <= 1e-4) return;
    const config = BlobConfig.armor;
    const from = vectorFromRapier(partA.body.translation());
    const direction = vectorFromRapier(partB.body.translation())
      .sub(from)
      .multiplyScalar(1 / distance);
    const velocityA = vectorFromRapier(partA.body.linvel());
    const velocityB = vectorFromRapier(partB.body.linvel());
    const closingSpeed = velocityA.sub(velocityB).dot(direction);
    const proximity = Math.max(
      0,
      1 - distance / config.reassemblyAttractionRadius,
    );
    const desiredClosingSpeed =
      config.reassemblyMaxSpeed * (0.2 + proximity * 0.8);
    const relativeDelta = clamp(
      desiredClosingSpeed - closingSpeed,
      -config.reassemblyAttractionAcceleration * elapsed,
      config.reassemblyAttractionAcceleration * elapsed,
    );
    const inverseMass =
      1 / Math.max(1e-4, partA.body.mass()) +
      1 / Math.max(1e-4, partB.body.mass());
    const impulse = direction.multiplyScalar(relativeDelta / inverseMass);
    queueImpulse(queuedImpulses, partA, impulse);
    queueImpulse(queuedImpulses, partB, impulse.clone().negate());
  }

  private applyQueuedAttraction(
    queuedImpulses: Map<BlobArmorPart, Vector3>,
    elapsed: number,
  ): void {
    for (const [part, impulse] of queuedImpulses) {
      if (!part.body.isValid()) continue;
      // El bosque tiene como máximo N-1 edges, pero un nodo puede participar
      // de varios. Limitar el delta total por body evita que una estrella de
      // vecinos multiplique la aceleración magnética configurada.
      const mass = Math.max(1e-4, part.body.mass());
      const maxImpulse =
        mass * BlobConfig.armor.reassemblyAttractionAcceleration * elapsed;
      if (impulse.lengthSq() > maxImpulse * maxImpulse) {
        impulse.setLength(maxImpulse);
      }
      part.body.applyImpulse(impulse, true);
    }
  }

  private updateShapeRelaxation(delta: number): void {
    const elapsed = finitePhysicsElapsed(delta);
    if (elapsed <= 0 || !this.options.coreBody.isValid()) return;
    this.updateReleasedShapeRelaxation(elapsed);
    this.updateMainShapeRelaxation(elapsed);
  }

  /**
   * Once separate pieces have joined, the magnetic bridge alone would leave
   * them as a chain. These targets add a soft, internal shape field. Removing
   * the aggregate impulse keeps the component free to fall (and, later, to be
   * navigated by AI) without this relaxation becoming locomotion.
   */
  private updateReleasedShapeRelaxation(elapsed: number): void {
    const config = BlobConfig.armor;
    const graph = releasedComponentGraph(this.parts, this.cohesionBonds);
    const activeSignatures = new Set<string>();

    for (const component of graph.components.values()) {
      const members = component.filter((part) => part.body.isValid());
      if (
        members.length < 3 ||
        members.some((part) => part.reassemblyCooldownRemaining > 0)
      ) {
        continue;
      }

      const signature = componentSignature(members);
      activeSignatures.add(signature);
      let assignments = this.fragmentShapeAssignments.get(signature);
      if (!assignments) {
        assignments = compactFragmentAssignments(members);
        this.fragmentShapeAssignments.set(signature, assignments);
      }

      let totalMass = 0;
      const center = new Vector3();
      const averageVelocity = new Vector3();
      for (const part of members) {
        const mass = Math.max(1e-4, part.body.mass());
        totalMass += mass;
        center.addScaledVector(vectorFromRapier(part.body.translation()), mass);
        averageVelocity.addScaledVector(vectorFromRapier(part.body.linvel()), mass);
      }
      if (totalMass <= 1e-4) continue;
      center.multiplyScalar(1 / totalMass);
      averageVelocity.multiplyScalar(1 / totalMass);

      const impulses = new Map<BlobArmorPart, Vector3>();
      let movableMass = 0;
      const aggregateImpulse = new Vector3();
      for (const part of members) {
        if (this.options.physics.isHeldBody(part.body.handle)) continue;
        const localTarget = assignments.get(part.index);
        if (!localTarget) continue;
        const target = center.clone().add(localTarget);
        if (!this.hasClearWorldPath(part, target)) continue;

        const desiredRelativeVelocity = target
          .sub(vectorFromRapier(part.body.translation()))
          .multiplyScalar(config.fragmentShapePositionGain);
        if (
          desiredRelativeVelocity.lengthSq() >
          config.fragmentShapeMaxSpeed ** 2
        ) {
          desiredRelativeVelocity.setLength(config.fragmentShapeMaxSpeed);
        }
        const velocityDelta = desiredRelativeVelocity.sub(
          vectorFromRapier(part.body.linvel()).sub(averageVelocity),
        );
        const mass = Math.max(1e-4, part.body.mass());
        const impulse = velocityDelta.multiplyScalar(mass);
        impulses.set(part, impulse);
        aggregateImpulse.add(impulse);
        movableMass += mass;
      }
      if (impulses.size === 0 || movableMass <= 1e-4) continue;

      // Saturation can make the raw PD field slightly asymmetric. Remove its
      // common component before applying one global acceleration cap.
      let scale = 1;
      for (const [part, impulse] of impulses) {
        const mass = Math.max(1e-4, part.body.mass());
        impulse.addScaledVector(aggregateImpulse, -mass / movableMass);
        const maxImpulse = mass * config.fragmentShapeAcceleration * elapsed;
        const length = impulse.length();
        if (length > maxImpulse && length > 1e-6) {
          scale = Math.min(scale, maxImpulse / length);
        }
      }
      for (const [part, impulse] of impulses) {
        part.body.applyImpulse(impulse.multiplyScalar(scale), true);
      }
    }

    for (const signature of this.fragmentShapeAssignments.keys()) {
      if (!activeSignatures.has(signature)) {
        this.fragmentShapeAssignments.delete(signature);
      }
    }
  }

  /**
   * El cerebro recompone una cobertura tipo cebolla: contiene cada rol en su
   * radio, mantiene slots uniformes y separa tangencialmente vecinos. Los slots
   * siguen activos con poca fuerza al terminar el reflow para que el gel pueda
   * deformarse sin volver a dejar un corredor abierto hacia el core.
   */
  private rebuildFeedingField(
    attached: BlobArmorPart[],
    corePosition: Vector3,
  ): void {
    const target = this.feedingTarget;
    this.feedingAssignments.clear();
    this.feedingCoreAssignments.clear();
    if (!target || target.requestedCoverage <= 0) {
      this.feedingCoverage = 0;
      this.feedingPartIndices.clear();
      return;
    }

    const towardTarget = target.position.clone().sub(corePosition);
    if (towardTarget.lengthSq() <= 1e-6) towardTarget.set(0, 0, 1);
    else towardTarget.normalize();
    const eligible = attached
      .filter((part) => part.layer > 0 && !part.joint?.isValid())
      .sort((left, right) => {
        const leftDirection = coreAnchorWorldPosition(
          this.mainShapeAssignments.get(left.index) ?? left.anchorTo,
          this.options.coreBody,
        ).sub(corePosition).normalize();
        const rightDirection = coreAnchorWorldPosition(
          this.mainShapeAssignments.get(right.index) ?? right.anchorTo,
          this.options.coreBody,
        ).sub(corePosition).normalize();
        return (
          right.layer - left.layer ||
          rightDirection.dot(towardTarget) - leftDirection.dot(towardTarget) ||
          left.index - right.index
        );
      });
    const maxFeeding = Math.min(
      eligible.length,
      Math.max(
        1,
        Math.floor(
          attached.length * BlobConfig.armor.feedingMaximumFraction,
        ),
      ),
    );
    const desiredCount = Math.min(
      maxFeeding,
      Math.max(1, Math.round(maxFeeding * target.requestedCoverage)),
    );
    const selected = eligible.slice(0, desiredCount);
    const nextIndices = new Set(selected.map((part) => part.index));
    const selectionChanged = !sameNumberSet(
      this.feedingPartIndices,
      nextIndices,
    );
    if (selectionChanged) {
      const newlyBorrowed = new Set(
        [...nextIndices].filter((index) => !this.feedingPartIndices.has(index)),
      );
      // Mientras los nodos estan bajo el campo inteligente, sus springs de
      // reposo del caparazon pelearian contra la extension. Se reconstruyen al
      // volver; los impactos aun pueden desprender cada body normalmente.
      if (newlyBorrowed.size > 0) {
        for (const bond of this.cohesionBonds) {
          if (
            newlyBorrowed.has(bond.partA.index) ||
            newlyBorrowed.has(bond.partB.index)
          ) {
            this.removeCohesionBond(bond);
          }
        }
        this.cohesionBonds = this.cohesionBonds.filter(
          (bond) => bond.joint?.isValid(),
        );
      }
      if (
        [...this.feedingPartIndices].some((index) => !nextIndices.has(index))
      ) {
        this.mainShapeHealingRemaining = Math.max(
          this.mainShapeHealingRemaining,
          BlobConfig.armor.reflowDuration + 1,
        );
      }
      this.feedingPartIndices.clear();
      for (const index of nextIndices) this.feedingPartIndices.add(index);
    }

    const wrapCount = Math.max(
      1,
      Math.min(
        selected.length,
        Math.round(selected.length * BlobConfig.armor.feedingWrapFraction),
      ),
    );
    const averageRadius =
      selected.reduce((sum, part) => sum + part.radius, 0) /
      Math.max(1, selected.length);
    const wrapRadius =
      target.radius + averageRadius + BlobConfig.armor.feedingSurfacePadding;
    const wrapSlots = fibonacciAnchors(
      wrapCount,
      wrapRadius,
      GOLDEN_ANGLE * 0.37,
    ).map((anchor) => target.position.clone().add(anchor));
    const bridgeCount = selected.length - wrapCount;
    const bridgeSlots = feedingBridgeSlots(
      bridgeCount,
      corePosition,
      target.position,
      this.mainOuterRadius,
      target.radius,
    );
    const slots = [...wrapSlots, ...bridgeSlots];
    for (let index = 0; index < selected.length; index += 1) {
      const slot = slots[index];
      if (slot) this.feedingAssignments.set(selected[index].index, slot);
    }

    // Los nodos que se quedan atras no conservan agujeros authored: se vuelven
    // a repartir uniformemente por capa para seguir escondiendo el cerebro.
    const remaining = attached.filter(
      (part) => !this.feedingPartIndices.has(part.index),
    );
    for (let layer = 0; layer <= this.mainOuterLayer; layer += 1) {
      const layerParts = remaining.filter((part) => part.layer === layer);
      if (layerParts.length === 0) continue;
      const targets = fibonacciAnchors(
        layerParts.length,
        this.mainLayerRadii[layer] ?? this.mainOuterRadius,
        (BlobConfig.armor.layerPhases[layer] ?? layer * GOLDEN_ANGLE) + 0.19,
      );
      const assignments = assignNearestTargets(
        layerParts,
        targets,
        this.options.coreBody,
      );
      for (const [part, assignment] of assignments) {
        this.feedingCoreAssignments.set(part.index, assignment.clone());
      }
    }
  }

  private applyFeedingField(
    part: BlobArmorPart,
    target: Vector3,
    elapsed: number,
  ): number {
    const position = vectorFromRapier(part.body.translation());
    const error = target.clone().sub(position);
    const distance = error.length();
    if (distance <= 1e-5) return 1;
    const desiredVelocity = error.multiplyScalar(
      BlobConfig.armor.feedingPositionGain,
    );
    if (desiredVelocity.length() > BlobConfig.armor.feedingMaxSpeed) {
      desiredVelocity.setLength(BlobConfig.armor.feedingMaxSpeed);
    }
    const velocityDelta = desiredVelocity.sub(
      vectorFromRapier(part.body.linvel()),
    );
    const maxDelta = BlobConfig.armor.feedingAcceleration * elapsed;
    if (velocityDelta.length() > maxDelta) velocityDelta.setLength(maxDelta);
    part.body.applyImpulse(
      velocityDelta.multiplyScalar(Math.max(1e-4, part.body.mass())),
      true,
    );
    return 1 - clamp(
      (distance - BlobConfig.armor.feedingCoverageContactDistance) /
        BlobConfig.armor.feedingCoverageFalloffDistance,
      0,
      1,
    );
  }

  private updateMainShapeRelaxation(elapsed: number): void {
    const config = BlobConfig.armor;
    const healingBoost =
      (this.mainShapeHealingRemaining > 0
        ? config.mainShapeHealingBoost
        : 1) * this.mainShapeLoadScale;
    const assignmentScale =
      (this.mainShapeHealingRemaining > 0
        ? config.mainShapeAssignmentHealingBoost
        : config.mainShapeAssignmentMaintenanceScale) *
      this.mainShapeLoadScale;
    const attached = this.parts.filter(
      (part) => part.state === "attached" && part.body.isValid(),
    );
    if (attached.length === 0) {
      this.feedingCoverage = 0;
      return;
    }

    const corePosition = vectorFromRapier(this.options.coreBody.translation());
    this.rebuildFeedingField(attached, corePosition);
    const coreVelocity = vectorFromRapier(this.options.coreBody.linvel());
    const coreAngularVelocity = vectorFromRapier(this.options.coreBody.angvel());
    const coreReaction = new Vector3();

    let feedingCloseness = 0;
    let feedingCount = 0;
    for (const part of attached) {
      if (this.options.physics.isHeldBody(part.body.handle)) continue;
      const feedingTarget = this.feedingAssignments.get(part.index);
      if (feedingTarget) {
        feedingCloseness += this.applyFeedingField(
          part,
          feedingTarget,
          elapsed,
        );
        feedingCount += 1;
        continue;
      }
      const position = vectorFromRapier(part.body.translation());
      const radiusVector = position.clone().sub(corePosition);
      const distance = radiusVector.length();
      if (distance <= 1e-4) continue;
      const radial = radiusVector.clone().multiplyScalar(1 / distance);
      const layerRadius =
        this.mainLayerRadii[part.layer] ?? this.mainOuterRadius;
      const target = corePosition
        .clone()
        .addScaledVector(radial, layerRadius);
      if (!this.hasClearWorldPath(part, target)) continue;

      const frameVelocity = coreVelocity
        .clone()
        .add(coreAngularVelocity.clone().cross(radiusVector));
      const radialVelocity = vectorFromRapier(part.body.linvel())
        .sub(frameVelocity)
        .dot(radial);
      const desiredRadialVelocity = clamp(
        (layerRadius - distance) * config.mainShapeRadialGain,
        -config.mainShapeMaxSpeed,
        config.mainShapeMaxSpeed,
      );
      const velocityDelta = clamp(
        desiredRadialVelocity - radialVelocity,
        -config.mainShapeRadialAcceleration * healingBoost * elapsed,
        config.mainShapeRadialAcceleration * healingBoost * elapsed,
      );
      const impulse = radial.clone().multiplyScalar(
        velocityDelta * Math.max(1e-4, part.body.mass()),
      );
      part.body.applyImpulse(impulse, true);
      coreReaction.sub(impulse);

      const assignedTarget =
        this.feedingCoreAssignments.get(part.index) ??
        this.mainShapeAssignments.get(part.index);
      if (!assignedTarget || assignmentScale <= 0) continue;
      const assignedWorld = coreAnchorWorldPosition(
        assignedTarget,
        this.options.coreBody,
      );
      if (!this.hasClearWorldPath(part, assignedWorld)) continue;
      const tangentialError = assignedWorld.sub(position);
      tangentialError.addScaledVector(
        radial,
        -tangentialError.dot(radial),
      );
      const tangentialDistance = tangentialError.length();
      if (tangentialDistance <= 1e-5) continue;
      const desiredTangentialVelocity = tangentialError
        .clone()
        .multiplyScalar(config.mainShapeAssignmentGain);
      const desiredSpeed = desiredTangentialVelocity.length();
      if (desiredSpeed > config.mainShapeAssignmentMaxSpeed) {
        desiredTangentialVelocity.multiplyScalar(
          config.mainShapeAssignmentMaxSpeed / desiredSpeed,
        );
      }
      const relativeVelocity = vectorFromRapier(part.body.linvel()).sub(
        frameVelocity,
      );
      relativeVelocity.addScaledVector(
        radial,
        -relativeVelocity.dot(radial),
      );
      const tangentialDelta = desiredTangentialVelocity.sub(relativeVelocity);
      const maxTangentialDelta =
        config.mainShapeAssignmentAcceleration * assignmentScale * elapsed;
      if (tangentialDelta.length() > maxTangentialDelta) {
        tangentialDelta.setLength(maxTangentialDelta);
      }
      const tangentialImpulse = tangentialDelta.multiplyScalar(
        Math.max(1e-4, part.body.mass()),
      );
      part.body.applyImpulse(tangentialImpulse, true);
      coreReaction.sub(tangentialImpulse);
    }
    if (coreReaction.lengthSq() > 1e-12) {
      this.options.coreBody.applyImpulse(coreReaction, true);
    }
    this.feedingCoverage =
      feedingCount > 0 && this.feedingTarget
        ? this.feedingTarget.requestedCoverage *
          (feedingCloseness / feedingCount)
        : 0;

    const angularImpulses = new Map<BlobArmorPart, Vector3>();
    for (let from = 0; from < attached.length; from += 1) {
      const partA = attached[from];
      if (this.options.physics.isHeldBody(partA.body.handle)) continue;
      for (let to = from + 1; to < attached.length; to += 1) {
        const partB = attached[to];
        if (
          partA.layer !== partB.layer ||
          this.feedingPartIndices.has(partA.index) ||
          this.feedingPartIndices.has(partB.index) ||
          this.options.physics.isHeldBody(partB.body.handle)
        ) {
          continue;
        }
        const radiusA = vectorFromRapier(partA.body.translation()).sub(
          corePosition,
        );
        const radiusB = vectorFromRapier(partB.body.translation()).sub(
          corePosition,
        );
        if (radiusA.lengthSq() <= 1e-8 || radiusB.lengthSq() <= 1e-8) {
          continue;
        }
        const unitA = radiusA.normalize();
        const unitB = radiusB.normalize();
        const layerRadius =
          this.mainLayerRadii[partA.layer] ?? this.mainOuterRadius;
        const surfaceDistance =
          layerRadius *
          Math.sqrt(Math.max(0, 2 - 2 * clamp(unitA.dot(unitB), -1, 1)));
        const targetSpacing =
          (this.layerSurfaceSpacings[partA.layer] ??
            partRadius(partA) + partRadius(partB)) *
          config.mainShapeSpacingScale;
        const spacingError = targetSpacing - surfaceDistance;
        if (spacingError <= 0) continue;

        const normal = unitA.clone().add(unitB);
        if (normal.lengthSq() <= 1e-8) normal.copy(unitA);
        normal.normalize();
        const separation = unitA
          .clone()
          .sub(unitB)
          .addScaledVector(normal, -unitA.clone().sub(unitB).dot(normal));
        if (separation.lengthSq() <= 1e-8) {
          separation.copy(
            deterministicPairTangent(partA.index, partB.index, normal),
          );
        } else {
          separation.normalize();
        }

        const relativeVelocity = vectorFromRapier(partA.body.linvel())
          .sub(vectorFromRapier(partB.body.linvel()))
          .dot(separation);
        const desiredSeparationVelocity = Math.min(
          config.mainShapeMaxSpeed,
          spacingError * config.mainShapeAngularGain,
        );
        const relativeDelta = clamp(
          desiredSeparationVelocity - relativeVelocity,
          -2 * config.mainShapeAngularAcceleration * healingBoost * elapsed,
          2 * config.mainShapeAngularAcceleration * healingBoost * elapsed,
        );
        const inverseMass =
          1 / Math.max(1e-4, partA.body.mass()) +
          1 / Math.max(1e-4, partB.body.mass());
        const impulse = separation.multiplyScalar(relativeDelta / inverseMass);
        queueImpulse(angularImpulses, partA, impulse);
        queueImpulse(angularImpulses, partB, impulse.clone().negate());
      }
    }

    let angularScale = 1;
    for (const [part, impulse] of angularImpulses) {
      const maxImpulse =
        Math.max(1e-4, part.body.mass()) *
        config.mainShapeAngularAcceleration *
        healingBoost *
        elapsed;
      const length = impulse.length();
      if (length > maxImpulse && length > 1e-6) {
        angularScale = Math.min(angularScale, maxImpulse / length);
      }
    }
    for (const [part, impulse] of angularImpulses) {
      part.body.applyImpulse(impulse.multiplyScalar(angularScale), true);
    }
  }

  private updateShapeHealing(delta: number): void {
    const elapsed = finitePhysicsElapsed(delta);
    if (elapsed <= 0) return;
    this.mainShapeHealingRemaining = Math.max(
      0,
      this.mainShapeHealingRemaining - elapsed,
    );
    this.shapeHealElapsed += elapsed;
    if (this.shapeHealElapsed < BlobConfig.armor.shapeHealInterval) return;
    this.shapeHealElapsed %= BlobConfig.armor.shapeHealInterval;

    const graph = releasedComponentGraph(this.parts, this.cohesionBonds);
    const degrees = new Map<BlobArmorPart, number>();
    const existing = new Set<string>();
    for (const bond of this.cohesionBonds) {
      if (!bond.joint?.isValid()) continue;
      existing.add(cohesionPairKey(bond.partA, bond.partB));
      degrees.set(bond.partA, (degrees.get(bond.partA) ?? 0) + 1);
      degrees.set(bond.partB, (degrees.get(bond.partB) ?? 0) + 1);
    }

    const candidates: ReassemblyCandidate[] = [];
    for (let from = 0; from < this.parts.length; from += 1) {
      const partA = this.parts[from];
      if (!partA.body.isValid()) continue;
      for (let to = from + 1; to < this.parts.length; to += 1) {
        const partB = this.parts[to];
        if (!partB.body.isValid()) continue;
        const pairKey = cohesionPairKey(partA, partB);
        if (existing.has(pairKey)) continue;

        const bothMain =
          this.mainShapeHealingRemaining > 0 &&
          partA.state === "attached" &&
          partB.state === "attached" &&
          Math.abs(partA.layer - partB.layer) <= 1;
        const componentA = graph.componentByPart.get(partA);
        const bothReadyFragment =
          partA.state === "released" &&
          partB.state === "released" &&
          componentA !== undefined &&
          componentA === graph.componentByPart.get(partB) &&
          partA.reassemblyCooldownRemaining <= 0 &&
          partB.reassemblyCooldownRemaining <= 0;
        if (!bothMain && !bothReadyFragment) continue;
        if (
          (degrees.get(partA) ?? 0) >=
            BlobConfig.armor.shapeHealMaxDegree ||
          (degrees.get(partB) ?? 0) >=
            BlobConfig.armor.shapeHealMaxDegree
        ) {
          continue;
        }

        const distance = rapierDistance(
          partA.body.translation(),
          partB.body.translation(),
        );
        const maxDistance = bothMain
          ? BlobConfig.armor.cohesionAttachMaxDistance
          : partRadius(partA) +
            partRadius(partB) +
            BlobConfig.armor.shapeHealPadding;
        if (
          distance > maxDistance ||
          !this.hasClearWorldPath(
            partA,
            vectorFromRapier(partB.body.translation()),
          )
        ) {
          continue;
        }
        candidates.push({ partA, partB, distance });
      }
    }
    candidates.sort(
      (a, b) =>
        a.distance - b.distance ||
        cohesionPairKey(a.partA, a.partB).localeCompare(
          cohesionPairKey(b.partA, b.partB),
        ),
    );

    let added = 0;
    for (const candidate of candidates) {
      if (added >= BlobConfig.armor.shapeHealMaxBondsPerTick) break;
      if (
        (degrees.get(candidate.partA) ?? 0) >=
          BlobConfig.armor.shapeHealMaxDegree ||
        (degrees.get(candidate.partB) ?? 0) >=
          BlobConfig.armor.shapeHealMaxDegree
      ) {
        continue;
      }
      if (this.addCohesionBond(candidate.partA, candidate.partB, 1)) {
        degrees.set(
          candidate.partA,
          (degrees.get(candidate.partA) ?? 0) + 1,
        );
        degrees.set(
          candidate.partB,
          (degrees.get(candidate.partB) ?? 0) + 1,
        );
        added += 1;
      }
    }
    if (this.mainShapeHealingRemaining > 0) {
      this.pruneStaleMainBonds();
    }
  }

  private pruneStaleMainBonds(): void {
    const config = BlobConfig.armor;
    const staleDistance =
      config.cohesionAttachMaxDistance *
      config.shapeHealStaleDistanceFactor;
    const hasTargetCompatibleReplacement = (
      part: BlobArmorPart,
      ignored: BlobCohesionBond,
    ): boolean => {
      const target = this.mainShapeAssignments.get(part.index);
      if (!target) return false;
      return this.cohesionBonds.some((candidate) => {
        if (candidate === ignored || !candidate.joint?.isValid()) return false;
        const other =
          candidate.partA === part
            ? candidate.partB
            : candidate.partB === part
              ? candidate.partA
              : null;
        if (!other || other.state !== "attached") return false;
        const otherTarget = this.mainShapeAssignments.get(other.index);
        return (
          otherTarget !== undefined &&
          Math.abs(part.layer - other.layer) <= 1 &&
          target.distanceTo(otherTarget) <= staleDistance &&
          rapierDistance(part.body.translation(), other.body.translation()) <=
            staleDistance
        );
      });
    };
    const candidates = this.cohesionBonds
      .filter((bond) => {
        if (
          !bond.joint?.isValid() ||
          this.feedingPartIndices.has(bond.partA.index) ||
          this.feedingPartIndices.has(bond.partB.index) ||
          bond.partA.state !== "attached" ||
          bond.partB.state !== "attached"
        ) {
          return false;
        }
        const actualDistance = rapierDistance(
          bond.partA.body.translation(),
          bond.partB.body.translation(),
        );
        const targetA = this.mainShapeAssignments.get(bond.partA.index);
        const targetB = this.mainShapeAssignments.get(bond.partB.index);
        const targetStale =
          targetA !== undefined &&
          targetB !== undefined &&
          targetA.distanceTo(targetB) > staleDistance;
        return (
          Math.abs(bond.partA.layer - bond.partB.layer) > 1 ||
          actualDistance > staleDistance ||
          (targetStale &&
            hasTargetCompatibleReplacement(bond.partA, bond) &&
            hasTargetCompatibleReplacement(bond.partB, bond))
        );
      })
      .sort(
        (a, b) =>
          cohesionBondExtension(b) - cohesionBondExtension(a) ||
          cohesionPairKey(a.partA, a.partB).localeCompare(
            cohesionPairKey(b.partA, b.partB),
          ),
      );
    let pruned = 0;
    for (const bond of candidates) {
      if (pruned >= config.shapeHealMaxPrunedPerTick) break;
      const degreeA = activeBondDegree(this.cohesionBonds, bond.partA);
      const degreeB = activeBondDegree(this.cohesionBonds, bond.partB);
      if (
        degreeA <= 2 ||
        degreeB <= 2 ||
        this.passiveCutOrphans(bond).length > 0
      ) {
        continue;
      }
      this.removeCohesionBond(bond);
      pruned += 1;
    }
  }

  private attractPartToCore(
    part: BlobArmorPart,
    target: Vector3,
    elapsed: number,
  ): void {
    const config = BlobConfig.armor;
    const position = vectorFromRapier(part.body.translation());
    const offset = target.clone().sub(position);
    const distance = offset.length();
    if (distance <= 1e-4) return;
    const proximity = Math.max(
      0,
      1 - distance / config.reassemblyCoreAttractionRadius,
    );
    const targetVelocity = offset
      .multiplyScalar(1 / distance)
      .multiplyScalar(config.reassemblyCoreMaxSpeed * (0.2 + proximity * 0.8))
      .add(vectorFromRapier(this.options.coreBody.linvel()));
    const velocityDelta = targetVelocity.sub(
      vectorFromRapier(part.body.linvel()),
    );
    const maxDelta = config.reassemblyCoreAcceleration * elapsed;
    if (velocityDelta.lengthSq() > maxDelta * maxDelta) {
      velocityDelta.setLength(maxDelta);
    }
    part.body.applyImpulse(
      velocityDelta.multiplyScalar(Math.max(1e-4, part.body.mass())),
      true,
    );
  }

  private hasClearWorldPath(part: BlobArmorPart, target: Vector3): boolean {
    const origin = vectorFromRapier(part.body.translation());
    const direction = target.clone().sub(origin);
    const distance = direction.length();
    if (distance <= 1e-4) return true;
    return (
      this.raycast.cast(
        origin,
        direction,
        distance,
        part.body,
        undefined,
        (metadata) =>
          metadata?.kind === "static" || metadata?.kind === "door",
      ) === null
    );
  }

  private attachComponentToBody(
    component: BlobArmorPart[],
    releasedPart: BlobArmorPart,
    mainPart: BlobArmorPart,
    existingMain: BlobArmorPart[],
  ): void {
    this.addCohesionBond(releasedPart, mainPart, 1);
    this.restoreAttachedComponent(component);
    this.connectComponentToNearbyMain(component, existingMain);
    this.armMainShapeHealing();
  }

  private attachComponentToCore(
    component: BlobArmorPart[],
    part: BlobArmorPart,
    anchor: Vector3,
    existingMain: BlobArmorPart[],
  ): void {
    if (!part.coreAnchorEligible || part.joint?.isValid()) return;
    for (const member of component) {
      if (!member.coreAnchorEligible || member.joint?.isValid()) continue;
      const memberAnchor = member === part
        ? anchor
        : coreAnchorForPart(member, this.options.coreBody);
      const target = coreAnchorWorldPosition(
        memberAnchor,
        this.options.coreBody,
      );
      if (
        member !== part &&
        (vectorFromRapier(member.body.translation()).distanceTo(target) >
          BlobConfig.armor.reassemblyCoreCaptureDistance ||
          !this.hasClearWorldPath(member, target))
      ) {
        continue;
      }
      member.anchorFrom.copy(memberAnchor);
      member.anchorTo.copy(memberAnchor);
      member.joint = this.createCoreJoint(member.body, memberAnchor);
    }
    this.restoreAttachedComponent(component);
    this.connectComponentToNearbyMain(component, existingMain);
    this.armMainShapeHealing();
  }

  private armMainShapeHealing(protectFromLoad = true): void {
    const healingDuration =
      BlobConfig.armor.reflowDelay + BlobConfig.armor.reflowDuration + 1;
    this.rebuildMainShapeAssignments();
    this.mainShapeHealingRemaining = Math.max(
      this.mainShapeHealingRemaining,
      healingDuration,
    );
    if (protectFromLoad) {
      this.loadFatigueGraceRemaining = Math.max(
        this.loadFatigueGraceRemaining,
        BlobConfig.armor.cohesionReflowLoadGraceSeconds,
      );
    }
  }

  private rebuildMainShapeAssignments(): void {
    this.mainShapeAssignments.clear();
    const config = BlobConfig.armor;
    const parts = this.parts.filter(
      (part) => part.state === "attached" && part.body.isValid(),
    );
    if (parts.length === 0) {
      this.mainLayerRadii = [...config.layerRadii];
      this.mainOuterLayer = config.layerCounts.length - 1;
      this.mainOuterRadius = config.outerRadius;
      this.layerSurfaceSpacings = config.layerCounts.map(
        () => config.maxRadius * 2,
      );
      return;
    }

    const layout = adaptiveGelLayers(parts.length);
    this.mainLayerRadii = layout.map((layer) => layer.radius);
    this.mainOuterLayer = Math.max(0, layout.length - 1);
    this.mainOuterRadius =
      layout[this.mainOuterLayer]?.radius ?? config.outerRadius;
    const slots: MainShapeSlot[] = [];
    const targetsByLayer: Vector3[][] = [];
    for (let layer = 0; layer < layout.length; layer += 1) {
      const targets = fibonacciAnchors(
        layout[layer].count,
        layout[layer].radius,
        layout[layer].phase,
      );
      targetsByLayer.push(targets);
      slots.push(...targets.map((target) => ({ target, layer })));
    }
    this.layerSurfaceSpacings = targetsByLayer.map((targets) =>
      averageNearestTargetSpacing(targets, config.maxRadius * 2),
    );

    const innerSlots = slots.filter((slot) => slot.layer === 0);
    const priorityInner = parts
      .filter((part) => part.coreAnchorEligible || part.joint?.isValid())
      .sort((a, b) => a.index - b.index)
      .slice(0, innerSlots.length);
    const assignments = assignNearestShapeSlots(
      priorityInner,
      innerSlots,
      this.options.coreBody,
    );
    const assignedParts = new Set(assignments.keys());
    const assignedSlots = new Set(assignments.values());
    const remainingAssignments = assignNearestShapeSlots(
      parts.filter((part) => !assignedParts.has(part)),
      slots.filter((slot) => !assignedSlots.has(slot)),
      this.options.coreBody,
    );
    for (const [part, slot] of remainingAssignments) {
      assignments.set(part, slot);
    }
    for (const [part, slot] of assignments) {
      part.layer = slot.layer;
      this.mainShapeAssignments.set(part.index, slot.target.clone());
    }
  }

  private restoreAttachedComponent(component: BlobArmorPart[]): void {
    const members = new Set(component);
    for (const part of component) {
      part.state = "attached";
      part.mesh.visible = false;
      part.detachedElapsed = 0;
      part.resistanceFramesRemaining = 0;
      part.cohesionWaveId = null;
      part.reassemblyCooldownRemaining = 0;
      part.yieldFinalized = false;
      part.hangingLoadFatigue = 0;
      this.restorePartVitalityVisual(part);
      this.options.physics.registerCollider(
        part.collider,
        this.attachedMetadata(part.index, part.damageable),
      );
      if (this.options.physics.isHeldBody(part.body.handle)) {
        this.options.physics.setHeldRestoreGravityScale(
          part.body.handle,
          BlobConfig.armor.attachedGravityScale,
        );
      } else {
        part.body.setGravityScale(
          BlobConfig.armor.attachedGravityScale,
          true,
        );
      }
    }
    for (const bond of this.cohesionBonds) {
      if (
        !bond.joint?.isValid() ||
        !members.has(bond.partA) ||
        !members.has(bond.partB)
      ) {
        continue;
      }
      bond.mixedElapsed = 0;
      bond.resistanceFramesRemaining = 0;
      bond.tearArmed = false;
      bond.snapArmed = false;
      bond.loadFatigue = 0;
      bond.passiveProtectionRemaining = 0;
      bond.lastRelativeVelocity.copy(
        relativeVelocityVector(bond.partA, bond.partB),
      );
    }
  }

  private connectComponentToNearbyMain(
    component: BlobArmorPart[],
    existingMain: BlobArmorPart[],
  ): void {
    const candidates: ReassemblyCandidate[] = [];
    for (const partA of component) {
      for (const partB of existingMain) {
        const distance = rapierDistance(
          partA.body.translation(),
          partB.body.translation(),
        );
        if (
          distance <= BlobConfig.armor.cohesionAttachMaxDistance &&
          this.hasClearWorldPath(partA, vectorFromRapier(partB.body.translation()))
        ) {
          candidates.push({ partA, partB, distance });
        }
      }
    }
    candidates.sort(
      (a, b) =>
        a.distance - b.distance ||
        cohesionPairKey(a.partA, a.partB).localeCompare(
          cohesionPairKey(b.partA, b.partB),
        ),
    );
    let added = 0;
    for (const candidate of candidates) {
      if (added >= BlobConfig.armor.cohesionNeighborCount) break;
      if (this.addCohesionBond(candidate.partA, candidate.partB, 1)) {
        added += 1;
      }
    }
  }

  private recoverNearbyCoreAnchors(): boolean {
    let recovered = false;
    for (const part of this.parts) {
      if (
        part.state !== "attached" ||
        !part.coreAnchorEligible ||
        part.joint?.isValid() ||
        !part.body.isValid()
      ) {
        continue;
      }
      const anchor = coreAnchorForPart(part, this.options.coreBody);
      const target = coreAnchorWorldPosition(anchor, this.options.coreBody);
      if (
        vectorFromRapier(part.body.translation()).distanceTo(target) >
          BlobConfig.armor.reassemblyCoreCaptureDistance ||
        !this.hasClearWorldPath(part, target)
      ) {
        continue;
      }
      part.anchorFrom.copy(anchor);
      part.anchorTo.copy(anchor);
      part.joint = this.createCoreJoint(part.body, anchor);
      recovered = true;
    }
    return recovered;
  }

  private syncGravityScales(): void {
    for (const part of this.parts) {
      if (
        !part.body.isValid() ||
        this.options.physics.isHeldBody(part.body.handle)
      ) {
        continue;
      }
      const target =
        part.state === "released"
          ? 1
          : BlobConfig.armor.attachedGravityScale;
      if (Math.abs(part.body.gravityScale() - target) > 1e-6) {
        part.body.setGravityScale(target, true);
      }
    }
  }

  private updateGelSurface(): void {
    if (!this.options.coreBody.isValid()) {
      this.gelSurface.object.visible = false;
      return;
    }
    const translation = this.options.coreBody.translation();
    this.gelCenter.set(translation.x, translation.y, translation.z);
    this.gelSurface.setCenter(this.gelCenter);

    let sampleCount = 0;
    sampleCount = this.writeGelSample(
      sampleCount,
      this.gelCenter,
      BlobConfig.visual.surfaceCoreRadius,
    );
    for (const part of this.parts) {
      if (part.state === "released" || !part.body.isValid()) continue;
      const position = part.body.translation();
      this.gelCenter.set(position.x, position.y, position.z);
      sampleCount = this.writeGelSample(
        sampleCount,
        this.gelCenter,
        part.radius * BlobConfig.visual.surfaceNodeRadiusScale,
      );
    }
    this.gelSamples.length = sampleCount;

    const corePosition = this.options.coreBody.translation();
    this.gelCenter.set(corePosition.x, corePosition.y, corePosition.z);
    this.gelSurface.update(this.gelCenter, this.gelSamples);
  }

  private writeGelSample(
    index: number,
    position: Vector3,
    radius: number,
  ): number {
    const sample = this.gelSamples[index];
    if (sample) {
      sample.position.copy(position);
      sample.radius = radius;
    } else {
      this.gelSamples.push({ position: position.clone(), radius });
    }
    return index + 1;
  }

  private armCohesionFromImpact(
    part: BlobArmorPart,
    mode: "direct" | "fragment",
  ): void {
    const config = BlobConfig.armor;
    for (const bond of this.cohesionBonds) {
      if (
        !bond.joint?.isValid() ||
        (bond.partA !== part && bond.partB !== part)
      ) {
        continue;
      }
      const other = bond.partA === part ? bond.partB : bond.partA;
      const load = cohesionRelativeSpeed(part, other);
      if (load < config.cohesionTearRelativeSpeed) continue;

      const bothDetached =
        part.state !== "attached" && other.state !== "attached";
      if (bothDetached) {
        // El impacto que desprende al segundo extremo no debe cortar el enlace
        // que acaba de convertir en interno. Disparos posteriores sí lo rasgan.
        if (mode === "fragment") {
          bond.snapArmed = true;
        } else {
          bond.snapArmed = false;
          bond.tearArmed = false;
          bond.mixedElapsed = 0;
        }
        bond.resistanceFramesRemaining = Math.max(
          1,
          bond.resistanceFramesRemaining,
        );
        continue;
      }

      if (load >= config.cohesionSnapRelativeSpeed) {
        bond.snapArmed = true;
        bond.tearArmed = false;
      } else {
        bond.tearArmed = true;
      }
      bond.resistanceFramesRemaining = Math.max(
        1,
        bond.resistanceFramesRemaining,
      );
    }
  }

  private createCohesionBond(bond: BlobCohesionBond): void {
    bond.restLength = rapierDistance(
      bond.partA.body.translation(),
      bond.partB.body.translation(),
    );
    const joint = this.options.physics.world.createImpulseJoint(
      RAPIER.JointData.spring(
        bond.restLength,
        BlobConfig.armor.cohesionSpringStiffness,
        BlobConfig.armor.cohesionSpringDamping,
        ZERO_ANCHOR,
        ZERO_ANCHOR,
      ),
      bond.partA.body,
      bond.partB.body,
      true,
    );
    // Las esferas siguen chocando al comprimirse: el resorte aporta la
    // tracción que faltaba para que el racimo se comporte como gel.
    joint.setContactsEnabled(true);
    bond.joint = joint;
    bond.lastRelativeVelocity.copy(
      relativeVelocityVector(bond.partA, bond.partB),
    );
  }

  private addCohesionBond(
    partA: BlobArmorPart,
    partB: BlobArmorPart,
    resistanceFramesRemaining = 0,
  ): BlobCohesionBond | null {
    if (partA === partB || !partA.body.isValid() || !partB.body.isValid()) {
      return null;
    }
    const key = cohesionPairKey(partA, partB);
    if (
      this.cohesionBonds.some(
        (bond) =>
          bond.joint?.isValid() &&
          cohesionPairKey(bond.partA, bond.partB) === key,
      )
    ) {
      return null;
    }
    const bond: BlobCohesionBond = {
      partA,
      partB,
      restLength: rapierDistance(
        partA.body.translation(),
        partB.body.translation(),
      ),
      joint: null,
      mixedElapsed: 0,
      resistanceFramesRemaining,
      tearArmed: false,
      snapArmed: false,
      loadFatigue: 0,
      passiveProtectionRemaining: 0,
      lastRelativeVelocity: relativeVelocityVector(partA, partB),
    };
    this.createCohesionBond(bond);
    this.cohesionBonds.push(bond);
    return bond;
  }

  private removeCohesionBond(
    bond: BlobCohesionBond,
    resetReassemblyCooldown = false,
  ): void {
    if (resetReassemblyCooldown) {
      this.resetReassemblyCooldownForComponent(bond.partA, bond);
      this.resetReassemblyCooldownForComponent(bond.partB, bond);
    }
    const joint = bond.joint;
    bond.joint = null;
    if (joint?.isValid()) {
      this.options.physics.world.removeImpulseJoint(joint, true);
    }
  }

  private resetReassemblyCooldownForComponent(
    start: BlobArmorPart,
    ignoredBond?: BlobCohesionBond,
  ): void {
    if (start.state === "attached") return;
    const visited = new Set<BlobArmorPart>();
    const pending = [start];
    while (pending.length > 0) {
      const part = pending.pop()!;
      if (visited.has(part) || part.state === "attached") continue;
      visited.add(part);
      for (const bond of this.cohesionBonds) {
        if (bond === ignoredBond || !bond.joint?.isValid()) continue;
        if (bond.partA === part && bond.partB.state !== "attached") {
          pending.push(bond.partB);
        } else if (bond.partB === part && bond.partA.state !== "attached") {
          pending.push(bond.partA);
        }
      }
    }
    for (const part of visited) {
      part.reassemblyCooldownRemaining =
        BlobConfig.armor.reassemblyDelaySeconds;
    }
  }

  private removeAllCohesionBonds(): void {
    for (const bond of this.cohesionBonds) {
      this.removeCohesionBond(bond);
    }
    this.cohesionBonds.length = 0;
  }

  private closeImpactWave(): void {
    if (!this.impactWaveOpen) return;
    this.impactWaveOpen = false;
    this.currentCohesionWaveId += 1;
  }

  private scheduleReflow(): void {
    if (!this.enabled || this.dead || this.disposed) return;
    const attached = this.parts.filter(
      (part) => part.state === "attached" && part.joint?.isValid(),
    );
    if (attached.length === 0) return;

    const targets = attached.map(
      (part) =>
        this.mainShapeAssignments.get(part.index)?.clone() ??
        part.anchorTo.clone(),
    );
    const assignments = assignNearestTargets(
      attached,
      targets,
      this.options.coreBody,
    );
    for (const [part, target] of assignments) {
      part.anchorFrom.copy(vectorFromRapier(part.joint!.anchor1()));
      part.anchorTo.copy(target);
    }
    this.reflowDelayRemaining = BlobConfig.armor.reflowDelay;
    this.reflowElapsed = 0;
    this.reflowActive = true;
  }

  private updateReflow(delta: number): void {
    if (!this.reflowActive) return;
    let remaining = Math.max(0, delta);
    if (this.reflowDelayRemaining > 0) {
      const consumed = Math.min(this.reflowDelayRemaining, remaining);
      this.reflowDelayRemaining -= consumed;
      remaining -= consumed;
      if (this.reflowDelayRemaining > 0 || remaining <= 0) return;
    }
    const duration = BlobConfig.armor.reflowDuration;
    if (duration <= 0) {
      for (const part of this.parts) {
        if (part.state === "attached" && part.joint?.isValid()) {
          part.joint.setAnchor1(part.anchorTo);
        }
      }
      this.reflowActive = false;
      return;
    }

    this.reflowElapsed = Math.min(duration, this.reflowElapsed + remaining);
    const t = this.reflowElapsed / duration;
    const eased = t * t * (3 - 2 * t);
    for (const part of this.parts) {
      if (part.state !== "attached" || !part.joint?.isValid()) continue;
      const anchor = part.anchorFrom.clone().lerp(part.anchorTo, eased);
      part.joint.setAnchor1(anchor);
    }
    if (this.reflowElapsed >= duration) {
      this.reflowActive = false;
    }
  }
}

function createGelMaterial(): MeshPhysicalMaterial {
  const visual = BlobConfig.visual;
  return new MeshPhysicalMaterial({
    color: visual.surfaceColor,
    transparent: true,
    opacity: visual.surfaceOpacity,
    depthWrite: false,
    roughness: ARMOR_ROUGHNESS,
    metalness: ARMOR_METALNESS,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    transmission: 0.12,
    thickness: 0.8,
    ior: 1.34,
  });
}

function detachedVisualRadius(physicalRadius: number): number {
  return physicalRadius * BlobConfig.visual.surfaceNodeRadiusScale;
}

function feedingBridgeSlots(
  count: number,
  core: Vector3,
  target: Vector3,
  coreRadius: number,
  targetRadius: number,
): Vector3[] {
  if (count <= 0) return [];
  const axis = target.clone().sub(core);
  const distance = axis.length();
  if (distance <= 1e-5) axis.set(0, 0, 1);
  else axis.multiplyScalar(1 / distance);
  const tangentA = Math.abs(axis.y) < 0.9
    ? axis.clone().cross(new Vector3(0, 1, 0)).normalize()
    : axis.clone().cross(new Vector3(1, 0, 0)).normalize();
  const tangentB = axis.clone().cross(tangentA).normalize();
  const start = core.clone().addScaledVector(axis, coreRadius * 0.72);
  const end = target.clone().addScaledVector(axis, -targetRadius * 0.7);
  const slots: Vector3[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = (index + 1) / (count + 1);
    const angle = index * GOLDEN_ANGLE;
    const width = Math.sin(Math.PI * t) * 0.24;
    slots.push(
      start
        .clone()
        .lerp(end, t)
        .addScaledVector(tangentA, Math.cos(angle) * width)
        .addScaledVector(tangentB, Math.sin(angle) * width),
    );
  }
  return slots;
}

function sameNumberSet(
  left: ReadonlySet<number>,
  right: ReadonlySet<number>,
): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function adaptiveGelLayers(nodeCount: number): GelLayerDefinition[] {
  const config = BlobConfig.armor;
  let remaining = Math.max(0, Math.floor(nodeCount));
  if (remaining === 0) return [];
  const layers: GelLayerDefinition[] = [];

  for (let layer = 0; layer < config.layerCounts.length; layer += 1) {
    if (remaining <= 0) break;
    const capacity = config.layerCounts[layer];
    const count = Math.min(capacity, remaining);
    layers.push({
      count,
      radius: config.layerRadii[layer],
      phase: config.layerPhases[layer],
    });
    remaining -= count;
  }
  if (remaining <= 0) return layers;

  const seedCount = Math.max(
    1,
    Math.floor(config.growthLayerMinimumNodes),
  );
  // Un puñado menor al seed densifica y ensancha suavemente la última capa en
  // vez de crear una protuberancia aislada a un radio completamente nuevo.
  if (remaining < seedCount) {
    const outer = layers[layers.length - 1];
    const nominalCapacity = config.layerCounts.at(-1) ?? outer.count;
    outer.count += remaining;
    outer.radius *= Math.sqrt(outer.count / nominalCapacity);
    return layers;
  }

  let dynamicLayer = 0;
  while (remaining > 0) {
    const nominalRadius =
      config.outerRadius +
      config.growthLayerSpacing * (dynamicLayer + 1);
    const capacity = Math.max(
      seedCount,
      Math.round(
        config.growthLayerSurfaceDensity * nominalRadius * nominalRadius,
      ),
    );
    let count = Math.min(capacity, remaining);
    if (remaining > capacity && remaining - capacity < seedCount) {
      count = remaining;
    }
    const radius =
      count > capacity
        ? nominalRadius * Math.sqrt(count / capacity)
        : nominalRadius;
    layers.push({
      count,
      radius,
      phase:
        (config.layerPhases.at(-1)! +
          GOLDEN_ANGLE * (dynamicLayer + 1) +
          dynamicLayer * 0.371) %
        (Math.PI * 2),
    });
    remaining -= count;
    dynamicLayer += 1;
  }
  return layers;
}

function gelPlacements(
  layerCounts: readonly number[],
  layerRadii: readonly number[],
  layerPhases: readonly number[],
): GelPlacement[] {
  if (
    layerCounts.length !== layerRadii.length ||
    layerCounts.length !== layerPhases.length
  ) {
    throw new Error("Blob gel layout: configuración de capas inconsistente");
  }
  const placements: GelPlacement[] = [];
  let globalIndex = 0;
  for (let layer = 0; layer < layerCounts.length; layer += 1) {
    const count = layerCounts[layer];
    const radius = layerRadii[layer];
    const phase = layerPhases[layer];
    const anchors = fibonacciAnchors(count, radius, phase);
    for (const anchor of anchors) {
      const radialJitter =
        1 + 0.02 * Math.sin((globalIndex + 1) * 5.398 + layer * 1.73);
      anchor.multiplyScalar(radialJitter);
      // Una deformación leve evita tres cáscaras perfectas y deja una masa
      // orgánica, algo más ancha que alta, sin perder bounds deterministas.
      anchor.x *= 1.04;
      anchor.y *= 0.96;
      anchor.z *= 1.02;
      placements.push({
        anchor,
        layer,
        coreAnchored: layer === 0,
      });
      globalIndex += 1;
    }
  }
  return placements;
}

function growthDirectionForIndex(index: number): Vector3 {
  const sequence = index + 1;
  const verticalUnit =
    sequence * 0.7548776662466927 -
    Math.floor(sequence * 0.7548776662466927);
  const y = 1 - verticalUnit * 2;
  const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
  const angle = sequence * GOLDEN_ANGLE;
  return new Vector3(
    Math.cos(angle) * horizontal,
    y,
    Math.sin(angle) * horizontal,
  );
}

function fibonacciAnchors(
  count: number,
  radius: number,
  phase = 0,
): Vector3[] {
  const anchors: Vector3[] = [];
  for (let index = 0; index < count; index += 1) {
    const y = 1 - (2 * (index + 0.5)) / count;
    const horizontal = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = index * GOLDEN_ANGLE + phase;
    anchors.push(
      new Vector3(
        Math.cos(angle) * horizontal,
        y,
        Math.sin(angle) * horizontal,
      ).multiplyScalar(radius),
    );
  }
  return anchors;
}

function radiusForIndex(index: number, min: number, max: number): number {
  const value = Math.sin((index + 1) * 12.9898) * 43758.5453;
  const unit = value - Math.floor(value);
  return min + (max - min) * unit;
}

function structuralNeighborPairs(
  parts: BlobArmorPart[],
  neighborCount: number,
  layerNeighborCount: number,
  maxLocalDistance: number,
): Array<[BlobArmorPart, BlobArmorPart]> {
  const candidates: Array<{
    partA: BlobArmorPart;
    partB: BlobArmorPart;
    distance: number;
  }> = [];
  for (let from = 0; from < parts.length; from += 1) {
    for (let to = from + 1; to < parts.length; to += 1) {
      if (Math.abs(parts[from].layer - parts[to].layer) > 1) continue;
      candidates.push({
        partA: parts[from],
        partB: parts[to],
        distance: rapierDistance(
          parts[from].body.translation(),
          parts[to].body.translation(),
        ),
      });
    }
  }
  candidates.sort(
    (a, b) =>
      a.distance - b.distance ||
      cohesionPairKey(a.partA, a.partB).localeCompare(
        cohesionPairKey(b.partA, b.partB),
      ),
  );

  const result = new Map<string, [BlobArmorPart, BlobArmorPart]>();
  const connectivity = new NumericDisjointSet(parts.map((part) => part.index));
  const coreRoots = parts.filter((part) => part.coreAnchorEligible);
  const firstRoot = coreRoots[0];
  if (!firstRoot) {
    throw new Error("Blob gel graph: no hay nodos internos");
  }
  // Los roots comparten el nodo virtual del cerebro. Preunirlos evita gastar
  // enlaces vecinos en conectar entre sí piezas que ya tienen camino al core.
  for (const root of coreRoots.slice(1)) {
    connectivity.union(firstRoot.index, root.index);
  }
  // El bosque garantiza que toda esfera tenga un camino físico hacia alguno
  // de los roots internos sin crear ningún resorte largo entre capas lejanas.
  for (const candidate of candidates) {
    if (candidate.distance > maxLocalDistance) break;
    if (
      connectivity.find(candidate.partA.index) ===
      connectivity.find(candidate.partB.index)
    ) {
      continue;
    }
    connectivity.union(candidate.partA.index, candidate.partB.index);
    result.set(cohesionPairKey(candidate.partA, candidate.partB), [
      candidate.partA,
      candidate.partB,
    ]);
  }
  const coreComponent = connectivity.find(firstRoot.index);
  if (
    parts.some(
      (part) => connectivity.find(part.index) !== coreComponent,
    )
  ) {
    throw new Error("Blob gel graph: el radio local no conecta todas las capas");
  }

  const count = Math.max(0, Math.floor(neighborCount));
  const sameLayerCount = Math.max(0, Math.floor(layerNeighborCount));
  for (const part of parts) {
    const nearest = candidates
      .filter(
        (candidate) =>
          candidate.distance <= maxLocalDistance &&
          (candidate.partA === part || candidate.partB === part),
      )
      .slice(0, count);
    for (const candidate of nearest) {
      result.set(cohesionPairKey(candidate.partA, candidate.partB), [
        candidate.partA,
        candidate.partB,
      ]);
    }

    const sameLayerNearest = candidates
      .filter(
        (candidate) =>
          candidate.distance <= maxLocalDistance &&
          candidate.partA.layer === part.layer &&
          candidate.partB.layer === part.layer &&
          (candidate.partA === part || candidate.partB === part),
      )
      .slice(0, sameLayerCount);
    for (const candidate of sameLayerNearest) {
      result.set(cohesionPairKey(candidate.partA, candidate.partB), [
        candidate.partA,
        candidate.partB,
      ]);
    }
  }

  return [...result.values()].sort(
    (a, b) => a[0].index - b[0].index || a[1].index - b[1].index,
  );
}

function releasedComponentGraph(
  parts: BlobArmorPart[],
  bonds: BlobCohesionBond[],
): ReleasedComponentGraph {
  const released = parts.filter((part) => part.state === "released");
  const sets = new NumericDisjointSet(released.map((part) => part.index));
  for (const bond of bonds) {
    if (
      bond.joint?.isValid() &&
      bond.partA.state === "released" &&
      bond.partB.state === "released"
    ) {
      sets.union(bond.partA.index, bond.partB.index);
    }
  }

  const componentByPart = new Map<BlobArmorPart, number>();
  const components = new Map<number, BlobArmorPart[]>();
  for (const part of released) {
    const componentId = sets.find(part.index);
    componentByPart.set(part, componentId);
    const members = components.get(componentId) ?? [];
    members.push(part);
    components.set(componentId, members);
  }
  return { componentByPart, components };
}

class NumericDisjointSet {
  private readonly parent = new Map<number, number>();

  constructor(values: Iterable<number>) {
    for (const value of values) {
      this.parent.set(value, value);
    }
  }

  find(value: number): number {
    const parent = this.parent.get(value);
    if (parent === undefined) {
      this.parent.set(value, value);
      return value;
    }
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const from = Math.max(rootA, rootB);
    const to = Math.min(rootA, rootB);
    this.parent.set(from, to);
  }
}

function cohesionPairKey(
  partA: BlobArmorPart,
  partB: BlobArmorPart,
): string {
  const from = Math.min(partA.index, partB.index);
  const to = Math.max(partA.index, partB.index);
  return `${from}:${to}`;
}

function assignNearestTargets(
  parts: BlobArmorPart[],
  targets: Vector3[],
  coreBody: RAPIER.RigidBody,
): Map<BlobArmorPart, Vector3> {
  if (parts.length === 0 || targets.length === 0) return new Map();
  const costs = parts.map((part) => {
    const current = bodyDirectionInCoreSpace(part, coreBody);
    return targets.map(
      (target) => 1 - current.dot(target.clone().normalize()),
    );
  });
  const targetIndices = minimumCostAssignment(costs);
  const assignments = new Map<BlobArmorPart, Vector3>();
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    assignments.set(parts[partIndex], targets[targetIndices[partIndex]]);
  }
  return assignments;
}

function assignNearestShapeSlots(
  parts: BlobArmorPart[],
  slots: MainShapeSlot[],
  coreBody: RAPIER.RigidBody,
): Map<BlobArmorPart, MainShapeSlot> {
  if (parts.length === 0 || slots.length === 0) return new Map();
  const corePosition = vectorFromRapier(coreBody.translation());
  const costs = parts.map((part) => {
    const direction = bodyDirectionInCoreSpace(part, coreBody);
    const radius = vectorFromRapier(part.body.translation()).distanceTo(
      corePosition,
    );
    return slots.map(
      (slot) =>
        -(
          direction.dot(slot.target.clone().normalize()) * 1.4 -
          Math.abs(radius - slot.target.length()) * 0.5 +
          (part.layer === slot.layer ? 0.04 : 0)
        ),
    );
  });
  const slotIndices = minimumCostAssignment(costs);
  const assignments = new Map<BlobArmorPart, MainShapeSlot>();
  for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
    assignments.set(parts[partIndex], slots[slotIndices[partIndex]]);
  }
  return assignments;
}

/**
 * Hungarian assignment for a rectangular cost matrix (rows <= columns).
 * Unlike a greedy nearest-slot pass, it cannot strand the final blob with an
 * antipodal target and therefore keeps the complete shell uniformly covered.
 */
function minimumCostAssignment(costs: number[][]): number[] {
  const rowCount = costs.length;
  const columnCount = costs[0]?.length ?? 0;
  if (rowCount === 0) return [];
  if (
    columnCount < rowCount ||
    costs.some(
      (row) =>
        row.length !== columnCount ||
        row.some((cost) => !Number.isFinite(cost)),
    )
  ) {
    throw new Error("Blob gel layout: matriz de asignación inválida");
  }

  const rowPotential = new Array(rowCount + 1).fill(0);
  const columnPotential = new Array(columnCount + 1).fill(0);
  const matchedRowByColumn = new Array(columnCount + 1).fill(0);
  const previousColumn = new Array(columnCount + 1).fill(0);

  for (let row = 1; row <= rowCount; row += 1) {
    matchedRowByColumn[0] = row;
    let currentColumn = 0;
    const minimumReducedCost = new Array(columnCount + 1).fill(
      Number.POSITIVE_INFINITY,
    );
    const usedColumn = new Array(columnCount + 1).fill(false);

    do {
      usedColumn[currentColumn] = true;
      const currentRow = matchedRowByColumn[currentColumn];
      let delta = Number.POSITIVE_INFINITY;
      let nextColumn = 0;
      for (let column = 1; column <= columnCount; column += 1) {
        if (usedColumn[column]) continue;
        const reducedCost =
          costs[currentRow - 1][column - 1] -
          rowPotential[currentRow] -
          columnPotential[column];
        if (reducedCost < minimumReducedCost[column]) {
          minimumReducedCost[column] = reducedCost;
          previousColumn[column] = currentColumn;
        }
        if (minimumReducedCost[column] < delta) {
          delta = minimumReducedCost[column];
          nextColumn = column;
        }
      }
      for (let column = 0; column <= columnCount; column += 1) {
        if (usedColumn[column]) {
          rowPotential[matchedRowByColumn[column]] += delta;
          columnPotential[column] -= delta;
        } else {
          minimumReducedCost[column] -= delta;
        }
      }
      currentColumn = nextColumn;
    } while (matchedRowByColumn[currentColumn] !== 0);

    do {
      const nextColumn = previousColumn[currentColumn];
      matchedRowByColumn[currentColumn] =
        matchedRowByColumn[nextColumn];
      currentColumn = nextColumn;
    } while (currentColumn !== 0);
  }

  const columnByRow = new Array(rowCount).fill(-1);
  for (let column = 1; column <= columnCount; column += 1) {
    const row = matchedRowByColumn[column];
    if (row !== 0) columnByRow[row - 1] = column - 1;
  }
  if (columnByRow.some((column) => column < 0)) {
    throw new Error("Blob gel layout: asignación incompleta");
  }
  return columnByRow;
}

function averageNearestTargetSpacing(
  targets: Vector3[],
  fallback: number,
): number {
  if (targets.length < 2) return fallback;
  const nearest = targets.map((target, index) => {
    let minimum = Number.POSITIVE_INFINITY;
    for (let other = 0; other < targets.length; other += 1) {
      if (other === index) continue;
      minimum = Math.min(minimum, target.distanceTo(targets[other]));
    }
    return minimum;
  });
  return (
    nearest.reduce((sum, distance) => sum + distance, 0) / nearest.length
  );
}

function closestBodyDockCandidate(
  component: BlobArmorPart[],
  mainParts: BlobArmorPart[],
  maxDistance: number,
  hasClearPath: (part: BlobArmorPart, target: Vector3) => boolean,
): ReassemblyCandidate | null {
  let best: ReassemblyCandidate | null = null;
  for (const partA of component) {
    if (!partA.body.isValid()) continue;
    for (const partB of mainParts) {
      if (!partB.body.isValid()) continue;
      const distance = rapierDistance(
        partA.body.translation(),
        partB.body.translation(),
      );
      if (
        distance > maxDistance ||
        !hasClearPath(partA, vectorFromRapier(partB.body.translation()))
      ) {
        continue;
      }
      if (
        !best ||
        distance < best.distance ||
        (distance === best.distance &&
          cohesionPairKey(partA, partB) <
            cohesionPairKey(best.partA, best.partB))
      ) {
        best = { partA, partB, distance };
      }
    }
  }
  return best;
}

function closestCoreDockCandidate(
  component: BlobArmorPart[],
  coreBody: RAPIER.RigidBody,
  hasClearPath: (part: BlobArmorPart, target: Vector3) => boolean,
): CoreDockCandidate | null {
  let best: CoreDockCandidate | null = null;
  for (const part of component) {
    if (!part.coreAnchorEligible || !part.body.isValid()) continue;
    const anchor = coreAnchorForPart(part, coreBody);
    const target = coreAnchorWorldPosition(anchor, coreBody);
    const distance = vectorFromRapier(part.body.translation()).distanceTo(target);
    if (
      distance > BlobConfig.armor.reassemblyCoreAttractionRadius ||
      !hasClearPath(part, target)
    ) {
      continue;
    }
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && part.index < best.part.index)
    ) {
      best = { part, anchor, target, distance };
    }
  }
  return best;
}

function coreAnchorForPart(
  part: BlobArmorPart,
  coreBody: RAPIER.RigidBody,
): Vector3 {
  const corePosition = coreBody.translation();
  const partPosition = part.body.translation();
  const direction = new Vector3(
    partPosition.x - corePosition.x,
    partPosition.y - corePosition.y,
    partPosition.z - corePosition.z,
  );
  if (direction.lengthSq() < 1e-5) {
    direction.copy(part.anchorTo);
  } else {
    const rotation = coreBody.rotation();
    direction.applyQuaternion(
      new Quaternion(-rotation.x, -rotation.y, -rotation.z, rotation.w),
    );
  }
  if (direction.lengthSq() < 1e-5) {
    direction.set(0, 1, 0);
  }
  return direction
    .normalize()
    .multiplyScalar(BlobConfig.armor.coreAnchorRadius);
}

function coreAnchorWorldPosition(
  anchor: Vector3,
  coreBody: RAPIER.RigidBody,
): Vector3 {
  const rotation = coreBody.rotation();
  const position = coreBody.translation();
  return anchor
    .clone()
    .applyQuaternion(
      new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    )
    .add(new Vector3(position.x, position.y, position.z));
}

function bodyDirectionInCoreSpace(
  part: BlobArmorPart,
  coreBody: RAPIER.RigidBody,
): Vector3 {
  const corePosition = coreBody.translation();
  const partPosition = part.body.translation();
  const current = new Vector3(
    partPosition.x - corePosition.x,
    partPosition.y - corePosition.y,
    partPosition.z - corePosition.z,
  );
  if (current.lengthSq() < 1e-5) {
    const fallback = part.joint?.isValid()
      ? vectorFromRapier(part.joint.anchor1())
      : part.anchorTo.clone();
    return fallback.lengthSq() > 1e-5
      ? fallback.normalize()
      : new Vector3(0, 1, 0);
  }

  // Los anchors del joint están en espacio local del core. Llevar la posición
  // física actual a ese mismo espacio hace que un blob estirado por la Gravity
  // Gun elija realmente el destino más cercano al redistribuirse.
  const rotation = coreBody.rotation();
  current.applyQuaternion(
    new Quaternion(-rotation.x, -rotation.y, -rotation.z, rotation.w),
  );
  return current.normalize();
}

function cohesionBondExtension(bond: BlobCohesionBond): number {
  if (!bond.partA.body.isValid() || !bond.partB.body.isValid()) {
    return Number.POSITIVE_INFINITY;
  }
  return (
    rapierDistance(
      bond.partA.body.translation(),
      bond.partB.body.translation(),
    ) - bond.restLength
  );
}

function cohesionRelativeSpeed(
  part: BlobArmorPart,
  other: BlobArmorPart,
): number {
  if (!part.body.isValid() || !other.body.isValid()) return 0;

  const partPosition = part.body.translation();
  const otherPosition = other.body.translation();
  const axisX = partPosition.x - otherPosition.x;
  const axisY = partPosition.y - otherPosition.y;
  const axisZ = partPosition.z - otherPosition.z;
  const distance = Math.hypot(axisX, axisY, axisZ);

  const partVelocity = part.body.linvel();
  const otherVelocity = other.body.linvel();
  const relativeX = partVelocity.x - otherVelocity.x;
  const relativeY = partVelocity.y - otherVelocity.y;
  const relativeZ = partVelocity.z - otherVelocity.z;
  if (distance < 1e-4) {
    return Math.hypot(relativeX, relativeY, relativeZ);
  }
  return Math.abs(
    (relativeX * axisX + relativeY * axisY + relativeZ * axisZ) / distance,
  );
}

function relativeSpeed(partA: BlobArmorPart, partB: BlobArmorPart): number {
  if (!partA.body.isValid() || !partB.body.isValid()) {
    return Number.POSITIVE_INFINITY;
  }
  const velocityA = partA.body.linvel();
  const velocityB = partB.body.linvel();
  return Math.hypot(
    velocityA.x - velocityB.x,
    velocityA.y - velocityB.y,
    velocityA.z - velocityB.z,
  );
}

function relativeVelocityVector(
  partA: BlobArmorPart,
  partB: BlobArmorPart,
): Vector3 {
  if (!partA.body.isValid() || !partB.body.isValid()) return new Vector3();
  return vectorFromRapier(partB.body.linvel()).sub(
    vectorFromRapier(partA.body.linvel()),
  );
}

function activeBondDegree(
  bonds: BlobCohesionBond[],
  part: BlobArmorPart,
): number {
  return bonds.reduce(
    (degree, bond) =>
      degree +
      (bond.joint?.isValid() &&
      (bond.partA === part || bond.partB === part)
        ? 1
        : 0),
    0,
  );
}

function passiveBondToughness(indexA: number, indexB: number): number {
  const low = Math.min(indexA, indexB) + 1;
  const high = Math.max(indexA, indexB) + 1;
  const noise = Math.sin(low * 91.733 + high * 37.719) * 43758.5453;
  const unit = noise - Math.floor(noise);
  return 0.86 + unit * 0.28;
}

function passivePartToughness(index: number): number {
  const noise = Math.sin((index + 1) * 53.117) * 43758.5453;
  const unit = noise - Math.floor(noise);
  return 0.82 + unit * 0.36;
}

function passivePatchSize(index: number, maximum: number): number {
  const count = Math.max(1, Math.floor(maximum));
  const noise = Math.sin((index + 1) * 71.911) * 43758.5453;
  const unit = noise - Math.floor(noise);
  return 1 + Math.floor(unit * count);
}

function queueImpulse(
  queued: Map<BlobArmorPart, Vector3>,
  part: BlobArmorPart,
  impulse: Vector3,
): void {
  const current = queued.get(part);
  if (current) {
    current.add(impulse);
  } else {
    queued.set(part, impulse.clone());
  }
}

function componentSignature(parts: BlobArmorPart[]): string {
  return parts
    .map((part) => part.index)
    .sort((a, b) => a - b)
    .join(":");
}

function compactFragmentAssignments(
  parts: BlobArmorPart[],
): Map<number, Vector3> {
  const sorted = [...parts].sort((a, b) => a.index - b.index);
  const signature = componentSignature(sorted);
  let hash = 2166136261;
  for (let index = 0; index < signature.length; index += 1) {
    hash = Math.imul(hash ^ signature.charCodeAt(index), 16777619);
  }
  const unit = (hash >>> 0) / 0xffffffff;
  const phase = unit * Math.PI * 2;
  const tilt = (((hash >>> 9) & 0x7fff) / 0x7fff - 0.5) * Math.PI;
  const rotation = new Quaternion()
    .setFromAxisAngle(new Vector3(0, 1, 0), phase)
    .multiply(
      new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), tilt),
    );
  const targets = fibonacciAnchors(sorted.length, 1, phase).map((target) =>
    target.applyQuaternion(rotation),
  );
  const targetCenter = targets
    .reduce((sum, target) => sum.add(target), new Vector3())
    .multiplyScalar(1 / targets.length);
  for (const target of targets) target.sub(targetCenter);

  let minimumTargetDistance = Number.POSITIVE_INFINITY;
  for (let from = 0; from < targets.length; from += 1) {
    for (let to = from + 1; to < targets.length; to += 1) {
      minimumTargetDistance = Math.min(
        minimumTargetDistance,
        targets[from].distanceTo(targets[to]),
      );
    }
  }
  const averageRadius =
    sorted.reduce((sum, part) => sum + partRadius(part), 0) / sorted.length;
  const targetSpacing =
    averageRadius * 2 + BlobConfig.armor.fragmentShapePadding;
  const scale =
    Number.isFinite(minimumTargetDistance) && minimumTargetDistance > 1e-5
      ? targetSpacing / minimumTargetDistance
      : targetSpacing;
  for (const target of targets) target.multiplyScalar(scale);

  const center = sorted
    .reduce(
      (sum, part) => sum.add(vectorFromRapier(part.body.translation())),
      new Vector3(),
    )
    .multiplyScalar(1 / sorted.length);
  const candidates: Array<{
    part: BlobArmorPart;
    target: Vector3;
    targetIndex: number;
    score: number;
  }> = [];
  for (const part of sorted) {
    const relative = vectorFromRapier(part.body.translation()).sub(center);
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
      candidates.push({
        part,
        target: targets[targetIndex],
        targetIndex,
        score: relative.distanceToSquared(targets[targetIndex]),
      });
    }
  }
  candidates.sort(
    (a, b) =>
      a.score - b.score ||
      a.part.index - b.part.index ||
      a.targetIndex - b.targetIndex,
  );
  const assignedParts = new Set<BlobArmorPart>();
  const assignedTargets = new Set<number>();
  const assignments = new Map<number, Vector3>();
  for (const candidate of candidates) {
    if (
      assignedParts.has(candidate.part) ||
      assignedTargets.has(candidate.targetIndex)
    ) {
      continue;
    }
    assignments.set(candidate.part.index, candidate.target.clone());
    assignedParts.add(candidate.part);
    assignedTargets.add(candidate.targetIndex);
    if (assignments.size === sorted.length) break;
  }
  return assignments;
}

function gelLayerSurfaceSpacings(): number[] {
  const placements = gelPlacements(
    BlobConfig.armor.layerCounts,
    BlobConfig.armor.layerRadii,
    BlobConfig.armor.layerPhases,
  );
  return BlobConfig.armor.layerCounts.map((_, layer) => {
    const anchors = placements
      .filter((placement) => placement.layer === layer)
      .map((placement) => placement.anchor);
    if (anchors.length < 2) return BlobConfig.armor.maxRadius * 2;
    const nearest = anchors.map((anchor, index) => {
      let minimum = Number.POSITIVE_INFINITY;
      for (let other = 0; other < anchors.length; other += 1) {
        if (other === index) continue;
        minimum = Math.min(minimum, anchor.distanceTo(anchors[other]));
      }
      return minimum;
    });
    return nearest.reduce((sum, distance) => sum + distance, 0) /
      nearest.length;
  });
}

function deterministicPairTangent(
  indexA: number,
  indexB: number,
  normal: Vector3,
): Vector3 {
  const low = Math.min(indexA, indexB) + 1;
  const high = Math.max(indexA, indexB) + 1;
  const seed = new Vector3(
    Math.sin(low * 12.9898 + high * 4.1414),
    Math.sin(low * 7.233 + high * 19.19),
    Math.sin(low * 3.117 + high * 9.731),
  );
  seed.addScaledVector(normal, -seed.dot(normal));
  if (seed.lengthSq() <= 1e-8) {
    const fallback =
      Math.abs(normal.y) < 0.8
        ? new Vector3(0, 1, 0)
        : new Vector3(1, 0, 0);
    seed.copy(fallback.cross(normal));
  }
  return seed.normalize();
}

function finitePhysicsElapsed(delta: number): number {
  return Number.isFinite(delta)
    ? Math.min(Math.max(0, delta), 1 / 20)
    : 0;
}

function partRadius(part: BlobArmorPart): number {
  return part.radius;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rapierDistance(a: RAPIER.Vector, b: RAPIER.Vector): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function vectorFromRapier(value: RAPIER.Vector): Vector3 {
  return new Vector3(value.x, value.y, value.z);
}
