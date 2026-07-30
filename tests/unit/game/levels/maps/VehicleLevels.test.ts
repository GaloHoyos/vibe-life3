import { describe, expect, it } from 'vitest';
import type { LevelDefinition, VehicleWaypointDefinition } from '@game/levels/LevelDefinition';
import { resolveVehicleAccessPolicy } from '@game/levels/LevelDefinition';
import type { EntityConnection } from '@game/script/EntityIOTypes';
import { Demo2Ravenholm } from '@game/levels/maps/campaign/Demo2Ravenholm';
import { Demo3WhiteoutFlight } from '@game/levels/maps/campaign/Demo3WhiteoutFlight';
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

  it('ofrece seis vehículos con IA y nueve estacionados en el sandbox', () => {
    const vehicles = VehicleSandboxLevel.vehicles ?? [];
    expect(vehicles).toHaveLength(15);
    expect(vehicles.filter((vehicle) => vehicle.ai?.enabled)).toHaveLength(6);
    expect(vehicles.filter((vehicle) => !vehicle.ai?.enabled)).toHaveLength(9);
    expect(new Set(vehicles.map((vehicle) => vehicle.presetId))).toEqual(
      new Set(['buggy', 'airboat', 'helicopter', 'rebelCrawler', 'combineGlider']),
    );
    expect(vehicles.every((vehicle) => vehicle.portalTraversal === 'blocked')).toBe(true);
  });

  it('declara las tres políticas de acceso en el sandbox', () => {
    const vehicles = VehicleSandboxLevel.vehicles ?? [];
    expect(vehicles.every((vehicle) => vehicle.accessPolicy !== undefined)).toBe(true);
    expect(vehicles.reduce<Record<string, number>>((counts, vehicle) => {
      const policy = resolveVehicleAccessPolicy(vehicle);
      counts[policy] = (counts[policy] ?? 0) + 1;
      return counts;
    }, {})).toEqual({
      player: 3,
      resistance: 7,
      combine: 5,
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
      expect(route?.path.points.length, routeDefinition.id).toBeGreaterThan(4);
      if (routeDefinition.id === 'buggy-flank') {
        expect(route?.laneRoute, routeDefinition.id).not.toBeNull();
      }
    }
  });

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

  it('monta a Gordon y Alyx, degrada el vuelo y termina en un choque sobrevivible', () => {
    const helicopter = Demo3WhiteoutFlight.vehicles?.[0];
    expect(helicopter).toMatchObject({
      id: 'd3-resistance-helicopter',
      presetId: 'helicopter',
      crashPolicy: 'survivable',
      weaponEnabled: true,
    });
    expect(helicopter?.crew).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: '!player', role: 'gunner', seatId: 'door-gunner' }),
      expect.objectContaining({ actor: 'd3-alyx', role: 'passenger', seatId: 'passenger' }),
      expect.objectContaining({ actor: 'd3-pilot', role: 'pilot', seatId: 'pilot' }),
    ]));

    const connections = allConnections(Demo3WhiteoutFlight);
    expect(connections.some((connection) => connection.input === 'SetSpeed' && connection.param === 14)).toBe(true);
    expect(connections.some((connection) => connection.input === 'SetSpeed' && connection.param === 8)).toBe(true);
    expect(connections.some((connection) => connection.input === 'Crash' && connection.delay === 4)).toBe(true);
    expect(Demo3WhiteoutFlight.checkpoints).toHaveLength(3);
  });

  it('mantiene separadas y completas las rutas normal y de choque de Demo 3', () => {
    const helicopter = Demo3WhiteoutFlight.vehicles?.[0];
    const waypoints = Demo3WhiteoutFlight.vehicleWaypoints ?? [];
    const flight = routeIds(waypoints, helicopter?.pathStart ?? '', false);
    const crash = routeIds(waypoints, helicopter?.crashPathStart ?? '', false);

    expect(flight).toHaveLength(6);
    expect(crash).toHaveLength(4);
    expect(flight.some((id) => crash.includes(id))).toBe(false);
    expect(crash[crash.length - 1]).toBe('d3-crash-04');
  });
});
