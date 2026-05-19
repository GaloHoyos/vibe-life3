import { MathUtils } from "three";
import type {
  ArmsMode,
  CharacterAnimationConfig,
  HumanoidBoneAxesConfig,
} from "../../characters/CharacterDefinition";
import {
  DefaultWalkConfig,
  DefaultWalkOptions,
  type ProceduralWalkConfig,
  type WalkStyle,
} from "../ProceduralWalk";
import { applyBoneRotationOffset } from "../BoneRotation";
import type { AnimationLayer, AnimationLayerContext } from "./AnimationLayer";

const IDLE_SPEED_THRESHOLD = 0.15;
const RUN_SPEED_THRESHOLD = 4.7;

/**
 * Locomoción direccional: rinde walk/run/strafe/backward leyendo
 * `localVelocity` (frame del personaje, +Z=forward, +X=right).
 *
 * Mantiene una fase persistente: el ciclo de paso avanza con `deltaTime *
 * stepFrequency * speedFactor` en vez de samplear `time * stepFrequency`,
 * para que cambios de velocidad no provoquen saltos visuales.
 *
 * Componentes (todos aditivos a la rest-pose):
 *  - Forward/back: swing de muslos sobre `legSwingAxis`, signado por
 *    `fwdSign` (-1 cuando camina hacia atrás → invierte la fase visual).
 *  - Strafe: hip sway lateral amplificado + ligera apertura del muslo
 *    sobre eje Z, según `strSign`.
 *  - Knee bend & step lift: levanta el pie en el medio ciclo.
 *  - Arm swing contralateral: opuesto a la pierna. Si `armsMode='weaponAim'`
 *    queda casi nulo (el `AimLayer` toma control de los brazos en F4).
 *  - Torso lean: hacia adelante en avance, hacia atrás en reverso, neutral
 *    en strafe puro.
 *  - Bob: oscilación vertical de las caderas en cada paso.
 */
export class LocomotionLayer implements AnimationLayer {
  private readonly config: ProceduralWalkConfig;
  private readonly axes: HumanoidBoneAxesConfig;
  private readonly armsMode: ArmsMode;
  private phase = 0;

  constructor(animation?: CharacterAnimationConfig) {
    this.config = {
      ...DefaultWalkConfig,
      ...animation?.walk,
      style: animation?.walkStyle ?? DefaultWalkConfig.style,
      maxHeadYaw: animation?.maxHeadYaw ?? DefaultWalkConfig.maxHeadYaw,
      maxHeadPitch: animation?.maxHeadPitch ?? DefaultWalkConfig.maxHeadPitch,
    };
    this.axes = animation?.boneAxes ?? DefaultWalkOptions.boneAxes;
    this.armsMode = animation?.armsMode ?? DefaultWalkOptions.armsMode;
  }

