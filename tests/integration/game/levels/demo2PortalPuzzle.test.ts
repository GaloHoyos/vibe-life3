import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { PhysicsWorld } from '@engine/physics/PhysicsWorld';
import { Raycast } from '@engine/physics/Raycast';
import { quatFromEuler } from '@game/levels/builders/transform';
import { PortalConfig } from '@game/config/portal.config';
import { computePortalPlacement } from '@game/gameplay/weapons/portal/PortalPlacement';
import { DEMO2_DETAIL_BOXES } from '@game/levels/maps/campaign/Demo2RavenholmGeometry';
import { tupleToVector3 } from '@shared/math/VectorTuple';

const PLACEMENT = {
  range: PortalConfig.placement.range,
  halfWidth: PortalConfig.ellipse.halfWidth,
  halfHeight: PortalConfig.ellipse.halfHeight,
  planarForward: new Vector3(0, 0, -1),
};

describe('Demo 2 portal puzzle surfaces', () => {
  const physics = new PhysicsWorld();
  let raycast: Raycast;

  beforeAll(async () => {
    await physics.init();
    const courtyard = DEMO2_DETAIL_BOXES.filter((box) => box.id.startsWith('d2-portal-'));
    physics.createStaticBoxes(courtyard.map((box) => ({
      id: box.id,
      position: tupleToVector3(box.position),
      size: tupleToVector3(box.size),
      rotation: box.rotation ? quatFromEuler(box.rotation) : undefined,
    })));
    physics.updateQueryPipeline();
    raycast = new Raycast(physics);
  });

  afterAll(() => {
    physics.reset();
  });

  it('acepta un portal completo en el piso despejado del patio', () => {
    const result = computePortalPlacement(
      raycast,
      new Vector3(28, 2.2, 70),
      new Vector3(0, -1, 0),
      PLACEMENT,
    );

    expect(result).not.toBeNull();
    expect(result?.frame.position.y).toBeCloseTo(0.12, 2);
    expect(result?.frame.position.x).toBeCloseTo(28, 1);
  });

  it('acepta el segundo portal sobre el panel alto y libra el balcón', () => {
    const origin = new Vector3(25, 1.65, 66);
    const aim = new Vector3(54.75, 8, 66).sub(origin).normalize();
    const result = computePortalPlacement(raycast, origin, aim, PLACEMENT);

    expect(result).not.toBeNull();
    expect(result?.frame.position.x).toBeCloseTo(54.75, 2);
    expect(result?.frame.position.y).toBeGreaterThan(6.5);
    expect(result?.frame.position.y).toBeLessThan(9.1);
    expect(result?.frame.position.z).toBeGreaterThan(60.5);
    expect(result?.frame.position.z).toBeLessThan(71.5);
  });
});
