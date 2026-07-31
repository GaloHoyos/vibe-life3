import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildNavigationGeometry } from '@engine/ai/navigation/NavigationGeometry';
import { NavigationService } from '@engine/ai/navigation/NavigationService';
import { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { Raycast } from '@engine/physics/Raycast';
import { quatFromEuler } from '@game/levels/builders/transform';
import { Demo3WhiteoutFlight } from '@game/levels/maps/campaign/Demo3WhiteoutFlight';
import { NavigationProfiles } from '@game/npc/navigation/NavAgentProfiles';
import { tupleToVector3 } from '@shared/math/VectorTuple';
import { vehicleNavigationInputFromLevel } from '@game/gameplay/vehicles/ai/VehicleNavigationLevelAdapter';
import { bakeVehicleNavigation } from '@game/gameplay/vehicles/ai/VehicleNavigationBake';
import { VehicleNavigationPlanner } from '@game/gameplay/vehicles/ai/VehicleNavigationPlanner';

type RouteLeg = readonly [
  name: string,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
];

/**
 * Cada tramo vive de un solo lado de una puerta de progresión: la barrera del
 * paso y el portón del depósito son obstáculos dinámicos, así que no se usan
 * como extremos. Lo que se afirma es que el corredor a pie existe.
 */
const CRITICAL_ROUTE: readonly RouteLeg[] = [
  ['boca del paso al cuenco', [-46, 1.2, 138], [-6, 1.2, 100]],
  ['cuenco al hueco del oeste', [-6, 1.2, 100], [-80, 1.2, 50]],
  ['hueco del oeste a la playa del depósito', [-80, 1.2, 50], [-46, 1.2, 24]],
  ['playa del depósito a la calzada', [-46, 1.2, 24], [-6, 1.2, 24]],
  ['calzada al puesto del control', [-6, 1.2, 24], [70, 1.2, -8]],
  ['estrechamiento al pad Combine', [90, 1.2, -36], [64, 1.2, -40]],
  ['pad Combine al portón del relé', [64, 1.2, -40], [56, 1.2, -84]],
  ['portón del relé al patio', [56, 1.2, -84], [40, 1.2, -104]],
  ['brecha del este al patio', [78, 1.2, -96], [40, 1.2, -104]],
  ['patio a la plataforma de extracción', [40, 1.2, -104], [-60, 1.2, -140]],
] as const;

/** Puestos que la IA tiene que poder ocupar caminando, no sólo de pie. */
const REACHABLE_POSTS: ReadonlyArray<readonly [string, readonly [number, number, number]]> = [
  ['plataforma de la torre del control', [-30, 4.5, 92]],
  ['pasarela alta del depósito', [-70, 5.6, 8]],
  ['techo de la torre del relé', [30, 8.2, -122]],
] as const;

describe('navegación de Demo 3', () => {
  const physics = new PhysicsWorld();
  let navigation: NavigationService;

  beforeAll(async () => {
    const boxes = [
      ...Demo3WhiteoutFlight.staticBoxes,
      ...(Demo3WhiteoutFlight.buildings ?? []).flatMap((building) => building.boxes),
    ];
    await physics.init();
    physics.createStaticBoxes(
      boxes.map((box) => ({
        id: box.id,
        position: tupleToVector3(box.position),
        size: tupleToVector3(box.size),
        rotation: box.rotation ? quatFromEuler(box.rotation) : undefined,
      })),
    );
    physics.updateQueryPipeline();
    navigation = await NavigationService.create({
      geometry: buildNavigationGeometry(boxes),
      groundProfiles: [NavigationProfiles.humanoid],
      raycast: new Raycast(physics),
      physics,
    });
  }, 60_000);

  afterAll(() => {
    navigation.dispose();
    physics.reset();
  });

  it.each(CRITICAL_ROUTE)('%s tiene corredor completo a pie', (_name, fromTuple, toTuple) => {
    const from = navigation.projectPoint(new Vector3(...fromTuple), NavigationProfiles.humanoid);
    const to = navigation.projectPoint(new Vector3(...toTuple), NavigationProfiles.humanoid);

    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    const path = navigation.requestPath(NavigationProfiles.humanoid, from!, to!);
    expect(path).not.toBeNull();
    expect(path?.partial).toBe(false);
    expect(path?.points.length).toBeGreaterThan(0);
  });

  it('no deja ningún NPC ni vehículo spawneado dentro de la geometría', () => {
    const spawned = (Demo3WhiteoutFlight.logicEntities ?? []).flatMap((entity) =>
      entity.kind === 'npcSpawner' ? entity.npcs : [],
    );
    const placements = [
      // Los manhacks vuelan: estar por encima del navmesh es su estado normal.
      ...[...Demo3WhiteoutFlight.npcs, ...spawned]
        .filter((npc) => npc.characterId !== 'manhack')
        .map((npc) => ({ id: npc.id, position: npc.position })),
      ...(Demo3WhiteoutFlight.vehicles ?? []).map((vehicle) => ({
        id: vehicle.id,
        position: vehicle.position,
      })),
    ];

    // Un actor metido en una ladera proyecta lejos —al techo de la roca o al
    // suelo del otro lado— y se queda clavado sin ruta. Es el modo de fallo
    // más caro de autoría: no rompe nada, sólo apaga a un enemigo.
    const buried = placements
      .map((placement) => {
        const wanted = new Vector3(...placement.position);
        const projected = navigation.projectPoint(wanted, NavigationProfiles.humanoid);
        if (!projected) return `${placement.id}: sin navmesh cerca`;
        const drift = Math.hypot(projected.x - wanted.x, projected.z - wanted.z);
        const lift = Math.abs(projected.y - wanted.y);
        return drift > 2 || lift > 2.5
          ? `${placement.id}: proyecta a ${drift.toFixed(1)} m / ${lift.toFixed(1)} m de altura`
          : null;
      })
      .filter((entry): entry is string => entry !== null);

    expect(buried).toEqual([]);
  });

  it.each(REACHABLE_POSTS)('%s se alcanza caminando desde el patio', (_name, postTuple) => {
    const post = navigation.projectPoint(new Vector3(...postTuple), NavigationProfiles.humanoid);
    expect(post).not.toBeNull();
    // Proyectar cerca de la cota autorada: si el navmesh sólo cubre el piso, el
    // punto proyectado cae metros más abajo y el puesto alto es decorativo.
    expect(Math.abs((post?.y ?? 0) - postTuple[1])).toBeLessThan(1.5);
  });

  describe('grafo vehicular', () => {
    // El bake de la grilla vehicular sobre un valle de 340 × 320 no es barato:
    // se arma una sola vez para todas las rutas.
    let planner: VehicleNavigationPlanner;

    beforeAll(() => {
      const input = vehicleNavigationInputFromLevel(Demo3WhiteoutFlight);
      planner = new VehicleNavigationPlanner(bakeVehicleNavigation(input), input.profiles);
    }, 60_000);

    it('deja la ruta del paso planificable de punta a punta para el buggy', () => {
      const route = planner.plan(
        'buggy',
        { position: [-40, 0, 16], heading: Math.PI / 2 },
        { position: [56, 0, -80], heading: Math.PI },
      );

      expect(route).not.toBeNull();
      expect(route?.path.points.length).toBeGreaterThan(4);
    });

    it('deja a los buggies de la emboscada con ruta hasta su objetivo', () => {
      const route = planner.plan(
        'buggy',
        { position: [66, 0, -4], heading: -Math.PI / 2 },
        { position: [30, 0, 10], heading: Math.PI },
      );

      expect(route).not.toBeNull();
      expect(route?.path.points.length).toBeGreaterThan(4);
    });

    it('deja al deslizador Combine con ruta hasta el portón del relé', () => {
      const route = planner.plan(
        'combineGlider',
        { position: [92, 0, -74], heading: Math.PI },
        { position: [56, 0, -84], heading: Math.PI },
      );

      expect(route).not.toBeNull();
      expect(route?.path.points.length).toBeGreaterThan(4);
    });
  });
});
