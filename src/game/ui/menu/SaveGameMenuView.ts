import type { Disposable } from "@shared/types/lifecycle";
import type { SaveEnvelopeV1, SaveSlotKind } from "@game/save";

export type SaveGameMenuMode = "load" | "save";

export type SaveGameMenuAction =
  | { kind: "back" }
  | { kind: "create" }
  | { kind: "load"; id: string }
  | { kind: "overwrite"; id: string }
  | { kind: "delete"; id: string }
  | { kind: "retry" };

export interface SaveGameMenuViewCallbacks {
  onAction: (action: SaveGameMenuAction) => void;
}

const SLOT_LABELS: Record<SaveSlotKind, string> = {
  quick: "GUARDADO RÁPIDO",
  auto: "AUTOGUARDADO",
  manual: "GUARDADO MANUAL",
};

const SAFE_THUMBNAIL_PATTERN = /^data:image\/(?:jpeg|webp);base64,/i;

export class SaveGameMenuView implements Disposable {
  readonly element = document.createElement("section");
  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("button[data-save-action]");
    if (!button || button.disabled || !this.element.contains(button)) return;

    const action = button.dataset.saveAction;
    const id = button.dataset.saveId;
    if (action === "delete" || action === "overwrite") {
      if (!id) return;
      const pending = `${action}:${id}`;
      if (this.pendingConfirmation !== pending) {
        this.pendingConfirmation = pending;
        this.render();
        return;
      }
      this.pendingConfirmation = null;
    } else {
      this.pendingConfirmation = null;
    }

