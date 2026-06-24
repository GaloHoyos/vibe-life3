import { getLibraryMap, listLibraryMaps } from "@game/editor/mapLibrary";
import { WorkshopStrings } from "@game/config/strings";
import type { WorkshopService } from "@game/workshop/WorkshopService";
import type {
  WorkshopComment,
  WorkshopListing,
} from "@game/workshop/WorkshopTypes";
import { StarRating } from "./StarRating";

export interface WorkshopMenuCallbacks {
  onPlay: (id: string) => void;
  onBack: () => void;
}

type WorkshopTab = "browse" | "subscribed" | "publish";
type LoadState = "idle" | "loading" | "error";

/**
 * Pantalla del Workshop (estilo Steam): grid de tarjetas para examinar el
 * catalogo / gestionar suscripciones / publicar, y una vista de detalle con
 * hero, rating de 5 estrellas y comentarios. Todo string remoto se inserta via
 * `textContent` — el contenido no es confiable y no debe interpretarse como HTML.
 */
export class WorkshopMenu {
  readonly element = document.createElement("section");

  private readonly body = document.createElement("div");
  private readonly status = document.createElement("p");
  private readonly search = document.createElement("label");
  private readonly searchInput = document.createElement("input");
  private readonly tabButtons = new Map<WorkshopTab, HTMLButtonElement>();
  private tab: WorkshopTab = "browse";
  private query = "";
  private listings: WorkshopListing[] = [];
  private loadState: LoadState = "idle";

  private detailId: string | null = null;
  private detail: WorkshopListing | null = null;
  private detailLoaded = false;
  private comments: WorkshopComment[] | null = null;

  constructor(
    private readonly workshop: WorkshopService,
    private readonly callbacks: WorkshopMenuCallbacks,
  ) {
    this.element.className = "hl2-panel hl2-panel--content hl2-panel--wide";

    const top = document.createElement("div");
    top.className = "hl2-workshop__top";

    const header = document.createElement("div");
    header.className = "hl2-panel__header";
    const title = document.createElement("h2");
    title.textContent = "WORKSHOP";
    const subtitle = document.createElement("p");
    subtitle.textContent = "Descarga, valora y publica mapas de la comunidad.";
    header.append(title, subtitle);

    const toolbar = document.createElement("div");
    toolbar.className = "hl2-workshop__toolbar";
    const tabs = document.createElement("div");
    tabs.className = "hl2-tabs";
    tabs.append(
      this.tabButton("browse", "EXAMINAR"),
      this.tabButton("subscribed", "SUSCRITOS"),
      this.tabButton("publish", "PUBLICAR"),
    );
    this.search.className = "hl2-workshop__search";
    this.searchInput.type = "search";
    this.searchInput.placeholder = "Buscar mapas...";
    this.searchInput.addEventListener("input", () => {
      this.query = this.searchInput.value.trim().toLowerCase();
      if (this.tab === "browse" && !this.detailId) this.renderBody();
    });
    this.search.append(this.searchInput);
    toolbar.append(tabs, this.search);

    top.append(header, toolbar);

    this.body.className = "hl2-workshop__body";

    const foot = document.createElement("div");
    foot.className = "hl2-workshop__foot";
    this.status.className = "hl2-status";
    const actions = document.createElement("div");
    actions.className = "hl2-actions";
    actions.append(button("VOLVER", "", this.callbacks.onBack));
    foot.append(this.status, actions);

    this.element.append(top, this.body, foot);

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
    this.detailId = null;
    for (const [key, el] of this.tabButtons) {
      el.classList.toggle("is-active", key === tab);
    }
    this.renderBody();
  }

  private async loadListings(): Promise<void> {
    this.loadState = "loading";
    if (this.tab === "browse" && !this.detailId) this.renderBody();
    try {
      this.listings = await this.workshop.browse();
      this.loadState = "idle";
    } catch (error) {
      this.loadState = "error";
      this.setStatus(messageOf(error, "Error cargando el catalogo."));
    }
    if (this.tab === "browse" && !this.detailId) this.renderBody();
  }

