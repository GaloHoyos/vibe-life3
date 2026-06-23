import type { VectorTuple } from '@shared/math/VectorTuple';

/** Control de formulario con su elemento y un setter para refresco externo. */
export interface Field<T> {
  element: HTMLElement;
  set(value: T): void;
}

function row(label: string, control: HTMLElement): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'editor-field';
  const labelEl = document.createElement('label');
  labelEl.className = 'editor-field__label';
  labelEl.textContent = label;
  element.append(labelEl, control);
  return element;
}

/** Variante con el label arriba del control (para textareas anchas). */
function stackRow(label: string, control: HTMLElement): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'editor-field editor-field--stack';
  if (label) {
    const labelEl = document.createElement('label');
    labelEl.className = 'editor-field__label';
    labelEl.textContent = label;
    element.append(labelEl);
  }
  element.append(control);
  return element;
}

/** Parte una lista coma-separada en items no vacios y trimmeados. */
export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function fmt(value: number): string {
  return String(Number(value.toFixed(3)));
}

function readNumber(input: HTMLInputElement): number {
  const v = Number.parseFloat(input.value);
  return Number.isNaN(v) ? 0 : v;
}

/** Pixeles de arrastre horizontal por cada `step` de incremento al scrubbear. */
const SCRUB_PX_PER_STEP = 8;

/**
 * Hace "scrubbable" un input numerico: arrastrarlo horizontalmente cambia el
 * valor en pasos de `step` (estilo Blender/dat.GUI). Un click sin arrastre deja
 * el foco para tipear normal. `emit` propaga el cambio en vivo.
 */
function makeScrubbable(input: HTMLInputElement, step: number, emit: () => void): void {
  input.classList.add('editor-input--scrub');
  let armed = false;
  let scrubbing = false;
  let startX = 0;
  let startValue = 0;

  const onMove = (event: PointerEvent): void => {
    if (!armed) return;
    const dx = event.clientX - startX;
    if (!scrubbing) {
      if (Math.abs(dx) < 4) return;
      scrubbing = true;
      input.blur();
      input.setPointerCapture(event.pointerId);
      document.body.classList.add('editor-scrubbing');
    }
    input.value = fmt(startValue + Math.round(dx / SCRUB_PX_PER_STEP) * step);
    emit();
  };

  const onUp = (event: PointerEvent): void => {
    armed = false;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (!scrubbing) return;
    scrubbing = false;
    document.body.classList.remove('editor-scrubbing');
    if (input.hasPointerCapture(event.pointerId)) input.releasePointerCapture(event.pointerId);
    // Traga el click sintetico que sigue al arrastre para no enfocar el input.
    const swallow = (click: MouseEvent): void => {
      click.preventDefault();
      click.stopPropagation();
      window.removeEventListener('click', swallow, true);
    };
    window.addEventListener('click', swallow, true);
  };

  input.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || document.activeElement === input) return;
    armed = true;
    scrubbing = false;
    startX = event.clientX;
    startValue = readNumber(input);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

export function numberField(
  label: string,
  value: number,
  onChange: (value: number) => void,
  step = 0.1,
): Field<number> {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = String(step);
  input.className = 'editor-input';
  input.value = fmt(value);
  const emit = (): void => onChange(readNumber(input));
  input.addEventListener('change', emit);
  makeScrubbable(input, step, emit);
  return { element: row(label, input), set: (v) => (input.value = fmt(v)) };
}

export function textField(
  label: string,
  value: string,
  onChange: (value: string) => void,
): Field<string> {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'editor-input';
  input.value = value;
  input.addEventListener('change', () => onChange(input.value.trim()));
  return { element: row(label, input), set: (v) => (input.value = v) };
}

export function textareaField(
  label: string,
  value: string,
  onChange: (value: string) => void,
  rows = 3,
): Field<string> {
  const textarea = document.createElement('textarea');
  textarea.className = 'editor-input editor-textarea';
  textarea.rows = rows;
  textarea.value = value;
  textarea.style.fontFamily = 'inherit';
  textarea.addEventListener('input', () => onChange(textarea.value));
  return { element: stackRow(label, textarea), set: (v) => (textarea.value = v) };
}

export function selectField(
  label: string,
  value: string,
  options: readonly string[],
  onChange: (value: string) => void,
): Field<string> {
  const select = document.createElement('select');
  select.className = 'editor-input';
  for (const option of options) {
    const opt = document.createElement('option');
    opt.value = option;
    opt.textContent = option;
    if (option === value) opt.selected = true;
    select.append(opt);
  }
  select.addEventListener('change', () => onChange(select.value));
  return { element: row(label, select), set: (v) => (select.value = v) };
}

export function checkboxField(
  label: string,
  value: boolean,
  onChange: (value: boolean) => void,
): Field<boolean> {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'editor-checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return { element: row(label, input), set: (v) => (input.checked = v) };
}

export function vec3Field(
  label: string,
  value: VectorTuple,
  onChange: (value: VectorTuple) => void,
  step = 0.1,
): Field<VectorTuple> {
  const wrap = document.createElement('div');
  wrap.className = 'editor-vec3';
  const inputs = [0, 1, 2].map((i) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.className = 'editor-input editor-input--vec';
    input.value = fmt(value[i]);
    return input;
  });
  const emit = (): void =>
    onChange([readNumber(inputs[0]), readNumber(inputs[1]), readNumber(inputs[2])]);
  inputs.forEach((input) => {
    input.addEventListener('change', emit);
    makeScrubbable(input, step, emit);
  });
  wrap.append(...inputs);
  return {
    element: row(label, wrap),
    set: (v) => inputs.forEach((input, i) => (input.value = fmt(v[i]))),
  };
}

export function vec2Field(
  label: string,
  value: [number, number],
  onChange: (value: [number, number]) => void,
  step = 0.1,
): Field<[number, number]> {
  const wrap = document.createElement('div');
  wrap.className = 'editor-vec3';
  const inputs = [0, 1].map((i) => {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.className = 'editor-input editor-input--vec';
    input.value = fmt(value[i]);
    return input;
  });
  const emit = (): void => onChange([readNumber(inputs[0]), readNumber(inputs[1])]);
  inputs.forEach((input) => {
    input.addEventListener('change', emit);
    makeScrubbable(input, step, emit);
  });
  wrap.append(...inputs);
  return {
    element: row(label, wrap),
    set: (v) => inputs.forEach((input, i) => (input.value = fmt(v[i]))),
  };
}

export function colorField(
  label: string,
  value: number,
  onChange: (value: number) => void,
): Field<number> {
  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'editor-input editor-input--color';
  input.value = toHex(value);
  input.addEventListener('change', () => onChange(Number.parseInt(input.value.slice(1), 16)));
  return { element: row(label, input), set: (v) => (input.value = toHex(v)) };
}

export function jsonField(
  label: string,
  value: unknown,
  onChange: (parsed: unknown) => void,
): Field<unknown> {
  const textarea = document.createElement('textarea');
  textarea.className = 'editor-input editor-textarea';
  textarea.rows = 10;
  textarea.spellcheck = false;
  textarea.value = JSON.stringify(value, null, 2);
  textarea.addEventListener('change', () => {
    try {
      onChange(JSON.parse(textarea.value));
      textarea.classList.remove('is-error');
    } catch {
      textarea.classList.add('is-error');
    }
  });
  return {
    element: row(label, textarea),
    set: (v) => (textarea.value = JSON.stringify(v, null, 2)),
  };
}

function toHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}