  apply(ctx: AnimationLayerContext): void {
    const lv = ctx.input.locomotion.localVelocity;
    const fwd = lv.z;
    const str = lv.x;
    const total = Math.hypot(fwd, str);

    if (total <= IDLE_SPEED_THRESHOLD) {
      return;
    }

    if (!ctx.hasSkeleton) {
      this.applyRootFallback(ctx, total);
      return;
    }

    const isRun = total > RUN_SPEED_THRESHOLD;
    const intensity = isRun ? 1.25 : 1;
    const runMul = isRun ? 1.35 : 1;

    const normalizedSpeed = MathUtils.clamp(total / 3.2, 0, 1.25);
    const styleMul = getStyleMultiplier(this.config.style);
    this.phase +=
      ctx.input.deltaTime *
      this.config.stepFrequency *
      Math.max(0.4, normalizedSpeed) *
      runMul *
      styleMul;

    const fwdAbs = Math.abs(fwd);
    const strAbs = Math.abs(str);
    const fwdWeight = total > 0 ? fwdAbs / total : 0;
    const strWeight = total > 0 ? strAbs / total : 0;
    const fwdSign = fwd >= 0 ? 1 : -1;
    const strSign = str >= 0 ? 1 : -1;

    const leftSin = Math.sin(this.phase);
    const rightSin = Math.sin(this.phase + Math.PI);
    const leftCos = Math.cos(this.phase);
    const rightCos = Math.cos(this.phase + Math.PI);

    const stride = clamp(
      this.config.strideLength * intensity * runMul,
      this.config.maxLegSwing,
    );
    const armSwing = clamp(
      this.config.armSwing *
        intensity *
        runMul *
        getArmSwingMultiplier(this.armsMode),
      this.config.maxArmSwing,
    );
    const staggerNoise =
      this.config.style === "staggered"
        ? Math.sin(ctx.input.time * 2.1) * this.config.randomness
        : 0;

    const legFwdLeft = leftSin * stride * fwdWeight * fwdSign;
    const legFwdRight = rightSin * stride * fwdWeight * fwdSign;

    applyBoneRotationOffset(
      ctx.bones.leftThigh,
      this.axes.legSwingAxis,
      clamp(legFwdLeft + staggerNoise * 0.25, this.config.maxLegSwing),
    );
    applyBoneRotationOffset(
      ctx.bones.rightThigh,
      this.axes.legSwingAxis,
      clamp(legFwdRight - staggerNoise * 0.25, this.config.maxLegSwing),
    );

    if (strWeight > 0.05) {
      const strafeAmplitude = stride * strWeight * 0.45;
      applyBoneRotationOffset(
        ctx.bones.leftThigh,
        "z",
        leftSin * strafeAmplitude * strSign,
      );
      applyBoneRotationOffset(
        ctx.bones.rightThigh,
        "z",
        rightSin * strafeAmplitude * strSign,
      );
    }

    const kneeBend = MathUtils.clamp(
      stride * 0.55,
      0,
      this.config.maxKneeBend,
    );
    const leftLift =
      Math.max(0, leftCos) * this.config.stepHeight * intensity;
    const rightLift =
      Math.max(0, rightCos) * this.config.stepHeight * intensity;
    applyBoneRotationOffset(
      ctx.bones.leftShin,
      this.axes.kneeBendAxis,
      MathUtils.clamp(
        Math.max(0, -leftSin) * kneeBend + leftLift,
        0,
        this.config.maxKneeBend,
      ),
    );
    applyBoneRotationOffset(
      ctx.bones.rightShin,
      this.axes.kneeBendAxis,
      MathUtils.clamp(
        Math.max(0, -rightSin) * kneeBend + rightLift,
        0,
        this.config.maxKneeBend,
      ),
    );
    applyBoneRotationOffset(
      ctx.bones.leftFoot,
      this.axes.kneeBendAxis,
      MathUtils.clamp(
        -leftSin * 0.08,
        -this.config.maxFootRotation,
        this.config.maxFootRotation,
      ),
    );
    applyBoneRotationOffset(
      ctx.bones.rightFoot,
      this.axes.kneeBendAxis,
      MathUtils.clamp(
        -rightSin * 0.08,
        -this.config.maxFootRotation,
        this.config.maxFootRotation,
      ),
    );

    const armWeight = fwdWeight + strWeight * 0.4;
    const armSwingEffective = armSwing * armWeight;
    applyBoneRotationOffset(
      ctx.bones.leftUpperArm,
      this.axes.armSwingAxis,
      rightSin * armSwingEffective * 0.55 * fwdSign,
    );
    applyBoneRotationOffset(
      ctx.bones.rightUpperArm,
      this.axes.armSwingAxis,
      leftSin * armSwingEffective * 0.55 * fwdSign,
    );
    applyBoneRotationOffset(
      ctx.bones.leftForearm,
      this.axes.elbowBendAxis,
      getForearmBend(this.armsMode, leftSin * fwdSign, intensity),
    );
    applyBoneRotationOffset(
      ctx.bones.rightForearm,
      this.axes.elbowBendAxis,
      getForearmBend(this.armsMode, rightSin * fwdSign, intensity),
    );

    const torsoLean = clamp(
      this.config.torsoLean * intensity * runMul * fwdWeight * fwdSign,
      this.config.maxTorsoLean,
    );
    applyBoneRotationOffset(
      ctx.bones.spine,
      this.axes.spineLeanAxis,
      torsoLean,
    );
    applyBoneRotationOffset(
      ctx.bones.chest,
      this.axes.spineLeanAxis,
      torsoLean * 0.45,
    );

    const sideSway = MathUtils.clamp(
      Math.sin(this.phase) *
        this.config.sideToSide *
        intensity *
        (1 + strWeight * 2.5),
      -this.config.maxSideSwing,
      this.config.maxSideSwing,
    );
    applyBoneRotationOffset(ctx.bones.chest, "z", sideSway);

    const bob =
      Math.abs(Math.sin(this.phase * 2)) *
      this.config.torsoBob *
      intensity *
      runMul;
    if (ctx.bones.hips) {
      ctx.bones.hips.position.y += bob;
    } else {
      ctx.root.position.y += bob;
    }
  }

  private applyRootFallback(ctx: AnimationLayerContext, speed: number): void {
    const walkAmount = MathUtils.clamp(speed / 4, 0, 1);
    const bob =
      Math.sin(ctx.input.time * 7 * Math.max(walkAmount, 0.25)) *
      0.08 *
      walkAmount;
    const sway =
      Math.sin(ctx.input.time * 3.5) * 0.08 * Math.max(walkAmount, 0.25);

    ctx.root.position.y += bob;
    ctx.root.rotation.z += sway;
    ctx.root.rotation.x += walkAmount * 0.12;
  }
}

function clamp(value: number, max: number): number {
  return MathUtils.clamp(value, -max, max);
}

function getStyleMultiplier(style: WalkStyle): number {
  if (style === "staggered") return 0.74;
  if (style === "heavy") return 0.72;
  if (style === "creature") return 1.15;
  return 1;
}

function getArmSwingMultiplier(mode: ArmsMode): number {
  if (mode === "zombieForward") return 0.55;
  if (mode === "weaponAim") return 0.25;
  return 1;
}

function getForearmBend(mode: ArmsMode, step: number, intensity: number): number {
  if (mode === "zombieForward") {
    return -0.08 * intensity + Math.max(0, step) * 0.035;
  }
  if (mode === "weaponAim") {
    return -0.18 * intensity;
  }
  return -0.1 * intensity + Math.max(0, step) * 0.055;
}
