import { describe, expect, it } from "vitest";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { WorkshopService } from "@game/workshop/WorkshopService";
import { recordEvents } from "@tests/support/events";
import { testEditorDocument } from "@tests/support/fixtures";
import {
  fakeWorkshopBackend,
  fakeWorkshopStore,
  testWorkshopListing,
} from "@tests/support/fakes";

describe("WorkshopService", () => {
  it("browses listings and emits loaded count", async () => {
    const bus = new EventBus<GameEventMap>();
    const events = recordEvents(bus, "workshop.list.loaded");
    const backend = fakeWorkshopBackend({
      listings: [testWorkshopListing({ id: "a" }), testWorkshopListing({ id: "b" })],
    });
    const service = new WorkshopService(backend, fakeWorkshopStore(), bus);

    const listings = await service.browse({ search: "sector" });

    expect(listings).toHaveLength(2);
    expect(backend.calls.list).toEqual([{ search: "sector" }]);
    expect(events).toEqual([{ count: 2 }]);
  });

  it("subscribes only sanitized documents and emits subscription events", async () => {
    const bus = new EventBus<GameEventMap>();
    const events = recordEvents(bus, "workshop.subscribed");
    const backend = fakeWorkshopBackend();
    const store = fakeWorkshopStore();
    const listing = testWorkshopListing({ id: "map-1", revision: "rev-2", title: "Sector" });
    const doc = testEditorDocument();
    backend.documents.set("map-1", doc);
    const service = new WorkshopService(backend, store, bus);

    await service.subscribe(listing);

    expect(backend.calls.fetchDocument).toEqual([{ id: "map-1", revision: "rev-2" }]);
    expect(store.state.subscribeCalls).toEqual([{ listing, document: doc }]);
    expect(events).toEqual([{ id: "map-1", title: "Sector" }]);
  });

  it("emits workshop errors and rejects invalid subscribe or publish payloads", async () => {
    const bus = new EventBus<GameEventMap>();
    const errors = recordEvents(bus, "workshop.error");
    const backend = fakeWorkshopBackend();
    backend.documents.set("bad", { nope: true });
    const service = new WorkshopService(backend, fakeWorkshopStore(), bus);

    await expect(service.subscribe(testWorkshopListing({ id: "bad" }))).rejects.toThrow();
    await expect(
      service.publish({ nope: true }, { title: "Bad", description: "", tags: [], type: "map" }),
    ).rejects.toThrow();

    expect(errors.map((event) => event.action)).toEqual(["subscribe", "publish"]);
    expect(backend.calls.publish).toEqual([]);
  });

  it("publishes sanitized documents and proxies local subscription state", async () => {
    const bus = new EventBus<GameEventMap>();
    const published = recordEvents(bus, "workshop.published");
    const enabled = recordEvents(bus, "workshop.enabled");
    const unsubscribed = recordEvents(bus, "workshop.unsubscribed");
    const backend = fakeWorkshopBackend();
    const store = fakeWorkshopStore({
      subscriptions: [{ id: "map-1", title: "Old", revision: "rev-1", enabled: true }],
    });
    const service = new WorkshopService(backend, store, bus);

    const listing = await service.publish(testEditorDocument(), {
      title: "Published",
      description: "Desc",
      tags: ["tag"],
      type: "map",
    });
    service.setEnabled("map-1", false);
    await service.unsubscribe("map-1");

    expect(listing.title).toBe("Published");
    expect(backend.calls.publish).toHaveLength(1);
    expect(published).toEqual([{ id: "published-1", title: "Published" }]);
    expect(enabled).toEqual([{ id: "map-1", enabled: false }]);
    expect(unsubscribed).toEqual([{ id: "map-1" }]);
    expect(store.state.enabledCalls).toEqual([{ id: "map-1", enabled: false }]);
    expect(store.state.unsubscribeCalls).toEqual(["map-1"]);
  });

  it("signs in before rating or commenting when needed", async () => {
    const bus = new EventBus<GameEventMap>();
    const rated = recordEvents(bus, "workshop.rated");
    const commented = recordEvents(bus, "workshop.commented");
    const backend = fakeWorkshopBackend();
    const service = new WorkshopService(backend, fakeWorkshopStore(), bus);

    const listing = await service.rate("map-1", 4);
    const comment = await service.postComment("map-1", "Nice");

    expect(backend.calls.signIn).toBe(1);
    expect(backend.calls.rate).toEqual([{ id: "map-1", value: 4 }]);
    expect(backend.calls.postComment).toEqual([{ id: "map-1", body: "Nice" }]);
    expect(listing.rating).toBe(4);
    expect(comment.body).toBe("Nice");
    expect(rated).toEqual([{ id: "map-1", rating: 4 }]);
    expect(commented).toEqual([{ id: "map-1" }]);
  });
});