  private renderBody(): void {
    this.body.replaceChildren();
    const showSearch = !this.detailId && this.tab === "browse" && this.workshop.capabilities.auth;
    this.search.classList.toggle("is-hidden", !showSearch);
    for (const el of this.tabButtons.values()) {
      el.toggleAttribute("disabled", this.detailId !== null);
    }
    if (this.detailId) {
      this.renderDetail();
      return;
    }
    if (this.tab === "browse") this.renderBrowse();
    else if (this.tab === "subscribed") this.renderSubscribed();
    else this.renderPublish();
  }

  private renderBrowse(): void {
    if (!this.workshop.capabilities.auth) {
      this.body.append(empty("Workshop no disponible. Configura VITE_WORKSHOP_API para conectarte."));
      return;
    }
    if (this.loadState === "loading") {
      this.body.append(empty("Cargando catalogo..."));
      return;
    }
    const filtered = this.query
      ? this.listings.filter((l) => matchesQuery(l, this.query))
      : this.listings;
    if (filtered.length === 0) {
      this.body.append(empty(this.query ? "Ningun mapa coincide con la busqueda." : "No hay mapas publicados todavia."));
      return;
    }
    const grid = cardGrid();
    for (const listing of filtered) {
      const { card, actions } = this.buildCard(listing, this.ratingStats(listing));
      actions.append(button("DETALLES", "", () => void this.openDetail(listing.id, listing)));
      if (this.workshop.isSubscribed(listing.id)) {
        const tag = button("SUSCRITO", "", () => {});
        tag.disabled = true;
        actions.append(tag);
      } else {
        actions.append(button("SUSCRIBIR", "hl2-button--primary", () => void this.subscribe(listing)));
      }
      grid.append(card);
    }
    this.body.append(grid);
  }

  private renderSubscribed(): void {
    const subs = this.workshop.listSubscriptions();
    if (subs.length === 0) {
      this.body.append(empty("No tienes mapas suscritos. Suscribite desde EXAMINAR."));
      return;
    }
    const grid = cardGrid();
    for (const sub of subs) {
      const remote = this.listings.find((l) => l.id === sub.id);
      const stats = document.createElement("span");
      stats.textContent = sub.enabled ? "Activo" : "Desactivado";
      const { card, actions } = this.buildCard(
        { id: sub.id, title: sub.title, author: remote?.author ?? "" },
        stats,
        sub.enabled ? { label: "ACTIVO", on: true } : { label: "OFF", on: false },
      );
      actions.append(button("JUGAR", "hl2-button--primary", () => this.callbacks.onPlay(sub.id)));
      if (this.workshop.capabilities.auth) {
        actions.append(button("DETALLES", "", () => void this.openDetail(sub.id, remote)));
      }
      actions.append(
        button(sub.enabled ? "DESACTIVAR" : "ACTIVAR", "", () => {
          this.workshop.setEnabled(sub.id, !sub.enabled);
          this.renderBody();
        }),
      );
      if (remote !== undefined && remote.revision !== sub.revision) {
        actions.append(button("ACTUALIZAR", "", () => void this.updateSubscription(remote)));
      }
      actions.append(button("ELIMINAR", "hl2-button--danger", () => void this.unsubscribe(sub.id, sub.title)));
      grid.append(card);
    }
    this.body.append(grid);
  }

  private renderPublish(): void {
    if (!this.workshop.capabilities.publish) {
      this.body.append(empty("Publicar no disponible. Configura VITE_WORKSHOP_API."));
      return;
    }
    const user = this.workshop.currentUser();
    const account = document.createElement("div");
    account.className = "hl2-workshop__account";
    if (user) {
      account.append(avatar(user.name), text(`Sesion iniciada como ${user.name}.`));
    } else {
      account.append(text("Inicia sesion para publicar tus mapas."));
      account.append(button("INICIAR SESION", "hl2-button--primary", () => void this.signIn()));
    }
    this.body.append(account);

    const maps = listLibraryMaps();
    if (maps.length === 0) {
      this.body.append(empty("No tienes mapas en tu biblioteca. Crea uno en el editor."));
      return;
    }
    const grid = cardGrid();
    for (const info of maps) {
      const meta = document.createElement("span");
      meta.textContent = "Mapa local";
      const { card, actions } = this.buildCard({ id: info.id, title: info.title, author: "tu" }, meta);
      actions.append(button("PUBLICAR", "hl2-button--primary", () => void this.publish(info.id)));
      grid.append(card);
    }
    this.body.append(grid);
  }

