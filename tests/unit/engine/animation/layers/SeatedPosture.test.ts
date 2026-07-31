import { Bone, Object3D, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { AnimationInput } from "@engine/animation/AnimationInput";
import type { AnimationLayerContext } from "@engine/animation/layers/AnimationLayer";
import { PostureLayer } from "@engine/animation/layers/PostureLayer";
import type { BoneMap } from "@engine/animation/pose/BoneMapper";

describe("pose sentada", () => {
  it("lleva los muslos al frente sin bajar las caderas", () => {
    const rig = makeRig();
    const hipsY = rig.bones.hips!.position.y;

    new PostureLayer().apply(context(rig, input({ seated: 1 })));
    rig.root.updateMatrixWorld(true);

    const hip = rig.bones.leftThigh!.getWorldPosition(new Vector3());
    const knee = rig.bones.leftShin!.getWorldPosition(new Vector3());
    const ankle = rig.bones.leftFoot!.getWorldPosition(new Vector3());
    // Rodilla adelante y a la altura de la cadera; tobillo por debajo de ella.
    expect(knee.z).toBeGreaterThan(0.4);
    expect(Math.abs(knee.y - hip.y)).toBeLessThan(0.15);
    expect(ankle.y).toBeLessThan(knee.y - 0.2);
    // El asiento coloca el root: la pose no debe hundir la cadera como el crouch.
    expect(rig.bones.hips!.position.y).toBeCloseTo(hipsY, 6);
  });

  it("interpola con el peso: media pose dobla la mitad", () => {
    const full = makeRig();
    const half = makeRig();
    new PostureLayer().apply(context(full, input({ seated: 1 })));
    new PostureLayer().apply(context(half, input({ seated: 0.5 })));

    expect(half.bones.leftShin!.rotation.x).toBeGreaterThan(0.1);
    expect(half.bones.leftShin!.rotation.x).toBeLessThan(
      full.bones.leftShin!.rotation.x,
    );
  });

  it("cede los brazos al aim para no sumar dos rotaciones al mismo hueso", () => {
    const resting = makeRig();
    const aiming = makeRig();
    new PostureLayer().apply(context(resting, input({ seated: 1 })));
    new PostureLayer().apply(
      context(aiming, input({ seated: 1, aimWeight: 1 })),
    );

    expect(resting.bones.leftUpperArm!.rotation.x).not.toBeCloseTo(0, 3);
    expect(aiming.bones.leftUpperArm!.rotation.x).toBeCloseTo(0, 6);
    // Las piernas siguen sentadas aunque los brazos apunten.
    expect(aiming.bones.leftShin!.rotation.x).toBeGreaterThan(0.5);
  });

  it("las manos a los controles flexionan más que los brazos en reposo", () => {
    const resting = makeRig();
    const driving = makeRig();
    new PostureLayer().apply(context(resting, input({ seated: 1 })));
    new PostureLayer().apply(
      context(driving, input({ seated: 1, seatedControls: 1 })),
    );

    expect(Math.abs(driving.bones.leftForearm!.rotation.x)).toBeGreaterThan(
      Math.abs(resting.bones.leftForearm!.rotation.x),
    );
  });
});

function makeRig(): { root: Object3D; bones: BoneMap } {
  const root = new Object3D();
  const hips = new Bone();
  hips.name = "Hips";
  hips.position.y = 1;
  root.add(hips);

  const spine = new Bone();
  spine.name = "Spine";
  hips.add(spine);
  const chest = new Bone();
  chest.name = "Chest";
  spine.add(chest);

  const left = limb(hips, chest, "Left");
  const right = limb(hips, chest, "Right");
  return {
    root,
    bones: {
      hips,
      spine,
      chest,
      leftThigh: left.thigh,
      leftShin: left.shin,
      leftFoot: left.foot,
      leftUpperArm: left.upperArm,
      leftForearm: left.forearm,
      rightThigh: right.thigh,
      rightShin: right.shin,
      rightFoot: right.foot,
      rightUpperArm: right.upperArm,
      rightForearm: right.forearm,
    },
  };
}

function limb(
  hips: Bone,
  chest: Bone,
  side: "Left" | "Right",
): { thigh: Bone; shin: Bone; foot: Bone; upperArm: Bone; forearm: Bone } {
  const sign = side === "Left" ? -1 : 1;
  const thigh = new Bone();
  thigh.name = `${side}UpLeg`;
  thigh.position.x = 0.2 * sign;
  const shin = new Bone();
  shin.name = `${side}Leg`;
  shin.position.y = -0.5;
  const foot = new Bone();
  foot.name = `${side}Foot`;
  foot.position.y = -0.5;
  hips.add(thigh);
  thigh.add(shin);
  shin.add(foot);

  const upperArm = new Bone();
  upperArm.name = `${side}Arm`;
  upperArm.position.x = 0.25 * sign;
  const forearm = new Bone();
  forearm.name = `${side}ForeArm`;
  forearm.position.y = -0.3;
  chest.add(upperArm);
  upperArm.add(forearm);
  return { thigh, shin, foot, upperArm, forearm };
}

function context(
  rig: { root: Object3D; bones: BoneMap },
  animationInput: AnimationInput,
): AnimationLayerContext {
  return {
    root: rig.root,
    bones: rig.bones,
    hasSkeleton: true,
    input: animationInput,
  };
}

function input(options: {
  seated?: number;
  seatedControls?: number;
  aimWeight?: number;
}): AnimationInput {
  return {
    deltaTime: 1 / 60,
    time: 0,
    locomotion: {
      worldVelocity: new Vector3(),
      localVelocity: new Vector3(),
      isGrounded: true,
    },
    posture: {
      crouch: 0,
      lean: 0,
      seated: options.seated ?? 0,
      seatedControls: options.seatedControls ?? 0,
    },
    aim: {
      active: (options.aimWeight ?? 0) > 0,
      weight: options.aimWeight ?? 0,
      localDirection: new Vector3(0, 0, 1),
      weaponPose: (options.aimWeight ?? 0) > 0 ? "twoHanded" : "none",
    },
    activity: "none",
    events: { shotJustFired: false },
    lookDirection: new Vector3(0, 0, 1),
    isDead: false,
    desiredDirection: new Vector3(0, 0, 1),
  };
}
