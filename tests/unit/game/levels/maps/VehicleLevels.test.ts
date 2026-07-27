import { describe, expect, it } from 'vitest';
import type { LevelDefinition, VehicleWaypointDefinition } from '@game/levels/LevelDefinition';
import type { EntityConnection } from '@game/script/EntityIOTypes';
import { Demo2Ravenholm } from '@game/levels/maps/campaign/Demo2Ravenholm';
import { Demo3WhiteoutFlight } from '@game/levels/maps/campaign/Demo3WhiteoutFlight';
import { VehicleSandboxLevel } from '@game/levels/maps/custom/VehicleSandboxLevel';
import { getLevel } from '@game/levels/LevelRegistry';

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

  it('ofrece seis vehículos con IA y seis estacionados en el sandbox', () => {
    const vehicles = VehicleSandboxLevel.vehicles ?? [];
    expect(vehicles).toHaveLength(12);
    expect(vehicles.filter((vehicle) => vehicle.ai?.enabled)).toHaveLength(6);
    expect(vehicles.filter((vehicle) => !vehicle.ai?.enabled)).toHaveLength(6);
    expect(new Set(vehicles.map((vehicle) => vehicle.presetId))).toEqual(
      new Set(['buggy', 'airboat', 'helicopter']),
    );
    expect(vehicles.every((vehicle) => vehicle.portalTraversal === 'blocked')).toBe(true);
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

  it('autoriza el ciclo aéreo del sandbox y mantiene su ruta enlazada', () => {
    const helicopter = VehicleSandboxLevel.vehicles?.find(
      (vehicle) => vehicle.id === 'vs-player-helicopter',
    );
    expect(helicopter?.pathLoop).toBe(true);
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