    if (action === "back") {
      this.callbacks.onAction({ kind: "back" });
    } else if (action === "create") {
      this.callbacks.onAction({ kind: "create" });
    } else if (action === "load" && id) {
      this.callbacks.onAction({ kind: "load", id });
    } else if (action === "overwrite" && id) {
      this.callbacks.onAction({ kind: "overwrite", id });
    } else if (action === "delete" && id) {
      this.callbacks.onAction({ kind: "delete", id });
    } else if (action === "retry") {
      this.callbacks.onAction({ kind: "retry" });
    }
  };

  private mode: SaveGameMenuMode = "load";
  private saves: readonly SaveEnvelopeV1[] = [];
  private loading = true;
  private busy = false;
  private message = "";
  private isError = false;
  private pendingConfirmation: string | null = null;

  constructor(private readonly callbacks: SaveGameMenuViewCallbacks) {
    this.element.className =
      "hl2-panel hl2-panel--content hl2-panel--wide hl2-save-menu";
    this.element.addEventListener("click", this.handleClick);
    this.render();
  }

  setMode(mode: SaveGameMenuMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.pendingConfirmation = null;
    this.message = "";
    this.isError = false;
    this.render();
  }

  setLoading(loading: boolean): void {
    this.loading = loading;
    if (loading) {
      this.pendingConfirmation = null;
      this.message = "Consultando archivos locales...";
      this.isError = false;
    }
    this.render();
  }

  setBusy(busy: boolean, message = ""): void {
    this.busy = busy;
    this.message = message;
    this.isError = false;
    this.render();
  }

  setSaves(saves: readonly SaveEnvelopeV1[], message = ""): void {
    this.saves = [...saves];
    this.loading = false;
    this.busy = false;
    this.message = message;
    this.isError = false;
    this.render();
  }

  setError(message: string): void {
    this.loading = false;
    this.busy = false;
    this.message = message;
    this.isError = true;
    this.render();
  }

  dispose(): void {
    this.element.removeEventListener("click", this.handleClick);
    this.element.remove();
  }

  private render(): void {
    this.element.setAttribute(
      "aria-busy",
      String(this.loading || this.busy),
    );
    this.element.replaceChildren(
      this.buildHeader(),
      this.buildToolbar(),
      this.buildBody(),
      this.buildFooter(),
    );
  }

  private buildHeader(): HTMLElement {
    const header = document.createElement("div");
    header.className = "hl2-save-menu__top";

    const heading = document.createElement("div");
    heading.className = "hl2-panel__header";
    const title = document.createElement("h2");
    title.textContent =
      this.mode === "save" ? "GUARDAR PARTIDA" : "CARGAR PARTIDA";
    const description = document.createElement("p");
    description.textContent =
      this.mode === "save"
        ? "Crea un archivo nuevo o actualiza uno de tus guardados manuales."
        : "Elige el punto desde el que quieres continuar.";
    heading.append(title, description);

    const rule = document.createElement("div");
    rule.className = "hl2-save-menu__signal";
    rule.setAttribute("aria-hidden", "true");

    header.append(heading, rule);
    return header;
  }

  private buildToolbar(): HTMLElement {
    const toolbar = document.createElement("div");
    toolbar.className = "hl2-save-menu__toolbar";

    const summary = document.createElement("span");
    summary.className = "hl2-save-menu__count";
    summary.textContent = `${this.saves.length} ${
      this.saves.length === 1 ? "archivo" : "archivos"
    }`;
    toolbar.append(summary);

    if (this.mode === "save") {
      toolbar.append(
        this.makeButton("CREAR GUARDADO MANUAL", "create", {
          primary: true,
          disabled: this.loading || this.busy,
        }),
      );
    }
    return toolbar;
  }

  private buildBody(): HTMLElement {
    const body = document.createElement("div");
    body.className = "hl2-save-menu__body";

    if (this.loading) {
      body.append(this.buildEmptyState("LEYENDO GUARDADOS", this.message));
      return body;
    }

    if (this.isError) {
      const empty = this.buildEmptyState(
        "NO SE PUDO LEER EL ARCHIVO",
        this.message,
      );
      empty.append(this.makeButton("VOLVER A INTENTAR", "retry"));
      body.append(empty);
      return body;
    }

    if (this.saves.length === 0) {
      body.append(
        this.buildEmptyState(
          "SIN GUARDADOS",
          this.mode === "save"
            ? "Crea tu primer guardado manual para conservar este punto."
            : "Inicia una partida para crear un guardado rápido, automático o manual.",
        ),
      );
      return body;
    }

    const list = document.createElement("ol");
    list.className = "hl2-save-list";
    this.saves.forEach((save) => list.append(this.buildSave(save)));
    body.append(list);
    return body;
  }

  private buildSave(save: SaveEnvelopeV1): HTMLLIElement {
    const item = document.createElement("li");
    item.className = `hl2-save hl2-save--${save.slot.kind}`;
    item.dataset.saveId = save.id;

    const thumbnail = document.createElement("div");
    thumbnail.className = "hl2-save__thumbnail";
    const imageUrl = save.metadata.thumbnail?.dataUrl;
    if (imageUrl && SAFE_THUMBNAIL_PATTERN.test(imageUrl)) {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = `Vista previa de ${save.metadata.levelTitle}`;
      image.width = 320;
      image.height = 180;
      image.loading = "lazy";
      thumbnail.append(image);
    } else {
      const placeholder = document.createElement("span");
      placeholder.className = "hl2-save__placeholder";
      placeholder.textContent = "SIN SEÑAL";
      thumbnail.append(placeholder);
    }

    const details = document.createElement("div");
    details.className = "hl2-save__details";

    const slot = document.createElement("span");
    slot.className = "hl2-save__slot";
    slot.textContent = formatSlot(save);

    const title = document.createElement("h3");
    title.className = "hl2-save__title";
    title.textContent = save.metadata.title;

    const level = document.createElement("p");
    level.className = "hl2-save__level";
    level.textContent = save.metadata.levelTitle;

    const metadata = document.createElement("dl");
    metadata.className = "hl2-save__metadata";
    metadata.append(
      metadataEntry("FECHA", formatDate(save.updatedAt)),
      metadataEntry("TIEMPO", formatPlayTime(save.metadata.playTimeSeconds)),
      metadataEntry("DIFICULTAD", save.metadata.difficulty),
    );
    details.append(slot, title, level, metadata);

    const actions = document.createElement("div");
    actions.className = "hl2-save__actions";
    if (this.mode === "load") {
      actions.append(
        this.makeButton("CARGAR", "load", {
          id: save.id,
          primary: true,
          disabled: this.busy,
        }),
      );
    } else if (save.slot.kind === "manual") {
      const pending = this.pendingConfirmation === `overwrite:${save.id}`;
      actions.append(
        this.makeButton(pending ? "CONFIRMAR" : "SOBRESCRIBIR", "overwrite", {
          id: save.id,
          primary: pending,
          disabled: this.busy,
        }),
      );
    }

    const deleting = this.pendingConfirmation === `delete:${save.id}`;
    actions.append(
      this.makeButton(deleting ? "CONFIRMAR BORRADO" : "BORRAR", "delete", {
        id: save.id,
        danger: true,
        disabled: this.busy,
      }),
    );

    item.append(thumbnail, details, actions);
    return item;
  }

  private buildFooter(): HTMLElement {
    const footer = document.createElement("div");
    footer.className = "hl2-save-menu__foot";

    const status = document.createElement("p");
    status.className = `hl2-status${this.isError ? " is-error" : ""}`;
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent =
      this.message ||
      (this.mode === "save"
        ? "Los guardados manuales se conservan en este navegador."
        : "Los archivos más recientes aparecen primero.");

    footer.append(status, this.makeButton("VOLVER", "back"));
    return footer;
  }

  private buildEmptyState(title: string, message: string): HTMLElement {
    const empty = document.createElement("div");
    empty.className = "hl2-save-menu__empty";
    const glyph = document.createElement("span");
    glyph.className = "hl2-save-menu__empty-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "▱";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = message;
    empty.append(glyph, heading, copy);
    return empty;
  }

  private makeButton(
    label: string,
    action: string,
    options: {
      id?: string;
      primary?: boolean;
      danger?: boolean;
      disabled?: boolean;
    } = {},
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = [
      "hl2-button",
      options.primary ? "hl2-button--primary" : "",
      options.danger ? "hl2-button--danger" : "",
    ]
      .filter(Boolean)
      .join(" ");
    button.dataset.saveAction = action;
    if (options.id) button.dataset.saveId = options.id;
    button.disabled = options.disabled ?? false;

    const marker = document.createElement("span");
    marker.className = "hl2-button__marker";
    const text = document.createElement("span");
    text.className = "hl2-button__label";
    text.textContent = label;
    button.append(marker, text);
    return button;
  }
}

function formatSlot(save: SaveEnvelopeV1): string {
  if (save.slot.kind !== "auto") return SLOT_LABELS[save.slot.kind];
  return `${SLOT_LABELS.auto} ${save.slot.index + 1}`;
}

function formatDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat("es-AR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  } catch {
    return "Fecha desconocida";
  }
}

function formatPlayTime(seconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours} h ${String(minutes).padStart(2, "0")} min`;
}

function metadataEntry(label: string, value: string): HTMLDivElement {
  const entry = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value;
  entry.append(term, description);
  return entry;
}
