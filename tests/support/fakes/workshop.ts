import type { EditorDocument } from "@game/editor/EditorDocument";
import type { WorkshopBackend } from "@game/workshop/WorkshopBackend";
import type { WorkshopStore } from "@game/workshop/WorkshopStore";
import type {
  PublishMeta,
  WorkshopComment,
  WorkshopListing,
  WorkshopQuery,
  WorkshopUser,
} from "@game/workshop/WorkshopTypes";
import type { WorkshopSubscription } from "@game/workshop/workshopIndex";

export function testWorkshopListing(
  overrides: Partial<WorkshopListing> = {},
): WorkshopListing {
  return {
    id: "listing-1",
    slug: "listing-1",
    title: "Test Listing",
    description: "A map for tests",
    author: "Tester",
    revision: "rev-1",
    updatedAt: "2026-01-01T00:00:00.000Z",
    downloads: 0,
    rating: 0,
    ratingCount: 0,
    myRating: null,
    tags: ["test"],
    type: "map",
    ...overrides,
  };
}

export function testWorkshopUser(
  overrides: Partial<WorkshopUser> = {},
): WorkshopUser {
  return {
    id: "user-1",
    name: "Tester",
    ...overrides,
  };
}

export function testWorkshopComment(
  overrides: Partial<WorkshopComment> = {},
): WorkshopComment {
  return {
    id: "comment-1",
    author: "Tester",
    body: "Good map",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export interface FakeWorkshopBackend extends WorkshopBackend {
  calls: {
    list: WorkshopQuery[];
    fetchDocument: Array<{ id: string; revision?: string }>;
    publish: Array<{ document: unknown; meta: PublishMeta }>;
    rate: Array<{ id: string; value: number }>;
    postComment: Array<{ id: string; body: string }>;
    signIn: number;
    signOut: number;
  };
  documents: Map<string, unknown>;
  listings: WorkshopListing[];
  comments: Map<string, WorkshopComment[]>;
  user: WorkshopUser | null;
}

export function fakeWorkshopBackend(
  overrides: Partial<FakeWorkshopBackend> = {},
): FakeWorkshopBackend {
  const calls: FakeWorkshopBackend["calls"] = {
    list: [],
    fetchDocument: [],
    publish: [],
    rate: [],
    postComment: [],
    signIn: 0,
    signOut: 0,
  };
  const backend: FakeWorkshopBackend = {
    id: "fake",
    capabilities: { publish: true, auth: true },
    calls,
    documents: new Map(),
    listings: [testWorkshopListing()],
    comments: new Map(),
    user: null,
    async list(query?: WorkshopQuery) {
      calls.list.push(query ?? {});
      return this.listings;
    },
    async fetchListing(id: string) {
      const listing = this.listings.find((item) => item.id === id);
      if (!listing) throw new Error(`Missing listing ${id}`);
      return listing;
    },
    async fetchDocument(id: string, revision?: string) {
      calls.fetchDocument.push({ id, revision });
      return this.documents.get(id);
    },
    async publish(document: unknown, meta: PublishMeta) {
      calls.publish.push({ document, meta });
      const listing = testWorkshopListing({
        id: "published-1",
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
      });
      this.listings.push(listing);
      return listing;
    },
    async rate(id: string, value: number) {
      calls.rate.push({ id, value });
      return testWorkshopListing({ id, rating: value, myRating: value });
    },
    async listComments(id: string) {
      return this.comments.get(id) ?? [];
    },
    async postComment(id: string, body: string) {
      calls.postComment.push({ id, body });
      const comment = testWorkshopComment({ id: "comment-created", body });
      this.comments.set(id, [...(this.comments.get(id) ?? []), comment]);
      return comment;
    },
    async signIn() {
      calls.signIn += 1;
      this.user = testWorkshopUser();
      return this.user;
    },
    signOut() {
      calls.signOut += 1;
      this.user = null;
    },
    currentUser() {
      return this.user;
    },
    ...overrides,
  };

  return backend;
}

export interface FakeWorkshopStore {
  subscriptions: WorkshopSubscription[];
  documents: Map<string, EditorDocument>;
  subscribeCalls: Array<{ listing: WorkshopListing; document: EditorDocument }>;
  unsubscribeCalls: string[];
  enabledCalls: Array<{ id: string; enabled: boolean }>;
}

export function fakeWorkshopStore(
  state: Partial<FakeWorkshopStore> = {},
): WorkshopStore & { state: FakeWorkshopStore } {
  const storeState: FakeWorkshopStore = {
    subscriptions: [],
    documents: new Map(),
    subscribeCalls: [],
    unsubscribeCalls: [],
    enabledCalls: [],
    ...state,
  };

  return {
    state: storeState,
    async subscribe(listing: WorkshopListing, document: EditorDocument) {
      storeState.subscribeCalls.push({ listing, document });
      storeState.documents.set(listing.id, document);
      storeState.subscriptions = [
        ...storeState.subscriptions.filter((sub) => sub.id !== listing.id),
        {
          id: listing.id,
          title: listing.title,
          revision: listing.revision,
          enabled: true,
        },
      ];
    },
    async unsubscribe(id: string) {
      storeState.unsubscribeCalls.push(id);
      storeState.documents.delete(id);
      storeState.subscriptions = storeState.subscriptions.filter((sub) => sub.id !== id);
    },
    setEnabled(id: string, enabled: boolean) {
      storeState.enabledCalls.push({ id, enabled });
      const sub = storeState.subscriptions.find((entry) => entry.id === id);
      if (sub) sub.enabled = enabled;
    },
    isSubscribed(id: string) {
      return storeState.subscriptions.some((entry) => entry.id === id);
    },
    listIndex() {
      return storeState.subscriptions;
    },
    needsUpdate(listing: WorkshopListing) {
      const sub = storeState.subscriptions.find((entry) => entry.id === listing.id);
      return Boolean(sub && sub.revision !== listing.revision);
    },
    async getDocument(id: string) {
      return storeState.documents.get(id) ?? null;
    },
  } as unknown as WorkshopStore & { state: FakeWorkshopStore };
}
