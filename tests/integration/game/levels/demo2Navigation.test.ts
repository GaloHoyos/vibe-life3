import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { buildNavigationGeometry } from '@engine/ai/navigation/NavigationGeometry';
import { NavigationService } from '@engine/ai/navigation/NavigationService';
import { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { Raycast } from '@engine/physics/Raycast';
import { quatFromEuler } from '@game/levels/builders/transform';
import { Demo2Ravenholm } from '@game/levels/maps/campaign/Demo2Ravenholm';
import { NavigationProfiles } from '@game/npc/navigation/NavAgentProfiles';
import { tupleToVector3 } from '@shared/math/VectorTuple';

type RouteLeg = readonly [name: string, from: readonly [number, number, number], to: readonly [number, number, number]];

// Each leg stays on one side of a progression gate. Doors are dynamic runtime
// obstacles, so they are deliberately not used as either endpoint here.
const CRITICAL_ROUTE: readonly RouteLeg[] = [
  ['arrival to crematorium plaza', [-92, 1.2, 140], [-48, 1.2, 106]],
  ['crematorium plaza to chapel west', [-48, 1.2, 106], [-23, 1.2, 94]],
  ['chapel east to quarantine courtyard', [3.5, 1.2, 86], [30, 1.2, 67]],
  ['quarantine gate exit to ossuary', [39, 1.2, 49], [60, 1.2, 31]],
  ['ossuary to rooftop court', [60, 1.2, 31], [60, 1.2, -5]],
  ['mid-district gate to station', [50, 1.2, -22], [10, 1.2, -45]],
  ['station to foundry gate approach', [10, 1.2, -45], [-12, 1.2, -56]],
  ['foundry gate exit to siren holdout', [-20, 1.2, -61], [-42, 1.2, -72]],
  ['siren holdout to mine approach', [-42, 1.2, -72], [-84, 1.2, -105]],
] as const;

describe('Demo 2 navigation', () => {
  const physics = new PhysicsWorld();
  let navigation: NavigationService;

  beforeAll(async () => {
    const boxes = [
      ...Demo2Ravenholm.staticBoxes,
      ...(Demo2Ravenholm.buildings ?? []).flatMap((building) => building.boxes),
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

  it.each(CRITICAL_ROUTE)('%s has a complete corridor for a humanoid NPC', (_name, fromTuple, toTuple) => {
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
