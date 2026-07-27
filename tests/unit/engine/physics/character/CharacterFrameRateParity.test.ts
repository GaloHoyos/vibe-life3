import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { CameraSystem } from "@engine/render/CameraSystem";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import {
  CharacterController,
  type MovementInput,
} from "@engine/physics/character/CharacterController";
import { CharacterMotor } from "@engine/physics/character/CharacterMotor";
import { KinematicFlyerMotor } from "@engine/physics/character/KinematicFlyerMotor";

const HZ_60 = 1 / 60;
const HZ_120 = 1 / 120;
const HZ_144 = 1 / 144;
/**
 * La recuperación de penetración de Rapier al aterrizar tarda distinto según el
 * framerate, así que hay que dejar que la cápsula converja antes de medir.
 */
const SETTLE_SECONDS = 2;
/** Banda de paridad. La regresión que cubre esto costaba un 58 % de velocidad. */
const PARITY_MIN = 0.95;
const PARITY_MAX = 1.05;
const NPC_MAX_SPEED = 3;

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
const SPRINT: MovementInput = { ...FORWARD, sprintDown: true };

const CAMERA = {
  getPlanarForward: () => new Vector3(0, 0, 1),
  getPlanarRight: () => new Vector3(1, 0, 0),
} as unknown as CameraSystem;

beforeAll(async () => {
  await RAPIER.init();
});

/**
 * La física corre a paso fijo de 60 Hz con 0..N substeps por frame, pero los
 * actores cinemáticos se mueven por frame. Estas pruebas fijan la invariante que
 * une las dos cosas: el mismo segundo de reloj recorre la misma distancia sin
 * importar a qué framerate se simule.
 *
 * Sin el objetivo pendiente de `PendingKinematicTarget`, cada frame sin substep
 * pisa el objetivo del anterior y la velocidad efectiva cae a
 * `frameDelta / (1/60)`: 41.7 % a 144 Hz.
 */
