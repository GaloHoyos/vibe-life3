/**
 * Pequenios builders DOM compartidos por los modulos del DebugMenu.
 * Mantenidos minimos y sin estado: cada modulo trae su propia logica.
 */

export interface SliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
}

export interface SliderRow {
  key: string;
  input: HTMLInputElement;
  valueLabel: HTMLSpanElement;
  rowElement: HTMLDivElement;
}

export function buildSection(title: string, color = "#ffcc66"): HTMLDivElement {
  const section = document.createElement("div");
  section.className = "debug-section";

  const header = document.createElement("div");
  header.className = "debug-section__header";
  header.style.borderBottomColor = color;
  header.style.color = color;
  header.textContent = title;
  section.appendChild(header);

  return section;
}

export function buildSelect(
  options: readonly string[],
  onChange: (v: string) => void,
  signal?: AbortSignal,
): HTMLSelectElement {
  const sel = document.createElement("select");
  sel.className = "debug-select";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    sel.appendChild(o);
  }
  sel.addEventListener(
    "change",
    () => onChange(sel.value),
    signal ? { signal } : undefined,
  );
  return sel;
}

export function buildSliderRow(
  def: SliderDef,
  container: HTMLElement,
  onChange: (v: number) => void,
  signal: AbortSignal,
): SliderRow {
  const row = document.createElement("div");
  row.className = "debug-slider";

  const header = document.createElement("div");
  header.className = "debug-slider__header";
  const label = document.createElement("span");
  label.textContent = def.label;
  const valueLabel = document.createElement("span");
  valueLabel.className = "debug-slider__value";
  header.appendChild(label);
  header.appendChild(valueLabel);
  row.appendChild(header);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = String(def.step ?? 0.01);
  input.className = "debug-slider__input";
  input.addEventListener(
    "input",
    () => {
      const v = parseFloat(input.value);
      valueLabel.textContent = v.toFixed(def.step && def.step < 0.01 ? 3 : 2);
      onChange(v);
    },
    { signal },
  );
  row.appendChild(input);

  container.appendChild(row);
  return { key: def.key, input, valueLabel, rowElement: row };
}

export function buildCheckbox(
  label: string,
  getValue: () => boolean,
  setValue: (v: boolean) => void,
  signal: AbortSignal,
): HTMLLabelElement {
  const wrap = document.createElement("label");
  wrap.className = "debug-checkbox";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = getValue();
  checkbox.addEventListener(
    "change",
    () => setValue(checkbox.checked),
    { signal },
  );
  wrap.appendChild(checkbox);

  const span = document.createElement("span");
  span.textContent = label;
  wrap.appendChild(span);

  return wrap;
}

export function buildButton(
  label: string,
  onClick: () => void,
  signal?: AbortSignal,
  variant: "primary" | "danger" = "primary",
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `debug-button debug-button--${variant}`;
  btn.textContent = label;
  btn.addEventListener(
    "click",
    onClick,
    signal ? { signal } : undefined,
  );
  return btn;
}

export function buildOutput(): HTMLPreElement {
  const pre = document.createElement("pre");
  pre.className = "debug-output";
  return pre;
}

export function copyToClipboard(text: string): void {
  try {
    void navigator.clipboard.writeText(text);
  } catch {
    // clipboard puede fallar sin gesture; ignorar.
  }
}
