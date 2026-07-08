import { AmmoDefinitions, type AmmoId } from "@game/config/ammo.config";
import { WeaponDefinitions } from "@game/config/weapons.config";
import type { WeaponId } from "@game/gameplay/weapons/core/WeaponDefinition";
import { GrenadeRenderTuning } from "@game/gameplay/weapons/grenade/GrenadeRenderTuning";
import type { DebugModule } from "../DebugModule";
import {
  buildButton,
  buildOutput,
  buildSection,
  buildSelect,
  buildSliderRow,
  copyToClipboard,
  type SliderDef,
  type SliderRow,
} from "../widgets";

type TunerField =
  | "pickupScale"
  | "viewModelScale"
  | "offsetX"
  | "offsetY"
  | "offsetZ"
  | "rotationX"
  | "rotationY"
  | "rotationZ";

type AmmoTarget = `ammo:${AmmoId}`;
type TargetKind = WeaponId | "grenadePrimed" | AmmoTarget;

const AmmoTargetPrefix = "ammo:";

const FIELDS: Array<SliderDef & { thrownLabel?: string }> = [
  {
    key: "pickupScale",
    label: "Pickup Scale (world)",
    min: 0.05,
    max: 1.5,
    step: 0.005,
    thrownLabel: "Thrown Scale",
  },
  { key: "viewModelScale", label: "ViewModel Scale", min: 0.05, max: 0.8, step: 0.005 },
  { key: "offsetX", label: "VM Offset X", min: -0.6, max: 0.6, step: 0.005 },
  { key: "offsetY", label: "VM Offset Y", min: -0.6, max: 0.6, step: 0.005 },
  { key: "offsetZ", label: "VM Offset Z", min: -0.9, max: 0.4, step: 0.005 },
  { key: "rotationX", label: "VM Rotation X", min: -Math.PI, max: Math.PI, step: 0.01 },
  { key: "rotationY", label: "VM Rotation Y", min: -Math.PI, max: Math.PI, step: 0.01 },
  { key: "rotationZ", label: "VM Rotation Z", min: -Math.PI, max: Math.PI, step: 0.01 },
];

/**
 * Sliders por arma (pickup scale + viewmodel offset/rotation/scale). Muta
 * directamente `WeaponDefinitions[id]` y `GrenadeRenderTuning`; los
 * consumers (WeaponPickup, WeaponViewModel, GrenadeSystem) releen por
 * frame asi que no hay evento involucrado.
 */
export class WeaponsModule implements DebugModule {
  readonly id = "weapons";
  readonly label = "Armas";
  private active = false;
  private readonly listenerAbort = new AbortController();
  private readonly rows: SliderRow[] = [];
  private readonly labelByRow = new Map<TunerField, HTMLSpanElement>();
  private currentTarget: TargetKind = "pistol";
  private targetSelect: HTMLSelectElement | null = null;
  private output: HTMLPreElement | null = null;

  mount(container: HTMLElement): void {
    this.currentTarget = (Object.keys(WeaponDefinitions)[0] ?? "pistol") as WeaponId;

    const section = buildSection("Weapon tuner", "#ffcc66");

    const weaponTargets = Object.keys(WeaponDefinitions) as WeaponId[];
    const ammoTargets = (Object.keys(AmmoDefinitions) as AmmoId[]).map(
      (id) => `${AmmoTargetPrefix}${id}` as AmmoTarget,
    );
    const targets: TargetKind[] = [...weaponTargets, ...ammoTargets, "grenadePrimed"];
    this.targetSelect = buildSelect(
      targets,
      (v) => {
        this.currentTarget = v as TargetKind;
        this.syncFromTarget();
      },
      this.listenerAbort.signal,
    );
    this.targetSelect.value = this.currentTarget;
    section.appendChild(this.targetSelect);

    const rowContainer = document.createElement("div");
    rowContainer.className = "debug-slider-list";
    for (const def of FIELDS) {
      const row = buildSliderRow(
        def,
        rowContainer,
        (v) => {
          this.applyChange(row.key as TunerField, v);
          this.refreshOutput();
        },
        this.listenerAbort.signal,
      );
      this.rows.push(row);
      const labelEl = row.rowElement.querySelector("span");
      if (labelEl) {
        this.labelByRow.set(def.key as TunerField, labelEl);
      }
    }
    section.appendChild(rowContainer);

    section.appendChild(
      buildButton(
        "Copiar config",
        () => copyToClipboard(this.output?.textContent ?? ""),
        this.listenerAbort.signal,
      ),
    );

    this.output = buildOutput();
    section.appendChild(this.output);

    container.appendChild(section);
    this.syncFromTarget();
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.listenerAbort.abort();
    this.rows.length = 0;
    this.labelByRow.clear();
    this.output = null;
    this.targetSelect = null;
  }

