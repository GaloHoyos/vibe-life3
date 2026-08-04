import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LOD,
  MathUtils,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  SpotLight,
  Vector3,
} from "three";
import {
  isCreatureVehicle,
  type VehicleArchetypeId,
} from "@game/config/vehicles.config";
import type { Disposable } from "@shared/types/lifecycle";
import {
  createCreatureVehicleAnimator,
  type CreatureVehicleAnimator,
} from "./CreatureVehicleAnimator";

export interface VehicleVisualTelemetry {
  speed: number;
  /** Velocidad con signo sobre +Z local: de acá sale la aceleración propia. */
  forwardSpeed: number;
  /** Guiñada en rad/s, para las inercias de los vehículos animados. */
  yawRate: number;
  steering: number;
  wheelRotation: number;
  suspension: readonly number[];
  engine01: number;
  /** Si hay alguien a bordo. Los vehículos vivos dormitan vacíos. */
  occupied: boolean;
  /** Mirada del que maneja, en ejes del vehículo. */
  riderYaw: number;
  riderPitch: number;
  /** Destruido: los vehículos vivos pasan a cadáver en vez de a chatarra. */
  dead: boolean;
}

export interface VehicleVisualModelLease extends Disposable {
  readonly root: Object3D | null;
}

export interface VehicleVisual extends Disposable {
  readonly root: Group;
  readonly cameraAnchors: ReadonlyMap<string, Object3D>;
  readonly exitAnchors: ReadonlyMap<string, readonly Object3D[]>;
  readonly seatAnchors: ReadonlyMap<string, Object3D>;
  readonly muzzle: Object3D | null;
  installModel(lease: VehicleVisualModelLease): boolean;
  hasGeneratedModel(): boolean;
  update(delta: number, telemetry: VehicleVisualTelemetry): void;
  aim(yaw: number, pitch: number): void;
  setLights(enabled: boolean): void;
  setDamage(hull01: number, burning: boolean): void;
  setWreckage(enabled: boolean): void;
  /**
   * Sacudón puntual. Sólo lo acusan los vehículos vivos: al montarlos, al
   * recibir un impacto. En una máquina no hace nada.
   */
  startle(intensity: number): void;
}

interface VisualRig {
  root: Group;
  wheels: Group[];
  frontWheelPivots: Group[];
  suspensionArms: Object3D[];
  steeringWheel: Object3D | null;
  speedNeedle: Object3D | null;
  engineNeedle: Object3D | null;
  rotor: Object3D | null;
  tailRotor: Object3D | null;
  fans: Object3D[];
  rudders: Object3D[];
  turretYaw: Object3D | null;
  turretPitch: Object3D | null;
  muzzle: Object3D | null;
  lights: SpotLight[];
  damageMaterials: MeshStandardMaterial[];
  cameraAnchors: Map<string, Object3D>;
  seatAnchors: Map<string, Object3D>;
  exitAnchors: Map<string, Object3D[]>;
}

interface ImportedAnimatedNode {
  readonly node: Object3D;
  readonly baseY: number;
  readonly baseRotation: readonly [number, number, number];
  readonly telemetryIndex: number;
  readonly direction: number;
}

interface ImportedMaterialState {
  readonly material: MeshStandardMaterial;
  readonly color: Color;
  readonly emissive: Color;
}

interface ImportedVisualRig {
  readonly root: Object3D;
  readonly lod: LOD;
  readonly creature: CreatureVehicleAnimator | null;
  readonly wreckage: Object3D | null;
  readonly wheels: readonly ImportedAnimatedNode[];
  readonly fans: readonly ImportedAnimatedNode[];
  readonly rudders: readonly ImportedAnimatedNode[];
  readonly mainRotors: readonly ImportedAnimatedNode[];
  readonly tailRotors: readonly ImportedAnimatedNode[];
  readonly turretYaw: readonly ImportedAnimatedNode[];
  readonly turretPitch: readonly ImportedAnimatedNode[];
  readonly damageMaterials: readonly ImportedMaterialState[];
  readonly cameraAnchors: ReadonlyMap<string, Object3D>;
  readonly seatAnchors: ReadonlyMap<string, Object3D>;
  readonly exitAnchors: ReadonlyMap<string, readonly Object3D[]>;
  readonly muzzle: Object3D | null;
}

const Y_AXIS = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);
// Ejes de rueda del buggy, derivados del preset físico (body.size 2.15×1.35×3.8,
// colliderCenter.y 0.75) tal como los arma `VehicleEntity.createMotor`.
const BUGGY_WHEEL_HALF_WIDTH = 2.15 * 0.46;
const BUGGY_WHEEL_HALF_LENGTH = 3.8 * 0.36;
/** Conexión (0.75 − 0.24) menos la suspensión totalmente extendida (0.36). */
const BUGGY_WHEEL_REST_Y = 0.75 - 0.24 - 0.36;
/**
 * Puesto de manejo del buggy, en +X porque la derecha del proyecto es −X. Mismo
 * reparto que el GLB generado: volante a la izquierda y cañón sobre el larguero
 * del artillero. Este rig procedural es el respaldo si el modelo no carga, así
 * que si los dos no coinciden el jugador cambia de lado al fallar la carga.
 */
const BUGGY_DRIVER_X = 0.42;
const BUGGY_GUN_X = -0.72;
const REBEL_CRAWLER_WHEEL_HALF_WIDTH = 2.7 * 0.46;
const REBEL_CRAWLER_WHEEL_HALF_LENGTH = 4.9 * 0.36;
const REBEL_CRAWLER_WHEEL_REST_Y = 1 - 0.24 - 0.42;
const TMP_DIRECTION = new Vector3();
const TMP_MIDPOINT = new Vector3();
const TMP_QUATERNION = new Quaternion();

