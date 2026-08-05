import { describe, expect, it } from 'vitest';
import type { LevelDefinition, VehicleWaypointDefinition } from '@game/levels/LevelDefinition';
import { resolveVehicleAccessPolicy } from '@game/levels/LevelDefinition';
import type { EntityConnection } from '@game/script/EntityIOTypes';
import { Demo2Ravenholm } from '@game/levels/maps/campaign/Demo2Ravenholm';
import { Demo3WhiteoutFlight } from '@game/levels/maps/campaign/Demo3WhiteoutFlight';
import { D3_ROAD } from '@game/levels/maps/campaign/Demo3WhiteoutPassGeometry';
import { VehicleSandboxLevel } from '@game/levels/maps/custom/VehicleSandboxLevel';
import { SnowFieldLevel } from '@game/levels/maps/custom/SnowFieldLevel';
import { getLevel } from '@game/levels/LevelRegistry';
import { vehicleNavigationInputFromLevel } from '@game/gameplay/vehicles/ai/VehicleNavigationLevelAdapter';
import { bakeVehicleNavigation } from '@game/gameplay/vehicles/ai/VehicleNavigationBake';
import { VehicleNavigationPlanner } from '@game/gameplay/vehicles/ai/VehicleNavigationPlanner';

function allConnections(level: LevelDefinition): EntityConnection[] {
  const authored = [
    ...level.doors,
    ...level.npcs,
    ...level.triggers,
    ...(level.logicEntities ?? []),
    ...(level.sequences ?? []),
    ...(level.vehicles ?? []),
    ...(level.vehicleWaypoints ?? []),
    ...(level.vehicleNavMarkers ?? []),
  ];
  return authored.flatMap((entity) => ('connections' in entity ? entity.connections ?? [] : []));
}

function routeIds(
  waypoints: readonly VehicleWaypointDefinition[],
  start: string,
  allowLoop: boolean,
): string[] {
  const byId = new Map(waypoints.map((waypoint) => [waypoint.id, waypoint] as const));
  const visited = new Set<string>();
  const ids: string[] = [];
  let current: string | undefined = start;
  while (current) {
    const waypoint = byId.get(current);
    expect(waypoint, `Falta el waypoint ${current}`).toBeDefined();
    if (!waypoint) break;
    if (visited.has(current)) {
      expect(allowLoop).toBe(true);
      break;
    }
    visited.add(current);
    ids.push(current);
    current = waypoint.next;
  }
  return ids;
}

