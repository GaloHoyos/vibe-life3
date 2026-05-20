import { WeaponDefinitions } from "@game/config/weapons.config";
import type { WeaponId } from "@game/gameplay/weapons/core/WeaponDefinition";
import { GrenadeRenderTuning } from "@game/gameplay/weapons/grenade/GrenadeRenderTuning";

type TunerField =
  | "pickupScale"
  | "viewModelScale"
  | "offsetX"
  | "offsetY"
  | "offsetZ"
  | "rotationX"
  | "rotationY"
  | "rotationZ";

type TargetKind = WeaponId | "grenadePrimed";

interface FieldDef {
  key: TunerField;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Cuando est seleccionado `grenadePrimed`, slo `pickupScale` se muestra. */
  thrownLabel?: string;
}

interface SliderRow {
  key: TunerField;
  input: HTMLInputElement;
  valueLabel: HTMLSpanElement;
  rowElement: HTMLDivElement;
}

const FIELDS: FieldDef[] = [
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
 * Panel de tuning para los assets visuales de armas:
 *
 * - Por cada `WeaponId`: pickup scale + viewmodel (offset xyz, rotation
 *   xyz, scale). Mutan en vivo el `WeaponDefinition` correspondiente.
 * - Para `grenadePrimed` (modelo de la granada lanzada): un nico slider
 *   "Thrown Scale" que mute `GrenadeRenderTuning.thrownScale`. El
 *   `GrenadeSystem` re-aplica scale por frame al mesh.
 *
 * Los consumers (WeaponPickup, WeaponViewModel, GrenadeSystem) releen
 * cada frame, as que no hace falta evento. Botn "Copiar config" exporta
 * los valores actuales del target seleccionado.
 */
export class WeaponTunerPanel {
  readonly element: HTMLDivElement;

  private readonly targetSelect: HTMLSelectElement;
  private readonly rows: SliderRow[] = [];
  private readonly output: HTMLPreElement;
  private readonly labelByRow = new Map<TunerField, HTMLSpanElement>();
  private readonly listenerAbort = new AbortController();
  private currentTarget: TargetKind;

  constructor() {
    this.currentTarget = (Object.keys(WeaponDefinitions)[0] ?? "pistol") as WeaponId;

    this.element = document.createElement("div");
    this.element.className = "weapon-tuner is-hidden";

    const title = document.createElement("div");
    title.className = "weapon-tuner__title";
    title.textContent = "Weapon Tuner (F3)";
    this.element.appendChild(title);

    this.targetSelect = document.createElement("select");
    this.targetSelect.className = "weapon-tuner__select";
    for (const id of Object.keys(WeaponDefinitions)) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      this.targetSelect.appendChild(opt);
    }
    {
      const opt = document.createElement("option");
      opt.value = "grenadePrimed";
      opt.textContent = "grenadePrimed (thrown)";
      this.targetSelect.appendChild(opt);
    }
    this.targetSelect.value = this.currentTarget;
    this.targetSelect.addEventListener(
      "change",
      () => {
        this.currentTarget = this.targetSelect.value as TargetKind;
        this.syncFromTarget();
      },
      { signal: this.listenerAbort.signal },
    );
    this.element.appendChild(this.targetSelect);

    const rowContainer = document.createElement("div");
    rowContainer.className = "weapon-tuner__rows";
    for (const def of FIELDS) {
      const row = this.buildRow(def, rowContainer);
      this.rows.push(row);
      const label = row.rowElement.querySelector(
        ".weapon-tuner__rowLabel",
      ) as HTMLSpanElement | null;
      if (label) {
        this.labelByRow.set(def.key, label);
      }
    }
    this.element.appendChild(rowContainer);

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "weapon-tuner__copy";
    copyBtn.textContent = "Copiar config";
    copyBtn.addEventListener(
      "click",
      async () => {
        try {
          await navigator.clipboard.writeText(this.output.textContent ?? "");
        } catch {
          // clipboard requiere gesture en algunos navegadores; ignorar
        }
      },
      { signal: this.listenerAbort.signal },
    );
    this.element.appendChild(copyBtn);

    this.output = document.createElement("pre");
    this.output.className = "weapon-tuner__output";
    this.element.appendChild(this.output);

    this.syncFromTarget();
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle("is-hidden", !visible);
  }

  dispose(): void {
    this.listenerAbort.abort();
    this.element.remove();
  }

  private buildRow(def: FieldDef, container: HTMLElement): SliderRow {
    const row = document.createElement("div");
    row.className = "weapon-tuner__row";

    const header = document.createElement("div");
    header.className = "weapon-tuner__rowHeader";
    const label = document.createElement("span");
    label.className = "weapon-tuner__rowLabel";
    label.textContent = def.label;
    const valueLabel = document.createElement("span");
    valueLabel.className = "weapon-tuner__value";
    header.appendChild(label);
    header.appendChild(valueLabel);
    row.appendChild(header);

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(def.min);
    input.max = String(def.max);
    input.step = String(def.step);
    input.className = "weapon-tuner__slider";
    input.addEventListener(
      "input",
      () => {
        const v = parseFloat(input.value);
        valueLabel.textContent = v.toFixed(3);
        this.applyChange(def.key, v);
        this.refreshOutput();
      },
      { signal: this.listenerAbort.signal },
    );
    row.appendChild(input);

    container.appendChild(row);
    return { key: def.key, input, valueLabel, rowElement: row };
  }

  private applyChange(key: TunerField, value: number): void {
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
    const isThrown = this.currentTarget === "grenadePrimed";

    for (const row of this.rows) {
      const def = FIELDS.find((f) => f.key === row.key);
      if (!def) continue;
      const showInThrown = row.key === "pickupScale";
      row.rowElement.classList.toggle("is-hidden", isThrown && !showInThrown);

      const label = this.labelByRow.get(row.key);
      if (label) {
        label.textContent =
          isThrown && def.thrownLabel ? def.thrownLabel : def.label;
      }

      const v = this.readField(row.key);
      row.input.value = String(v);
      row.valueLabel.textContent = v.toFixed(3);
    }
    this.refreshOutput();
  }

  private readField(key: TunerField): number {
    if (this.currentTarget === "grenadePrimed") {
      if (key === "pickupScale") {
        return GrenadeRenderTuning.thrownScale;
      }
      return 0;
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
    if (this.currentTarget === "grenadePrimed") {
      this.output.textContent = [
        `GrenadeRenderTuning: {`,
        `  thrownScale: ${GrenadeRenderTuning.thrownScale.toFixed(3)},`,
        `}`,
      ].join("\n");
      return;
    }
    const d = WeaponDefinitions[this.currentTarget];
    const lines = [
      `${this.currentTarget}: {`,
      `  pickupScale: ${d.pickupScale.toFixed(3)},`,
      `  viewModelScale: ${d.viewModelScale.toFixed(3)},`,
      `  viewModelOffset: new Vector3(${d.viewModelOffset.x.toFixed(3)}, ${d.viewModelOffset.y.toFixed(3)}, ${d.viewModelOffset.z.toFixed(3)}),`,
      `  viewModelRotation: new Euler(${d.viewModelRotation.x.toFixed(3)}, ${d.viewModelRotation.y.toFixed(3)}, ${d.viewModelRotation.z.toFixed(3)}),`,
      `}`,
    ];
    this.output.textContent = lines.join("\n");
  }
}