export function createVehicleVisual(archetype: VehicleArchetypeId): VehicleVisual {
  // El nadador cae en el rig del deslizador: este armado procedural sólo se ve
  // si falla la carga del GLB, y ahí importa que el vehículo tenga el volumen y
  // los nodos correctos, no de qué está hecho.
  const rig = archetype === "buggy"
    ? buildBuggy()
    : archetype === "airboat"
      ? buildAirboat()
      : archetype === "helicopter"
        ? buildHelicopter()
        : archetype === "rebelCrawler"
          ? buildRebelCrawler()
          : buildCombineGlider();

  let rotorAngle = 0;
  let fanAngle = 0;
  let damage01 = 0;
  let isBurning = false;
  let wreckage = false;
  let aimYaw = 0;
  let aimPitch = 0;
  let imported: ImportedVisualRig | null = null;
  let importedLease: VehicleVisualModelLease | null = null;
  let disposed = false;
  const proceduralVisibility = new Map(
    rig.root.children.map((child) => [child, child.visible] as const),
  );

  return {
    root: rig.root,
    get cameraAnchors(): ReadonlyMap<string, Object3D> {
      return imported?.cameraAnchors ?? rig.cameraAnchors;
    },
    get exitAnchors(): ReadonlyMap<string, readonly Object3D[]> {
      return imported?.exitAnchors ?? rig.exitAnchors;
    },
    get seatAnchors(): ReadonlyMap<string, Object3D> {
      return imported?.seatAnchors ?? rig.seatAnchors;
    },
    get muzzle(): Object3D | null {
      return imported?.muzzle ?? rig.muzzle;
    },
    installModel(lease): boolean {
      if (disposed || !lease.root) {
        lease.dispose();
        return false;
      }

      let nextImported: ImportedVisualRig;
      try {
        nextImported = bindImportedRig(lease.root, archetype, rig);
      } catch {
        lease.dispose();
        return false;
      }
      imported?.creature?.dispose();
      imported?.root.removeFromParent();
      importedLease?.dispose();
      importedLease = lease;
      imported = nextImported;
      proceduralVisibility.forEach((_visible, child) => {
        const isLightTarget = rig.lights.some((light) => light.target === child);
        if (!(child instanceof SpotLight) && !isLightTarget) {
          child.visible = false;
        }
      });
      rig.root.add(imported.root);
      applyImportedAim(imported, aimYaw, aimPitch);
      applyImportedDamage(imported, damage01, isBurning);
      setImportedWreckage(imported, wreckage);
      rig.root.updateMatrixWorld(true);
      return true;
    },
    hasGeneratedModel(): boolean {
      return imported !== null;
    },
    update(delta, telemetry): void {
      const steering = MathUtils.clamp(telemetry.steering, -1, 1);
      // Girar sobre +Y lleva el morro hacia +X, que es la IZQUIERDA (la derecha
      // del proyecto es `forward × up` = -X). Sin el signo las ruedas apuntaban
      // al lado contrario del que doblaba el chasis.
      rig.frontWheelPivots.forEach((pivot) => {
        pivot.rotation.y = -steering * 0.48;
      });
      rig.wheels.forEach((wheel, index) => {
        wheel.rotation.x =
          telemetry.wheelRotation *
          (index % 2 === 0 ? 1 : -1);
        const suspension = telemetry.suspension[index] ?? 0;
        wheel.position.y = suspension;
      });
      rig.suspensionArms.forEach((arm, index) => {
        arm.rotation.x = (telemetry.suspension[index] ?? 0) * 0.6;
      });
      if (rig.steeringWheel) {
        // Visto desde el asiento, +Z hacia adelante, girar sobre el eje del
        // volante en positivo lo lleva en sentido horario: doblar a la derecha.
        rig.steeringWheel.rotation.z = steering * 1.7;
      }
      if (rig.speedNeedle) {
        rig.speedNeedle.rotation.z =
          MathUtils.lerp(2.15, -2.15, MathUtils.clamp(telemetry.speed / 42, 0, 1));
      }
      if (rig.engineNeedle) {
        rig.engineNeedle.rotation.z =
          MathUtils.lerp(1.9, -1.9, MathUtils.clamp(telemetry.engine01, 0, 1));
      }

      rotorAngle += delta * MathUtils.lerp(1.5, 34, telemetry.engine01);
      fanAngle += delta * MathUtils.lerp(0.8, 45, telemetry.engine01);
      if (rig.rotor) rig.rotor.rotation.y = rotorAngle;
      if (rig.tailRotor) rig.tailRotor.rotation.z = rotorAngle * 1.7;
      rig.fans.forEach((fan) => {
        fan.rotation.z = fanAngle;
      });
      rig.rudders.forEach((rudder) => {
        rudder.rotation.y = -steering * 0.55;
      });
      if (imported) {
        updateImportedRig(
          imported,
          telemetry,
          steering,
          rotorAngle,
          fanAngle,
        );
        // Después del rig genérico: la criatura escribe sobre los mismos nodos
        // (los timones son sus aletas caudales) y tiene que ganar ella.
        imported.creature?.update(delta, {
          speed: telemetry.speed,
          forwardSpeed: telemetry.forwardSpeed,
          steering,
          yawRate: telemetry.yawRate,
          engine01: telemetry.engine01,
          hull01: damage01,
          burning: isBurning,
          occupied: telemetry.occupied,
          riderYaw: telemetry.riderYaw,
          riderPitch: telemetry.riderPitch,
          dead: telemetry.dead || wreckage,
        });
      }

      const targetDamage = 1 - MathUtils.clamp(damage01, 0, 1);
      rig.damageMaterials.forEach((material) => {
        material.emissiveIntensity = MathUtils.lerp(
          material.emissiveIntensity,
          targetDamage * 0.12,
          1 - Math.exp(-delta * 4),
        );
      });
      imported?.damageMaterials.forEach(({ material }) => {
        material.emissiveIntensity = MathUtils.lerp(
          material.emissiveIntensity,
          isBurning ? 0.34 : targetDamage * 0.12,
          1 - Math.exp(-delta * 4),
        );
      });
    },
    aim(yaw, pitch): void {
      aimYaw = yaw;
      aimPitch = pitch;
      if (rig.turretYaw) {
        rig.turretYaw.rotation.y = yaw;
      }
      if (rig.turretPitch) {
        rig.turretPitch.rotation.x = -pitch;
      }
      if (imported) applyImportedAim(imported, yaw, pitch);
    },
    setLights(enabled): void {
      rig.lights.forEach((light) => {
        light.intensity = enabled ? 34 : 0;
      });
      rig.root.traverse((lens) => {
        if (lens.name !== "vehicle-headlight-lens") return;
        if (lens instanceof Mesh && lens.material instanceof MeshStandardMaterial) {
          lens.material.emissiveIntensity = enabled ? 5.5 : 0.18;
        }
      });
    },
    setDamage(hull01, burning): void {
      damage01 = MathUtils.clamp(hull01, 0, 1);
      isBurning = burning;
      rig.damageMaterials.forEach((material) => {
        material.color.lerp(new Color(0x16120f), (1 - damage01) * 0.42);
        material.emissive.setHex(burning ? 0xa82808 : 0x1f0903);
        material.emissiveIntensity = burning ? 0.34 : (1 - damage01) * 0.12;
      });
      if (imported) applyImportedDamage(imported, damage01, isBurning);
    },
    setWreckage(enabled): void {
      wreckage = enabled;
      if (imported) setImportedWreckage(imported, enabled);
    },
    startle(intensity): void {
      imported?.creature?.startle(intensity);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      imported?.creature?.dispose();
      imported?.root.removeFromParent();
      imported = null;
      importedLease?.dispose();
      importedLease = null;
      rig.root.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        node.geometry.dispose();
        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];
        materials.forEach((material) => material.dispose());
      });
      rig.root.removeFromParent();
    },
  };
}

function bindImportedRig(
  root: Object3D,
  archetype: VehicleArchetypeId,
  fallback: VisualRig,
): ImportedVisualRig {
  const lod = root.getObjectByName("runtime_visual_lods");
  if (!(lod instanceof LOD)) {
    throw new Error(`El modelo ${archetype} no contiene un LOD preparado.`);
  }

  const wheels = archetype === "buggy" || archetype === "rebelCrawler"
    ? [
        ...animatedVariants(root, "wheel_front_left", 0, 1, 2),
        ...animatedVariants(root, "wheel_front_right", 1, -1, 2),
        ...animatedVariants(root, "wheel_rear_left", 2, 1, 2),
        ...animatedVariants(root, "wheel_rear_right", 3, -1, 2),
      ]
    : [];
  const hasFanRig = archetype === "airboat" ||
    archetype === "combineGlider" ||
    archetype === "combineSwimmer";
  const fans = hasFanRig ? animatedVariants(root, "fan_main", 0, 1, 1) : [];
  const rudders = hasFanRig
    ? [
        ...animatedVariants(root, "rudder_left", 0, 1, 1),
        ...animatedVariants(root, "rudder_right", 1, 1, 1),
      ]
    : [];
  const mainRotors = archetype === "helicopter"
    ? animatedVariants(root, "rotor_main", 0, 1, 1)
    : [];
  const tailRotors = archetype === "helicopter"
    ? animatedVariants(root, "rotor_tail", 0, 1, 1)
    : [];
  const turretYaw = animatedVariants(root, "turret_yaw", 0, 1, 1);
  const turretPitch = animatedVariants(root, "turret_pitch", 0, 1, 1);

  const seatAnchors = new Map(fallback.seatAnchors);
  const cameraAnchors = new Map(fallback.cameraAnchors);
  const exitAnchors = new Map<string, readonly Object3D[]>(
    fallback.exitAnchors,
  );
  bindImportedAnchors(
    root,
    archetype,
    seatAnchors,
    cameraAnchors,
    exitAnchors,
  );

  const muzzle = root.getObjectByName("muzzle") ?? fallback.muzzle;
  const primaryPitch = root.getObjectByName("turret_pitch");
  if (muzzle && muzzle !== fallback.muzzle && primaryPitch) {
    root.updateMatrixWorld(true);
    primaryPitch.attach(muzzle);
  }

  const damageMaterials = new Map<
    MeshStandardMaterial,
    ImportedMaterialState
  >();
  lod.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const materials = Array.isArray(node.material)
      ? node.material
      : [node.material];
    materials.forEach((material) => {
      if (!(material instanceof MeshStandardMaterial)) return;
      // El daño tizna y enrojece la chapa. Aplicado al cristal lo vuelve un
      // panel opaco al carbonizarse y lo enciende al arder, que es justo lo
      // que un vidrio no hace.
      if (material.transparent) return;
      // Lo mismo con lo que emite luz propia: el tiznado le pisa el
      // `emissiveIntensity` y a vida llena lo deja en cero, que es por qué los
      // emisores Combine se veían apagados. Su brillo lo maneja quien los
      // encendió.
      if (!isBlack(material.emissive)) return;
      damageMaterials.set(material, {
        material,
        color: material.color.clone(),
        emissive: material.emissive.clone(),
      });
    });
  });

  return {
    root,
    lod,
    creature: isCreatureVehicle(archetype)
      ? createCreatureVehicleAnimator(root)
      : null,
    wreckage: root.getObjectByName("wreckage") ?? null,
    wheels,
    fans,
    rudders,
    mainRotors,
    tailRotors,
    turretYaw,
    turretPitch,
    damageMaterials: [...damageMaterials.values()],
    cameraAnchors,
    seatAnchors,
    exitAnchors,
    muzzle,
  };
}

function isBlack(color: Color): boolean {
  return color.r === 0 && color.g === 0 && color.b === 0;
}

function animatedVariants(
  root: Object3D,
  baseName: string,
  telemetryIndex: number,
  direction: number,
  highestLod: 1 | 2,
): ImportedAnimatedNode[] {
  const names = [
    baseName,
    ...Array.from(
      { length: highestLod },
      (_unused, index) => `${baseName}_lod${index + 1}`,
    ),
  ];
  return names.flatMap((name) => {
    const node = root.getObjectByName(name);
    if (!node) return [];
    return [{
      node,
      baseY: node.position.y,
      baseRotation: [node.rotation.x, node.rotation.y, node.rotation.z],
      telemetryIndex,
      direction,
    }];
  });
}

