import {
  AimTuning,
  AimTuningOverrides,
  type AimPoseTuning,
  type AimTuningStore,
} from "@engine/animation/layers/AimTuning";
import {
  RestPoseTuning,
  type RestPoseTuningKey,
  type RestPoseValues,
} from "@engine/animation/pose/RestPoseTuning";
import { NpcDebugFlags, type ForcedAimPose } from "@game/npc/core/NpcDebugFlags";
import {
  applyAttachmentTuning,
  WeaponAttachmentTuning,
  type WeaponAttachmentKey,
  type WeaponAttachmentPose,
} from "@game/npc/combat/WeaponAttachmentTuning";
import type { DebugModule } from "../DebugModule";
import {
  buildButton,
  buildCheckbox,
  buildOutput,
  buildSection,
  buildSelect,
  buildSliderRow,
  copyToClipboard,
  type SliderDef,
  type SliderRow,
} from "../widgets";

type AimPoseKey = keyof AimTuningStore;
type AimFieldKey = keyof AimPoseTuning;
type RestFieldKey = keyof RestPoseValues;
type WeaponFieldKey = keyof WeaponAttachmentPose;

const AIM_FIELDS: Array<SliderDef & { key: AimFieldKey }> = [
  { key: "rightUpperArmX", label: "R Upper Arm X", min: -2, max: 2 },
  { key: "rightUpperArmY", label: "R Upper Arm Y", min: -2, max: 2 },
  { key: "rightUpperArmZ", label: "R Upper Arm Z", min: -2, max: 2 },
  { key: "rightForearmX", label: "R Forearm X", min: -2, max: 2 },
  { key: "rightForearmY", label: "R Forearm Y", min: -2, max: 2 },
  { key: "rightForearmZ", label: "R Forearm Z", min: -2, max: 2 },
  { key: "leftUpperArmX", label: "L Upper Arm X", min: -2, max: 2 },
  { key: "leftUpperArmY", label: "L Upper Arm Y", min: -2, max: 2 },
  { key: "leftUpperArmZ", label: "L Upper Arm Z", min: -2, max: 2 },
  { key: "leftForearmX", label: "L Forearm X", min: -2, max: 2 },
  { key: "leftForearmY", label: "L Forearm Y", min: -2, max: 2 },
  { key: "leftForearmZ", label: "L Forearm Z", min: -2, max: 2 },
  { key: "spinePitchFactor", label: "Spine Pitch", min: 0, max: 1 },
  { key: "chestPitchFactor", label: "Chest Pitch", min: 0, max: 1 },
];

const REST_FIELDS: Array<SliderDef & { key: RestFieldKey }> = [
  { key: "rightUpperArmX", label: "R Upper Arm X", min: -2, max: 2 },
  { key: "rightUpperArmY", label: "R Upper Arm Y", min: -2, max: 2 },
  { key: "rightUpperArmZ", label: "R Upper Arm Z", min: -2, max: 2 },
  { key: "rightForearmX", label: "R Forearm X", min: -2, max: 2 },
  { key: "rightForearmY", label: "R Forearm Y", min: -2, max: 2 },
  { key: "rightForearmZ", label: "R Forearm Z", min: -2, max: 2 },
  { key: "leftUpperArmX", label: "L Upper Arm X", min: -2, max: 2 },
  { key: "leftUpperArmY", label: "L Upper Arm Y", min: -2, max: 2 },
  { key: "leftUpperArmZ", label: "L Upper Arm Z", min: -2, max: 2 },
  { key: "leftForearmX", label: "L Forearm X", min: -2, max: 2 },
  { key: "leftForearmY", label: "L Forearm Y", min: -2, max: 2 },
  { key: "leftForearmZ", label: "L Forearm Z", min: -2, max: 2 },
  { key: "spineX", label: "Spine X", min: -1, max: 1 },
  { key: "chestX", label: "Chest X", min: -1, max: 1 },
  { key: "headX", label: "Head X", min: -1, max: 1 },
];

const WEAPON_FIELDS: Array<SliderDef & { key: WeaponFieldKey }> = [
  { key: "positionX", label: "Position X", min: -0.5, max: 0.5 },
  { key: "positionY", label: "Position Y", min: -0.5, max: 0.5 },
  { key: "positionZ", label: "Position Z", min: -0.5, max: 0.5 },
  { key: "rotationX", label: "Rotation X", min: -Math.PI, max: Math.PI },
  { key: "rotationY", label: "Rotation Y", min: -Math.PI, max: Math.PI },
  { key: "rotationZ", label: "Rotation Z", min: -Math.PI, max: Math.PI },
  { key: "worldScale", label: "Scale", min: 0.05, max: 1 },
];

/**
 * Pestania NPCs: flags de AI (ignore/freeze/forceAim) y tuners en vivo de
 * AimTuning / RestPoseTuning / WeaponAttachmentTuning. Solo muta tablas
 * data-driven que los NPCs releen por frame, asi que no hay subscripciones.
 */
