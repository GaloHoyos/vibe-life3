import { describe, expect, it } from "vitest";
import type { NpcPreset } from "@game/npc/presets/NpcPreset";
import { buildAlyxPreset } from "@game/npc/presets/alyxPreset";
import { buildBlobPreset } from "@game/npc/presets/blobPreset";
import { buildCombinePreset } from "@game/npc/presets/combinePreset";
import { buildGunshipPreset } from "@game/npc/presets/gunshipPreset";
import { buildHeadcrabPreset } from "@game/npc/presets/headcrabPreset";
import { buildManhackPreset } from "@game/npc/presets/manhackPreset";
import { buildPassivePreset } from "@game/npc/presets/passivePreset";
import { buildRebelPreset } from "@game/npc/presets/rebelPreset";
import { buildStriderPreset } from "@game/npc/presets/striderPreset";
import { buildTurretPreset } from "@game/npc/presets/turretPreset";
import { buildZombiePreset } from "@game/npc/presets/zombiePreset";

const builders: Array<[string, () => NpcPreset]> = [
  ["alyx", () => buildAlyxPreset()],
  ["blob", () => buildBlobPreset()],
  ["combine", () => buildCombinePreset()],
  ["combine+patrol", () => buildCombinePreset({ hasPatrol: true })],
  ["gunship", () => buildGunshipPreset()],
  ["gunship+patrol", () => buildGunshipPreset({ hasPatrol: true })],
  ["headcrab", () => buildHeadcrabPreset()],
  ["manhack", () => buildManhackPreset()],
  ["passive", () => buildPassivePreset()],
  ["rebel", () => buildRebelPreset()],
  ["rebelMedic", () => buildRebelPreset({ medic: true })],
  ["strider", () => buildStriderPreset()],
  ["strider+patrol", () => buildStriderPreset({ hasPatrol: true })],
  ["turret", () => buildTurretPreset()],
  ["zombie", () => buildZombiePreset()],
];

describe("preset invariants", () => {
  it.each(builders)("%s: schedules con ids unicos, prioridades validas y tasks", (_name, build) => {
    const preset = build();
    expect(preset.schedules.length).toBeGreaterThan(0);

    const ids = new Set<string>();
    for (const schedule of preset.schedules) {
      expect(ids.has(schedule.id)).toBe(false);
      ids.add(schedule.id);
      expect(schedule.priority).toBeGreaterThan(0);
      expect(schedule.tasks.length).toBeGreaterThan(0);
    }
    // Todo preset necesita el schedule terminal de muerte y un fallback sin condiciones.
    expect(ids.has("dead")).toBe(true);
    expect(ids.has("idle")).toBe(true);
  });

  it.each(builders)("%s: stats de movimiento y percepcion sanos", (_name, build) => {
    const preset = build();
    expect(preset.maxHealth).toBeGreaterThan(0);
    expect(preset.radius).toBeGreaterThan(0);
    expect(preset.perception.visionRange).toBeGreaterThan(0);
    expect(preset.perception.visionConeRadians).toBeGreaterThan(0);
    expect(preset.movement.walkSpeed).toBeGreaterThan(0);
    // `applyGait` divide sprint/walk: sprint no puede ser menor que walk.
    expect(preset.movement.sprintSpeed).toBeGreaterThanOrEqual(preset.movement.walkSpeed);
  });
});