function bindImportedAnchors(
  root: Object3D,
  archetype: VehicleArchetypeId,
  seats: Map<string, Object3D>,
  cameras: Map<string, Object3D>,
  exits: Map<string, readonly Object3D[]>,
): void {
  if (archetype === "buggy") {
    bindAnchor(seats, "driver", root, "seat_driver");
    bindAnchor(seats, "gunner", root, "seat_gunner");
    bindAnchor(cameras, "driver", root, "camera_driver");
    bindAnchor(cameras, "gunner", root, "camera_gunner");
    bindExits(exits, "driver", root, ["exit_left", "exit_right"]);
    bindExits(exits, "gunner", root, ["exit_right", "exit_left"]);
    return;
  }
  if (archetype === "airboat") {
    bindAnchor(seats, "driver", root, "seat_driver");
    bindAnchor(cameras, "driver", root, "camera_driver");
    bindExits(exits, "driver", root, ["exit_left", "exit_right"]);
    return;
  }
  if (archetype === "rebelCrawler") {
    bindAnchor(seats, "driver", root, "seat_driver");
    bindAnchor(seats, "passenger", root, "seat_passenger");
    bindAnchor(cameras, "driver", root, "camera_driver");
    bindAnchor(cameras, "passenger", root, "camera_passenger");
    bindExits(exits, "driver", root, ["exit_left", "exit_right"]);
    bindExits(exits, "passenger", root, ["exit_right", "exit_left"]);
    return;
  }
  if (archetype === "combineGlider" || archetype === "combineSwimmer") {
    bindAnchor(seats, "driver", root, "seat_driver");
    bindAnchor(cameras, "driver", root, "camera_driver");
    bindExits(exits, "driver", root, ["exit_left", "exit_right"]);
    return;
  }

  bindAnchor(seats, "pilot", root, "seat_pilot");
  bindAnchor(seats, "commander", root, "seat_commander");
  bindAnchor(seats, "door-gunner", root, "seat_gunner");
  bindAnchor(seats, "passenger", root, "seat_passenger_right");
  bindAnchor(cameras, "pilot", root, "camera_pilot");
  bindAnchor(cameras, "commander", root, "camera_commander");
  bindAnchor(cameras, "door-gunner", root, "camera_gunner");
  bindAnchor(cameras, "passenger", root, "camera_passenger");
  bindExits(exits, "pilot", root, ["exit_right"]);
  bindExits(exits, "commander", root, ["exit_right"]);
  bindExits(exits, "door-gunner", root, ["exit_left"]);
  bindExits(exits, "passenger", root, ["exit_right", "exit_left"]);
}

function bindAnchor(
  target: Map<string, Object3D>,
  key: string,
  root: Object3D,
  nodeName: string,
): void {
  const anchor = root.getObjectByName(nodeName);
  if (anchor) target.set(key, anchor);
}

function bindExits(
  target: Map<string, readonly Object3D[]>,
  key: string,
  root: Object3D,
  nodeNames: readonly string[],
): void {
  const anchors = nodeNames.flatMap((name) => {
    const anchor = root.getObjectByName(name);
    return anchor ? [anchor] : [];
  });
  if (anchors.length > 0) target.set(key, anchors);
}

function updateImportedRig(
  rig: ImportedVisualRig,
  telemetry: VehicleVisualTelemetry,
  steering: number,
  rotorAngle: number,
  fanAngle: number,
): void {
  rig.wheels.forEach((entry) => {
    // `suspension` viene en metros: `baseY` es la rueda con la suspensión
    // totalmente extendida, y comprimirla la sube contra el chasis.
    const suspension = telemetry.suspension[entry.telemetryIndex] ?? 0;
    entry.node.position.y = entry.baseY + suspension;
    entry.node.rotation.set(
      entry.baseRotation[0] + telemetry.wheelRotation * entry.direction,
      entry.baseRotation[1] -
        (entry.telemetryIndex < 2 ? steering * 0.48 : 0),
      entry.baseRotation[2],
    );
  });
  rig.fans.forEach((entry) => {
    entry.node.rotation.set(
      entry.baseRotation[0],
      entry.baseRotation[1],
      entry.baseRotation[2] + fanAngle * entry.direction,
    );
  });
  rig.rudders.forEach((entry) => {
    entry.node.rotation.set(
      entry.baseRotation[0],
      entry.baseRotation[1] - steering * 0.55,
      entry.baseRotation[2],
    );
  });
  rig.mainRotors.forEach((entry) => {
    entry.node.rotation.set(
      entry.baseRotation[0],
      entry.baseRotation[1] + rotorAngle,
      entry.baseRotation[2],
    );
  });
  rig.tailRotors.forEach((entry) => {
    entry.node.rotation.set(
      entry.baseRotation[0],
      entry.baseRotation[1],
      entry.baseRotation[2] + rotorAngle * 1.7,
    );
  });
}

function applyImportedAim(
  rig: ImportedVisualRig,
  yaw: number,
  pitch: number,
): void {
  rig.turretYaw.forEach((entry) => {
    entry.node.rotation.set(
      entry.baseRotation[0],
      entry.baseRotation[1] + yaw,
      entry.baseRotation[2],
    );
  });
  rig.turretPitch.forEach((entry) => {
    entry.node.rotation.set(
      entry.baseRotation[0] - pitch,
      entry.baseRotation[1],
      entry.baseRotation[2],
    );
  });
}

function applyImportedDamage(
  rig: ImportedVisualRig,
  hull01: number,
  burning: boolean,
): void {
  const damage = 1 - MathUtils.clamp(hull01, 0, 1);
  const damageColor = new Color(0x16120f);
  const damageEmissive = new Color(burning ? 0xa82808 : 0x1f0903);
  rig.damageMaterials.forEach(({ material, color, emissive }) => {
    material.color.copy(color).lerp(damageColor, damage * 0.42);
    material.emissive
      .copy(emissive)
      .lerp(damageEmissive, burning ? 0.88 : damage * 0.32);
    material.emissiveIntensity = burning ? 0.34 : damage * 0.12;
  });
}

function setImportedWreckage(
  rig: ImportedVisualRig,
  enabled: boolean,
): void {
  // Una criatura no deja chatarra: deja un cadáver, y el cadáver es este mismo
  // modelo con los apéndices sueltos. Esconder el LOD para mostrar una carcasa
  // aparte era justamente lo que hacía que el muerto no se pareciera al vivo.
  rig.lod.visible = !enabled || rig.creature !== null;
  rig.wreckage?.traverse((node) => {
    node.visible = enabled && rig.creature === null;
  });
}

function buildBuggy(): VisualRig {
  const root = namedGroup("vehicle-buggy");
  const mats = buggyMaterials();
  const lod = new LOD();
  lod.name = "visual_lods";
  root.add(lod);

  const full = namedGroup("visual_lod0");
  addBuggyHull(full, mats, true);
  lod.addLevel(full, 0);
  const medium = namedGroup("visual_lod1");
  addBuggyHull(medium, mats, false);
  lod.addLevel(medium, 52);
  const low = namedGroup("visual_lod2");
  low.add(box([0, 0.8, 0], [2.08, 0.72, 3.55], mats.body));
  low.add(box([0, 1.3, -0.05], [1.62, 0.75, 1.6], mats.dark));
  lod.addLevel(low, 115);

  const wheels: Group[] = [];
  const frontWheelPivots: Group[] = [];
  const suspensionArms: Object3D[] = [];
  // Mismos ejes que arma `VehicleEntity.createMotor` para el raycast: el pivote
  // va en la rueda con la suspensión extendida y sube al comprimirse.
  for (const z of [-BUGGY_WHEEL_HALF_LENGTH, BUGGY_WHEEL_HALF_LENGTH]) {
    for (const x of [-BUGGY_WHEEL_HALF_WIDTH, BUGGY_WHEEL_HALF_WIDTH]) {
      const pivot = namedGroup(z > 0 ? "wheel_front_pivot" : "wheel_rear_pivot");
      pivot.position.set(x, BUGGY_WHEEL_REST_Y, z);
      const wheel = namedGroup("wheel");
      wheel.add(cylinder([0, 0, 0], 0.46, 0.34, mats.rubber, 18, Z_AXIS, Math.PI / 2));
      wheel.add(cylinder([0, 0, 0], 0.25, 0.35, mats.metal, 12, Z_AXIS, Math.PI / 2));
      for (let i = 0; i < 8; i += 1) {
        const spoke = tube(
          new Vector3(0, 0, 0),
          new Vector3(Math.cos((i / 8) * Math.PI * 2) * 0.22, Math.sin((i / 8) * Math.PI * 2) * 0.22, 0),
          0.026,
          mats.metal,
          6,
        );
        spoke.rotation.y = Math.PI / 2;
        wheel.add(spoke);
      }
      pivot.add(wheel);
      root.add(pivot);
      wheels.push(wheel);
      if (z > 0) frontWheelPivots.push(pivot);

      const arm = tube(
        new Vector3(x * 0.42, BUGGY_WHEEL_REST_Y + 0.2, z * 0.72),
        new Vector3(x * 0.92, BUGGY_WHEEL_REST_Y + 0.04, z),
        0.06,
        mats.metal,
      );
      full.add(arm);
      suspensionArms.push(arm);
    }
  }

  const cockpit = addBuggyCockpit(root, mats);
  const turret = addBuggyTurret(root, mats);
  const anchors = buildAnchors(root, {
    seats: {
      driver: [BUGGY_DRIVER_X, 1.05, 0.15],
      gunner: [-BUGGY_DRIVER_X, 1.05, 0.15],
    },
    cameras: {
      driver: [BUGGY_DRIVER_X, 1.42, 0.15],
      gunner: [-BUGGY_DRIVER_X, 1.42, 0.15],
    },
    exits: {
      driver: [
        [1.45, 0.25, 0.15],
        [-1.45, 0.25, 0.15],
        [0, 0.25, 2.25],
      ],
      gunner: [
        [-1.45, 0.25, 0.15],
        [1.45, 0.25, 0.15],
      ],
    },
  });
  const lights = addHeadlights(root, [
    [-0.7, 0.83, 1.82],
    [0.7, 0.83, 1.82],
  ], mats.lens);

  return {
    root,
    wheels,
    frontWheelPivots,
    suspensionArms,
    steeringWheel: cockpit.steeringWheel,
    speedNeedle: cockpit.speedNeedle,
    engineNeedle: cockpit.engineNeedle,
    rotor: null,
    tailRotor: null,
    fans: [],
    rudders: [],
    turretYaw: turret.yaw,
    turretPitch: turret.pitch,
    muzzle: turret.muzzle,
    lights,
    damageMaterials: [mats.body, mats.patch],
    ...anchors,
  };
}

