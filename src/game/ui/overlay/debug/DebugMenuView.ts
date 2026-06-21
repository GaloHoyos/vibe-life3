import type { DebugModule } from "./DebugModule";

interface TabEntry {
  module: DebugModule;
  tabButton: HTMLButtonElement;
  panel: HTMLDivElement;
  body: HTMLDivElement;
  activeCheckbox: HTMLInputElement;
}

export interface DebugMenuViewCallbacks {
  /** El usuario marco/desmarco el activador de un modulo. */
  onModuleActiveChange: (moduleId: string, active: boolean) => void;
  /** El usuario cambio de pestania (para que el componente decida si suspender modulos costosos). */
  onTabChange: (moduleId: string) => void;
  /** El usuario cerro el menu con la X. */
  onClose: () => void;
}

/**
 * Shell DOM del DebugMenu: barra de pestanias, contenedor de paneles,
 * checkbox "Activo" por modulo. No conoce la logica de cada modulo;
 * solo expone hooks al componente.
 */
export class DebugMenuView {
  readonly element: HTMLDivElement;
  private readonly tabsRow: HTMLDivElement;
  private readonly panelsRow: HTMLDivElement;
  private readonly entries = new Map<string, TabEntry>();
  private activeTabId: string | null = null;

  constructor(private readonly callbacks: DebugMenuViewCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "debug-menu is-hidden";

    const header = document.createElement("div");
    header.className = "debug-menu__header";

    const title = document.createElement("div");
    title.className = "debug-menu__title";
    title.textContent = "Debug Menu";
    header.appendChild(title);

    const hint = document.createElement("div");
    hint.className = "debug-menu__hint";
    hint.textContent = "F3 ocultar | F9 liberar cursor";
    header.appendChild(hint);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "debug-menu__close";
    closeBtn.textContent = "x";
    closeBtn.title = "Cerrar (F3)";
    closeBtn.addEventListener("click", () => this.callbacks.onClose());
    header.appendChild(closeBtn);

    this.element.appendChild(header);

    this.tabsRow = document.createElement("div");
    this.tabsRow.className = "debug-menu__tabs";
    this.element.appendChild(this.tabsRow);

    this.panelsRow = document.createElement("div");
    this.panelsRow.className = "debug-menu__panels";
    this.element.appendChild(this.panelsRow);
  }

  attachTo(container: HTMLElement): void {
    container.appendChild(this.element);
  }

  addModule(module: DebugModule): HTMLElement {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "debug-menu__tab";
    tab.textContent = module.label;
    if (module.heavy) {
      const marker = document.createElement("span");
      marker.className = "debug-menu__tab-marker";
      marker.textContent = "*";
      marker.title = "Modulo costoso: inactivo por defecto";
      tab.appendChild(marker);
    }
    tab.addEventListener("click", () => this.setActiveTab(module.id));
    this.tabsRow.appendChild(tab);

    const panel = document.createElement("div");
    panel.className = "debug-menu__panel is-hidden";

    const switchRow = document.createElement("label");
    switchRow.className = "debug-menu__switch";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = !module.heavy;
    checkbox.addEventListener("change", () => {
      this.callbacks.onModuleActiveChange(module.id, checkbox.checked);
      this.refreshTabState(module.id);
    });
    switchRow.appendChild(checkbox);

    const switchLabel = document.createElement("span");
    switchLabel.textContent = module.heavy ? "Activo (costoso)" : "Activo";
    switchRow.appendChild(switchLabel);

    panel.appendChild(switchRow);

    const body = document.createElement("div");
    body.className = "debug-menu__body";
    panel.appendChild(body);

    this.panelsRow.appendChild(panel);

    this.entries.set(module.id, {
      module,
      tabButton: tab,
      panel,
      body,
      activeCheckbox: checkbox,
    });

    if (this.activeTabId === null) {
      this.setActiveTab(module.id);
    }

    return body;
  }

  setActiveTab(moduleId: string): void {
    if (!this.entries.has(moduleId) || this.activeTabId === moduleId) {
      return;
    }
    this.activeTabId = moduleId;
    for (const [id, entry] of this.entries) {
      const isActive = id === moduleId;
      entry.tabButton.classList.toggle("is-active", isActive);
      entry.panel.classList.toggle("is-hidden", !isActive);
    }
    this.callbacks.onTabChange(moduleId);
  }

  getActiveTabId(): string | null {
    return this.activeTabId;
  }

  refreshTabState(moduleId: string): void {
    const entry = this.entries.get(moduleId);
    if (!entry) return;
    entry.tabButton.classList.toggle(
      "is-module-active",
      entry.module.isActive(),
    );
    entry.activeCheckbox.checked = entry.module.isActive();
  }

  refreshAll(): void {
    for (const id of this.entries.keys()) {
      this.refreshTabState(id);
    }
  }

  show(): void {
    this.element.classList.remove("is-hidden");
  }

  hide(): void {
    this.element.classList.add("is-hidden");
  }

  isVisible(): boolean {
    return !this.element.classList.contains("is-hidden");
  }

  dispose(): void {
    this.element.remove();
    this.entries.clear();
  }
}
