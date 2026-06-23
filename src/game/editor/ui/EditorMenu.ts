import type { Disposable } from '@shared/types/lifecycle';
import { iconSpan, type EditorIconName } from './editorIcons';

/**
 * Item de un menu desplegable. `separator` ignora el resto de los campos.
 * `submenu` abre un fly-out al costado; `checked` muestra un tilde (toggles).
 */
export interface MenuItem {
  label?: string;
  icon?: EditorIconName;
  accel?: string;
  onClick?: () => void;
  submenu?: MenuItem[];
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
}

/**
 * Boton de la barra de menus con su dropdown. `getItems` se evalua en cada
 * apertura para soportar menus dinamicos (p. ej. la lista de la biblioteca).
 * La coordinacion entre menus hermanos (cerrar al abrir otro, cambiar al pasar
 * el mouse) la maneja `EditorMenuBar` via `isOpen`/`openMenu`/`close`.
 */
export class MenuButton implements Disposable {
  readonly element = document.createElement('div');
  private readonly button = document.createElement('button');
  private dropdown: HTMLElement | null = null;
  private opened = false;

  constructor(
    label: string,
    private readonly getItems: () => MenuItem[],
    private readonly hooks: { onOpen?: () => void } = {},
  ) {
    this.element.className = 'editor-menu';
    this.button.type = 'button';
    this.button.className = 'editor-menu__button';
    this.button.textContent = label;
    this.button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggle();
    });
    this.element.append(this.button);
  }

  isOpen(): boolean {
    return this.opened;
  }

  toggle(): void {
    if (this.opened) this.close();
    else this.openMenu();
  }

  openMenu(): void {
    if (this.opened) return;
    this.hooks.onOpen?.();
    this.opened = true;
    this.element.classList.add('is-open');
    this.dropdown = buildDropdown(this.getItems(), () => this.close());
    this.element.append(this.dropdown);
    document.addEventListener('pointerdown', this.onDocPointer, true);
    window.addEventListener('keydown', this.onEscape, true);
    this.dropdown.focus();
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.element.classList.remove('is-open');
    this.dropdown?.remove();
    this.dropdown = null;
    document.removeEventListener('pointerdown', this.onDocPointer, true);
    window.removeEventListener('keydown', this.onEscape, true);
  }

  dispose(): void {
    this.close();
  }

  private readonly onDocPointer = (event: PointerEvent): void => {
    if (!this.element.contains(event.target as Node)) this.close();
  };

  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close();
      this.button.focus();
    }
  };
}

/** Construye un nivel de dropdown (recursivo para submenus). */
function buildDropdown(items: MenuItem[], closeAll: () => void): HTMLElement {
  const dd = document.createElement('div');
  dd.className = 'editor-dropdown';
  dd.tabIndex = -1;

  let openSub: { panel: HTMLElement; trigger: HTMLElement } | null = null;
  const closeSub = (): void => {
    if (!openSub) return;
    openSub.panel.remove();
    openSub.trigger.classList.remove('is-active');
    openSub = null;
  };
  const openSubFor = (item: MenuItem, trigger: HTMLElement, wrap: HTMLElement): void => {
    if (openSub?.trigger === trigger) return;
    closeSub();
    const panel = buildDropdown(item.submenu ?? [], closeAll);
    trigger.classList.add('is-active');
    wrap.append(panel);
    openSub = { panel, trigger };
  };

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'editor-dropdown__sep';
      dd.append(sep);
      continue;
    }

    const trigger = makeItem(item);

    if (item.submenu) {
      const wrap = document.createElement('div');
      wrap.className = 'editor-dropdown__sub';
      wrap.append(trigger);
      dd.append(wrap);
      if (!item.disabled) {
        wrap.addEventListener('mouseenter', () => openSubFor(item, trigger, wrap));
        trigger.addEventListener('click', (event) => {
          event.stopPropagation();
          if (openSub?.trigger === trigger) closeSub();
          else openSubFor(item, trigger, wrap);
        });
      }
    } else {
      dd.append(trigger);
      trigger.addEventListener('mouseenter', closeSub);
      if (!item.disabled && item.onClick) {
        trigger.addEventListener('click', (event) => {
          event.stopPropagation();
          item.onClick?.();
          closeAll();
        });
      }
    }
  }

  dd.addEventListener('keydown', (event) => {
    const focusables = [
      ...dd.querySelectorAll<HTMLButtonElement>(
        ':scope > .editor-dropdown__item, :scope > .editor-dropdown__sub > .editor-dropdown__item',
      ),
    ].filter((el) => !el.disabled);
    if (focusables.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active instanceof HTMLButtonElement ? focusables.indexOf(active) : -1;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      focusables[(index + 1 + focusables.length) % focusables.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      focusables[(index - 1 + focusables.length) % focusables.length]?.focus();
    } else if (event.key === 'ArrowRight') {
      const wrap = active?.parentElement;
      if (
        active instanceof HTMLButtonElement &&
        wrap?.classList.contains('editor-dropdown__sub') &&
        wrap.parentElement === dd
      ) {
        event.preventDefault();
        event.stopPropagation();
        active.click();
        wrap.querySelector<HTMLElement>('.editor-dropdown')?.focus();
      }
    } else if (event.key === 'ArrowLeft') {
      if (openSub && active && openSub.panel.contains(active)) {
        event.preventDefault();
        event.stopPropagation();
        const { trigger } = openSub;
        closeSub();
        trigger.focus();
      }
    }
  });

  return dd;
}

function makeItem(item: MenuItem): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'editor-dropdown__item';
  if (item.danger) button.classList.add('editor-dropdown__item--danger');
  if (item.disabled) {
    button.classList.add('is-disabled');
    button.disabled = true;
  }

  if (item.checked !== undefined) {
    const check = document.createElement('span');
    check.className = 'editor-dropdown__check';
    check.textContent = item.checked ? '✓' : '';
    button.append(check);
  } else if (item.icon) {
    button.append(iconSpan(item.icon));
  }

  const label = document.createElement('span');
  label.className = 'editor-dropdown__label';
  label.textContent = item.label ?? '';
  button.append(label);

  if (item.submenu) {
    const arrow = document.createElement('span');
    arrow.className = 'editor-dropdown__arrow';
    arrow.textContent = '▸';
    button.append(arrow);
  } else if (item.accel) {
    const accel = document.createElement('span');
    accel.className = 'editor-dropdown__accel';
    accel.textContent = item.accel;
    button.append(accel);
  }
  return button;
}
