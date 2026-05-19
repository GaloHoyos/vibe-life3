import {
  AimTuning,
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

type AimPoseKey = keyof AimTuningStore;
type AimFieldKey = keyof AimPoseTuning;
type RestFieldKey = keyof RestPoseValues;
type WeaponFieldKey = keyof WeaponAttachmentPose;

interface SliderRow<TField extends string> {
  field: TField;
  input: HTMLInputElement;
  valueLabel: HTMLSpanElement;
}

interface FieldDef<TField extends string> {
  key: TField;
  label: string;
  min: number;
  max: number;
}

const AIM_FIELDS: FieldDef<AimFieldKey>[] = [
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

const WEAPON_FIELDS: FieldDef<WeaponFieldKey>[] = [
  { key: "positionX", label: "Position X", min: -0.5, max: 0.5 },
  { key: "positionY", label: "Position Y", min: -0.5, max: 0.5 },
  { key: "positionZ", label: "Position Z", min: -0.5, max: 0.5 },
  { key: "rotationX", label: "Rotation X", min: -Math.PI, max: Math.PI },
  { key: "rotationY", label: "Rotation Y", min: -Math.PI, max: Math.PI },
  { key: "rotationZ", label: "Rotation Z", min: -Math.PI, max: Math.PI },
  { key: "worldScale", label: "Scale", min: 0.05, max: 1 },
];

const REST_FIELDS: FieldDef<RestFieldKey>[] = [
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

/**
 * Panel flotante con sliders para tunear `AimTuning`, `RestPoseTuning` y
 * `WeaponAttachmentTuning` en runtime. El toggle de visibilidad lo maneja
 * el `NpcDebugSystem` via keybind.
 */
export class AimDebugPanel {
  private readonly root: HTMLDivElement;
  private readonly aimRows: SliderRow<AimFieldKey>[] = [];
  private readonly restRows: SliderRow<RestFieldKey>[] = [];
  private readonly weaponRows: SliderRow<WeaponFieldKey>[] = [];
  private readonly aimPoseSelect: HTMLSelectElement;
  private readonly restCharSelect: HTMLSelectElement;
  private readonly weaponSelect: HTMLSelectElement;
  private readonly aimOutput: HTMLPreElement;
  private readonly restOutput: HTMLPreElement;
  private readonly weaponOutput: HTMLPreElement;
  private readonly aimContainer: HTMLDivElement;
  private readonly restContainer: HTMLDivElement;
  private readonly weaponContainer: HTMLDivElement;
  private readonly listenerAbort = new AbortController();
  private currentAimPose: AimPoseKey = "twoHanded";
  private currentRestChar: RestPoseTuningKey = "combine";
  private currentWeapon: WeaponAttachmentKey = "ar3";

  constructor() {
    this.root = document.createElement("div");
    this.root.style.cssText = [
      "position: fixed",
      "top: 12px",
      "right: 12px",
      "width: 300px",
      "max-height: 92vh",
      "overflow-y: auto",
      "padding: 10px 12px",
      "background: rgba(15,15,22,0.92)",
      "color: #e8e8ee",
      "font: 11px/1.3 'Consolas', monospace",
      "border: 1px solid #2a2a3a",
      "border-radius: 6px",
      "z-index: 99999",
      "user-select: none",
      "pointer-events: auto",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "NPC Debug (F4 toggle Â· F9 cursor)";
    title.style.cssText =
      "font-weight: bold; margin-bottom: 8px; color: #ffcc66; font-size: 12px";
    this.root.appendChild(title);

    this.root.appendChild(this.buildIgnoreToggle());
    this.root.appendChild(this.buildFreezeToggle());
    this.root.appendChild(this.buildForceAimSelect());

    this.aimContainer = document.createElement("div");
    this.restContainer = document.createElement("div");
    this.weaponContainer = document.createElement("div");

    this.root.appendChild(this.buildSectionHeader("AIM POSE", "#ffcc66"));
    this.aimPoseSelect = this.buildSelect(
      ["twoHanded", "oneHanded"],
      (v) => {
        this.currentAimPose = v as AimPoseKey;
        this.syncAimFromStore();
      },
    );
    this.aimContainer.appendChild(this.aimPoseSelect);
    for (const def of AIM_FIELDS) {
      this.aimRows.push(this.buildAimRow(def));
    }
    this.aimOutput = this.buildOutput();
    this.aimContainer.appendChild(
      this.buildCopyButton(() => this.aimOutput.textContent ?? ""),
    );
    this.aimContainer.appendChild(this.aimOutput);
    this.root.appendChild(this.aimContainer);

    this.root.appendChild(this.buildSectionHeader("REST POSE", "#66ccff"));
    this.restCharSelect = this.buildSelect(
      ["combine", "alyx", "zombie"],
      (v) => {
        this.currentRestChar = v as RestPoseTuningKey;
        this.syncRestFromStore();
      },
    );
    this.restContainer.appendChild(this.restCharSelect);
    for (const def of REST_FIELDS) {
      this.restRows.push(this.buildRestRow(def));
    }
    this.restOutput = this.buildOutput();
    this.restContainer.appendChild(
      this.buildCopyButton(() => this.restOutput.textContent ?? ""),
    );
    this.restContainer.appendChild(this.restOutput);
    this.root.appendChild(this.restContainer);

    this.root.appendChild(this.buildSectionHeader("WEAPON ATTACHMENT", "#ff99cc"));
    this.weaponSelect = this.buildSelect(
      Object.keys(WeaponAttachmentTuning),
      (v) => {
        this.currentWeapon = v as WeaponAttachmentKey;
        this.syncWeaponFromStore();
      },
    );
    this.weaponContainer.appendChild(this.weaponSelect);
    for (const def of WEAPON_FIELDS) {
      this.weaponRows.push(this.buildWeaponRow(def));
    }
    this.weaponOutput = this.buildOutput();
    this.weaponContainer.appendChild(
      this.buildCopyButton(() => this.weaponOutput.textContent ?? ""),
    );
    this.weaponContainer.appendChild(this.weaponOutput);
    this.root.appendChild(this.weaponContainer);

    document.body.appendChild(this.root);
    this.hide();

    this.syncAimFromStore();
    this.syncRestFromStore();
    this.syncWeaponFromStore();
  }

  show(): void {
    this.root.style.display = "block";
  }

  hide(): void {
    this.root.style.display = "none";
  }

  toggle(): void {
    if (this.root.style.display === "none") {
      this.show();
    } else {
      this.hide();
    }
  }

  isVisible(): boolean {
    return this.root.style.display !== "none";
  }

  private buildSectionHeader(text: string, color: string): HTMLDivElement {
    const header = document.createElement("div");
    header.textContent = text;
    header.style.cssText = `margin-top: 10px; margin-bottom: 6px; padding-bottom: 2px; border-bottom: 1px solid ${color}; color: ${color}; font-weight: bold; letter-spacing: 1px`;
    return header;
  }

  private buildSelect(
    options: string[],
    onChange: (v: string) => void,
  ): HTMLSelectElement {
    const sel = document.createElement("select");
    sel.style.cssText =
      "width: 100%; margin-bottom: 8px; background: #1a1a26; color: #e8e8ee; border: 1px solid #2a2a3a; padding: 3px";
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => onChange(sel.value), {
      signal: this.listenerAbort.signal,
    });
    return sel;
  }

  private buildOutput(): HTMLPreElement {
    const pre = document.createElement("pre");
    pre.style.cssText =
      "margin-top: 6px; padding: 6px; background: #0a0a12; border: 1px solid #2a2a3a; border-radius: 3px; font-size: 10px; white-space: pre-wrap; word-break: break-all; max-height: 160px; overflow-y: auto";
    return pre;
  }

  private buildCopyButton(getText: () => string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = "Copiar config";
    btn.style.cssText =
      "width: 100%; margin-top: 6px; background: #2a4a2a; color: #e8e8ee; border: 1px solid #3a6a3a; padding: 5px; cursor: pointer; font: inherit";
    btn.addEventListener(
      "click",
      async () => {
        try {
          await navigator.clipboard.writeText(getText());
        } catch {
          // clipboard puede fallar sin gesture
        }
      },
      { signal: this.listenerAbort.signal },
    );
    return btn;
  }

  private buildIgnoreToggle(): HTMLElement {
    return this.buildCheckboxRow(
      "IA me ignora",
      "#ff9999",
      "#2a1a1a",
      "#6a3a3a",
      () => NpcDebugFlags.ignorePlayer,
      (v) => {
        NpcDebugFlags.ignorePlayer = v;
      },
    );
  }

  private buildFreezeToggle(): HTMLElement {
    return this.buildCheckboxRow(
      "Congelar NPCs",
      "#99ccff",
      "#1a1a2a",
      "#3a3a6a",
      () => NpcDebugFlags.freezeMovement,
      (v) => {
        NpcDebugFlags.freezeMovement = v;
      },
    );
  }

  private buildCheckboxRow(
    text: string,
    textColor: string,
    bgColor: string,
    borderColor: string,
    getValue: () => boolean,
    setValue: (v: boolean) => void,
  ): HTMLElement {
    const wrap = document.createElement("label");
    wrap.style.cssText = `display: flex; align-items: center; gap: 6px; padding: 6px; margin-bottom: 4px; background: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 3px; cursor: pointer`;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = getValue();
    checkbox.style.cssText = "margin: 0";
    checkbox.addEventListener(
      "change",
      () => {
        setValue(checkbox.checked);
      },
      { signal: this.listenerAbort.signal },
    );

    const label = document.createElement("span");
    label.textContent = text;
    label.style.cssText = `color: ${textColor}; font-weight: bold`;

    wrap.appendChild(checkbox);
    wrap.appendChild(label);
    return wrap;
  }

  private buildForceAimSelect(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.style.cssText =
      "padding: 6px; margin-bottom: 8px; background: #1a2a1a; border: 1px solid #3a6a3a; border-radius: 3px";

    const label = document.createElement("div");
    label.textContent = "Forzar pose de aim:";
    label.style.cssText =
      "color: #99ffaa; font-weight: bold; margin-bottom: 4px";
    wrap.appendChild(label);

    const select = document.createElement("select");
    select.style.cssText =
      "width: 100%; background: #1a1a26; color: #e8e8ee; border: 1px solid #2a2a3a; padding: 3px";
    for (const opt of ["none", "twoHanded", "oneHanded"] as ForcedAimPose[]) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    }
    select.value = NpcDebugFlags.forceAimPose;
    select.addEventListener(
      "change",
      () => {
        NpcDebugFlags.forceAimPose = select.value as ForcedAimPose;
      },
      { signal: this.listenerAbort.signal },
    );
    wrap.appendChild(select);

    return wrap;
  }

  private buildAimRow(def: FieldDef<AimFieldKey>): SliderRow<AimFieldKey> {
    return this.buildRow(def, this.aimContainer, (v) => {
      AimTuning[this.currentAimPose][def.key] = v;
      this.refreshAimOutput();
    });
  }

  private buildRestRow(def: FieldDef<RestFieldKey>): SliderRow<RestFieldKey> {
    return this.buildRow(def, this.restContainer, (v) => {
      RestPoseTuning[this.currentRestChar][def.key] = v;
      this.refreshRestOutput();
    });
  }

  private buildWeaponRow(def: FieldDef<WeaponFieldKey>): SliderRow<WeaponFieldKey> {
    return this.buildRow(def, this.weaponContainer, (v) => {
      WeaponAttachmentTuning[this.currentWeapon][def.key] = v;
      applyAttachmentTuning();
      this.refreshWeaponOutput();
    });
  }

  private buildRow<TField extends string>(
    def: FieldDef<TField>,
    container: HTMLElement,
    onChange: (v: number) => void,
  ): SliderRow<TField> {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom: 4px";

    const header = document.createElement("div");
    header.style.cssText = "display: flex; justify-content: space-between";
    const label = document.createElement("span");
    label.textContent = def.label;
    const valueLabel = document.createElement("span");
    valueLabel.style.cssText = "color: #99ccff";
    header.appendChild(label);
    header.appendChild(valueLabel);
    row.appendChild(header);

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = "0.01";
    input.style.cssText = "width: 100%; margin: 0";
    input.addEventListener(
      "input",
      () => {
        const v = parseFloat(input.value);
        valueLabel.textContent = v.toFixed(2);
        onChange(v);
      },
      { signal: this.listenerAbort.signal },
    );
    row.appendChild(input);
    container.appendChild(row);

    return { field: def.key, input, valueLabel };
  }

  private syncAimFromStore(): void {
    this.aimPoseSelect.value = this.currentAimPose;
    const pose = AimTuning[this.currentAimPose];
    for (const row of this.aimRows) {
      const v = pose[row.field];
      row.input.value = String(v);
      row.valueLabel.textContent = v.toFixed(2);
    }
    this.refreshAimOutput();
  }

  private syncRestFromStore(): void {
    this.restCharSelect.value = this.currentRestChar;
    const pose = RestPoseTuning[this.currentRestChar];
    for (const row of this.restRows) {
      const v = pose[row.field];
      row.input.value = String(v);
      row.valueLabel.textContent = v.toFixed(2);
    }
    this.refreshRestOutput();
  }

  private syncWeaponFromStore(): void {
    this.weaponSelect.value = this.currentWeapon;
    const pose = WeaponAttachmentTuning[this.currentWeapon];
    for (const row of this.weaponRows) {
      const v = pose[row.field];
      row.input.value = String(v);
      row.valueLabel.textContent = v.toFixed(2);
    }
    this.refreshWeaponOutput();
  }

  private refreshAimOutput(): void {
    const pose = AimTuning[this.currentAimPose];
    const lines = [`${this.currentAimPose}: {`];
    for (const def of AIM_FIELDS) {
      lines.push(`  ${def.key}: ${pose[def.key].toFixed(2)},`);
    }
    lines.push("}");
    this.aimOutput.textContent = lines.join("\n");
  }

  private refreshRestOutput(): void {
    const pose = RestPoseTuning[this.currentRestChar];
    const lines = [`${this.currentRestChar}: {`];
    for (const def of REST_FIELDS) {
      lines.push(`  ${def.key}: ${pose[def.key].toFixed(2)},`);
    }
    lines.push("}");
    this.restOutput.textContent = lines.join("\n");
  }

  private refreshWeaponOutput(): void {
    const pose = WeaponAttachmentTuning[this.currentWeapon];
    const lines = [`${this.currentWeapon}: {`];
    for (const def of WEAPON_FIELDS) {
      lines.push(`  ${def.key}: ${pose[def.key].toFixed(2)},`);
    }
    lines.push("}");
    this.weaponOutput.textContent = lines.join("\n");
  }

  dispose(): void {
    this.listenerAbort.abort();
    this.root.remove();
  }
}
