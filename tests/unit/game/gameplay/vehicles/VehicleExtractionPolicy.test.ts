import { describe, expect, it } from "vitest";
import {
  hasExtractionResourceWaitExpired,
  recordExtractionActorFailure,
  VEHICLE_EXTRACTION_RESOURCE_WAIT_SECONDS,
} from "@game/gameplay/vehicles/VehicleExtractionPolicy";

describe("VehicleExtractionPolicy", () => {
  it("deja una ventana para que se libere un transporte", () => {
    expect(hasExtractionResourceWaitExpired(10, 10)).toBe(false);
    expect(
      hasExtractionResourceWaitExpired(
        10,
        10 + VEHICLE_EXTRACTION_RESOURCE_WAIT_SECONDS - 0.01,
      ),
    ).toBe(false);
    expect(
      hasExtractionResourceWaitExpired(
        10,
        10 + VEHICLE_EXTRACTION_RESOURCE_WAIT_SECONDS,
      ),
    ).toBe(true);
  });

  it("registra cada fallo individual una sola vez", () => {
    const failedActorIds = new Set(["restored"]);

    expect(recordExtractionActorFailure(failedActorIds, "restored")).toBe(false);
    expect(recordExtractionActorFailure(failedActorIds, "alyx")).toBe(true);
    expect(recordExtractionActorFailure(failedActorIds, "alyx")).toBe(false);
    expect([...failedActorIds]).toEqual(["restored", "alyx"]);
  });
});
