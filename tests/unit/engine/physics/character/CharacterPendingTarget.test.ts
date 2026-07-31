import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { CameraSystem } from "@engine/render/CameraSystem";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import {
  CharacterController,
  type MovementInput,
} from "@engine/physics/character/CharacterController";

const HZ_144 = 1 / 144;
const SETTLE_SECONDS = 2;

const IDLE: MovementInput = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jumpPressed: false,
  sprintDown: false,
  crouchDown: false,
};
const FORWARD: MovementInput = { ...IDLE, forward: true };
const CROUCH: MovementInput = { ...IDLE, crouchDown: true };

const CAMERA = {
  getPlanarForward: () => new Vector3(0, 0, 1),
  getPlanarRight: () => new Vector3(1, 0, 0),
} as unknown as CameraSystem;

beforeAll(async () => {
  await RAPIER.init();
});

/**
 * Semántica del objetivo cinemático pendiente: dónde reporta estar el actor
 * antes de que Rapier comprometa la pose, y cómo se re-ancla cuando alguien
 * escribe la posición del cuerpo por fuera del motor.
 */
describe("objetivo cinemático pendiente", () => {
  it("getPosition refleja el objetivo pendiente antes del substep", async () => {
    const { physics, player } = await createSettledPlayer(HZ_144);

    const committed = player.body.translation().z;
    player.update(HZ_144, FORWARD, CAMERA);
    // Sin `physics.step`: el cuerpo todavía no movió, pero el jugador sí.
    expect(player.body.translation().z).toBeCloseTo(committed, 10);
    expect(player.getPosition().z).toBeGreaterThan(committed);
    expect(physics.getBodyCount()).toBeGreaterThan(0);
  });

  it("la cámara avanza en los frames que no corren substep", async () => {
    const { physics, player } = await createSettledPlayer(HZ_144);

    const samples: number[] = [];
    for (let frame = 0; frame < 12; frame += 1) {
      player.update(HZ_144, FORWARD, CAMERA);
      physics.step(HZ_144);
      samples.push(player.getEyePosition().z);
    }

    // A 144 Hz sólo ~2 de cada 5 frames corren un substep: con la pose
    // comprometida los ojos se quedarían clavados en el resto.
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThan(samples[index - 1] ?? 0);
    }
  });

  it("teleport resincroniza el objetivo pendiente", async () => {
    const { physics, player } = await createSettledPlayer(HZ_144);

    // Frames sin comprometer para dejar offset pendiente, y después un salto.
    player.update(HZ_144, FORWARD, CAMERA);
    player.update(HZ_144, FORWARD, CAMERA);
    player.teleport(new Vector3(0, 5, 20), new Vector3());

    expect(player.getPosition().z).toBeCloseTo(20, 6);
    player.update(HZ_144, IDLE, CAMERA);
    physics.step(HZ_144);
    // Sin re-anclar, el barrido arrastraría la cápsula de vuelta al origen.
    expect(player.getPosition().z).toBeCloseTo(20, 2);
  });

  it("setPosition resincroniza el objetivo pendiente", async () => {
    const { physics, player } = await createSettledPlayer(HZ_144);

    player.update(HZ_144, FORWARD, CAMERA);
    player.setPosition(new Vector3(0, 5, -12));

    expect(player.getPosition().z).toBeCloseTo(-12, 6);
    player.update(HZ_144, IDLE, CAMERA);
    physics.step(HZ_144);
    expect(player.getPosition().z).toBeCloseTo(-12, 2);
  });

  it("agacharse mantiene los pies anclados al piso", async () => {
    const { physics, player } = await createSettledPlayer(HZ_144);
    const feetBefore = player.getFeetPosition().y;

    for (let frame = 0; frame < Math.round(0.6 / HZ_144); frame += 1) {
      player.update(HZ_144, CROUCH, CAMERA);
      physics.step(HZ_144);
    }

    expect(player.isCrouched()).toBe(true);
    expect(player.getFeetPosition().y).toBeCloseTo(feetBefore, 1);
  });

  it("un setTranslation externo se auto-corrige sin arrastrar la cápsula", async () => {
    const { physics, player } = await createSettledPlayer(HZ_144);

    player.update(HZ_144, FORWARD, CAMERA);
    // Escritura cruda que no pasa por el motor: el clamp de seguridad debe
    // descartar el offset viejo en vez de barrer al jugador de vuelta.
    player.body.setTranslation({ x: 0, y: 5, z: 30 }, true);

    player.update(HZ_144, IDLE, CAMERA);
    expect(player.getPosition().z).toBeGreaterThan(29);
  });

  it("getPosition devuelve una copia", async () => {
    const { player } = await createSettledPlayer(HZ_144);

    const first = player.getPosition();
    first.set(999, 999, 999);

    expect(player.getPosition().x).not.toBe(999);
  });

  it("una cápsula suspendida no acumula objetivo pendiente", async () => {
    const { physics, player } = await createSettledPlayer(HZ_144);

    player.update(HZ_144, FORWARD, CAMERA);
    player.setSimulationEnabled(false);
    for (let frame = 0; frame < 20; frame += 1) {
      player.setPosition(new Vector3(0, 3, 10));
      player.update(HZ_144, FORWARD, CAMERA);
      physics.step(HZ_144);
    }
    player.setSimulationEnabled(true);
    player.teleport(new Vector3(0, 3, 10), new Vector3());

    player.update(HZ_144, IDLE, CAMERA);
    physics.step(HZ_144);
    expect(player.getPosition().z).toBeCloseTo(10, 2);
  });
});

async function createSettledPlayer(
  delta: number,
): Promise<{ physics: PhysicsWorld; player: CharacterController }> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.25, 0),
    size: new Vector3(120, 0.5, 120),
  });
  const player = new CharacterController(physics, {
    position: new Vector3(0, 1.4, 0),
    radius: 0.35,
    standingHalfHeight: 0.55,
    crouchHalfHeight: 0.3,
    standingEyeHeight: 0.75,
    crouchEyeHeight: 0.22,
    walkSpeed: 6.2,
    sprintSpeed: 9.5,
    crouchSpeed: 2.5,
    jumpSpeed: 9.2,
    groundAccelerate: 14,
    airAccelerate: 14,
    maxAirWishSpeed: 0.7,
    friction: 6,
    stopSpeed: 1.5,
    crouchTransitionTime: 0.18,
    dynamicPushMass: 70,
  });
  physics.updateQueryPipeline();
  for (let frame = 0; frame < Math.round(SETTLE_SECONDS / delta); frame += 1) {
    player.update(delta, IDLE, CAMERA);
    physics.step(delta);
  }
  return { physics, player };
}