  /** Tarjeta generica con banner derivado del id, titulo, autor, stats y zona de acciones. */
  private buildCard(
    map: { id: string; title: string; author: string },
    stats: HTMLElement,
    badge?: { label: string; on: boolean },
  ): { card: HTMLElement; actions: HTMLElement } {
    const card = document.createElement("article");
    card.className = "hl2-card";

    const banner = document.createElement("div");
    banner.className = "hl2-card__banner";
    banner.style.setProperty("--h", String(hueOf(map.id)));
    const glyph = document.createElement("span");
    glyph.className = "hl2-card__glyph";
    glyph.textContent = glyphFor(map.title);
    banner.append(glyph);
    if (badge) {
      const b = document.createElement("span");
      b.className = `hl2-card__badge${badge.on ? " is-on" : ""}`;
      b.textContent = badge.label;
      banner.append(b);
    }

    const main = document.createElement("div");
    main.className = "hl2-card__main";
    const title = document.createElement("h3");
    title.className = "hl2-card__title";
    title.textContent = map.title;
    title.title = map.title;
    main.append(title);
    if (map.author) {
      const author = document.createElement("div");
      author.className = "hl2-card__author";
      author.textContent = `por ${map.author}`;
      main.append(author);
    }
    const statsRow = document.createElement("div");
    statsRow.className = "hl2-card__stats";
    statsRow.append(stats);
    main.append(statsRow);

    const actions = document.createElement("div");
    actions.className = "hl2-card__actions";

    card.append(banner, main, actions);
    return { card, actions };
  }

