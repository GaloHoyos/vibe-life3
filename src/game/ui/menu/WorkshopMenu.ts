import { getLibraryMap, listLibraryMaps } from "@game/editor/mapLibrary";
import type { WorkshopService } from "@game/workshop/WorkshopService";
import type { WorkshopListing } from "@game/workshop/WorkshopTypes";

export interface WorkshopMenuCallbacks {
  onPlay: (id: string) => void;
  onBack: () => void;
}

type WorkshopTab = "browse" | "subscribed" | "publish";
type LoadState = "idle" | "loading" | "error";

/**
 * Pantalla del Workshop: examinar el catalogo remoto, gestionar suscripciones
 * (activar/desactivar/actualizar/eliminar) y publicar mapas de la biblioteca.
 * Todo string dinamico se inserta via `textContent` — el contenido remoto no
 * es confiable y no debe interpretarse como HTML.
 */
export class WorkshopMenu {
  readonly element = document.createElement("section");

  private readonly body = document.createElement("div");
  private readonly status = document.createElement("p");
  private readonly tabButtons = new Map<WorkshopTab, HTMLButtonElement>();
  private tab: WorkshopTab = "browse";
  private listings: WorkshopListing[] = [];
  private loadState: LoadState = "idle";

  constructor(
    private readonly workshop: WorkshopService,
    private readonly callbacks: WorkshopMenuCallbacks,
  ) {
    this.element.className = "hl2-panel hl2-panel--content";

    const header = document.createElement("div");
    header.className = "hl2-panel__header";
    const title = document.createElement("h2");
    title.textContent = "WORKSHOP";
    const subtitle = document.createElement("p");
    subtitle.textContent = "Descarga, gestiona y publica mapas de la comunidad.";
    header.append(title, subtitle);

    const tabs = document.createElement("div");
    tabs.className = "hl2-tabs";
    tabs.append(
      this.tabButton("browse", "EXAMINAR"),
      this.tabButton("subscribed", "SUSCRITOS"),
      this.tabButton("publish", "PUBLICAR"),
    );

    this.body.className = "hl2-workshop__body";
    this.status.className = "hl2-status";

    const actions = document.createElement("div");
    actions.className = "hl2-actions";
    actions.append(button("VOLVER", "", this.callbacks.onBack));

    this.element.append(header, tabs, this.body, this.status, actions);

    this.selectTab("browse");
    if (this.workshop.capabilities.auth) {
      void this.loadListings();
    }
  }

  private tabButton(tab: WorkshopTab, label: string): HTMLButtonElement {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "hl2-tab";
    el.textContent = label;
    el.addEventListener("click", () => this.selectTab(tab));
    this.tabButtons.set(tab, el);
    return el;
  }

  private selectTab(tab: WorkshopTab): void {
    this.tab = tab;
    for (const [key, el] of this.tabButtons) {
      el.classList.toggle("is-active", key === tab);
    }
    this.renderBody();
  }

  private async loadListings(): Promise<void> {
    this.loadState = "loading";
    if (this.tab === "browse") this.renderBody();
    try {
      this.listings = await this.workshop.browse();
      this.loadState = "idle";
    } catch (error) {
      this.loadState = "error";
      this.setStatus(messageOf(error, "Error cargando el catalogo."));
    }
    if (this.tab === "browse") this.renderBody();
  }

  private renderBody(): void {
    this.body.replaceChildren();
    if (this.tab === "browse") this.renderBrowse();
    else if (this.tab === "subscribed") this.renderSubscribed();
    else this.renderPublish();
  }

  private renderBrowse(): void {
    if (!this.workshop.capabilities.auth) {
      this.body.append(
        emptyRow("Workshop no disponible. Configura VITE_WORKSHOP_API para conectarte."),
      );
      return;
    }
    if (this.loadState === "loading") {
      this.body.append(emptyRow("Cargando catalogo..."));
      return;
    }
    if (this.listings.length === 0) {
      this.body.append(emptyRow("No hay mapas publicados todavia."));
      return;
    }
    const list = chapterList();
    for (const listing of this.listings) {
      const meta = `por ${listing.author} · ${listing.downloads} descargas`;
      const item = listRow(listing.title, meta, listing.description);
      const buttons = rowButtons(item);
      if (this.workshop.isSubscribed(listing.id)) {
        const tag = button("SUSCRITO", "", () => {});
        tag.disabled = true;
        buttons.append(tag);
      } else {
        buttons.append(
          button("SUSCRIBIR", "hl2-button--primary", () => {
            void this.subscribe(listing);
          }),
        );
      }
      list.append(item);
    }
    this.body.append(list);
  }

  private async subscribe(listing: WorkshopListing): Promise<void> {
    this.setStatus(`Descargando "${listing.title}"...`);
    try {
      await this.workshop.subscribe(listing);
      this.setStatus(`Suscrito a "${listing.title}".`);
      this.renderBody();
    } catch (error) {
      this.setStatus(messageOf(error, "Error al suscribirse."));
    }
  }