describe("paridad de movimiento entre framerates", () => {
  it("el jugador recorre la misma distancia a 60 y a 144 Hz", async () => {
    const slow = await runPlayerSeconds(HZ_60, 1, FORWARD);
    const fast = await runPlayerSeconds(HZ_144, 1, FORWARD);

    expect(slow.distance).toBeGreaterThan(4);
    expect(fast.distance / slow.distance).toBeGreaterThan(PARITY_MIN);
    expect(fast.distance / slow.distance).toBeLessThan(PARITY_MAX);
  });

  it("el sprint recorre la misma distancia a 60 y a 120 Hz", async () => {
    const slow = await runPlayerSeconds(HZ_60, 1, SPRINT);
    const fast = await runPlayerSeconds(HZ_120, 1, SPRINT);

    expect(slow.distance).toBeGreaterThan(6);
    expect(fast.distance / slow.distance).toBeGreaterThan(PARITY_MIN);
    expect(fast.distance / slow.distance).toBeLessThan(PARITY_MAX);
  });

  it("el apex del salto es igual a 60 y a 144 Hz", async () => {
    const slow = await runPlayerJump(HZ_60);
    const fast = await runPlayerJump(HZ_144);

    // Tolerancia más amplia que en distancia: muestrear el apex 144 veces por
    // segundo lo encuentra un poco más alto que muestrearlo 60.
    expect(slow).toBeGreaterThan(1);
    expect(fast / slow).toBeGreaterThan(PARITY_MIN);
    expect(fast / slow).toBeLessThan(PARITY_MAX);
  });

  it("el impacto de caída es igual a 60 y a 144 Hz", async () => {
    const slow = await runPlayerFallImpact(HZ_60);
    const fast = await runPlayerFallImpact(HZ_144);

    expect(slow).toBeGreaterThan(5);
    expect(fast / slow).toBeGreaterThan(0.9);
    expect(fast / slow).toBeLessThan(1.1);
  });

  it("un NPC terrestre recorre la misma distancia a 60 y a 144 Hz", async () => {
    const slow = await runNpcSeconds(HZ_60, 1);
    const fast = await runNpcSeconds(HZ_144, 1);

    expect(slow.distance).toBeGreaterThan(2);
    expect(fast.distance / slow.distance).toBeGreaterThan(PARITY_MIN);
    expect(fast.distance / slow.distance).toBeLessThan(PARITY_MAX);
  });

  it("la velocidad reportada por el NPC no se infla en los frames con substep", async () => {
    // `computedMovement` cubre todo lo pendiente, no sólo este frame: derivarla
    // de ahí daría picos de 2-3x justo en los frames que comprometen, y eso
    // alimenta la cadencia del ciclo de caminata.
    const fast = await runNpcSeconds(HZ_144, 1);

    expect(fast.maxReportedSpeed).toBeGreaterThan(1);
    expect(fast.maxReportedSpeed).toBeLessThan(NPC_MAX_SPEED * 1.15);
  });

  it("el flyer cinemático recorre la misma distancia a 60 y a 144 Hz", async () => {
    const slow = await runFlyerSeconds(HZ_60, 1);
    const fast = await runFlyerSeconds(HZ_144, 1);

    expect(slow).toBeGreaterThan(1);
    expect(fast / slow).toBeGreaterThan(PARITY_MIN);
    expect(fast / slow).toBeLessThan(PARITY_MAX);
  });

  it("la cápsula frena contra una pared sin acumular desplazamiento perdido", async () => {
    const physics = await createWorld();
    physics.createStaticBox({
      id: "wall",
      position: new Vector3(0, 1.5, 4),
      size: new Vector3(8, 3, 0.5),
    });
    const player = createPlayerController(physics);
    physics.updateQueryPipeline();
    settlePlayer(physics, player, HZ_144);

    for (let frame = 0; frame < 144 * 2; frame += 1) {
      player.update(HZ_144, FORWARD, CAMERA);
      physics.step(HZ_144);
    }

    // Se detiene contra la cara de la pared (z = 3.75) sin penetrarla, y el
    // desplazamiento bloqueado no queda acumulado para dispararse después.
    expect(player.getPosition().z).toBeGreaterThan(3);
    expect(player.getPosition().z).toBeLessThan(3.75);
  });

  it("subir un escalón da el mismo resultado a 60 y a 144 Hz", async () => {
    const slow = await runPlayerStep(HZ_60);
    const fast = await runPlayerStep(HZ_144);

    expect(slow.climbed).toBeGreaterThan(0.28);
    expect(fast.climbed).toBeCloseTo(slow.climbed, 2);
    expect(fast.distance / slow.distance).toBeGreaterThan(PARITY_MIN);
    expect(fast.distance / slow.distance).toBeLessThan(PARITY_MAX);
  });
});

interface RunResult {
  distance: number;
  maxReportedSpeed: number;
}

async function runPlayerSeconds(
  delta: number,
  seconds: number,
  move: MovementInput,
): Promise<RunResult> {
  const physics = await createWorld();
  const player = createPlayerController(physics);
  physics.updateQueryPipeline();
  settlePlayer(physics, player, delta);

  const start = player.getPosition().z;
  let maxReportedSpeed = 0;
  for (let frame = 0; frame < Math.round(seconds / delta); frame += 1) {
    player.update(delta, move, CAMERA);
    physics.step(delta);
    maxReportedSpeed = Math.max(maxReportedSpeed, player.getMoveIntensity());
  }
  return { distance: player.getPosition().z - start, maxReportedSpeed };
}

async function runPlayerJump(delta: number): Promise<number> {
  const physics = await createWorld();
  const player = createPlayerController(physics);
  physics.updateQueryPipeline();
  settlePlayer(physics, player, delta);

  const baseline = player.getPosition().y;
  let apex = baseline;
  for (let frame = 0; frame < Math.round(1.5 / delta); frame += 1) {
    player.update(
      delta,
      frame === 0 ? { ...IDLE, jumpPressed: true } : IDLE,
      CAMERA,
    );
    physics.step(delta);
    apex = Math.max(apex, player.getPosition().y);
  }
  return apex - baseline;
}

async function runPlayerFallImpact(delta: number): Promise<number> {
  const physics = await createWorld();
  const player = createPlayerController(physics);
  physics.updateQueryPipeline();
  player.teleport(new Vector3(0, 6, 0), new Vector3(0, -16, 0));

  let impact = 0;
  for (let frame = 0; frame < Math.round(1.5 / delta); frame += 1) {
    player.update(delta, IDLE, CAMERA);
    physics.step(delta);
    impact = Math.max(impact, player.consumeLandingImpact());
  }
  return impact;
}