describe('niveles vehiculares', () => {
  it('registra el sandbox y Demo 3 por sus ids estables', () => {
    expect(getLevel('vehicle-sandbox')).toBe(VehicleSandboxLevel);
    expect(getLevel('demo-03-whiteout-flight')).toBe(Demo3WhiteoutFlight);
  });

  it('encadena Demo 2 con Demo 3 sin alterar el id de campaña', () => {
    expect(Demo2Ravenholm.id).toBe('demo-02-ravenholm');
    expect(Demo2Ravenholm.nextLevel).toBe('demo-03-whiteout-flight');
    expect(Demo3WhiteoutFlight.nextLevel).toBe('snow-field');
  });

  it('ofrece siete vehículos con IA y once estacionados en el sandbox', () => {
    const vehicles = VehicleSandboxLevel.vehicles ?? [];
    expect(vehicles).toHaveLength(18);
    expect(vehicles.filter((vehicle) => vehicle.ai?.enabled)).toHaveLength(7);
    expect(vehicles.filter((vehicle) => !vehicle.ai?.enabled)).toHaveLength(11);
    expect(new Set(vehicles.map((vehicle) => vehicle.presetId))).toEqual(
      new Set([
        'buggy',
        'airboat',
        'helicopter',
        'helicopterFree',
        'rebelCrawler',
        'combineGlider',
        'combineSwimmer',
      ]),
    );
    expect(vehicles.every((vehicle) => vehicle.portalTraversal === 'blocked')).toBe(true);
  });

  it('trae el helicóptero pilotable sin ruta autorada', () => {
    const free = (VehicleSandboxLevel.vehicles ?? []).find(
      (vehicle) => vehicle.id === 'vs-free-helicopter',
    );
    // Un aparato de vuelo libre con pathStart sería una contradicción: no tiene
    // motor de riel que lo siga.
    expect(free?.presetId).toBe('helicopterFree');
    expect(free?.pathStart).toBeUndefined();
    expect(free?.accessPolicy).toBe('player');
  });

  it('el helicóptero de la IA ofrece tripulación sin autorarla', () => {
    const ai = (VehicleSandboxLevel.vehicles ?? []).find(
      (vehicle) => vehicle.id === 'vs-ai-combine-helicopter',
    );
    // Sin `crew`: los NPCs de la facción tienen que repartirse los puestos.
    expect(ai?.crew).toBeUndefined();
    expect(ai?.aiCrew?.roles).toEqual(['pilot', 'gunner']);
    expect(ai?.ai?.enabled).toBe(true);
  });

  it('declara las tres políticas de acceso en el sandbox', () => {
    const vehicles = VehicleSandboxLevel.vehicles ?? [];
    expect(vehicles.every((vehicle) => vehicle.accessPolicy !== undefined)).toBe(true);
    expect(vehicles.reduce<Record<string, number>>((counts, vehicle) => {
      const policy = resolveVehicleAccessPolicy(vehicle);
      counts[policy] = (counts[policy] ?? 0) + 1;
      return counts;
    }, {})).toEqual({
      player: 4,
      resistance: 7,
      combine: 7,
    });
    expect(vehicles.find((vehicle) => vehicle.id === 'vs-player-buggy')).toMatchObject({
      faction: 'resistance',
      accessPolicy: 'player',
    });
  });

  it('mantiene la política compatible de mapas anteriores según faction', () => {
    expect(resolveVehicleAccessPolicy({ faction: 'combine' })).toBe('combine');
    expect(resolveVehicleAccessPolicy({ faction: 'resistance' })).toBe('resistance');
    expect(resolveVehicleAccessPolicy({ faction: 'neutral' })).toBe('player');
    expect(resolveVehicleAccessPolicy({})).toBe('player');
    expect(resolveVehicleAccessPolicy({
      faction: 'combine',
      accessPolicy: 'player',
    })).toBe('player');
  });

  it('deja un buggy tripulado y quieto para revisar la pose sentada', () => {
    const buggy = VehicleSandboxLevel.vehicles?.find(
      (vehicle) => vehicle.id === 'vs-parked-crewed-buggy',
    );
    expect(buggy).toMatchObject({ presetId: 'buggy', engineOn: false });
    expect(buggy?.ai).toBeUndefined();
    const crew = buggy?.crew ?? [];
    expect(crew.map((assignment) => assignment.seatId)).toEqual([
      'driver',
      'gunner',
    ]);
    const npcIds = new Set((VehicleSandboxLevel.npcs ?? []).map((npc) => npc.id));
    crew.forEach((assignment) => {
      expect(npcIds.has(assignment.actor)).toBe(true);
    });
  });

  it('estaciona el deslizador Combine desarmado para pruebas', () => {
    expect(
      VehicleSandboxLevel.vehicles?.find(
        (vehicle) => vehicle.id === 'vs-player-combine-glider',
      ),
    ).toMatchObject({
      presetId: 'combineGlider',
      faction: 'combine',
      weaponEnabled: false,
      engineOn: false,
      transitionKey: 'sandbox-combine-glider',
    });
  });

  it('deja el transporte oruga desarmado y conducible después del accidente', () => {
    expect(SnowFieldLevel.vehicles).toEqual([
      expect.objectContaining({
        id: 'whiteout-rebel-crawler',
        presetId: 'rebelCrawler',
        faction: 'resistance',
        weaponEnabled: false,
        engineOn: false,
        transitionKey: 'campaign-rebel-crawler',
      }),
    ]);
  });

  it('incluye agua, costa y navegación híbrida para tráfico y convoy', () => {
    expect(VehicleSandboxLevel.waterVolumes).toHaveLength(1);
    expect(VehicleSandboxLevel.vehicleNavAreas?.some((area) => area.surface === 'ground')).toBe(true);
    expect(VehicleSandboxLevel.vehicleNavAreas?.some((area) => area.surface === 'water')).toBe(true);
    expect(VehicleSandboxLevel.vehicleNavAreas?.some((area) => area.surface === 'both')).toBe(true);
    expect(VehicleSandboxLevel.vehicleNavLanes?.length).toBeGreaterThanOrEqual(5);
    expect(VehicleSandboxLevel.vehicleNavMarkers?.some((marker) => marker.kind === 'passingBay')).toBe(true);
    expect(VehicleSandboxLevel.vehicleNavMarkers?.some((marker) => marker.kind === 'recovery')).toBe(true);
    expect(VehicleSandboxLevel.checkpoints).toHaveLength(4);
  });

  it('resuelve las seis rutas iniciales sin abandonar el grafo vehicular', () => {
    const input = vehicleNavigationInputFromLevel(VehicleSandboxLevel);
    expect(input.profiles.map((profile) => profile.id)).toEqual([
      'buggy',
      'airboat',
      'rebelCrawler',
      'combineGlider',
      'combineSwimmer',
    ]);
    const navigation = bakeVehicleNavigation(input);
    const planner = new VehicleNavigationPlanner(navigation, input.profiles);
    const routes = [
      {
        id: 'buggy-lead',
        profileId: 'buggy',
        start: [-105, 0, 62],
        startHeading: Math.PI,
        goal: [-24, 0, -64],
        goalHeading: Math.PI / 2,
      },
      {
        id: 'buggy-wing',
        profileId: 'buggy',
        start: [-105, 0, 74],
        startHeading: Math.PI,
        goal: [-105, 0, 62],
        goalHeading: Math.PI,
      },
      {
        id: 'buggy-hunter',
        profileId: 'buggy',
        start: [-78, 0, -72],
        startHeading: 0,
        goal: [-105, 0, 62],
        goalHeading: Math.PI,
      },
      {
        id: 'buggy-flank',
        profileId: 'buggy',
        start: [-38, 0, -72],
        startHeading: 0,
        goal: [-114.765, 0, 56.698],
        goalHeading: Math.atan2(-114.765 - -38, 56.698 - -72),
      },
      {
        id: 'airboat-resistance',
        profileId: 'airboat',
        start: [60, 0.7, 66],
        startHeading: Math.PI,
        goal: [60, 0.7, 88],
        goalHeading: Math.PI,
      },
      {
        id: 'airboat-combine',
        profileId: 'airboat',
        start: [60, 0.7, -64],
        startHeading: 0,
        goal: [60, 0.7, 66],
        goalHeading: Math.PI,
      },
    ] as const;

    for (const routeDefinition of routes) {
      const route = planner.plan(
        routeDefinition.profileId,
        {
          position: routeDefinition.start,
          heading: routeDefinition.startHeading,
        },
        {
          position: routeDefinition.goal,
          heading: routeDefinition.goalHeading,
        },
      );
      expect(route, routeDefinition.id).not.toBeNull();
      expect(route?.path.points.length ?? 0, routeDefinition.id).toBeGreaterThanOrEqual(2);
      // Contar puntos dejó de medir nada cuando el suavizado empezó a colapsar
      // los tramos rectos. Lo que sí sigue valiendo: ninguna ruta puede ser más
      // corta que la línea recta entre sus extremos.
      const straight = Math.hypot(
        routeDefinition.goal[0] - routeDefinition.start[0],
        routeDefinition.goal[2] - routeDefinition.start[2],
      );
      expect(
        polylineLength(route?.path.points ?? []),
        routeDefinition.id,
      ).toBeGreaterThanOrEqual(straight - 0.5);
      if (routeDefinition.id === 'buggy-flank') {
        expect(route?.laneRoute, routeDefinition.id).not.toBeNull();
      }
    }
    // Hornear el sandbox entero y resolver seis rutas es trabajo de integración:
    // el presupuesto por defecto no alcanza cuando la suite corre en paralelo.
  }, 30_000);

  it('autoriza el ciclo aéreo del sandbox y mantiene su ruta enlazada', () => {
    const helicopter = VehicleSandboxLevel.vehicles?.find(
      (vehicle) => vehicle.id === 'vs-player-helicopter',
    );
    expect(helicopter?.pathLoop).toBe(true);
    expect(helicopter?.allowPlayerExit).toBe(true);
    const ids = routeIds(
      VehicleSandboxLevel.vehicleWaypoints ?? [],
      helicopter?.pathStart ?? '',
      helicopter?.pathLoop === true,
    );
    expect(ids).toHaveLength(8);
  });

  it('expone Start, Stop, SetSpeed y Crash mediante entity I/O', () => {
    const inputs = new Set(allConnections(VehicleSandboxLevel).map((connection) => connection.input));
    expect(inputs.has('Start')).toBe(true);
    expect(inputs.has('Stop')).toBe(true);
    expect(inputs.has('SetSpeed')).toBe(true);
    expect(inputs.has('Crash')).toBe(true);
  });

  it('reparte los tres roles vehiculares de Demo 3 sin ninguna ruta autorada', () => {
    const vehicles = Demo3WhiteoutFlight.vehicles ?? [];
    expect(new Set(vehicles.map((vehicle) => vehicle.presetId))).toEqual(
      new Set(['buggy', 'helicopterFree', 'combineGlider']),
    );
    // El capítulo se rehizo sobre vuelo libre e IA: ya no queda nada sobre
    // rieles, así que ningún vehículo debería declarar trazado.
    expect(vehicles.every((vehicle) => vehicle.pathStart === undefined)).toBe(true);
    expect(Demo3WhiteoutFlight.vehicleWaypoints).toBeUndefined();

    expect(
      vehicles.filter((vehicle) => resolveVehicleAccessPolicy(vehicle) === 'player'),
    ).toHaveLength(2);
    expect(vehicles.filter((vehicle) => vehicle.ai?.enabled)).toHaveLength(4);
    expect(vehicles.every((vehicle) => vehicle.portalTraversal === 'blocked')).toBe(true);
  });

  it('deriva el carril del paso del mismo trazado que dibuja la calzada', () => {
    const lane = Demo3WhiteoutFlight.vehicleNavLanes?.find(
      (candidate) => candidate.id === 'd3-lane-pass',
    );
    expect(lane?.points).toEqual(D3_ROAD.map(([x, z]) => [x, 0, z]));
    expect(lane?.direction).toBe('both');

    const areas = Demo3WhiteoutFlight.vehicleNavAreas ?? [];
    expect(areas.some((area) => area.surface === 'ground')).toBe(true);
    expect(areas.some((area) => area.flags?.includes('parking'))).toBe(true);
    // Tres zonas de aterrizaje: el pad Combine, el patio del relé y la salida.
    expect(
      (Demo3WhiteoutFlight.vehicleNavMarkers ?? []).filter(
        (marker) => marker.kind === 'landingZone',
      ),
    ).toHaveLength(3);
  });
});

/** Largo de la polilínea en planta. */
function polylineLength(
  points: readonly { position: readonly [number, number, number] }[],
): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    total += Math.hypot(
      current.position[0] - previous.position[0],
      current.position[2] - previous.position[2],
    );
  }
  return total;
}
