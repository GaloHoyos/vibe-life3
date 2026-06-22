import { Bone, Mesh, Object3D, Vector3 } from "three";
import { BoneMapper } from "@engine/animation/pose/BoneMapper";
import {
  applyToAttachment,
  isWeaponAttachmentKey,
  registerAttachment,
  WeaponAttachmentTuning,
} from "./WeaponAttachmentTuning";

export interface WeaponAttachmentHandle {
  readonly weapon: Object3D;
  readonly hand: Bone;
  /** Devuelve la posiciÃ³n world actual del arma (Ãºtil al hacer drop). */
  getWorldPosition(target: Vector3): Vector3;
  /** Saca el arma del bone y la deja como huÃ©rfana. Para drop on death. */
  detach(): void;
}

/**
 * Adjunta `weaponModel` como hijo de la bone `rightHand` del esqueleto de
 * `npcVisualRoot`. La escala se calcula compensando la escala acumulada de
 * todo el chain de parents â€” esto evita que el arma quede invisible cuando
 * el rig importado viene con scale != 1 (tÃ­pico de Mixamo en cm).
 *
 * El pose (position / rotation / worldScale) viene de `WeaponAttachmentTuning`,
 * un store mutable que el panel de debug puede modificar en runtime.
 *
 * Devuelve un handle para detach() en muerte (drop weapon). Null si no
 * encontrÃ³ el bone o el weapon es null.
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

  const tuningKey = isWeaponAttachmentKey(weaponId) ? weaponId : "ar3";
  if (!isWeaponAttachmentKey(weaponId)) {
    console.warn(
      `[NpcWeapon] '${npcId}': weaponId '${weaponId}' sin tuning; usando ar3`,
    );
  }

  hand.updateWorldMatrix(true, false);
  const handWorldScale = new Vector3();
  hand.matrixWorld.decompose(new Vector3(), npcVisualRoot.quaternion.clone(), handWorldScale);
  const accumulatedScale = (handWorldScale.x + handWorldScale.y + handWorldScale.z) / 3;

  weaponModel.traverse((obj) => {
    obj.frustumCulled = false;
    if (obj instanceof Mesh) {
      obj.castShadow = false;
      obj.receiveShadow = false;
    }
  });

  // El weapon vive como hijo del hand bone, asÃ­ que el PoseSnapshot del
  // animator lo captura. Marcar `skipPoseSnapshot` evita que el restore
  // de cada frame pise nuestros offsets (los del `WeaponAttachmentTuning`).
  weaponModel.userData['skipPoseSnapshot'] = true;

  hand.add(weaponModel);

  const entry = {
    weapon: weaponModel,
    weaponId: tuningKey,
    accumulatedScale,
    kind: "hand" as const,
  };
  applyToAttachment(entry);
  const unregister = registerAttachment(entry);

  const tuning = WeaponAttachmentTuning[tuningKey];
  console.info(
    `[NpcWeapon] '${npcId}': '${weaponId}' adjuntado a '${hand.name}' (scale acumulada ${accumulatedScale.toFixed(3)}, target world ${tuning.worldScale.toFixed(3)})`,
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
      unregister();
      weaponModel.removeFromParent();
    },
  };
}