async function runPlayerStep(
  delta: number,
): Promise<{ climbed: number; distance: number }> {
  const physics = await createWorld();
  physics.createStaticBox({
    id: "step",
    position: new Vector3(0, 0.15, 26),
    size: new Vector3(8, 0.3, 48),
  });
  const player = createPlayerController(physics);
  physics.updateQueryPipeline();
  settlePlayer(physics, player, delta);

  const baseline = player.getPosition();
  for (let frame = 0; frame < Math.round(1.5 / delta); frame += 1) {
    player.update(delta, FORWARD, CAMERA);
    physics.step(delta);
  }
  const distance = player.getPosition().z - baseline.z;
  // Frenar antes de medir la altura: el autostep puede dejar la cápsula en el
  // aire justo en el frame final y eso no dice nada del escalón.
  settlePlayer(physics, player, delta);
  return { climbed: player.getPosition().y - baseline.y, distance };
}

async function runNpcSeconds(delta: number, seconds: number): Promise<RunResult> {
  const physics = await createWorld();
  const motor = createGroundNpc(physics);
  physics.updateQueryPipeline();
  const target = new Vector3(0, 0.9, 60);
  for (let frame = 0; frame < Math.round(SETTLE_SECONDS / delta); frame += 1) {
    motor.update(delta, target, false);
    physics.step(delta);
  }

  const start = motor.getPosition().z;
  let maxReportedSpeed = 0;
  for (let frame = 0; frame < Math.round(seconds / delta); frame += 1) {
    motor.update(delta, target, true);
    physics.step(delta);
    maxReportedSpeed = Math.max(
      maxReportedSpeed,
      motor.syncFromPhysics().velocity.length(),
    );
  }
  return { distance: motor.getPosition().z - start, maxReportedSpeed };
}

async function runFlyerSeconds(delta: number, seconds: number): Promise<number> {
  const physics = await createWorld();
  const motor = new KinematicFlyerMotor(physics, {
    id: "flyer",
    position: new Vector3(0, 8, 0),
    height: 2,
    radius: 0.8,
    mass: 300,
    maxSpeed: 6,
    acceleration: 40,
    turnSpeed: 8,
    metadata: { id: "flyer", kind: "npc" },
  });
  physics.updateQueryPipeline();

  const target = new Vector3(0, 8, 60);
  for (let frame = 0; frame < Math.round(seconds / delta); frame += 1) {
    motor.update(delta, target, true);
    physics.step(delta);
  }
  return motor.getPosition().z;
}

function settlePlayer(
  physics: PhysicsWorld,
  player: CharacterController,
  delta: number,
): void {
  for (let frame = 0; frame < Math.round(SETTLE_SECONDS / delta); frame += 1) {
    player.update(delta, IDLE, CAMERA);
    physics.step(delta);
  }
}

async function createWorld(): Promise<PhysicsWorld> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.25, 0),
    size: new Vector3(60, 0.5, 120),
  });
  return physics;
}

function createPlayerController(physics: PhysicsWorld): CharacterController {
  return new CharacterController(physics, {
    // Despegado del piso: spawnear con la cápsula exactamente apoyada deja una
    // penetración cuya recuperación depende del framerate y ensucia el baseline.
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
}

function createGroundNpc(physics: PhysicsWorld): CharacterMotor {
  // `CharacterMotor.shouldCollideWith` compara `damageable` contra el del
  // collider: sin uno propio el NPC ignora el piso (ambos `undefined`) y cae.
  const damageable = { applyDamage: () => undefined, isAlive: () => true };
  return new CharacterMotor(physics, {
    id: "npc-parity",
    position: new Vector3(0, 1.4, 0),
    height: 1.8,
    radius: 0.35,
    mass: 60,
    maxSpeed: NPC_MAX_SPEED,
    acceleration: 12,
    turnSpeed: 8,
    rotationSmoothing: 0,
    faceTargetDeadzone: 0,
    turnBeforeMoveAngle: Math.PI,
    minMoveFacingDot: -1,
    gravity: 20.5,
    stepOffset: 0.2,
    snapToGround: 0.2,
    metadata: { id: "npc-parity", kind: "npc", damageable },
  });
}
