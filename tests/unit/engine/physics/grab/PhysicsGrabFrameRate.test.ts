import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Object3D, Quaternion, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { RaycastSource } from "@engine/physics/Raycast";
import {
  PhysicsGrabController,
  type GrabTuning,
} from "@engine/physics/grab/PhysicsGrabController";

const HZ_60 = 1 / 60;
const HZ_144 = 1 / 144;

const tuning: GrabTuning = {
  holdDistance: 2.4,
  minHoldDistance: 1.1,
  wallClampMargin: 0.25,
  maxLinearSpeed: 14,
  linearGain: 12,
  maxAngularSpeed: 12,
  angularGain: 10,
  dropErrorDistance: 1.2,
  dropErrorTime: 0.45,
  teleportGraceSeconds: 0.25,
};

const CAMERA_POS = new Vector3(0, 1.6, 0);
const CAMERA_DIR = new Vector3(0, 0, 1);
const CAMERA_QUAT = new Quaternion();

beforeAll(async () => {
  await RAPIER.init();
});

/**
 * El auto-drop por obstrucción mide progreso entre frames, pero el cuerpo sólo
 * avanza dentro de `world.step()`, que a 144 Hz no corre todos los frames.
 */
describe("auto-drop del grab a distinto framerate", () => {
  it("sostiene un prop libre el mismo tiempo a 60 y a 144 Hz", async () => {
    expect(await holdSeconds(HZ_60, 3)).toBe(true);
    expect(await holdSeconds(HZ_144, 3)).toBe(true);
  });

  it("suelta un prop anclado a la pared a 60 y a 144 Hz por igual", async () => {
    expect(await holdSeconds(HZ_60, 3, true)).toBe(false);
    expect(await holdSeconds(HZ_144, 3, true)).toBe(false);
  });
});

/** Devuelve true si el prop seguía sostenido al terminar. */
async function holdSeconds(
  delta: number,
  seconds: number,
  anchored = false,
): Promise<boolean> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.25, 0),
    size: new Vector3(60, 0.5, 60),
  });

  const body = physics.createDynamicBox(
    {
      id: "prop",
      position: new Vector3(0, 1.6, 2.4),
      size: new Vector3(0.5, 0.5, 0.5),
      mass: 8,
    },
    new Object3D(),
  );
  if (anchored) {
    // Muro entre el cuerpo y el hold-target: el shadow empuja contra él y el
    // error nunca baja, así que el auto-drop por obstrucción debe dispararse.
    physics.createStaticBox({
      id: "wall",
      position: new Vector3(0, 1.6, 5),
      size: new Vector3(8, 6, 0.5),
    });
    body.setTranslation({ x: 0, y: 1.6, z: 8 }, true);
    body.setGravityScale(0, true);
  }
  physics.updateQueryPipeline();

  const raycast: RaycastSource = { cast: vi.fn(() => null) };
  const controller = new PhysicsGrabController(physics, raycast, tuning);
  controller.grab(body, CAMERA_QUAT);

  for (let frame = 0; frame < Math.round(seconds / delta); frame += 1) {
    controller.update(delta, CAMERA_POS, CAMERA_DIR, CAMERA_QUAT);
    physics.step(delta);
    if (!controller.isHolding()) return false;
  }
  return controller.isHolding();
}