function addBuggyHull(
  root: Group,
  mats: ReturnType<typeof buggyMaterials>,
  detailed: boolean,
): void {
  root.add(box([0, 0.75, 0], [1.82, 0.42, 2.88], mats.dark));
  root.add(box([0, 0.9, 1.25], [1.86, 0.36, 0.95], mats.body, [-0.12, 0, 0]));
  root.add(box([-0.82, 1.02, -0.2], [0.22, 0.78, 2.25], mats.body));
  root.add(box([0.82, 0.98, -0.28], [0.22, 0.64, 2.1], mats.patch));
  root.add(box([0, 0.74, -1.42], [1.72, 0.42, 0.62], mats.patch));
  root.add(box([0, 0.51, 1.72], [1.74, 0.28, 0.18], mats.metal));
  root.add(box([0, 0.5, -1.73], [1.74, 0.28, 0.18], mats.metal));

  const cagePoints = [
    [-0.77, 0.82, -0.85],
    [-0.69, 1.72, -0.55],
    [-0.65, 1.88, 0.7],
    [-0.78, 0.86, 1.12],
  ] as const;
  for (const side of [-1, 1]) {
    for (let i = 0; i < cagePoints.length - 1; i += 1) {
      const a = cagePoints[i];
      const b = cagePoints[i + 1];
      if (!a || !b) continue;
      root.add(tube(
        new Vector3(a[0] * side, a[1], a[2]),
        new Vector3(b[0] * side, b[1], b[2]),
        0.055,
        mats.frame,
      ));
    }
  }
  root.add(tube(new Vector3(-0.67, 1.82, -0.4), new Vector3(0.67, 1.82, -0.4), 0.055, mats.frame));
  root.add(tube(new Vector3(-0.65, 1.88, 0.65), new Vector3(0.65, 1.88, 0.65), 0.055, mats.frame));
  root.add(tube(new Vector3(-0.72, 0.9, -1.55), new Vector3(0.72, 1.45, -1.35), 0.06, mats.frame));
  root.add(tube(new Vector3(-0.82, 0.72, 1.63), new Vector3(0.82, 0.72, 1.63), 0.07, mats.frame));

  if (!detailed) return;
  for (const x of [-0.46, 0.46]) {
    root.add(seat([x, 0.97, -0.08], mats.fabric, mats.frame));
  }
  const radiator = box([0, 0.95, 1.73], [1.25, 0.48, 0.08], mats.grille);
  root.add(radiator);
  for (let i = -5; i <= 5; i += 1) {
    root.add(box([i * 0.1, 0.95, 1.79], [0.025, 0.4, 0.025], mats.metal));
  }
  const engine = namedGroup("engine");
  engine.add(box([0, 0, 0], [1.15, 0.5, 0.92], mats.engine));
  engine.add(cylinder([-0.34, 0.33, 0], 0.12, 0.72, mats.metal, 12, Y_AXIS, Math.PI / 2));
  engine.add(cylinder([0.34, 0.33, 0], 0.12, 0.72, mats.metal, 12, Y_AXIS, Math.PI / 2));
  engine.position.set(0, 0.98, -1.3);
  root.add(engine);
  for (let i = 0; i < 4; i += 1) {
    const cable = tube(
      new Vector3(-0.45 + i * 0.3, 1.15, -1.25),
      new Vector3(-0.5 + i * 0.32, 1.5, -0.8),
      0.018,
      i % 2 === 0 ? mats.cableRed : mats.cable,
      6,
    );
    root.add(cable);
  }
  root.add(box([-0.86, 1.22, 0.7], [0.04, 0.62, 0.62], mats.patch, [0, 0.08, 0.05]));
  root.add(box([0.86, 1.16, 0.42], [0.04, 0.5, 0.78], mats.body, [0, -0.05, -0.03]));
}

function addBuggyCockpit(
  root: Group,
  mats: ReturnType<typeof buggyMaterials>,
): { steeringWheel: Object3D; speedNeedle: Object3D; engineNeedle: Object3D } {
  const dash = namedGroup("dashboard");
  dash.position.set(0, 1.25, 0.82);
  dash.rotation.x = -0.18;
  dash.add(box([0, 0, 0], [1.35, 0.25, 0.18], mats.dark));
  root.add(dash);

  const steeringWheel = namedGroup("steering_wheel");
  steeringWheel.position.set(BUGGY_DRIVER_X, 1.32, 0.55);
  steeringWheel.rotation.x = -0.48;
  steeringWheel.add(torusWheel(0.2, 0.025, mats.rubber));
  for (let i = 0; i < 3; i += 1) {
    const angle = (i / 3) * Math.PI * 2;
    steeringWheel.add(tube(
      new Vector3(0, 0, 0),
      new Vector3(Math.cos(angle) * 0.17, Math.sin(angle) * 0.17, 0),
      0.015,
      mats.metal,
      6,
    ));
  }
  root.add(steeringWheel);

  const speedNeedle = instrument(root, [BUGGY_DRIVER_X - 0.14, 1.34, 0.9], mats);
  const engineNeedle = instrument(root, [BUGGY_DRIVER_X + 0.14, 1.34, 0.9], mats);
  return { steeringWheel, speedNeedle, engineNeedle };
}

function addBuggyTurret(
  root: Group,
  mats: ReturnType<typeof buggyMaterials>,
): { yaw: Group; pitch: Group; muzzle: Object3D } {
  const yaw = namedGroup("turret_yaw");
  // El pivote de elevación cuelga 0.12 más arriba, así que el caño queda a la
  // altura del pedestal del modelo generado.
  yaw.position.set(BUGGY_GUN_X, 1.66, 0.6);
  yaw.add(cylinder([0, 0, 0], 0.24, 0.14, mats.metal, 16));
  root.add(cylinder([BUGGY_GUN_X, 1.24, 0.6], 0.08, 0.8, mats.metal, 10));
  const pitch = namedGroup("turret_pitch");
  pitch.position.y = 0.12;
  pitch.add(box([0, 0, 0.18], [0.34, 0.24, 0.56], mats.patch));
  pitch.add(cylinder([0, 0, 0.66], 0.075, 0.95, mats.barrel, 10, X_AXIS, Math.PI / 2));
  pitch.add(cylinder([0, 0, 1.14], 0.11, 0.18, mats.coil, 12, X_AXIS, Math.PI / 2));
  for (let i = 0; i < 4; i += 1) {
    const coil = torusWheel(0.125, 0.018, mats.coil);
    coil.position.z = 0.8 + i * 0.13;
    pitch.add(coil);
  }
  const muzzle = new Object3D();
  muzzle.name = "muzzle";
  muzzle.position.set(0, 0, 1.3);
  pitch.add(muzzle);
  yaw.add(pitch);
  root.add(yaw);
  return { yaw, pitch, muzzle };
}

function buildRebelCrawler(): VisualRig {
  const root = namedGroup("vehicle-rebel-crawler");
  const mats = rebelCrawlerMaterials();
  const lod = new LOD();
  lod.name = "visual_lods";
  root.add(lod);

  const full = namedGroup("visual_lod0");
  addRebelCrawlerHull(full, mats, true);
  lod.addLevel(full, 0);
  const medium = namedGroup("visual_lod1");
  addRebelCrawlerHull(medium, mats, false);
  lod.addLevel(medium, 62);
  const low = namedGroup("visual_lod2");
  low.add(box([0, 0.75, 0], [2.55, 0.72, 4.45], mats.body));
  low.add(box([0, 1.55, 0.82], [1.85, 1.28, 1.62], mats.patch));
  lod.addLevel(low, 132);

  const wheels: Group[] = [];
  const wheelPositions = [
    [-REBEL_CRAWLER_WHEEL_HALF_WIDTH, REBEL_CRAWLER_WHEEL_HALF_LENGTH],
    [REBEL_CRAWLER_WHEEL_HALF_WIDTH, REBEL_CRAWLER_WHEEL_HALF_LENGTH],
    [-REBEL_CRAWLER_WHEEL_HALF_WIDTH, -REBEL_CRAWLER_WHEEL_HALF_LENGTH],
    [REBEL_CRAWLER_WHEEL_HALF_WIDTH, -REBEL_CRAWLER_WHEEL_HALF_LENGTH],
  ] as const;
  wheelPositions.forEach(([x, z], index) => {
    const pivot = namedGroup(index < 2 ? "track_front_pivot" : "track_rear_pivot");
    pivot.position.set(x, REBEL_CRAWLER_WHEEL_REST_Y, z);
    const wheel = namedGroup("track_wheel");
    wheel.add(cylinder([0, 0, 0], 0.46, 0.32, mats.rubber, 18, Z_AXIS, Math.PI / 2));
    wheel.add(cylinder([0, 0, 0], 0.23, 0.34, mats.metal, 12, Z_AXIS, Math.PI / 2));
    pivot.add(wheel);
    root.add(pivot);
    wheels.push(wheel);
  });

  const steeringWheel = namedGroup("steering_wheel");
  steeringWheel.position.set(0.48, 1.55, 1.16);
  steeringWheel.rotation.x = -0.48;
  steeringWheel.add(torusWheel(0.19, 0.025, mats.rubber));
  root.add(steeringWheel);
  const speedNeedle = instrument(root, [0.34, 1.62, 1.42], mats);
  const engineNeedle = instrument(root, [0.62, 1.62, 1.42], mats);
  const anchors = buildAnchors(root, {
    seats: {
      driver: [0.48, 1.45, 0.78],
      passenger: [-0.48, 1.45, 0.78],
    },
    cameras: {
      driver: [0.48, 1.86, 0.82],
      passenger: [-0.48, 1.86, 0.82],
    },
    exits: {
      driver: [
        [1.72, 0.35, 0.55],
        [-1.72, 0.35, 0.55],
        [0, 0.35, -2.8],
      ],
      passenger: [
        [-1.72, 0.35, 0.55],
        [1.72, 0.35, 0.55],
        [0, 0.35, -2.8],
      ],
    },
  });
  const lights = addHeadlights(root, [
    [-0.56, 1.2, 2.05],
    [0.56, 1.2, 2.05],
  ], mats.lens, 52);

  return {
    root,
    wheels,
    frontWheelPivots: [],
    suspensionArms: [],
    steeringWheel,
    speedNeedle,
    engineNeedle,
    rotor: null,
    tailRotor: null,
    fans: [],
    rudders: [],
    turretYaw: null,
    turretPitch: null,
    muzzle: null,
    lights,
    damageMaterials: [mats.body, mats.patch],
    ...anchors,
  };
}

