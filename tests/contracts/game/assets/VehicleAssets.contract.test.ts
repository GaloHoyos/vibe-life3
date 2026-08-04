import { describe, expect, it } from "vitest";

import manifest from "@game/assets/vehicles/manifest.json";
import validationReport from "@game/assets/vehicles/validation-report.json";

const BUDGETS = {
  buggy: { triangles: 75_000, draws: 18, bytes: 8 * 1024 * 1024 },
  airboat: { triangles: 80_000, draws: 18, bytes: 8 * 1024 * 1024 },
  helicopter: { triangles: 125_000, draws: 24, bytes: 14 * 1024 * 1024 },
  rebelCrawler: { triangles: 90_000, draws: 18, bytes: 9 * 1024 * 1024 },
  combineGlider: { triangles: 85_000, draws: 18, bytes: 9 * 1024 * 1024 },
  // El nadador tiene presupuesto propio de draws: cada apéndice que se anima
  // por su cuenta —remos, antenas, cola, mandíbula— es una malla aparte, y la
  // articulación es justamente lo que lo separa del resto del parque.
  combineSwimmer: { triangles: 85_000, draws: 26, bytes: 9 * 1024 * 1024 },
} as const;

const REQUIRED_COMMON_NODES = [
  "visual_lod0",
  "visual_lod1",
  "visual_lod2",
  "exit_left",
  "exit_right",
  "wreckage",
] as const;

describe("vehicle asset contracts", () => {
  it("keeps original procedural models inside their production budgets", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.generator).toBe("vibe-life3-procedural-vehicles");
    expect(manifest.coordinateSystem).toEqual({
      units: "meters",
      up: "+Y",
      physicalForward: "+Z",
      cameraLook: "-Z rotated toward +Z",
    });
    expect(manifest.vehicles.map((vehicle) => vehicle.id)).toEqual([
      "buggy",
      "airboat",
      "helicopter",
      "rebelCrawler",
      "combineGlider",
      "combineSwimmer",
    ]);

    for (const vehicle of manifest.vehicles) {
      expect(Object.hasOwn(BUDGETS, vehicle.id)).toBe(true);
      const budget = BUDGETS[vehicle.id as keyof typeof BUDGETS];
      expect(vehicle.glbBytes).toBeLessThanOrEqual(budget.bytes);
      expect(vehicle.lods).toHaveLength(3);
      expect(vehicle.lods[0]?.triangles).toBeLessThanOrEqual(budget.triangles);
      for (const lod of vehicle.lods) {
        expect(lod.draws).toBeLessThanOrEqual(budget.draws);
        expect(lod.triangles).toBeGreaterThan(0);
      }
      for (const nodeName of REQUIRED_COMMON_NODES) {
        expect(vehicle.nodeNames).toContain(nodeName);
      }
    }
  });

  it("keeps generated models clean according to Khronos validation", () => {
    expect(validationReport.validator).toBe("Khronos glTF Validator");
    expect(validationReport.deterministic).toBe(true);
    for (const vehicle of validationReport.vehicles) {
      expect(vehicle.khronos.errors).toBe(0);
      expect(vehicle.khronos.warnings).toBe(0);
      expect(vehicle.bytes).toBeLessThanOrEqual(vehicle.budgetBytes);
    }
  });

  it("keeps every required vehicle audio layer under the aggregate budget", () => {
    const audioPaths = manifest.audio.files.map((file) => file.path);
    for (const layer of [
      "engine",
      "transmission",
      "skid",
      "fan",
      "water",
      "rotor",
      "cabin",
      "alarm",
      "hover",
      "damage",
      "crash",
      // Voz del nadador: es un bicho, no un motor.
      "breath",
      "graft",
      "strain",
    ]) {
      expect(audioPaths.some((path) => path.includes(layer))).toBe(true);
    }
    expect(manifest.audio.totalBytes).toBeLessThanOrEqual(12 * 1024 * 1024);
    expect(validationReport.audio.bytes).toBe(manifest.audio.totalBytes);
  });
});