  private applyChange(key: TunerField, value: number): void {
    if (isAmmoTarget(this.currentTarget)) {
      if (key === "pickupScale") {
        AmmoDefinitions[getAmmoIdFromTarget(this.currentTarget)].pickupScale = value;
      }
      return;
    }

    if (this.currentTarget === "grenadePrimed") {
      if (key === "pickupScale") {
        GrenadeRenderTuning.thrownScale = value;
      }
      return;
    }
    const definition = WeaponDefinitions[this.currentTarget];
    switch (key) {
      case "pickupScale":
        definition.pickupScale = value;
        return;
      case "viewModelScale":
        definition.viewModelScale = value;
        return;
      case "offsetX":
        definition.viewModelOffset.x = value;
        return;
      case "offsetY":
        definition.viewModelOffset.y = value;
        return;
      case "offsetZ":
        definition.viewModelOffset.z = value;
        return;
      case "rotationX":
        definition.viewModelRotation.x = value;
        return;
      case "rotationY":
        definition.viewModelRotation.y = value;
        return;
      case "rotationZ":
        definition.viewModelRotation.z = value;
        return;
    }
  }

  private syncFromTarget(): void {
    if (this.targetSelect) {
      this.targetSelect.value = this.currentTarget;
    }
    const isThrown = this.currentTarget === "grenadePrimed";
    const isAmmo = isAmmoTarget(this.currentTarget);
    const isScaleOnly = isThrown || isAmmo;

    for (const row of this.rows) {
      const def = FIELDS.find((f) => f.key === row.key);
      if (!def) continue;
      const showInScaleOnlyTarget = row.key === "pickupScale";
      row.rowElement.classList.toggle("is-hidden", isScaleOnly && !showInScaleOnlyTarget);

      const label = this.labelByRow.get(row.key as TunerField);
      if (label) {
        label.textContent = isAmmo
          ? "Ammo Pickup Scale"
          : isThrown && def.thrownLabel
            ? def.thrownLabel
            : def.label;
      }

      const v = this.readField(row.key as TunerField);
      row.input.value = String(v);
      row.valueLabel.textContent = v.toFixed(3);
    }
    this.refreshOutput();
  }

  private readField(key: TunerField): number {
    if (isAmmoTarget(this.currentTarget)) {
      return key === "pickupScale"
        ? AmmoDefinitions[getAmmoIdFromTarget(this.currentTarget)].pickupScale
        : 0;
    }

    if (this.currentTarget === "grenadePrimed") {
      return key === "pickupScale" ? GrenadeRenderTuning.thrownScale : 0;
    }
    const definition = WeaponDefinitions[this.currentTarget];
    switch (key) {
      case "pickupScale":
        return definition.pickupScale;
      case "viewModelScale":
        return definition.viewModelScale;
      case "offsetX":
        return definition.viewModelOffset.x;
      case "offsetY":
        return definition.viewModelOffset.y;
      case "offsetZ":
        return definition.viewModelOffset.z;
      case "rotationX":
        return definition.viewModelRotation.x;
      case "rotationY":
        return definition.viewModelRotation.y;
      case "rotationZ":
        return definition.viewModelRotation.z;
    }
  }

  private refreshOutput(): void {
    if (!this.output) return;
    if (isAmmoTarget(this.currentTarget)) {
      const ammoId = getAmmoIdFromTarget(this.currentTarget);
      const d = AmmoDefinitions[ammoId];
      this.output.textContent = [
        `${this.currentTarget}: {`,
        `  pickupScale: ${d.pickupScale.toFixed(3)},`,
        `}`,
      ].join("\n");
      return;
    }

    if (this.currentTarget === "grenadePrimed") {
      this.output.textContent = [
        `GrenadeRenderTuning: {`,
        `  thrownScale: ${GrenadeRenderTuning.thrownScale.toFixed(3)},`,
        `}`,
      ].join("\n");
      return;
    }
    const d = WeaponDefinitions[this.currentTarget];
    this.output.textContent = [
      `${this.currentTarget}: {`,
      `  pickupScale: ${d.pickupScale.toFixed(3)},`,
      `  viewModelScale: ${d.viewModelScale.toFixed(3)},`,
      `  viewModelOffset: new Vector3(${d.viewModelOffset.x.toFixed(3)}, ${d.viewModelOffset.y.toFixed(3)}, ${d.viewModelOffset.z.toFixed(3)}),`,
      `  viewModelRotation: new Euler(${d.viewModelRotation.x.toFixed(3)}, ${d.viewModelRotation.y.toFixed(3)}, ${d.viewModelRotation.z.toFixed(3)}),`,
      `}`,
    ].join("\n");
  }
}

function isAmmoTarget(target: TargetKind): target is AmmoTarget {
  return target.startsWith(AmmoTargetPrefix);
}

function getAmmoIdFromTarget(target: AmmoTarget): AmmoId {
  return target.slice(AmmoTargetPrefix.length) as AmmoId;
}