function addRebelCrawlerHull(
  root: Group,
  mats: ReturnType<typeof rebelCrawlerMaterials>,
  detailed: boolean,
): void {
  root.add(box([0, 0.72, 0], [2.18, 0.62, 4.18], mats.body));
  root.add(box([0, 1.02, 1.7], [1.78, 0.5, 0.92], mats.body, [-0.08, 0, 0]));
  root.add(box([0, 1.08, -1.72], [1.82, 0.14, 1.08], mats.patch));
  for (const side of [-1, 1]) {
    const x = side * 1.25;
    root.add(box([x, -0.08, 0], [0.42, 0.13, 4.05], mats.rubber));
    root.add(box([x, 0.79, 0], [0.42, 0.13, 4.05], mats.rubber));
    root.add(box([side * 1.13, 0.78, 0], [0.28, 0.32, 4.34], mats.patch));
    for (const z of [-0.88, 0, 0.88]) {
      root.add(cylinder([x, REBEL_CRAWLER_WHEEL_REST_Y, z], 0.36, 0.3, mats.metal, 12, Z_AXIS, Math.PI / 2));
    }
  }
  root.add(box([0, 2.18, 0.92], [1.9, 0.14, 1.62], mats.body));
  for (const x of [-0.84, 0.84]) {
    root.add(tube(new Vector3(x, 1.06, 0.16), new Vector3(x, 2.17, 0.16), 0.05, mats.metal));
    root.add(tube(new Vector3(x, 1.08, 1.6), new Vector3(x, 2.17, 1.6), 0.05, mats.metal));
    root.add(box([x * 1.08, 1.3, 0.92], [0.08, 0.58, 1.1], mats.body));
  }
  root.add(tube(new Vector3(-0.84, 2.17, 0.16), new Vector3(0.84, 2.17, 0.16), 0.05, mats.metal));
  root.add(tube(new Vector3(-0.84, 2.17, 1.6), new Vector3(0.84, 2.17, 1.6), 0.05, mats.metal));
  root.add(box([0, 1.76, 1.56], [1.5, 0.62, 0.045], mats.glass, [-0.12, 0, 0]));
  root.add(box([0, 1.42, -0.55], [1.24, 0.62, 0.92], mats.engine));
  for (let index = 0; index < 5; index += 1) {
    root.add(box([-0.42 + index * 0.21, 1.75, -0.55], [0.11, 0.07, 0.72], mats.metal));
  }
  root.add(tube(new Vector3(-0.86, 1.2, -2.1), new Vector3(-0.86, 1.52, -2.1), 0.045, mats.metal));
  root.add(tube(new Vector3(0.86, 1.2, -2.1), new Vector3(0.86, 1.52, -2.1), 0.045, mats.metal));
  root.add(tube(new Vector3(-0.86, 1.52, -2.1), new Vector3(0.86, 1.52, -2.1), 0.045, mats.metal));

  if (!detailed) return;
  root.add(seat([0.48, 1.28, 0.72], mats.fabric, mats.metal));
  root.add(seat([-0.48, 1.28, 0.72], mats.fabric, mats.metal));
  root.add(box([-0.58, 1.36, -1.68], [0.48, 0.42, 0.34], mats.patch));
  root.add(box([0.56, 1.31, -1.72], [0.52, 0.34, 0.4], mats.body));
  root.add(tube(new Vector3(-0.98, 0.72, 2.35), new Vector3(0.98, 0.72, 2.35), 0.065, mats.metal));
  root.add(cylinder([0, 0.82, 2.26], 0.18, 0.52, mats.metal, 14, Z_AXIS, Math.PI / 2));
}

function buildCombineGlider(): VisualRig {
  const root = namedGroup("vehicle-combine-glider");
  const mats = combineGliderMaterials();
  const lod = new LOD();
  lod.name = "visual_lods";
  root.add(lod);
  const full = namedGroup("visual_lod0");
  addCombineGliderHull(full, mats, true);
  lod.addLevel(full, 0);
  const medium = namedGroup("visual_lod1");
  addCombineGliderHull(medium, mats, false);
  lod.addLevel(medium, 68);
  const low = namedGroup("visual_lod2");
  low.add(box([0, 0.52, 0], [2.05, 0.52, 3.25], mats.body));
  low.add(box([0, 0.9, -0.72], [1.28, 0.5, 1.15], mats.ceramic));
  lod.addLevel(low, 145);

  const fan = namedGroup("fan_main");
  fan.position.set(0, 0.84, -1.4);
  fan.add(cylinder([0, 0, 0], 0.34, 0.06, mats.energy, 18, Z_AXIS, Math.PI / 2));
  for (let index = 0; index < 3; index += 1) {
    const spoke = box([0, 0.2, 0], [0.055, 0.4, 0.035], mats.energy);
    spoke.rotation.z = (index / 3) * Math.PI * 2;
    fan.add(spoke);
  }
  root.add(fan);

  const rudders: Object3D[] = [];
  for (const x of [-0.82, 0.82]) {
    const rudder = namedGroup(x < 0 ? "rudder_left" : "rudder_right");
    rudder.position.set(x, 0.88, -1.28);
    rudder.add(box([0, 0.15, 0], [0.12, 0.54, 0.58], mats.ceramic, [0.08, 0, 0]));
    root.add(rudder);
    rudders.push(rudder);
  }
  const anchors = buildAnchors(root, {
    seats: { driver: [0, 0.98, -0.08] },
    cameras: { driver: [0, 1.5, 0.02] },
    exits: {
      driver: [
        [-1.48, 0.25, -0.05],
        [1.48, 0.25, -0.05],
        [0, 0.25, 2.15],
      ],
    },
  });
  const lights = addHeadlights(
    root,
    [[-0.38, 0.7, 1.55], [0.38, 0.7, 1.55]],
    mats.energy,
    58,
    0x80dcff,
  );
  return {
    root,
    wheels: [],
    frontWheelPivots: [],
    suspensionArms: [],
    steeringWheel: null,
    speedNeedle: null,
    engineNeedle: null,
    rotor: null,
    tailRotor: null,
    fans: [fan],
    rudders,
    turretYaw: null,
    turretPitch: null,
    muzzle: null,
    lights,
    damageMaterials: [mats.body, mats.ceramic],
    ...anchors,
  };
}

function addCombineGliderHull(
  root: Group,
  mats: ReturnType<typeof combineGliderMaterials>,
  detailed: boolean,
): void {
  root.add(box([0, 0.5, 0], [1.95, 0.48, 3.08], mats.body));
  root.add(box([0, 0.72, 1.35], [1.25, 0.34, 0.82], mats.ceramic, [-0.12, 0, 0]));
  root.add(box([-0.84, 0.56, -0.66], [0.34, 0.3, 1.7], mats.body, [0.02, -0.08, 0.03]));
  root.add(box([0.84, 0.56, -0.66], [0.34, 0.3, 1.7], mats.body, [0.02, 0.08, -0.03]));
  root.add(box([0, 0.92, -0.96], [1.22, 0.56, 0.92], mats.body));
  root.add(box([0, 0.94, 0.18], [1.12, 0.42, 1.16], mats.dark));
  root.add(box([0, 1.28, 0.52], [1.02, 0.48, 0.04], mats.glass, [-0.48, 0, 0]));

  for (const [x, z] of [[0, 1.35], [-0.78, -0.92], [0.78, -0.92]] as const) {
    root.add(cylinder([x, 0.23, z], 0.22, 0.08, mats.energy, 16));
    root.add(cylinder([x, 0.3, z], 0.09, 0.12, mats.metal, 12));
  }
  if (!detailed) return;
  root.add(seat([0, 0.86, -0.08], mats.fabric, mats.metal));
  root.add(box([0, 1.08, 0.66], [0.72, 0.16, 0.28], mats.metal, [-0.22, 0, 0]));
  root.add(scaledSphere([0, 0.9, 1.53], [0.14, 0.09, 0.08], mats.energy));
  root.add(tube(new Vector3(-0.64, 0.5, 1.22), new Vector3(-0.9, 0.8, -0.6), 0.05, mats.metal));
  root.add(tube(new Vector3(0.58, 0.48, 1.26), new Vector3(0.88, 0.78, -0.7), 0.045, mats.metal));
}

