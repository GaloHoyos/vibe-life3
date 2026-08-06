import { describe, expect, it } from 'vitest';
import type { LevelDefinition } from '@game/levels/LevelDefinition';
import { getLevel } from '@game/levels/LevelRegistry';
import { VehicleLabChase } from '@game/levels/maps/custom/VehicleLabChase';
import { VehicleLabDismount } from '@game/levels/maps/custom/VehicleLabDismount';
import { VehicleLabExtraction } from '@game/levels/maps/custom/VehicleLabExtraction';
import { VehicleLabTerrain } from '@game/levels/maps/custom/VehicleLabTerrain';
import { bakeVehicleNavigation } from '@game/gameplay/vehicles/ai/VehicleNavigationBake';
import { vehicleNavigationInputFromLevel } from '@game/gameplay/vehicles/ai/VehicleNavigationLevelAdapter';
import { vehicleNavCells } from '@game/gameplay/vehicles/ai/VehicleNavGridIndex';
import { VehicleNavigationPlanner } from '@game/gameplay/vehicles/ai/VehicleNavigationPlanner';
import { usesGroundNavigation, VehiclePresets } from '@game/config/vehicles.config';

const LABS = [
  VehicleLabChase,
  VehicleLabDismount,
  VehicleLabExtraction,
  VehicleLabTerrain,
] as const;

function bake(level: LevelDefinition): {
  cells: ReturnType<typeof vehicleNavCells>;
  planner: VehicleNavigationPlanner;
} {
  const input = vehicleNavigationInputFromLevel(level);
  const navigation = bakeVehicleNavigation(input);
  const grid = navigation.grids.find((entry) => entry.profileId === 'buggy');
  return {
    cells: grid ? vehicleNavCells(grid) : [],
    planner: new VehicleNavigationPlanner(navigation, input.profiles),
  };
}

/** Celda cuyo centro cae dentro del rectángulo, o `undefined`. */
function cellIn(
  cells: ReturnType<typeof vehicleNavCells>,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): (typeof cells)[number] | undefined {
  return cells.find(
    (cell) =>
      cell.position[0] >= minX &&
      cell.position[0] <= maxX &&
      cell.position[2] >= minZ &&
      cell.position[2] <= maxZ,
  );
}

