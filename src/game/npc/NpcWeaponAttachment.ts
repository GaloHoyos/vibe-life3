import { Bone, Euler, Mesh, Object3D, Vector3 } from "three";
import { BoneMapper } from "../../engine/animation/BoneMapper";

interface AttachmentPose {
  /** Offset local en la bone de la mano (en metros mundo). */
  position: Vector3;
  /** Rotación local Euler. */
  rotation: Euler;
  /** Escala visual final del arma (metros mundo). Se compensa por la escala
   *  acumulada del esqueleto antes de aplicar al modelo. */
  worldScale: number;
}

/**
 * Las escalas son las mismas que `viewModelScale` en `weapons.config.ts` —
 * así el arma en la mano del NPC se ve del mismo tamaño que la del player.
 *
 * Convención de ejes en la bone derecha de Mixamo:
 *   +Y → a lo largo de los dedos (dirección del cañón cuando se empuña)
 *   +Z → dorso de la mano (techo del arma)
 *   +X → lado del pulgar
 *
 * El GLB de armas tiene cañón en -X y techo en +Y (consistente con
 * `WeaponViewModel.modelRoot.rotation.y = -π/2`, que mapea GLB -X a -Z =
 * forward de la cámara). La rotación base `Euler(0, π/2, -π/2)` alinea
 * el cañón -X con hand +Y y el techo +Y con hand -Z (palmar) — equivale
 * a la rotación canónica más un roll de 180° sobre el eje del cañón. El
 * offset en Y desliza el arma desde la wrist hacia los dedos.
 */
const ATTACHMENTS: Record<string, AttachmentPose> = {
  ar3: {
    position: new Vector3(0, 0.12, 0),
    rotation: new Euler(0, Math.PI / 2, -Math.PI / 2),
    worldScale: 0.29,
  },
  pistol: {
    position: new Vector3(0, 0.16, 0),
    rotation: new Euler(0, Math.PI / 2, -Math.PI / 2),
    worldScale: 0.17,
  },
  smg: {
    position: new Vector3(0, 0.11, 0),
    rotation: new Euler(0, Math.PI / 2, -Math.PI / 2),
    worldScale: 0.28,
  },
  crowbar: {
    position: new Vector3(0, 0.11, 0),
    rotation: new Euler(0.15, -Math.PI / 2 - 0.35, -0.22),
    worldScale: 0.28,
  },
};

const DEFAULT_POSE: AttachmentPose = {
  position: new Vector3(0, 0.11, 0),
  rotation: new Euler(0, Math.PI / 2, -Math.PI / 2),
  worldScale: 0.28,
};

export interface WeaponAttachmentHandle {
  readonly weapon: Object3D;
  readonly hand: Bone;
  /** Devuelve la posición world actual del arma (útil al hacer drop). */
  getWorldPosition(target: Vector3): Vector3;
  /** Saca el arma del bone y la deja como huérfana. Para drop on death. */
  detach(): void;
}

/**
 * Adjunta `weaponModel` como hijo de la bone `rightHand` del esqueleto de
 * `npcVisualRoot`. La escala se calcula compensando la escala acumulada de
 * todo el chain de parents — esto evita que el arma quede invisible cuando
 * el rig importado viene con scale != 1 (típico de Mixamo en cm).
 *
 * Devuelve un handle para detach() en muerte (drop weapon). Null si no
 * encontró el bone.
 */
export function attachWeaponToHand(
  npcVisualRoot: Object3D,
  weaponModel: Object3D | null,
  weaponId: string,
  npcId: string,
): WeaponAttachmentHandle | null {
  if (!weaponModel) {
    console.warn(`[NpcWeapon] '${npcId}': weaponModel es null`);
    return null;
  }
  const mapper = new BoneMapper(npcVisualRoot);
  const hand = mapper.get("rightHand");
  if (!hand) {
    const available = mapper.getFoundNames().join(", ");
    console.warn(
      `[NpcWeapon] '${npcId}' no tiene rightHand bone. Bones disponibles: ${available.slice(0, 400)}`,
    );
    return null;
  }

  const pose = ATTACHMENTS[weaponId] ?? DEFAULT_POSE;

  hand.updateWorldMatrix(true, false);
  const handWorldScale = new Vector3();
  hand.matrixWorld.decompose(new Vector3(), npcVisualRoot.quaternion.clone(), handWorldScale);
  const accumulatedScale = (handWorldScale.x + handWorldScale.y + handWorldScale.z) / 3;
  const localScale =
    accumulatedScale > 0 ? pose.worldScale / accumulatedScale : pose.worldScale;

  weaponModel.position.copy(pose.position).divideScalar(
    accumulatedScale > 0 ? accumulatedScale : 1,
  );
  weaponModel.rotation.copy(pose.rotation);
  weaponModel.scale.setScalar(localScale);
  weaponModel.traverse((obj) => {
    obj.frustumCulled = false;
    if (obj instanceof Mesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });

  hand.add(weaponModel);
  console.info(
    `[NpcWeapon] '${npcId}': '${weaponId}' adjuntado a '${hand.name}' (scale acumulada ${accumulatedScale.toFixed(3)}, local ${localScale.toFixed(3)})`,
  );

  return {
    weapon: weaponModel,
    hand,
    getWorldPosition(target: Vector3): Vector3 {
      hand.updateWorldMatrix(true, false);
      target.setFromMatrixPosition(hand.matrixWorld);
      return target;
    },
    detach(): void {
      weaponModel.removeFromParent();
    },
  };
}
