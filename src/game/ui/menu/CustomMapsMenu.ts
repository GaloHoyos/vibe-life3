import type { CustomMapEntry, CustomMapSource } from "./MainMenuState";

const SOURCE_TAGS: Record<CustomMapSource, string> = {
  folder: "INCLUIDO",
  library: "LOCAL",
  workshop: "WORKSHOP",
};

export interface CustomMapsMenuCallbacks {
  onPlay: (entry: CustomMapEntry) => void;
  onEdit: (entry: CustomMapEntry) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
  onBack: () => void;
}

/**
 * Selector de "Mapas Personalizados". Lista los mapas custom de carpeta
 * (`maps/custom/`, solo Jugar + Editar) y los guardados en el navegador
 * (Jugar + Editar + Borrar). Se reconstruye al entrar al estado porque la
 * biblioteca local cambia (importar/borrar).
 */
export class CustomMapsMenu {
  readonly element = document.createElement("section");

  constructor(maps: CustomMapEntry[], callbacks: CustomMapsMenuCallbacks) {
    this.element.className = "hl2-panel hl2-panel--content";
    this.element.innerHTML = `
      <div class="hl2-panel__header">
        <h2>MAPAS PERSONALIZADOS</h2>
        <p>Mapas de comunidad y creados con el editor.</p>
      </div>
      <div class="hl2-actions hl2-actions--top">
        <button class="hl2-button" type="button" data-action="import">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">IMPORTAR .JSON</span>
        </button>
      </div>
      <ul class="hl2-chapters"></ul>
      <div class="hl2-actions">
        <button class="hl2-button" type="button" data-action="back">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">VOLVER</span>
        </button>
      </div>
    `;

    const list = this.element.querySelector(".hl2-chapters") as HTMLUListElement;

    if (maps.length === 0) {
      const empty = document.createElement("li");
      empty.className = "hl2-chapter hl2-chapter--empty";
      empty.textContent = "No hay mapas personalizados. Importa un .json o crea uno en el editor.";
      list.append(empty);
    } else {
      maps.forEach((entry) => list.append(this.renderEntry(entry, callbacks)));
    }

    (
      this.element.querySelector('[data-action="import"]') as HTMLButtonElement
    ).addEventListener("click", callbacks.onImport);
    (
      this.element.querySelector('[data-action="back"]') as HTMLButtonElement
    ).addEventListener("click", callbacks.onBack);
  }

  private renderEntry(
    entry: CustomMapEntry,
    callbacks: CustomMapsMenuCallbacks,
  ): HTMLLIElement {
    const item = document.createElement("li");
    item.className = "hl2-chapter hl2-chapter--custom";
    item.dataset.chapterId = entry.id;

    const body = document.createElement("div");
    body.className = "hl2-chapter__body";

    // textContent (no innerHTML): titulo/descripcion pueden venir de contenido
    // remoto del Workshop y no deben interpretarse como HTML.
    const title = document.createElement("div");
    title.className = "hl2-chapter__title";
    title.textContent = entry.title;
    const tag = document.createElement("span");
    tag.className = "hl2-chapter__tag";
    tag.textContent = SOURCE_TAGS[entry.source];
    title.append(" ", tag);

    const desc = document.createElement("div");
    desc.className = "hl2-chapter__desc";
    desc.textContent = entry.description;
    body.append(title, desc);

    const buttons = document.createElement("div");
    buttons.className = "hl2-chapter__buttons";
    buttons.append(button("JUGAR", "hl2-button--primary", () => callbacks.onPlay(entry)));
    buttons.append(button("EDITAR", "", () => callbacks.onEdit(entry)));
    if (entry.source === "library") {
      buttons.append(button("BORRAR", "hl2-button--danger", () => callbacks.onDelete(entry.id)));
    }

    item.append(body, buttons);
    return item;
  }
}

function button(label: string, modifier: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `hl2-button${modifier ? ` ${modifier}` : ""}`;
  el.innerHTML = `<span class="hl2-button__marker"></span><span class="hl2-button__label">${label}</span>`;
  el.addEventListener("click", onClick);
  return el;
}