function buildAirboat(): VisualRig {
  const root = namedGroup("vehicle-airboat");
  const mats = airboatMaterials();
  const lod = new LOD();
  lod.name = "visual_lods";
  root.add(lod);
  const full = namedGroup("visual_lod0");
  addAirboatHull(full, mats, true);
  lod.addLevel(full, 0);
  const medium = namedGroup("visual_lod1");
  addAirboatHull(medium, mats, false);
  lod.addLevel(medium, 58);
  const low = namedGroup("visual_lod2");
  low.add(box([0, 0.45, 0], [2.25, 0.48, 4.2], mats.yellow));
  low.add(box([0, 0.92, -1.1], [1.65, 1.1, 1.42], mats.graphite));
  lod.addLevel(low, 125);

  const fans: Object3D[] = [];
  const rudders: Object3D[] = [];
  for (const x of [-0.53, 0.53]) {
    const shroud = namedGroup("fan_shroud");
    shroud.position.set(x, 1.36, -1.25);
    shroud.add(torusWheel(0.51, 0.065, mats.graphite));
    for (let i = 0; i < 5; i += 1) {
      const blade = box([0, 0.24, 0], [0.09, 0.46, 0.035], mats.fan);
      blade.rotation.z = (i / 5) * Math.PI * 2;
      shroud.add(blade);
    }
    const hub = cylinder([0, 0, 0], 0.1, 0.18, mats.metal, 12, X_AXIS, Math.PI / 2);
    shroud.add(hub);
    full.add(shroud);
    fans.push(shroud);

    const rudder = box([x, 1.02, -1.92], [0.34, 0.78, 0.06], mats.yellow, [0.08, 0, 0]);
    full.add(rudder);
    rudders.push(rudder);
  }

  const cockpit = addAirboatCockpit(root, mats);
  const turret = addAirboatTurret(root, mats);
  const anchors = buildAnchors(root, {
    seats: { driver: [0, 0.95, -0.35] },
    cameras: { driver: [0, 1.38, -0.25] },
    exits: {
      driver: [
        [-1.55, 0.25, -0.1],
        [1.55, 0.25, -0.1],
        [0, 0.25, 2.55],
      ],
    },
  });
  const lights = addHeadlights(root, [
    [-0.62, 0.68, 2.07],
    [0.62, 0.68, 2.07],
  ], mats.lens);

  return {
    root,
    wheels: [],
    frontWheelPivots: [],
    suspensionArms: [],
    steeringWheel: cockpit.steeringWheel,
    speedNeedle: cockpit.speedNeedle,
    engineNeedle: cockpit.engineNeedle,
    rotor: null,
    tailRotor: null,
    fans,
    rudders,
    turretYaw: turret.yaw,
    turretPitch: turret.pitch,
    muzzle: turret.muzzle,
    lights,
    damageMaterials: [mats.yellow, mats.patch],
    ...anchors,
  };
}

function addAirboatHull(
  root: Group,
  mats: ReturnType<typeof airboatMaterials>,
  detailed: boolean,
): void {
  root.add(wedgeHull(mats.yellow));
  root.add(box([0, 0.56, -0.45], [2.15, 0.18, 2.95], mats.graphite));
  root.add(box([-0.97, 0.76, 0.25], [0.14, 0.65, 2.8], mats.yellow, [0, 0, -0.08]));
  root.add(box([0.97, 0.73, 0.12], [0.14, 0.58, 2.95], mats.patch, [0, 0, 0.07]));
  root.add(box([0, 0.54, 2.06], [1.82, 0.3, 0.22], mats.metal, [-0.18, 0, 0]));
  root.add(box([0, 0.49, -2.02], [2.04, 0.38, 0.18], mats.graphite));
  for (const side of [-1, 1]) {
    root.add(tube(
      new Vector3(side * 0.92, 0.65, -1.78),
      new Vector3(side * 0.92, 1.88, -1.58),
      0.055,
      mats.metal,
    ));
    root.add(tube(
      new Vector3(side * 0.92, 1.88, -1.58),
      new Vector3(side * 0.55, 1.88, -0.78),
      0.055,
      mats.metal,
    ));
  }
  root.add(tube(new Vector3(-0.92, 1.88, -1.58), new Vector3(0.92, 1.88, -1.58), 0.055, mats.metal));
  if (!detailed) return;
  root.add(seat([0, 0.92, -0.38], mats.seat, mats.metal));
  root.add(box([0, 0.84, 0.74], [1.2, 0.5, 0.12], mats.graphite, [-0.15, 0, 0]));
  root.add(box([-0.83, 0.9, 0.2], [0.06, 0.34, 1.4], mats.patch));
  root.add(box([0.82, 0.87, -0.08], [0.06, 0.3, 1.6], mats.yellow));
  for (let i = -4; i <= 4; i += 1) {
    root.add(box([i * 0.14, 0.67, -1.95], [0.04, 0.28, 0.03], mats.metal));
  }
}

function addAirboatCockpit(
  root: Group,
  mats: ReturnType<typeof airboatMaterials>,
): { steeringWheel: Object3D; speedNeedle: Object3D; engineNeedle: Object3D } {
  const steeringWheel = namedGroup("steering_wheel");
  steeringWheel.position.set(0, 1.18, 0.45);
  steeringWheel.rotation.x = -0.52;
  steeringWheel.add(torusWheel(0.23, 0.028, mats.graphite));
  root.add(steeringWheel);
  const speedNeedle = instrument(root, [-0.17, 1.19, 0.66], mats);
  const engineNeedle = instrument(root, [0.17, 1.19, 0.66], mats);
  return { steeringWheel, speedNeedle, engineNeedle };
}

function addAirboatTurret(
  root: Group,
  mats: ReturnType<typeof airboatMaterials>,
): { yaw: Group; pitch: Group; muzzle: Object3D } {
  const yaw = namedGroup("turret_yaw");
  yaw.position.set(0, 0.98, 1.05);
  yaw.add(cylinder([0, 0, 0], 0.25, 0.18, mats.metal, 16));
  const pitch = namedGroup("turret_pitch");
  pitch.position.y = 0.16;
  pitch.add(box([0, 0, 0.18], [0.38, 0.3, 0.5], mats.graphite));
  pitch.add(cylinder([0, 0, 0.72], 0.065, 1.02, mats.barrel, 10, X_AXIS, Math.PI / 2));
  for (const x of [-0.12, 0.12]) {
    pitch.add(cylinder([x, 0, 0.72], 0.035, 0.76, mats.emissive, 8, X_AXIS, Math.PI / 2));
  }
  const muzzle = new Object3D();
  muzzle.name = "muzzle";
  muzzle.position.z = 1.25;
  pitch.add(muzzle);
  yaw.add(pitch);
  root.add(yaw);
  return { yaw, pitch, muzzle };
}

function buildHelicopter(): VisualRig {
  const root = namedGroup("vehicle-helicopter");
  const mats = helicopterMaterials();
  const lod = new LOD();
  lod.name = "visual_lods";
  root.add(lod);
  const full = namedGroup("visual_lod0");
  addHelicopterHull(full, mats, true);
  lod.addLevel(full, 0);
  const medium = namedGroup("visual_lod1");
  addHelicopterHull(medium, mats, false);
  lod.addLevel(medium, 90);
  const low = namedGroup("visual_lod2");
  low.add(scaledSphere([0, 1.3, 1.15], [1.55, 1.22, 2.5], mats.olive));
  low.add(box([0, 1.5, -1.55], [1.25, 1.25, 3.4], mats.olive));
  low.add(box([0, 1.62, -3.45], [0.45, 0.55, 2.7], mats.dark));
  lod.addLevel(low, 180);

  const rotor = namedGroup("rotor_main");
  rotor.position.set(0, 2.82, 0.15);
  rotor.add(cylinder([0, 0, 0], 0.18, 0.2, mats.metal, 14));
  for (let i = 0; i < 4; i += 1) {
    const blade = box([0, 0.01, 3.2], [0.17, 0.045, 6.2], mats.rotor);
    blade.rotation.y = (i / 4) * Math.PI * 2;
    rotor.add(blade);
  }
  root.add(rotor);
  const tailRotor = namedGroup("rotor_tail");
  tailRotor.position.set(0.32, 1.68, -4.68);
  tailRotor.rotation.y = Math.PI / 2;
  for (let i = 0; i < 4; i += 1) {
    const blade = box([0, 0.42, 0], [0.07, 0.82, 0.04], mats.rotor);
    blade.rotation.z = (i / 4) * Math.PI * 2;
    tailRotor.add(blade);
  }
  tailRotor.add(cylinder([0, 0, 0], 0.12, 0.18, mats.metal, 12, X_AXIS, Math.PI / 2));
  root.add(tailRotor);

  const turret = addHelicopterDoorGun(root, mats);
  const anchors = buildAnchors(root, {
    seats: {
      pilot: [-0.58, 1.35, 2.45],
      commander: [0.58, 1.35, 2.45],
      "door-gunner": [-1.05, 1.15, -0.25],
      passenger: [0.62, 1.05, -0.75],
    },
    cameras: {
      pilot: [-0.58, 1.82, 2.42],
      commander: [0.58, 1.82, 2.42],
      "door-gunner": [-1.22, 1.65, -0.25],
      passenger: [0.62, 1.55, -0.75],
    },
    exits: {
      pilot: [[-1.75, 0.2, 1.25]],
      commander: [[1.75, 0.2, 1.25]],
      "door-gunner": [[-1.85, 0.15, -0.25]],
      passenger: [[1.85, 0.15, -0.75]],
    },
  });
  const lights = addHeadlights(root, [
    [-0.63, 1.14, 3.5],
    [0.63, 1.14, 3.5],
  ], mats.lens, 70);

  return {
    root,
    wheels: [],
    frontWheelPivots: [],
    suspensionArms: [],
    steeringWheel: null,
    speedNeedle: null,
    engineNeedle: null,
    rotor,
    tailRotor,
    fans: [],
    rudders: [],
    turretYaw: turret.yaw,
    turretPitch: turret.pitch,
    muzzle: turret.muzzle,
    lights,
    damageMaterials: [mats.olive, mats.cream, mats.patch],
    ...anchors,
  };
}

