import { beforeEach, describe, expect, it } from "vitest";
import {
  getWorkshopSubscription,
  listWorkshopIndex,
  removeWorkshopSubscription,
  setWorkshopEnabled,
  upsertWorkshopSubscription,
} from "@game/workshop/workshopIndex";
import { installMemoryStorage, testWorkshopListing } from "@tests/support/fakes";

describe("workshopIndex", () => {
  beforeEach(() => {
    installMemoryStorage("localStorage");
  });

  it("lists empty and ignores corrupt storage", () => {
    expect(listWorkshopIndex()).toEqual([]);

    localStorage.setItem("vibe.workshop.index", "{bad json");
    expect(listWorkshopIndex()).toEqual([]);

    localStorage.setItem(
      "vibe.workshop.index",
      JSON.stringify([{ id: "ok", title: "Ok", revision: "1", enabled: true }, { id: 1 }]),
    );
    expect(listWorkshopIndex()).toEqual([{ id: "ok", title: "Ok", revision: "1", enabled: true }]);
  });

  it("upserts subscriptions and preserves enabled state", () => {
    upsertWorkshopSubscription(testWorkshopListing({ id: "map-1", title: "Original", revision: "1" }));
    setWorkshopEnabled("map-1", false);
    upsertWorkshopSubscription(testWorkshopListing({ id: "map-1", title: "Updated", revision: "2" }));

    expect(getWorkshopSubscription("map-1")).toEqual({
      id: "map-1",
      title: "Updated",
      revision: "2",
      enabled: false,
    });
  });

  it("removes subscriptions and ignores enable for missing ids", () => {
    upsertWorkshopSubscription(testWorkshopListing({ id: "map-1" }));
    setWorkshopEnabled("missing", false);
    removeWorkshopSubscription("map-1");

    expect(getWorkshopSubscription("map-1")).toBeNull();
    expect(listWorkshopIndex()).toEqual([]);
  });
});