  private ratingStats(listing: WorkshopListing): HTMLElement {
    const wrap = document.createElement("span");
    wrap.style.display = "inline-flex";
    wrap.style.alignItems = "center";
    wrap.style.gap = "8px";
    const stars = new StarRating({ value: listing.rating, readonly: true });
    stars.element.classList.add("hl2-stars--sm");
    const dl = document.createElement("span");
    dl.textContent = `↓ ${listing.downloads}`;
    wrap.append(stars.element, dl);
    return wrap;
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

  // ---------------------------------------------------------------- Detalle

  private async openDetail(id: string, seed?: WorkshopListing): Promise<void> {
    this.detailId = id;
    this.detail = seed ?? null;
    this.detailLoaded = false;
    this.comments = null;
    this.renderBody();
    try {
      const [listing, comments] = await Promise.all([
        this.workshop.fetchListing(id),
        this.workshop.listComments(id),
      ]);
      if (this.detailId !== id) return;
      this.detail = listing;
      this.comments = comments;
    } catch (error) {
      this.setStatus(messageOf(error, "Error cargando el detalle."));
    } finally {
      if (this.detailId === id) {
        this.detailLoaded = true;
        this.renderBody();
      }
    }
  }

  private closeDetail(): void {
    this.detailId = null;
    this.detail = null;
    this.comments = null;
    this.detailLoaded = false;
    this.renderBody();
  }

  private renderDetail(): void {
    const wrapper = document.createElement("div");
    wrapper.className = "hl2-detail";

    const back = document.createElement("div");
    back.className = "hl2-actions hl2-actions--top hl2-detail__back";
    back.append(button("VOLVER A LA LISTA", "", () => this.closeDetail()));
    wrapper.append(back);

    const listing = this.detail;
    if (!listing) {
      wrapper.append(empty(this.detailLoaded ? "No se pudo cargar el detalle." : "Cargando mapa..."));
      this.body.append(wrapper);
      return;
    }

    wrapper.append(this.buildHero(listing));
    if (listing.description) {
      const desc = document.createElement("p");
      desc.className = "hl2-detail__desc";
      desc.textContent = listing.description;
      wrapper.append(desc);
    }
    wrapper.append(this.buildRatingSection(listing));
    wrapper.append(this.buildCommentsSection(listing.id));
    this.body.append(wrapper);
  }

  private buildHero(listing: WorkshopListing): HTMLElement {
    const hero = document.createElement("div");
    hero.className = "hl2-detail__hero";

    const banner = document.createElement("div");
    banner.className = "hl2-detail__banner";
    banner.style.setProperty("--h", String(hueOf(listing.id)));
    const glyph = document.createElement("span");
    glyph.className = "hl2-card__glyph";
    glyph.textContent = glyphFor(listing.title);
    banner.append(glyph);

    const headline = document.createElement("div");
    headline.className = "hl2-detail__headline";
    const title = document.createElement("h2");
    title.textContent = listing.title;
    const author = document.createElement("div");
    author.className = "hl2-detail__author";
    author.textContent = `por ${listing.author}`;

    const statline = document.createElement("div");
    statline.className = "hl2-detail__statline";
    statline.append(
      stat("↓", `${listing.downloads}`, "descargas"),
      stat("★", formatRating(listing), ""),
    );

    const actions = document.createElement("div");
    actions.className = "hl2-detail__hero-actions";
    if (this.workshop.isSubscribed(listing.id)) {
      actions.append(button("JUGAR", "hl2-button--primary", () => this.callbacks.onPlay(listing.id)));
    } else {
      actions.append(button("SUSCRIBIR", "hl2-button--primary", () => void this.subscribe(listing)));
    }

    headline.append(title, author, statline, actions);
    hero.append(banner, headline);
    return hero;
  }

  private buildRatingSection(listing: WorkshopListing): HTMLElement {
    const section = document.createElement("div");
    section.className = "hl2-detail__section";
    const heading = document.createElement("h3");
    heading.textContent = "VALORACION";
    section.append(heading);

    const rate = document.createElement("div");
    rate.className = "hl2-rate";
    const big = document.createElement("div");
    big.className = "hl2-rate__big";
    big.textContent = listing.ratingCount > 0 ? listing.rating.toFixed(1) : "—";
    const slash = document.createElement("span");
    slash.textContent = " /5";
    big.append(slash);
    const meta = document.createElement("div");
    meta.className = "hl2-rate__meta";
    const avg = new StarRating({ value: listing.rating, readonly: true });
    const count = document.createElement("span");
    count.className = "hl2-stars__summary";
    count.textContent = WorkshopStrings.ratingSummary(listing.rating, listing.ratingCount);
    meta.append(avg.element, count);
    rate.append(big, meta);
    section.append(rate);

    const yours = document.createElement("div");
    yours.className = "hl2-rate__yours";
    if (this.workshop.currentUser()) {
      const label = document.createElement("span");
      label.className = "hl2-rate__label";
      label.textContent = WorkshopStrings.rateHeading;
      const stars = new StarRating({
        value: listing.myRating ?? 0,
        onRate: (value) => void this.rate(listing.id, value),
      });
      stars.element.classList.add("hl2-stars--lg");
      yours.append(label, stars.element);
    } else {
      yours.append(hint(WorkshopStrings.signInToRate), this.signInButton());
    }
    section.append(yours);
    return section;
  }

  private buildCommentsSection(id: string): HTMLElement {
    const section = document.createElement("div");
    section.className = "hl2-detail__section";
    const heading = document.createElement("h3");
    const count = this.comments?.length ?? 0;
    heading.textContent = `${WorkshopStrings.commentsHeading} (${count})`;
    section.append(heading);

    if (this.workshop.currentUser()) {
      section.append(this.buildCommentForm(id));
    } else {
      const prompt = document.createElement("div");
      prompt.className = "hl2-rate__yours";
      prompt.append(hint(WorkshopStrings.signInToComment), this.signInButton());
      section.append(prompt);
    }

    const list = document.createElement("div");
    list.className = "hl2-comments";
    if (this.comments === null) {
      list.append(hint(WorkshopStrings.loadingComments));
    } else if (this.comments.length === 0) {
      list.append(hint(WorkshopStrings.noComments));
    } else {
      for (const comment of this.comments) list.append(renderComment(comment));
    }
    section.append(list);
    return section;
  }

  private buildCommentForm(id: string): HTMLElement {
    const form = document.createElement("div");
    form.className = "hl2-comment-form";
    const user = this.workshop.currentUser();
    form.append(avatar(user?.name ?? "?"));
    const field = document.createElement("div");
    field.className = "hl2-comment-form__field";
    const textarea = document.createElement("textarea");
    textarea.maxLength = 1000;
    textarea.placeholder = WorkshopStrings.commentPlaceholder;
    const actions = document.createElement("div");
    actions.className = "hl2-actions";
    actions.append(
      button(WorkshopStrings.comment, "hl2-button--primary", () => void this.submitComment(id, textarea.value)),
    );
    field.append(textarea, actions);
    form.append(field);
    return form;
  }

  private signInButton(): HTMLButtonElement {
    return button("INICIAR SESION CON GITHUB", "hl2-button--primary", () => void this.signIn());
  }

  private async rate(id: string, value: number): Promise<void> {
    this.setStatus("Enviando puntuacion...");
    try {
      const listing = await this.workshop.rate(id, value);
      if (this.detailId === id) this.detail = listing;
      this.setStatus("Gracias por puntuar.");
      this.renderBody();
    } catch (error) {
      this.setStatus(messageOf(error, "Error al puntuar."));
    }
  }

  private async submitComment(id: string, body: string): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) {
      this.setStatus("El comentario esta vacio.");
      return;
    }
    this.setStatus("Publicando comentario...");
    try {
      const comment = await this.workshop.postComment(id, trimmed);
      if (this.detailId === id) this.comments = [comment, ...(this.comments ?? [])];
      this.setStatus("Comentario publicado.");
      this.renderBody();
    } catch (error) {
      this.setStatus(messageOf(error, "Error al comentar."));
    }
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

function cardGrid(): HTMLDivElement {
  const grid = document.createElement("div");
  grid.className = "hl2-cards";
  return grid;
}

function renderComment(comment: WorkshopComment): HTMLElement {
  const el = document.createElement("article");
  el.className = "hl2-comment";
  el.append(avatar(comment.author));

  const content = document.createElement("div");
  content.className = "hl2-comment__content";
  const head = document.createElement("div");
  head.className = "hl2-comment__head";
  const author = document.createElement("span");
  author.className = "hl2-comment__author";
  author.textContent = comment.author;
  const date = document.createElement("span");
  date.className = "hl2-comment__date";
  date.textContent = formatDate(comment.createdAt);
  head.append(author, date);
  const body = document.createElement("p");
  body.className = "hl2-comment__body";
  body.textContent = comment.body;
  content.append(head, body);

  el.append(content);
  return el;
}

function avatar(name: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "hl2-avatar";
  el.style.setProperty("--h", String(hueOf(name)));
  el.textContent = glyphFor(name);
  return el;
}

function stat(icon: string, value: string, suffix: string): HTMLSpanElement {
  const span = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = `${icon} ${value}`;
  span.append(strong);
  if (suffix) span.append(` ${suffix}`);
  return span;
}

function text(value: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

function hint(value: string): HTMLElement {
  const el = document.createElement("p");
  el.className = "hl2-detail__hint";
  el.textContent = value;
  return el;
}

function empty(value: string): HTMLElement {
  const el = document.createElement("p");
  el.className = "hl2-workshop__empty";
  el.textContent = value;
  return el;
}

function matchesQuery(listing: WorkshopListing, query: string): boolean {
  return (
    listing.title.toLowerCase().includes(query) ||
    listing.author.toLowerCase().includes(query) ||
    listing.tags.some((t) => t.toLowerCase().includes(query))
  );
}

function formatRating(listing: WorkshopListing): string {
  return listing.ratingCount > 0
    ? `${listing.rating.toFixed(1)} (${listing.ratingCount})`
    : "sin votos";
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Hue determinista 0..359 desde un seed (para banners/avatares variados). */
function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/** Inicial alfanumerica del titulo/nombre para el banner/avatar; fallback lambda. */
function glyphFor(value: string): string {
  const match = value.match(/[a-z0-9]/i);
  return match ? match[0].toUpperCase() : "λ";
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