function addHelicopterHull(
  root: Group,
  mats: ReturnType<typeof helicopterMaterials>,
  detailed: boolean,
): void {
  root.add(scaledSphere([0, 1.32, 1.35], [1.48, 1.13, 2.45], mats.olive));
  root.add(box([0, 1.42, -1.2], [1.5, 1.55, 3.15], mats.olive, [-0.02, 0, 0]));
  root.add(box([0, 1.65, -3.42], [0.48, 0.58, 2.75], mats.dark, [0.05, 0, 0]));
  root.add(box([0, 2.02, -4.42], [0.12, 1.25, 1.15], mats.olive, [0.12, 0, 0]));
  root.add(box([0, 1.1, -4.32], [1.18, 0.1, 0.62], mats.cream));
  root.add(box([0, 2.52, 0.2], [1.1, 0.34, 1.25], mats.dark));
  root.add(cylinder([0, 2.72, 0.12], 0.2, 0.55, mats.metal, 14));

  const glass = scaledSphere([0, 1.58, 2.52], [1.22, 0.84, 0.98], mats.glass);
  glass.scale.z = 0.75;
  root.add(glass);
  root.add(box([-0.78, 1.42, 2.2], [0.08, 1.05, 1.18], mats.frame, [0, 0.08, 0]));
  root.add(box([0.78, 1.42, 2.2], [0.08, 1.05, 1.18], mats.frame, [0, -0.08, 0]));
  root.add(box([0, 1.97, 2.34], [1.44, 0.08, 0.98], mats.frame, [0.2, 0, 0]));

  for (const side of [-1, 1]) {
    root.add(tube(
      new Vector3(side * 0.92, 0.43, -1.9),
      new Vector3(side * 0.92, 0.43, 2.15),
      0.055,
      mats.metal,
    ));
    root.add(tube(
      new Vector3(side * 0.92, 0.43, -1.3),
      new Vector3(side * 0.67, 0.84, -0.7),
      0.045,
      mats.metal,
    ));
    root.add(tube(
      new Vector3(side * 0.92, 0.43, 1.55),
      new Vector3(side * 0.7, 0.82, 1.1),
      0.045,
      mats.metal,
    ));
  }

  root.add(box([-1.13, 1.5, -0.25], [0.08, 1.38, 1.65], mats.frame));
  root.add(box([1.13, 1.5, -0.25], [0.08, 1.38, 1.65], mats.patch));
  root.add(box([0.9, 1.78, -1.45], [0.4, 0.62, 1.2], mats.cream, [0, 0, -0.05]));
  root.add(box([-0.92, 1.94, -1.52], [0.35, 0.56, 1.05], mats.patch, [0.04, 0, 0.06]));

  if (!detailed) return;
  root.add(box([0, 0.88, -0.25], [2.02, 0.16, 2.52], mats.floor));
  root.add(seat([-0.58, 1.18, 1.78], mats.seat, mats.frame));
  root.add(seat([0.58, 1.18, 1.78], mats.seat, mats.frame));
  root.add(seat([0.62, 1.05, -0.75], mats.seat, mats.frame));
  root.add(seat([-0.62, 1.05, -0.75], mats.seat, mats.frame));
  root.add(box([0, 1.38, 2.42], [1.15, 0.48, 0.2], mats.instrument));
  for (let i = -3; i <= 3; i += 1) {
    const lamp = cylinder([i * 0.14, 1.5, 2.54], 0.035, 0.02, i % 2 === 0 ? mats.green : mats.amber, 8, X_AXIS, Math.PI / 2);
    root.add(lamp);
  }
  const webbing = box([0.7, 1.45, -0.08], [0.02, 0.92, 1.45], mats.webbing);
  root.add(webbing);
  for (let i = -3; i <= 3; i += 1) {
    root.add(tube(
      new Vector3(0.71, 1.05 + (i + 3) * 0.13, -0.78),
      new Vector3(0.71, 1.05 + (i + 3) * 0.13, 0.62),
      0.012,
      mats.webbing,
      5,
    ));
  }
  for (let i = 0; i < 5; i += 1) {
    root.add(tube(
      new Vector3(-0.96 + i * 0.48, 0.94, -1.25),
      new Vector3(-0.96 + i * 0.48, 2.25, -1.25),
      0.018,
      mats.cable,
      6,
    ));
  }
}

function addHelicopterDoorGun(
  root: Group,
  mats: ReturnType<typeof helicopterMaterials>,
): { yaw: Group; pitch: Group; muzzle: Object3D } {
  const yaw = namedGroup("turret_yaw");
  yaw.position.set(-1.18, 1.38, -0.1);
  yaw.add(cylinder([0, 0, 0], 0.22, 0.16, mats.metal, 14));
  const pitch = namedGroup("turret_pitch");
  pitch.add(box([0, 0, 0.2], [0.28, 0.24, 0.64], mats.dark));
  const barrels = namedGroup("door_gun_barrels");
  for (const x of [-0.065, 0.065]) {
    barrels.add(cylinder([x, 0, 0.7], 0.035, 1.02, mats.barrel, 9, X_AXIS, Math.PI / 2));
  }
  pitch.add(barrels);
  const ammoBox = box([0.28, -0.12, 0.12], [0.34, 0.42, 0.48], mats.patch);
  pitch.add(ammoBox);
  const muzzle = new Object3D();
  muzzle.name = "muzzle";
  muzzle.position.set(0, 0, 1.23);
  pitch.add(muzzle);
  yaw.add(pitch);
  root.add(yaw);
  return { yaw, pitch, muzzle };
}

function buggyMaterials() {
  return {
    body: standard(0xd3c3a1, 0.82, 0.16),
    patch: standard(0x8b3328, 0.9, 0.1),
    dark: standard(0x292a27, 0.86, 0.42),
    frame: standard(0x332d26, 0.72, 0.65),
    metal: standard(0x77756e, 0.42, 0.8),
    engine: standard(0x403c35, 0.58, 0.76),
    grille: standard(0x181a19, 0.9, 0.55),
    rubber: standard(0x171615, 0.96, 0.02),
    fabric: standard(0x423a31, 0.96, 0.02),
    barrel: standard(0x24272a, 0.36, 0.88),
    coil: standard(0xb46c35, 0.38, 0.78, 0x5c260e, 0.22),
    cable: standard(0x171716, 0.88, 0.05),
    cableRed: standard(0x73251d, 0.78, 0.08),
    lens: standard(0xffe2a3, 0.18, 0.05, 0xffb342, 0.18),
    instrument: standard(0x11191c, 0.28, 0.12, 0x2bd7e4, 1.2),
  };
}

function rebelCrawlerMaterials() {
  return {
    body: standard(0x4d6170, 0.82, 0.2),
    patch: standard(0x873f2d, 0.9, 0.14),
    metal: standard(0x686d6d, 0.5, 0.82),
    engine: standard(0x323638, 0.62, 0.76),
    rubber: standard(0x17191a, 0.97, 0.02),
    fabric: standard(0x30383a, 0.96, 0.02),
    lens: standard(0xf5e4b8, 0.18, 0.05, 0xffcc68, 0.2),
    instrument: standard(0x101a1c, 0.3, 0.14, 0x63dbe5, 1.15),
    glass: new MeshPhysicalMaterial({
      color: 0x7691a0,
      roughness: 0.18,
      metalness: 0.04,
      transmission: 0.28,
      transparent: true,
      opacity: 0.46,
      thickness: 0.04,
      side: DoubleSide,
    }),
  };
}

function combineGliderMaterials() {
  return {
    body: standard(0x2d414d, 0.58, 0.42),
    ceramic: standard(0xa5b1b1, 0.64, 0.14),
    metal: standard(0x515c62, 0.4, 0.88),
    dark: standard(0x171d21, 0.9, 0.08),
    fabric: standard(0x242a2e, 0.96, 0.02),
    energy: standard(0x62d8f2, 0.22, 0.18, 0x43cfff, 2.4),
    glass: new MeshPhysicalMaterial({
      color: 0x568da0,
      roughness: 0.12,
      metalness: 0.04,
      transmission: 0.42,
      transparent: true,
      opacity: 0.44,
      thickness: 0.035,
      side: DoubleSide,
    }),
  };
}

