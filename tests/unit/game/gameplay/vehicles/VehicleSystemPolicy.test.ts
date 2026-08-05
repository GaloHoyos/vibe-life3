import { describe, expect, it } from "vitest";
import {
  airNoLandingAreas,
  canCompleteVehicleObjectiveFromFoot,
  normalizeVehicleTargetId,
  vehicleTargetIdsMatch,
} from "@game/gameplay/vehicles/VehicleSystem";
import type { VehicleObjectiveKind } from "@game/gameplay/vehicles/ai";

describe("VehicleSystem objective policies", () => {
  it("normaliza el alias autorado del jugador para percepción e intel", () => {
    expect(normalizeVehicleTargetId("!player")).toBe("player");
    expect(normalizeVehicleTargetId("player")).toBe("player");
    expect(vehicleTargetIdsMatch("!player", "player")).toBe(true);
    expect(vehicleTargetIdsMatch("player", "combine-01")).toBe(false);
    expect(vehicleTargetIdsMatch("combine-01", "combine-01")).toBe(true);
  });

  it("sólo deja que una llegada a pie cierre objetivos finitos compatibles", () => {
    const compatible: readonly VehicleObjectiveKind[] = ["move", "retreat"];
    const persistent: readonly VehicleObjectiveKind[] = [
      "hold",
      "patrol",
      "escort",
      "transport",
      "intercept",
      "flank",
      "land",
      "extract",
    ];

    for (const kind of compatible) {
      expect(canCompleteVehicleObjectiveFromFoot(kind)).toBe(true);
    }
    for (const kind of persistent) {
      expect(canCompleteVehicleObjectiveFromFoot(kind)).toBe(false);
    }
  });
});

describe("exclusiones de aterrizaje", () => {
  it("prohibe posarse sobre el agua y sobre las areas marcadas noLanding", () => {
    const areas = airNoLandingAreas({
      waterVolumes: [
        { id: "canal", position: [10, -1, 4], size: [30, 4, 12] },
      ],
      vehicleNavAreas: [
        {
          id: "plaza",
          surface: "ground",
          polygon: [[-6, 0, -6], [6, 0, -6], [6, 0, 6], [-6, 0, 6]],
          tags: ["noLanding"],
        },
        {
          id: "calle",
          surface: "ground",
          polygon: [[20, 0, 20], [30, 0, 20], [30, 0, 30], [20, 0, 30]],
          tags: ["fast"],
        },
      ],
    });

    expect(areas.map((area) => area.id)).toEqual(["nav:plaza", "water:canal"]);
    // El lecho del canal es suelo firme: sin la exclusion, la sonda lo aceptaria.
    expect(areas[1]).toMatchObject({
      center: [10, -1, 4],
      halfExtents: [15, 2, 6],
    });
  });
});
