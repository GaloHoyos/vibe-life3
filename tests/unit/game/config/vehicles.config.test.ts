import { describe, expect, it } from "vitest";
import {
  VEHICLE_ARCHETYPE_IDS,
  VEHICLE_PRESET_IDS,
  VehiclePresets,
  isVehiclePresetId,
  usesGroundNavigation,
} from "@game/config/vehicles.config";

describe("vehicles.config", () => {
  it("define un preset completo por id", () => {
    // Por conjunto y no por orden: la tabla agrupa los dos helicópteros juntos,
    // mientras que la lista de ids extiende la de arquetipos.
    expect(new Set(Object.keys(VehiclePresets))).toEqual(
      new Set(VEHICLE_PRESET_IDS),
    );

    for (const id of VEHICLE_PRESET_IDS) {
      const preset = VehiclePresets[id];
      expect(preset.id).toBe(id);
      expect(VEHICLE_ARCHETYPE_IDS).toContain(preset.archetype);
      expect(preset.body.mass).toBeGreaterThan(0);
      expect(preset.seats.length).toBeGreaterThan(0);
      expect(new Set(preset.seats.map((seat) => seat.id)).size).toBe(preset.seats.length);
      expect(preset.damageZones.some((zone) => zone.id === "hull")).toBe(true);
    }
  });

  it("comparte arquetipo entre los dos helicópteros pero no el motor", () => {
    const guided = VehiclePresets.helicopter;
    const free = VehiclePresets.helicopterFree;
    // El arquetipo decide modelo y cajas de daño: tienen que coincidir o el
    // pilotable se quedaría sin GLB propio.
    expect(free.archetype).toBe(guided.archetype);
    expect(guided.motor.kind).toBe("onRails");
    expect(free.motor.kind).toBe("rotorcraft");
    expect(usesGroundNavigation(free)).toBe(false);
    expect(usesGroundNavigation(guided)).toBe(false);
    expect(usesGroundNavigation(VehiclePresets.buggy)).toBe(true);
  });

  it("resuelve ids sin aceptar presets remotos arbitrarios", () => {
    expect(isVehiclePresetId("buggy")).toBe(true);
    expect(isVehiclePresetId("airboat")).toBe(true);
    expect(isVehiclePresetId("helicopter")).toBe(true);
    expect(isVehiclePresetId("rebelCrawler")).toBe(true);
    expect(isVehiclePresetId("combineGlider")).toBe(true);
    expect(isVehiclePresetId("helicopterFree")).toBe(true);
    expect(isVehiclePresetId("remote-glb")).toBe(false);
  });
});
