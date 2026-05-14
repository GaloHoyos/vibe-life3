import { Bone, Object3D } from 'three';

export type NormalizedBoneName =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftUpperArm'
  | 'leftForearm'
  | 'leftHand'
  | 'rightUpperArm'
  | 'rightForearm'
  | 'rightHand'
  | 'leftThigh'
  | 'leftShin'
  | 'leftFoot'
  | 'rightThigh'
  | 'rightShin'
  | 'rightFoot';

export type BoneMap = Partial<Record<NormalizedBoneName, Bone>>;

export interface BoneMapperOptions {
  debug?: boolean;
}

const aliases: Record<NormalizedBoneName, string[]> = {
  hips: ['Hips', 'hips', 'Pelvis', 'pelvis', 'mixamorigHips', 'DEF-hips'],
  spine: ['Spine', 'spine', 'mixamorigSpine', 'DEF-spine'],
  chest: ['Spine1', 'Spine2', 'Chest', 'chest', 'mixamorigSpine1', 'mixamorigSpine2', 'DEF-chest'],
  neck: ['Neck', 'neck', 'mixamorigNeck'],
  head: ['Head', 'head', 'mixamorigHead', 'DEF-head'],
  leftUpperArm: ['LeftArm', 'UpperArm.L', 'upper_arm.L', 'mixamorigLeftArm'],
  leftForearm: ['LeftForeArm', 'Forearm.L', 'lower_arm.L', 'mixamorigLeftForeArm'],
  leftHand: ['LeftHand', 'Hand.L', 'mixamorigLeftHand'],
  rightUpperArm: ['RightArm', 'UpperArm.R', 'upper_arm.R', 'mixamorigRightArm'],
  rightForearm: ['RightForeArm', 'Forearm.R', 'lower_arm.R', 'mixamorigRightForeArm'],
  rightHand: ['RightHand', 'Hand.R', 'mixamorigRightHand'],
  leftThigh: ['LeftUpLeg', 'Thigh.L', 'upper_leg.L', 'mixamorigLeftUpLeg'],
  leftShin: ['LeftLeg', 'Shin.L', 'lower_leg.L', 'mixamorigLeftLeg'],
  leftFoot: ['LeftFoot', 'Foot.L', 'mixamorigLeftFoot'],
  rightThigh: ['RightUpLeg', 'Thigh.R', 'upper_leg.R', 'mixamorigRightUpLeg'],
  rightShin: ['RightLeg', 'Shin.R', 'lower_leg.R', 'mixamorigRightLeg'],
  rightFoot: ['RightFoot', 'Foot.R', 'mixamorigRightFoot'],
};

export class BoneMapper {
  readonly bones: BoneMap = {};
  readonly missing: NormalizedBoneName[] = [];
  readonly foundNames: string[] = [];

  constructor(root: Object3D, options: BoneMapperOptions = {}) {
    const availableBones = this.collectBones(root);
    const lowerNameIndex = new Map<string, Bone>();

    availableBones.forEach((bone) => {
      this.foundNames.push(bone.name);
      lowerNameIndex.set(normalizeName(bone.name), bone);
    });

    (Object.keys(aliases) as NormalizedBoneName[]).forEach((normalizedName) => {
      const bone = aliases[normalizedName]
        .map((alias) => lowerNameIndex.get(normalizeName(alias)))
        .find((candidate): candidate is Bone => Boolean(candidate));

      if (bone) {
        this.bones[normalizedName] = bone;
        return;
      }

      this.missing.push(normalizedName);
      if (options.debug) {
        console.warn(`[BoneMapper] Missing bone "${normalizedName}".`);
      }
    });
  }

  get(name: NormalizedBoneName): Bone | undefined {
    return this.bones[name];
  }

  hasSkeleton(): boolean {
    return this.foundNames.length > 0;
  }

  getFoundNames(): string[] {
    return [...this.foundNames];
  }

  getMissingNames(): NormalizedBoneName[] {
    return [...this.missing];
  }

  private collectBones(root: Object3D): Bone[] {
    const bones: Bone[] = [];

    root.traverse((object) => {
      if (object instanceof Bone) {
        bones.push(object);
      }
    });

    return bones;
  }
}

function normalizeName(name: string): string {
  return name.replace(/[\s_\-.]/g, '').toLowerCase();
}