describe('laboratorios vehiculares', () => {
  it('quedan registrados y con ids estables', () => {
    for (const lab of LABS) {
      expect(getLevel(lab.id), lab.id).toBe(lab);
      expect(lab.id.startsWith('vehicle-lab-'), lab.id).toBe(true);
    }
    expect(new Set(LABS.map((lab) => lab.id)).size).toBe(LABS.length);
  });

  it('nombran actores de tripulación que existen como NPCs', () => {
    for (const lab of LABS) {
      const npcs = new Set((lab.npcs ?? []).map((npc) => npc.id));
      for (const vehicle of lab.vehicles ?? []) {
        for (const assignment of vehicle.crew ?? []) {
          expect(npcs.has(assignment.actor), `${lab.id}/${assignment.actor}`).toBe(true);
        }
      }
    }
  });

  it('coloca cada vehículo terrestre sobre terreno manejable', () => {
    // Es lo que un mapa hecho a ojo se equivoca: un vehículo fuera del grid no
    // planifica nunca y parece un bug de la IA.
    for (const lab of LABS) {
      const { planner } = bake(lab);
      for (const vehicle of lab.vehicles ?? []) {
        if (!usesGroundNavigation(VehiclePresets[vehicle.presetId])) continue;
        const at = vehicle.position;
        expect(
          planner.isReachable(vehicle.presetId, at, at),
          `${lab.id}/${vehicle.id}`,
        ).toBe(true);
      }
    }
  });

  it('deja a los perseguidores del Lab 1 con ruta hasta la largada', () => {
    const { planner } = bake(VehicleLabChase);
    const start = VehicleLabChase.playerStart;
    for (const vehicle of VehicleLabChase.vehicles ?? []) {
      expect(
        planner.travelDistance('buggy', vehicle.position, start),
        vehicle.id,
      ).not.toBeNull();
    }
  });

  it('permite que Overwatch reemplace la meta del Lab 1 y luego devuelva autonomía', () => {
    const order = VehicleLabChase.triggers.find(
      (trigger) => trigger.id === 'chase-overwatch-order',
    );
    const release = VehicleLabChase.triggers.find(
      (trigger) => trigger.id === 'chase-overwatch-release',
    );
    const cutoff = VehicleLabChase.vehicleWaypoints?.find(
      (waypoint) => waypoint.id === 'chase-overwatch-cutoff',
    );

    expect(cutoff).toBeDefined();
    expect(order?.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        target: 'chase-buggy-a',
        input: 'SetGoal',
        param: 'chase-overwatch-cutoff',
      }),
      expect.objectContaining({
        target: 'chase-buggy-b',
        input: 'SetGoal',
        param: 'chase-overwatch-cutoff',
      }),
    ]));
    expect(release?.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'chase-buggy-a', input: 'ClearGoal' }),
      expect.objectContaining({ target: 'chase-buggy-b', input: 'ClearGoal' }),
    ]));
  });

  it('deja el interior de los refugios del Lab 2 fuera del grid vehicular', () => {
    const { planner, cells } = bake(VehicleLabDismount);
    const outside = VehicleLabDismount.vehicles?.[0]?.position;
    expect(outside).toBeDefined();
    if (!outside) return;

    // El vano mide 1,3 m y el buggy no entra: el interior no es alcanzable.
    for (const center of [[-34, 0], [0, 22], [36, -6]] as const) {
      expect(
        planner.isReachable('buggy', outside, [center[0], 0, center[1]]),
        `refugio ${center[0]},${center[1]}`,
      ).toBe(false);
    }
    // Y afuera sí hay grid, o el test anterior pasaría por vacío.
    expect(cells.length).toBeGreaterThan(500);
  });

  it('arma el Lab 2 para driver desmontado y artillero en apoyo', () => {
    const armedBuggy = VehicleLabDismount.vehicles?.find(
      (vehicle) => vehicle.id === 'dismount-hunter-full',
    );
    expect(armedBuggy?.crew).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: 'dismount-full-driver', role: 'driver' }),
      expect.objectContaining({ actor: 'dismount-full-gunner', role: 'gunner' }),
    ]));
    expect(armedBuggy?.ai?.behavior).toBe('intercept');
  });

  it('resuelve las cinco estaciones del Lab 4 como dicen sus comentarios', () => {
    const { cells } = bake(VehicleLabTerrain);

    // 1. La losa fina se maneja por arriba, no por el suelo de abajo.
    const onSlab = cellIn(cells, -46, -44, -2, 2);
    expect(onSlab?.position[1]).toBeCloseTo(0.2, 1);

    // 2. Debajo del tablero no hay gálibo.
    expect(cellIn(cells, -15, -13, -2, 2)).toBeUndefined();
    // Pero se lo puede rodear por fuera de los pilares.
    expect(cellIn(cells, -15, -13, 14, 20)).toBeDefined();

    // 3. La cara superior del bloque quedó descartada: es una isla.
    expect(cells.some((cell) => cell.position[1] > 2)).toBe(false);

    // 4. El área vedada recorta, aunque el suelo esté despejado.
    expect(cellIn(cells, 46, 62, -8, 8)).toBeUndefined();
    expect(cellIn(cells, 68, 74, -8, 8)).toBeDefined();

    // 5. El pasillo entra: el buggy tiene por dónde meterse.
    expect(cellIn(cells, 87, 89, 6, 12)).toBeDefined();

    // Dynamic blockers belong to runtime sensing, never to the baked grid.
    expect(VehicleLabTerrain.dynamicBoxes?.map((box) => box.id)).toEqual([
      'lab-dynamic-blocker-a',
      'lab-dynamic-blocker-b',
    ]);
  });

  it('arma el Lab 3 con pickup y retorno sistémicos', () => {
    const transport = VehicleLabExtraction.vehicles?.find(
      (vehicle) => vehicle.id === 'extraction-transport',
    );
    expect(transport?.presetId).toBe('helicopterFree');
    expect(transport?.ai).toMatchObject({
      enabled: true,
      behavior: 'transport',
      goal: 'extraction-return-point',
    });
    // Sin `crew` autorada: el puesto de piloto lo cubre la facción.
    expect(transport?.crew).toBeUndefined();

    const zones = (VehicleLabExtraction.vehicleNavMarkers ?? []).filter(
      (marker) => marker.kind === 'landingZone',
    );
    expect(zones).toHaveLength(1);
    expect(zones[0]?.id).toBe('extraction-preferred-lz');
    expect(zones[0]?.allowedPresets).toContain('helicopterFree');

    const points = new Map(
      (VehicleLabExtraction.logicEntities ?? [])
        .filter((entity) => entity.kind === 'marker')
        .map((marker) => [marker.id, marker.position] as const),
    );
    expect(points.get('extraction-pickup-point')).toEqual([10, 0, -12]);
    expect(points.get('extraction-return-point')).toEqual([48, 0, 48]);

    const pickup = points.get('extraction-pickup-point');
    const preferred = zones[0]?.position;
    expect(pickup).toBeDefined();
    expect(preferred).toBeDefined();
    if (pickup && preferred) {
      expect(Math.hypot(pickup[0] - preferred[0], pickup[2] - preferred[2]))
        .toBeGreaterThan(35);
    }

    // El buggy que hay que destruir lleva tripulación: sin ella no hay a quién
    // recoger y el laboratorio no demuestra nada.
    const target = VehicleLabExtraction.vehicles?.find(
      (vehicle) => vehicle.id === 'extraction-target-buggy',
    );
    expect(target?.crew).toHaveLength(2);
  });
});
