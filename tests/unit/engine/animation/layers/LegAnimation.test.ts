import { Bone, Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { AnimationInput } from "@engine/animation/AnimationInput";
import type { AnimationLayerContext } from "@engine/animation/layers/AnimationLayer";
import { LocomotionLayer } from "@engine/animation/layers/LocomotionLayer";
import { PostureLayer } from "@engine/animation/layers/PostureLayer";
import type { BoneMap } from "@engine/animation/pose/BoneMapper";

describe("animación anatómica de piernas", () => {
  it("el crouch lleva las rodillas hacia delante y mantiene los pies nivelados", () => {
    const rig = makeRig();
    const layer = new PostureLayer();

    layer.apply(context(rig.root, rig.bones, input({ crouch: 1 })));
    rig.root.updateMatrixWorld(true);

    const knee = rig.bones.leftShin!.getWorldPosition(new Vector3());
    const ankle = rig.bones.leftFoot!.getWorldPosition(new Vector3());
    const footRotation = rig.bones.leftFoot!.getWorldQuaternion(new Quaternion());
    expect(knee.z).toBeGreaterThan(0.3);
    expect(ankle.z).toBeLessThan(knee.z);
    expect(footRotation.angleTo(new Quaternion())).toBeLessThan(0.001);
  });

  it("flexiona la rodilla en el centro de recuperación, no al final del paso", () => {
    const recovering = makeRig();
    const recoveryLayer = new LocomotionLayer();
    recoveryLayer.apply(context(
      recovering.root,
      recovering.bones,
      input({ deltaTime: Math.PI / 3.4, localForwardSpeed: 3.2 }),
    ));

    const extended = makeRig();
    const extensionLayer = new LocomotionLayer();
    extensionLayer.apply(context(
      extended.root,
      extended.bones,
      input({ deltaTime: Math.PI * 1.5 / 3.4, localForwardSpeed: 3.2 }),
    ));

    expect(recovering.bones.leftShin!.rotation.x).toBeGreaterThan(0.15);
    expect(extended.bones.leftShin!.rotation.x).toBeCloseTo(0, 5);
  });
});

function makeRig(): { root: Object3D; bones: BoneMap } {
  const root = new Object3D();
  const hips = new Bone();
  hips.name = "Hips";
  hips.position.y = 1;
  root.add(hips);

  const leftThigh = leg(hips, "LeftUpLeg", -0.2);
  const rightThigh = leg(hips, "RightUpLeg", 0.2);
  return {
    root,
    bones: {
      hips,
      leftThigh: leftThigh.thigh,
      leftShin: leftThigh.shin,
      leftFoot: leftThigh.foot,
      rightThigh: rightThigh.thigh,
      rightShin: rightThigh.shin,
      rightFoot: rightThigh.foot,
    },
  };
}

function leg(
  hips: Bone,
  thighName: string,
  x: number,
): { thigh: Bone; shin: Bone; foot: Bone } {
  const thigh = new Bone();
  thigh.name = thighName;
  thigh.position.x = x;
  const shin = new Bone();
  shin.name = thighName.replace("Up", "");
  shin.position.y = -0.5;
  const foot = new Bone();
  foot.name = thighName.replace("UpLeg", "Foot");
  foot.position.y = -0.5;
  hips.add(thigh);
  thigh.add(shin);
  shin.add(foot);
  return { thigh, shin, foot };
}

function context(
  root: Object3D,
  bones: BoneMap,
  animationInput: AnimationInput,
): AnimationLayerContext {
  return { root, bones, hasSkeleton: true, input: animationInput };
}

function input(options: {
  crouch?: number;
  deltaTime?: number;
  localForwardSpeed?: number;
}): AnimationInput {
  const localVelocity = new Vector3(0, 0, options.localForwardSpeed ?? 0);
  return {
    deltaTime: options.deltaTime ?? 1 / 60,
    time: 0,
    locomotion: {
      worldVelocity: localVelocity.clone(),
      localVelocity,
      isGrounded: true,
    },
    posture: { crouch: options.crouch ?? 0, lean: 0 },
    aim: {
      active: false,
      weight: 0,
      localDirection: new Vector3(0, 0, 1),
      weaponPose: "none",
    },
    activity: "none",
    events: { shotJustFired: false },
    lookDirection: new Vector3(0, 0, 1),
    isDead: false,
    desiredDirection: new Vector3(0, 0, 1),
  };
}
