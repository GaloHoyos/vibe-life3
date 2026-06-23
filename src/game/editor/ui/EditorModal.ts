import { iconSpan, type EditorIconName } from './editorIcons';

export interface ModalAction {
  label: string;
  variant?: 'primary' | 'danger' | 'ghost';
  icon?: EditorIconName;
  /**
   * Handler de la accion. Si lanza (o rechaza), el modal queda abierto para que
   * el caller muestre el error inline; si resuelve, el modal se cierra (salvo
   * `keepOpen`).
   */
  onClick: () => void | Promise<void>;
  keepOpen?: boolean;
}

export interface ModalOptions {
  title: string;
  subtitle?: string;
  icon?: EditorIconName;
  body: HTMLElement;
  actions: ModalAction[];
  /** Contenedor donde montar (default `document.body`). */
  host?: HTMLElement;
  onClose?: () => void;
  /** Permite cerrar con X / click-afuera / ESC (default true). */
  dismissable?: boolean;
}

export interface ModalHandle {
  readonly element: HTMLElement;
  close(): void;
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Abre un modal premium. Devuelve un handle para cerrarlo programaticamente. */
export function openModal(options: ModalOptions): ModalHandle {
  const host = options.host ?? document.body;
  const dismissable = options.dismissable ?? true;
  const previousFocus = document.activeElement as HTMLElement | null;
  let closed = false;
  let busy = false;

  const backdrop = document.createElement('div');
  backdrop.className = 'editor-modal';

  const card = document.createElement('div');
  card.className = 'editor-modal__card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');

  card.append(buildHeader(options, () => close()), buildBody(options.body));

  const actionButtons: HTMLButtonElement[] = [];
  const setDisabled = (disabled: boolean): void => {
    for (const button of actionButtons) button.disabled = disabled;
  };

  const runAction = async (action: ModalAction): Promise<void> => {
    if (busy) return;
    busy = true;
    setDisabled(true);
    try {
      await action.onClick();
      if (!action.keepOpen) close();
    } catch {
      // El caller ya mostro el error en el body: dejamos el modal abierto.
    } finally {
      busy = false;
      if (!closed) setDisabled(false);
    }
  };

  const footer = document.createElement('div');
  footer.className = 'editor-modal__footer';
  for (const action of options.actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `editor-button editor-button--${action.variant ?? 'ghost'}`;
    if (action.icon) button.append(iconSpan(action.icon));
    const label = document.createElement('span');
    label.textContent = action.label;
    button.append(label);
    button.addEventListener('click', () => void runAction(action));
    actionButtons.push(button);
    footer.append(button);
  }
  if (options.actions.length > 0) card.append(footer);

  backdrop.append(card);
  host.append(backdrop);

  function close(): void {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKeyDown, true);
    options.onClose?.();
    previousFocus?.focus?.();
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && dismissable) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Enter' && !(event.target instanceof HTMLTextAreaElement)) {
      const primary = actionButtons.find((b) => b.classList.contains('editor-button--primary'));
      if (primary && !busy) {
        event.preventDefault();
        primary.click();
      }
    } else if (event.key === 'Tab') {
      trapTab(event, card);
    }
  };

  if (dismissable) {
    backdrop.addEventListener('pointerdown', (event) => {
      if (event.target === backdrop) close();
    });
  }
  document.addEventListener('keydown', onKeyDown, true);

  // Foco inicial: primer campo/boton del cuerpo, o la accion primaria.
  const body = card.querySelector<HTMLElement>('.editor-modal__body');
  const firstField = body?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
  (firstField ?? actionButtons.find((b) => b.classList.contains('editor-button--primary')) ?? actionButtons[0])?.focus();

  return { element: backdrop, close };
}

/** Confirmacion simple si/no. Resuelve `true` solo si se confirma. */
export function confirmDialog(options: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  icon?: EditorIconName;
  host?: HTMLElement;
}): Promise<boolean> {
  return new Promise((resolve) => {
    let decided = false;
    const body = document.createElement('p');
    body.className = 'editor-modal__message';
    body.textContent = options.message;
    openModal({
      title: options.title,
      icon: options.icon ?? (options.danger ? 'warning' : undefined),
      body,
      host: options.host,
      actions: [
        {
          label: options.cancelLabel ?? 'Cancelar',
          variant: 'ghost',
          onClick: () => {
            decided = true;
            resolve(false);
          },
        },
        {
          label: options.confirmLabel ?? 'Aceptar',
          variant: options.danger ? 'danger' : 'primary',
          onClick: () => {
            decided = true;
            resolve(true);
          },
        },
      ],
      onClose: () => {
        if (!decided) resolve(false);
      },
    });
  });
}

function buildHeader(options: ModalOptions, close: () => void): HTMLElement {
  const header = document.createElement('div');
  header.className = 'editor-modal__header';

  if (options.icon) {
    const iconBox = document.createElement('div');
    iconBox.className = 'editor-modal__header-icon';
    iconBox.append(iconSpan(options.icon));
    header.append(iconBox);
  }

  const heading = document.createElement('div');
  heading.className = 'editor-modal__heading';
  const title = document.createElement('h2');
  title.className = 'editor-modal__title';
  title.textContent = options.title;
  heading.append(title);
  if (options.subtitle) {
    const subtitle = document.createElement('p');
    subtitle.className = 'editor-modal__subtitle';
    subtitle.textContent = options.subtitle;
    heading.append(subtitle);
  }
  header.append(heading);

  if (options.dismissable ?? true) {
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'editor-modal__close';
    closeButton.setAttribute('aria-label', 'Cerrar');
    closeButton.append(iconSpan('close'));
    closeButton.addEventListener('click', close);
    header.append(closeButton);
  }
  return header;
}

function buildBody(content: HTMLElement): HTMLElement {
  const body = document.createElement('div');
  body.className = 'editor-modal__body';
  body.append(content);
  return body;
}

function trapTab(event: KeyboardEvent, card: HTMLElement): void {
  const focusables = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)];
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
