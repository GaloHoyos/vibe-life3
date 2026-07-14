import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildNavigationGeometry } from '@engine/ai/navigation/NavigationGeometry';
import { NavigationService } from '@engine/ai/navigation/NavigationService';
import { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { Raycast } from '@engine/physics/Raycast';
import { quatFromEuler } from '@game/levels/builders/transform';
import { Demo1Plaza } from '@game/levels/maps/campaign/Demo1Plaza';
import { NavigationProfiles } from '@game/npc/navigation/NavAgentProfiles';
import { tupleToVector3 } from '@shared/math/VectorTuple';

type RouteLeg = readonly [name: string, from: readonly [number, number, number], to: readonly [number, number, number]];

const CRITICAL_ROUTE: readonly RouteLeg[] = [
  ['anexo → mercado', [-78, 1.2, 138], [-35, 1.2, 101]],
  ['mercado → refugio', [-35, 1.2, 101], [42, 1.2, 75]],
  ['refugio → depósito', [42, 1.2, 54], [58, 1.2, 33]],
  ['depósito → puente principal', [58, 1.2, 18], [39, 1.2, -3]],
  ['ribera sur → bombeo', [39, 1.2, -23], [-54, 1.2, -34]],
  ['bombeo → puente de servicio', [-54, 1.2, -34], [-72, 1.2, -3]],
  ['retorno → plaza', [-72, 1.2, 63], [0, 1.2, 70]],
  ['recinto → cabina elevada', [0, 1.2, 54], [0, 10.2, 39]],
  ['cabina → salida oeste', [0, 10.2, 39], [-96, 1.2, 40]],
] as const;

describe('Demo 1 navigation', () => {
  const physics = new PhysicsWorld();
  let navigation: NavigationService;

  beforeAll(async () => {
    const boxes = [
      ...Demo1Plaza.staticBoxes,
      ...(Demo1Plaza.buildings ?? []).flatMap((building) => building.boxes),
    ];
    await physics.init();
    physics.createStaticBoxes(boxes.map((box) => ({
      id: box.id,
      position: tupleToVector3(box.position),
      size: tupleToVector3(box.size),
      rotation: box.rotation ? quatFromEuler(box.rotation) : undefined,
    })));
    physics.updateQueryPipeline();
    navigation = await NavigationService.create({
      geometry: buildNavigationGeometry(boxes),
      groundProfiles: [NavigationProfiles.humanoid],
      raycast: new Raycast(physics),
      physics,
    });
  }, 20_000);

  afterAll(() => {
    navigation.dispose();
    physics.reset();
  });

  it.each(CRITICAL_ROUTE)('%s tiene un corredor completo para NPC humanoide', (_name, fromTuple, toTuple) => {
    const from = navigation.projectPoint(new Vector3(...fromTuple), NavigationProfiles.humanoid);
    const to = navigation.projectPoint(new Vector3(...toTuple), NavigationProfiles.humanoid);

    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    const path = navigation.requestPath(NavigationProfiles.humanoid, from!, to!);
    expect(path).not.toBeNull();
    expect(path?.partial).toBe(false);
    expect(path?.points.length).toBeGreaterThan(0);
  });
});