export class NpcsModule implements DebugModule {
  readonly id = "npcs";
  readonly label = "NPCs";
  private active = false;
  private readonly listenerAbort = new AbortController();
  private readonly aimRows: SliderRow[] = [];
  private readonly restRows: SliderRow[] = [];
  private readonly weaponRows: SliderRow[] = [];
  private aimPoseSelect: HTMLSelectElement | null = null;
  private aimCharSelect: HTMLSelectElement | null = null;
  private restCharSelect: HTMLSelectElement | null = null;
  private weaponSelect: HTMLSelectElement | null = null;
  private aimOutput: HTMLPreElement | null = null;
  private restOutput: HTMLPreElement | null = null;
  private weaponOutput: HTMLPreElement | null = null;
  /** `"default"` edita el AimTuning compartido; otro = override por characterId. */
  private currentAimChar = "default";
  private currentAimPose: AimPoseKey = "twoHanded";
  private currentRestChar: RestPoseTuningKey = "combine";
  private currentWeapon: WeaponAttachmentKey = "ar3";

  mount(container: HTMLElement): void {
    container.appendChild(this.buildFlagsSection());
    container.appendChild(this.buildAimSection());
    container.appendChild(this.buildRestSection());
    container.appendChild(this.buildWeaponSection());
    this.syncAll();
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.listenerAbort.abort();
    this.aimRows.length = 0;
    this.restRows.length = 0;
    this.weaponRows.length = 0;
  }

  private buildFlagsSection(): HTMLElement {
    const section = buildSection("AI flags", "#ff9999");
    section.appendChild(
      buildCheckbox(
        "IA me ignora",
        () => NpcDebugFlags.ignorePlayer,
        (v) => (NpcDebugFlags.ignorePlayer = v),
        this.listenerAbort.signal,
      ),
    );
    section.appendChild(
      buildCheckbox(
        "Congelar NPCs",
        () => NpcDebugFlags.freezeMovement,
        (v) => (NpcDebugFlags.freezeMovement = v),
        this.listenerAbort.signal,
      ),
    );
    section.appendChild(
      buildCheckbox(
        "NPCs se atacan entre sí",
        () => NpcDebugFlags.infighting,
        (v) => (NpcDebugFlags.infighting = v),
        this.listenerAbort.signal,
      ),
    );

    const wrap = document.createElement("div");
    wrap.className = "debug-row";
    const label = document.createElement("span");
    label.textContent = "Forzar pose aim:";
    wrap.appendChild(label);
    const forceSelect = buildSelect(
      ["none", "twoHanded", "oneHanded"] satisfies ForcedAimPose[],
      (v) => (NpcDebugFlags.forceAimPose = v as ForcedAimPose),
      this.listenerAbort.signal,
    );
    forceSelect.value = NpcDebugFlags.forceAimPose;
    wrap.appendChild(forceSelect);
    section.appendChild(wrap);

    return section;
  }

  private buildAimSection(): HTMLElement {
    const section = buildSection("Aim pose", "#ffcc66");
    this.aimCharSelect = buildSelect(
      ["default", ...Object.keys(AimTuningOverrides)],
      (v) => {
        this.currentAimChar = v;
        this.syncAim();
      },
      this.listenerAbort.signal,
    );
    section.appendChild(this.aimCharSelect);
    this.aimPoseSelect = buildSelect(
      ["twoHanded", "oneHanded"],
      (v) => {
        this.currentAimPose = v as AimPoseKey;
        this.syncAim();
      },
      this.listenerAbort.signal,
    );
    section.appendChild(this.aimPoseSelect);

    const slideHost = document.createElement("div");
    slideHost.className = "debug-slider-list";
    for (const def of AIM_FIELDS) {
      const row = buildSliderRow(
        def,
        slideHost,
        (v) => {
          this.activeAimPose(true)[def.key] = v;
          this.refreshAimOutput();
        },
        this.listenerAbort.signal,
      );
      this.aimRows.push(row);
    }
    section.appendChild(slideHost);

    this.aimOutput = buildOutput();
    section.appendChild(
      buildButton(
        "Copiar aim",
        () => copyToClipboard(this.aimOutput?.textContent ?? ""),
        this.listenerAbort.signal,
      ),
    );
    section.appendChild(this.aimOutput);
    return section;
  }

  private buildRestSection(): HTMLElement {
    const section = buildSection("Rest pose", "#66ccff");
    this.restCharSelect = buildSelect(
      Object.keys(RestPoseTuning),
      (v) => {
        this.currentRestChar = v as RestPoseTuningKey;
        this.syncRest();
      },
      this.listenerAbort.signal,
    );
    section.appendChild(this.restCharSelect);

    const slideHost = document.createElement("div");
    slideHost.className = "debug-slider-list";
    for (const def of REST_FIELDS) {
      const row = buildSliderRow(
        def,
        slideHost,
        (v) => {
          RestPoseTuning[this.currentRestChar][def.key] = v;
          this.refreshRestOutput();
        },
        this.listenerAbort.signal,
      );
      this.restRows.push(row);
    }
    section.appendChild(slideHost);

    this.restOutput = buildOutput();
    section.appendChild(
      buildButton(
        "Copiar rest",
        () => copyToClipboard(this.restOutput?.textContent ?? ""),
        this.listenerAbort.signal,
      ),
    );
    section.appendChild(this.restOutput);
    return section;
  }

