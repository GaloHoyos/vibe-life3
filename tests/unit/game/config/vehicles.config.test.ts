import { describe, expect, it } from "vitest";
import {
  VEHICLE_ARCHETYPE_IDS,
  VehiclePresets,
  isVehiclePresetId,
} from "@game/config/vehicles.config";

describe("vehicles.config", () => {
  it("define un preset completo por arquetipo", () => {
    expect(Object.keys(VehiclePresets)).toEqual(VEHICLE_ARCHETYPE_IDS);

    for (const id of VEHICLE_ARCHETYPE_IDS) {
      const preset = VehiclePresets[id];
      expect(preset.id).toBe(id);
      expect(preset.archetype).toBe(id);
      expect(preset.body.mass).toBeGreaterThan(0);
      expect(preset.seats.length).toBeGreaterThan(0);
      expect(new Set(preset.seats.map((seat) => seat.id)).size).toBe(preset.seats.length);
      expect(preset.damageZones.some((zone) => zone.id === "hull")).toBe(true);
    }
  });

  it("resuelve ids sin aceptar presets remotos arbitrarios", () => {
    expect(isVehiclePresetId("buggy")).toBe(true);
    expect(isVehiclePresetId("airboat")).toBe(true);
    expect(isVehiclePresetId("helicopter")).toBe(true);
    expect(isVehiclePresetId("remote-glb")).toBe(false);
  });
});