function airboatMaterials() {
  return {
    yellow: standard(0xd29c19, 0.76, 0.22),
    patch: standard(0x7d651d, 0.9, 0.12),
    graphite: standard(0x242829, 0.82, 0.42),
    metal: standard(0x6e7471, 0.48, 0.78),
    fan: standard(0x303334, 0.62, 0.66),
    barrel: standard(0x23282d, 0.34, 0.86),
    emissive: standard(0x9fdce1, 0.24, 0.35, 0x41c9e3, 2.2),
    seat: standard(0x35322b, 0.95, 0.02),
    lens: standard(0xe6f4d5, 0.16, 0.05, 0xe6ffaf, 0.18),
    instrument: standard(0x10191a, 0.28, 0.12, 0x63f3d2, 1.4),
  };
}

function helicopterMaterials() {
  return {
    olive: standard(0x4f5a3f, 0.84, 0.18),
    cream: standard(0xb7b49e, 0.88, 0.12),
    patch: standard(0x6e452f, 0.9, 0.16),
    dark: standard(0x292c2b, 0.78, 0.5),
    frame: standard(0x252725, 0.68, 0.72),
    metal: standard(0x71746f, 0.44, 0.82),
    rotor: standard(0x242525, 0.7, 0.55),
    barrel: standard(0x1c2021, 0.3, 0.9),
    floor: standard(0x393c37, 0.88, 0.4),
    seat: standard(0x323a2d, 0.98, 0.02),
    instrument: standard(0x171a18, 0.4, 0.16),
    webbing: standard(0x5a6044, 0.98, 0.01),
    cable: standard(0x1d1c1a, 0.9, 0.04),
    green: standard(0x6ae36d, 0.26, 0.08, 0x39dc4a, 2.5),
    amber: standard(0xe5a44a, 0.26, 0.08, 0xeb7e26, 2.1),
    lens: standard(0xf4e6bd, 0.18, 0.06, 0xffd36b, 0.18),
    glass: new MeshPhysicalMaterial({
      color: 0x7e9a9c,
      roughness: 0.14,
      metalness: 0.05,
      transmission: 0.36,
      transparent: true,
      opacity: 0.48,
      thickness: 0.05,
      side: DoubleSide,
    }),
  };
}

function standard(
  color: number,
  roughness: number,
  metalness: number,
  emissive = 0x000000,
  emissiveIntensity = 0,
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
  });
}

function namedGroup(name: string): Group {
  const group = new Group();
  group.name = name;
  return group;
}

function box(
  position: readonly [number, number, number],
  size: readonly [number, number, number],
  material: MeshStandardMaterial,
  rotation: readonly [number, number, number] = [0, 0, 0],
): Mesh {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cylinder(
  position: readonly [number, number, number],
  radius: number,
  length: number,
  material: MeshStandardMaterial,
  segments = 12,
  axis = Y_AXIS,
  angle = 0,
): Mesh {
  const mesh = new Mesh(
    new CylinderGeometry(radius, radius, length, segments),
    material,
  );
  mesh.position.set(...position);
  if (angle !== 0) {
    mesh.quaternion.setFromAxisAngle(axis, angle);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function scaledSphere(
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
  material: MeshStandardMaterial,
): Mesh {
  const mesh = new Mesh(new SphereGeometry(1, 20, 14), material);
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function tube(
  start: Vector3,
  end: Vector3,
  radius: number,
  material: MeshStandardMaterial,
  segments = 8,
): Mesh {
  TMP_DIRECTION.copy(end).sub(start);
  const length = TMP_DIRECTION.length();
  TMP_MIDPOINT.copy(start).add(end).multiplyScalar(0.5);
  const mesh = new Mesh(
    new CylinderGeometry(radius, radius, length, segments),
    material,
  );
  mesh.position.copy(TMP_MIDPOINT);
  TMP_QUATERNION.setFromUnitVectors(Y_AXIS, TMP_DIRECTION.normalize());
  mesh.quaternion.copy(TMP_QUATERNION);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function torusWheel(
  radius: number,
  thickness: number,
  material: MeshStandardMaterial,
): Mesh {
  const geometry = new CylinderGeometry(radius, radius, thickness, 24, 1, true);
  const inner = new CylinderGeometry(
    Math.max(0.01, radius - thickness * 2),
    Math.max(0.01, radius - thickness * 2),
    thickness * 1.1,
    24,
    1,
    true,
  );
  const outer = new Mesh(geometry, material);
  outer.rotation.x = Math.PI / 2;
  const innerMesh = new Mesh(inner, material);
  innerMesh.rotation.x = Math.PI / 2;
  outer.add(innerMesh);
  return outer;
}

function seat(
  position: readonly [number, number, number],
  fabric: MeshStandardMaterial,
  frame: MeshStandardMaterial,
): Group {
  const group = namedGroup("seat");
  group.position.set(...position);
  group.add(box([0, 0, 0], [0.56, 0.16, 0.58], fabric, [-0.08, 0, 0]));
  group.add(box([0, 0.42, -0.23], [0.56, 0.78, 0.16], fabric, [-0.16, 0, 0]));
  group.add(tube(new Vector3(-0.25, -0.15, -0.22), new Vector3(-0.25, 0.12, -0.22), 0.025, frame, 6));
  group.add(tube(new Vector3(0.25, -0.15, -0.22), new Vector3(0.25, 0.12, -0.22), 0.025, frame, 6));
  return group;
}

function instrument(
  root: Group,
  position: readonly [number, number, number],
  mats: { instrument: MeshStandardMaterial; metal: MeshStandardMaterial },
): Object3D {
  const gauge = namedGroup("instrument");
  gauge.position.set(...position);
  gauge.rotation.x = -0.16;
  gauge.add(cylinder([0, 0, 0], 0.105, 0.035, mats.instrument, 18, X_AXIS, Math.PI / 2));
  const needle = box([0, 0.055, 0.024], [0.018, 0.105, 0.014], mats.metal);
  needle.geometry.translate(0, -0.045, 0);
  gauge.add(needle);
  root.add(gauge);
  return needle;
}

function wedgeHull(material: MeshStandardMaterial): Mesh {
  const vertices = new Float32Array([
    -1.13, 0.18, -2.05,
    1.13, 0.18, -2.05,
    -1.02, 0.18, 1.55,
    1.02, 0.18, 1.55,
    -0.62, 0.1, 2.2,
    0.62, 0.1, 2.2,
    -0.94, 0.62, -1.95,
    0.94, 0.62, -1.95,
    -0.82, 0.62, 1.52,
    0.82, 0.62, 1.52,
    -0.38, 0.46, 2.18,
    0.38, 0.46, 2.18,
  ]);
  const indices = [
    0, 2, 1, 1, 2, 3, 2, 4, 3, 3, 4, 5,
    6, 7, 8, 7, 9, 8, 8, 9, 10, 9, 11, 10,
    0, 6, 2, 2, 6, 8, 2, 8, 4, 4, 8, 10,
    1, 3, 7, 3, 9, 7, 3, 5, 9, 5, 11, 9,
    0, 1, 6, 1, 7, 6, 4, 10, 5, 5, 10, 11,
  ];
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildAnchors(
  root: Group,
  spec: {
    seats: Record<string, readonly [number, number, number]>;
    cameras: Record<string, readonly [number, number, number]>;
    exits: Record<string, readonly (readonly [number, number, number])[]>;
  },
): Pick<VisualRig, "cameraAnchors" | "seatAnchors" | "exitAnchors"> {
  const seatAnchors = new Map<string, Object3D>();
  const cameraAnchors = new Map<string, Object3D>();
  const exitAnchors = new Map<string, Object3D[]>();
  Object.entries(spec.seats).forEach(([id, position]) => {
    const anchor = new Object3D();
    anchor.name = `seat_${id}`;
    anchor.position.set(...position);
    root.add(anchor);
    seatAnchors.set(id, anchor);
  });
  Object.entries(spec.cameras).forEach(([id, position]) => {
    const anchor = new Object3D();
    anchor.name = `camera_${id}`;
    anchor.position.set(...position);
    root.add(anchor);
    cameraAnchors.set(id, anchor);
  });
  Object.entries(spec.exits).forEach(([id, positions]) => {
    const anchors = positions.map((position, index) => {
      const anchor = new Object3D();
      anchor.name = `exit_${id}_${index}`;
      anchor.position.set(...position);
      root.add(anchor);
      return anchor;
    });
    exitAnchors.set(id, anchors);
  });
  return { seatAnchors, cameraAnchors, exitAnchors };
}

function addHeadlights(
  root: Group,
  positions: readonly (readonly [number, number, number])[],
  material: MeshStandardMaterial,
  distance = 45,
  color = 0xffe7bd,
): SpotLight[] {
  return positions.map((position) => {
    const housing = cylinder(position, 0.12, 0.08, material, 14, X_AXIS, Math.PI / 2);
    housing.name = "vehicle-headlight-lens";
    root.add(housing);
    const light = new SpotLight(color, 0, distance, MathUtils.degToRad(24), 0.55, 1.15);
    light.position.set(...position);
    light.target.position.set(position[0], position[1] - 0.2, position[2] + 18);
    root.add(light, light.target);
    return light;
  });
}
