import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { NavigationService } from "@engine/ai/navigation/NavigationService";
import type {
  NavigationRequest,
  NavigationRequestQueue,
} from "@engine/ai/navigation/NavigationRequestQueue";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { BlobConfig } from "@game/config/blob.config";
import { BlobChunkNavigator } from "@game/npc/blob/BlobChunkNavigator";

describe("BlobChunkNavigator", () => {
  it("alcanza el burst de catch-up cuando el cuerpo quedó lejos", () => {
    const fake = fakeBody(new Vector3(10, 0, 0));
    const navigator = createNavigator();
    const component = [[{ index: 0, body: fake.body, supported: true }]];

    for (let step = 0; step < 12; step += 1) {
      navigator.update(1 / 20, component, new Vector3());
    }

    expect(fake.velocity().length()).toBeCloseTo(
      BlobConfig.armor.chunkNavigationCatchupMaxSpeed,
      4,
    );
    expect(fake.velocity().length()).toBeGreaterThan(
      BlobConfig.predator.moveSpeed,
    );
  });

  it("adelanta el destino de navegación cuando el cuerpo está en movimiento", () => {
    const fake = fakeBody(new Vector3(-10, 0, 0));
    const goal = new Vector3();
    const leads: number[] = [];
    const navigator = createNavigator((request) => {
      leads.push(request.to.x - goal.x);
    });
    const component = [[{ index: 1, body: fake.body, supported: true }]];

    navigator.update(1 / 20, component, goal);
    for (let step = 0; step < 10; step += 1) {
      goal.x += BlobConfig.predator.moveSpeed / 20;
      navigator.update(1 / 20, component, goal);
    }

    expect(leads.length).toBeGreaterThan(1);
    expect(Math.max(...leads)).toBeGreaterThan(2);
    expect(Math.max(...leads)).toBeLessThanOrEqual(
      BlobConfig.armor.chunkNavigationPredictionMaxDistance + 1e-5,
    );
  });
});

function createNavigator(
  onRequest: (request: NavigationRequest) => void = () => undefined,
): BlobChunkNavigator {
  const navigation = {
    projectPoint: (position: Vector3) => position.clone(),
  } as unknown as NavigationService;
  const requests = {
    enqueue: (request: NavigationRequest) => {
      onRequest(request);
      request.onResolve({
        points: [request.to.clone()],
        actions: [],
        length: request.from.distanceTo(request.to),
        partial: false,
      });
    },
    cancel: () => undefined,
  } as unknown as NavigationRequestQueue;
  const physics = {
    isHeldBody: () => false,
  } as unknown as PhysicsWorld;
  return new BlobChunkNavigator({
    ownerId: "blob-chunk-test",
    navigation,
    requests,
    physics,
  });
}

function fakeBody(position: Vector3): {
  body: RAPIER.RigidBody;
  velocity(): Vector3;
} {
  const velocity = new Vector3();
  const body = {
    handle: 1,
    isValid: () => true,
    mass: () => 1,
    translation: () => ({ x: position.x, y: position.y, z: position.z }),
    linvel: () => ({ x: velocity.x, y: velocity.y, z: velocity.z }),
    applyImpulse: (impulse: RAPIER.Vector) => {
      velocity.add(new Vector3(impulse.x, impulse.y, impulse.z));
    },
  } as unknown as RAPIER.RigidBody;
  return { body, velocity: () => velocity.clone() };
}