  private buildWeaponSection(): HTMLElement {
    const section = buildSection("Weapon attachment", "#ff99cc");
    this.weaponSelect = buildSelect(
      Object.keys(WeaponAttachmentTuning),
      (v) => {
        this.currentWeapon = v as WeaponAttachmentKey;
        this.syncWeapon();
      },
      this.listenerAbort.signal,
    );
    section.appendChild(this.weaponSelect);

    const slideHost = document.createElement("div");
    slideHost.className = "debug-slider-list";
    for (const def of WEAPON_FIELDS) {
      const row = buildSliderRow(
        def,
        slideHost,
        (v) => {
          WeaponAttachmentTuning[this.currentWeapon][def.key] = v;
          applyAttachmentTuning();
          this.refreshWeaponOutput();
        },
        this.listenerAbort.signal,
      );
      this.weaponRows.push(row);
    }
    section.appendChild(slideHost);

    this.weaponOutput = buildOutput();
    section.appendChild(
      buildButton(
        "Copiar weapon",
        () => copyToClipboard(this.weaponOutput?.textContent ?? ""),
        this.listenerAbort.signal,
      ),
    );
    section.appendChild(this.weaponOutput);
    return section;
  }

  private syncAll(): void {
    this.syncAim();
    this.syncRest();
    this.syncWeapon();
  }

  /**
   * Pose de aim activa para (currentAimChar, currentAimPose). `"default"` →
   * el AimTuning compartido. Un character → su override; en `forEdit` se crea
   * (clonando el default) si todavía no existe, así mirar no ensucia overrides.
   */
  private activeAimPose(forEdit: boolean): AimPoseTuning {
    if (this.currentAimChar === "default") return AimTuning[this.currentAimPose];
    const override = (AimTuningOverrides[this.currentAimChar] ??= {});
    const existing = override[this.currentAimPose];
    if (existing) return existing;
    if (!forEdit) return AimTuning[this.currentAimPose];
    const seeded = { ...AimTuning[this.currentAimPose] };
    override[this.currentAimPose] = seeded;
    return seeded;
  }

  private syncAim(): void {
    if (this.aimCharSelect) this.aimCharSelect.value = this.currentAimChar;
    if (this.aimPoseSelect) this.aimPoseSelect.value = this.currentAimPose;
    const pose = this.activeAimPose(false);
    for (const row of this.aimRows) {
      const v = pose[row.key as AimFieldKey];
      row.input.value = String(v);
      row.valueLabel.textContent = v.toFixed(2);
    }
    this.refreshAimOutput();
  }

  private syncRest(): void {
    if (this.restCharSelect) this.restCharSelect.value = this.currentRestChar;
    const pose = RestPoseTuning[this.currentRestChar];
    for (const row of this.restRows) {
      const v = pose[row.key as RestFieldKey];
      row.input.value = String(v);
      row.valueLabel.textContent = v.toFixed(2);
    }
    this.refreshRestOutput();
  }

  private syncWeapon(): void {
    if (this.weaponSelect) this.weaponSelect.value = this.currentWeapon;
    const pose = WeaponAttachmentTuning[this.currentWeapon];
    for (const row of this.weaponRows) {
      const v = pose[row.key as WeaponFieldKey];
      row.input.value = String(v);
      row.valueLabel.textContent = v.toFixed(2);
    }
    this.refreshWeaponOutput();
  }

  private refreshAimOutput(): void {
    if (!this.aimOutput) return;
    const pose = this.activeAimPose(false);
    const label =
      this.currentAimChar === "default"
        ? this.currentAimPose
        : `${this.currentAimChar}.${this.currentAimPose}`;
    const lines = [`${label}: {`];
    for (const def of AIM_FIELDS) {
      lines.push(`  ${def.key}: ${pose[def.key].toFixed(2)},`);
    }
    lines.push("}");
    this.aimOutput.textContent = lines.join("\n");
  }

  private refreshRestOutput(): void {
    if (!this.restOutput) return;
    const pose = RestPoseTuning[this.currentRestChar];
    const lines = [`${this.currentRestChar}: {`];
    for (const def of REST_FIELDS) {
      lines.push(`  ${def.key}: ${pose[def.key].toFixed(2)},`);
    }
    lines.push("}");
    this.restOutput.textContent = lines.join("\n");
  }

  private refreshWeaponOutput(): void {
    if (!this.weaponOutput) return;
    const pose = WeaponAttachmentTuning[this.currentWeapon];
    const lines = [`${this.currentWeapon}: {`];
    for (const def of WEAPON_FIELDS) {
      lines.push(`  ${def.key}: ${pose[def.key].toFixed(2)},`);
    }
    lines.push("}");
    this.weaponOutput.textContent = lines.join("\n");
  }
}