  private renderSubscribed(): void {
    const subs = this.workshop.listSubscriptions();
    if (subs.length === 0) {
      this.body.append(emptyRow("No tienes mapas suscritos. Suscribite desde EXAMINAR."));
      return;
    }
    const list = chapterList();
    for (const sub of subs) {
      const remote = this.listings.find((l) => l.id === sub.id);
      const item = listRow(sub.title, sub.enabled ? "Activo" : "Desactivado", "");
      const buttons = rowButtons(item);
      buttons.append(
        button("JUGAR", "hl2-button--primary", () => this.callbacks.onPlay(sub.id)),
      );
      buttons.append(
        button(sub.enabled ? "DESACTIVAR" : "ACTIVAR", "", () => {
          this.workshop.setEnabled(sub.id, !sub.enabled);
          this.renderBody();
        }),
      );
      if (remote !== undefined && remote.revision !== sub.revision) {
        buttons.append(
          button("ACTUALIZAR", "", () => {
            void this.updateSubscription(remote);
          }),
        );
      }
      buttons.append(
        button("ELIMINAR", "hl2-button--danger", () => {
          void this.unsubscribe(sub.id, sub.title);
        }),
      );
      list.append(item);
    }
    this.body.append(list);
  }

  private async updateSubscription(listing: WorkshopListing): Promise<void> {
    this.setStatus(`Actualizando "${listing.title}"...`);
    try {
      await this.workshop.update(listing);
      this.setStatus(`"${listing.title}" actualizado.`);
      this.renderBody();
    } catch (error) {
      this.setStatus(messageOf(error, "Error al actualizar."));
    }
  }

  private async unsubscribe(id: string, title: string): Promise<void> {
    try {
      await this.workshop.unsubscribe(id);
      this.setStatus(`Te diste de baja de "${title}".`);
      this.renderBody();
    } catch (error) {
      this.setStatus(messageOf(error, "Error al darse de baja."));
    }
  }

  private renderPublish(): void {
    if (!this.workshop.capabilities.publish) {
      this.body.append(emptyRow("Publicar no disponible. Configura VITE_WORKSHOP_API."));
      return;
    }
    const user = this.workshop.currentUser();
    const account = document.createElement("p");
    account.className = "hl2-workshop__account";
    account.textContent = user ? `Sesion: ${user.name}` : "No has iniciado sesion.";
    this.body.append(account);
    if (!user) {
      this.body.append(
        button("INICIAR SESION CON GITHUB", "hl2-button--primary", () => {
          void this.signIn();
        }),
      );
    }

    const maps = listLibraryMaps();
    if (maps.length === 0) {
      this.body.append(emptyRow("No tienes mapas en tu biblioteca. Crea uno en el editor."));
      return;
    }
    const list = chapterList();
    for (const info of maps) {
      const item = listRow(info.title, info.id, "");
      rowButtons(item).append(
        button("PUBLICAR", "hl2-button--primary", () => {
          void this.publish(info.id);
        }),
      );
      list.append(item);
    }
    this.body.append(list);
  }

  private async signIn(): Promise<void> {
    try {
      const user = await this.workshop.signIn();
      this.setStatus(`Sesion iniciada como ${user.name}.`);
      this.renderBody();
    } catch (error) {
      this.setStatus(messageOf(error, "Error al iniciar sesion."));
    }
  }

  private async publish(libraryId: string): Promise<void> {
    const doc = getLibraryMap(libraryId);
    if (!doc) {
      this.setStatus("No se encontro el mapa en la biblioteca.");
      return;
    }
    if (!this.workshop.currentUser()) {
      try {
        await this.workshop.signIn();
      } catch {
        this.setStatus("Necesitas iniciar sesion para publicar.");
        return;
      }
    }
    this.setStatus(`Publicando "${doc.meta.title}"...`);
    try {
      const listing = await this.workshop.publish(doc, {
        title: doc.meta.title,
        description: doc.meta.description ?? "",
        tags: [],
        type: "map",
      });
      this.setStatus(`Publicado: "${listing.title}".`);
      this.renderBody();
    } catch (error) {
      this.setStatus(messageOf(error, "Error al publicar."));
    }
  }

  private setStatus(message: string): void {
    this.status.textContent = message;
  }
}

function button(label: string, modifier: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `hl2-button${modifier ? ` ${modifier}` : ""}`;
  const marker = document.createElement("span");
  marker.className = "hl2-button__marker";
  const text = document.createElement("span");
  text.className = "hl2-button__label";
  text.textContent = label;
  el.append(marker, text);
  el.addEventListener("click", onClick);
  return el;
}

function chapterList(): HTMLUListElement {
  const list = document.createElement("ul");
  list.className = "hl2-chapters";
  return list;
}

function rowButtons(item: HTMLLIElement): HTMLDivElement {
  return item.querySelector(".hl2-chapter__buttons") as HTMLDivElement;
}

function listRow(title: string, meta: string, description: string): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "hl2-chapter hl2-chapter--custom";

  const body = document.createElement("div");
  body.className = "hl2-chapter__body";
  const titleEl = document.createElement("div");
  titleEl.className = "hl2-chapter__title";
  titleEl.textContent = title;
  body.append(titleEl);
  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.className = "hl2-chapter__tag";
    metaEl.textContent = meta;
    body.append(metaEl);
  }
  if (description) {
    const descEl = document.createElement("div");
    descEl.className = "hl2-chapter__desc";
    descEl.textContent = description;
    body.append(descEl);
  }

  const buttons = document.createElement("div");
  buttons.className = "hl2-chapter__buttons";
  item.append(body, buttons);
  return item;
}

function emptyRow(text: string): HTMLElement {
  const el = document.createElement("p");
  el.className = "hl2-chapter hl2-chapter--empty";
  el.textContent = text;
  return el;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
