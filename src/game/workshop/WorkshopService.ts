import type { GameEventBus } from "@game/GameEvents";
import type { EditorDocument } from "@game/editor/EditorDocument";
import { sanitizeDocument } from "./sanitizeDocument";
import type { WorkshopBackend, WorkshopCapabilities } from "./WorkshopBackend";
import type { WorkshopStore } from "./WorkshopStore";
import type { WorkshopSubscription } from "./workshopIndex";
import type {
  PublishMeta,
  WorkshopListing,
  WorkshopQuery,
  WorkshopUser,
} from "./WorkshopTypes";

/**
 * Orquesta el Workshop: combina el backend remoto (catalogo + descarga +
 * publicacion) con el store local de suscripciones, y emite eventos
 * `workshop.*` para que la UI/otros sistemas reaccionen. No toca el DOM.
 */
export class WorkshopService {
  constructor(
    private readonly backend: WorkshopBackend,
    private readonly store: WorkshopStore,
    private readonly eventBus: GameEventBus,
  ) {}

  get capabilities(): WorkshopCapabilities {
    return this.backend.capabilities;
  }

  currentUser(): WorkshopUser | null {
    return this.backend.currentUser();
  }

  signIn(): Promise<WorkshopUser> {
    return this.backend.signIn();
  }

  signOut(): void {
    this.backend.signOut();
  }

  async browse(query?: WorkshopQuery): Promise<WorkshopListing[]> {
    const listings = await this.backend.list(query);
    this.eventBus.emit("workshop.list.loaded", { count: listings.length });
    return listings;
  }

  async subscribe(listing: WorkshopListing): Promise<void> {
    const raw = await this.backend.fetchDocument(listing.id, listing.revision);
    const result = sanitizeDocument(raw);
    if (!result.ok) {
      this.fail("subscribe", result.reason);
      throw new Error(result.reason);
    }
    await this.store.subscribe(listing, result.document);
    this.eventBus.emit("workshop.subscribed", { id: listing.id, title: listing.title });
  }

  /** Re-descarga el documento (la revision remota cambio) preservando `enabled`. */
  update(listing: WorkshopListing): Promise<void> {
    return this.subscribe(listing);
  }

  setEnabled(id: string, enabled: boolean): void {
    this.store.setEnabled(id, enabled);
    this.eventBus.emit("workshop.enabled", { id, enabled });
  }

  async unsubscribe(id: string): Promise<void> {
    await this.store.unsubscribe(id);
    this.eventBus.emit("workshop.unsubscribed", { id });
  }

  listSubscriptions(): WorkshopSubscription[] {
    return this.store.listIndex();
  }

  isSubscribed(id: string): boolean {
    return this.store.isSubscribed(id);
  }

  needsUpdate(listing: WorkshopListing): boolean {
    return this.store.needsUpdate(listing);
  }

  getDocument(id: string): Promise<EditorDocument | null> {
    return this.store.getDocument(id);
  }

  async publish(document: unknown, meta: PublishMeta): Promise<WorkshopListing> {
    const result = sanitizeDocument(document);
    if (!result.ok) {
      this.fail("publish", result.reason);
      throw new Error(result.reason);
    }
    const listing = await this.backend.publish(result.document, meta);
    this.eventBus.emit("workshop.published", { id: listing.id, title: listing.title });
    return listing;
  }

  private fail(action: string, message: string): void {
    this.eventBus.emit("workshop.error", { action, message });
  }
}
