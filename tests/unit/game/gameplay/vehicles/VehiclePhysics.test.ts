import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Scene, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { RaycastSource } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import type { EntityIOSystem } from "@game/script/EntityIOSystem";
import type {
  VehicleDefinition,
  WaterVolumeDefinition,
} from "@game/levels/LevelDefinition";
import { VehicleEntity } from "@game/gameplay/vehicles/VehicleEntity";
import { WaterVolumeSystem } from "@game/gameplay/vehicles/water/WaterVolumeSystem";

const DT = 1 / 60;

beforeAll(async () => {
  await RAPIER.init();
});

/**
 * Un vehículo recién spawneado y sin control no puede volcarse, despegar ni
 * acumular daño solo. Estas pruebas simulan el mundo real (Rapier + el motor
 * del preset) porque el bug sólo aparece integrando muchos pasos.
 */
describe("estabilidad física de los vehículos", () => {
  it("el buggy queda apoyado y quieto tras asentarse", async () => {
    const rig = await spawn({ presetId: "buggy", position: [0, 1.2, 0] });
    simulate(rig, 2);

    const trace = simulate(rig, 6);

    expect(trace.maxSpeed).toBeLessThan(0.5);
    expect(trace.maxHeight).toBeLessThan(1.2);
    expect(trace.maxTiltDegrees).toBeLessThan(10);
    expect(rig.vehicle.damage.getHull().current).toBe(
      rig.vehicle.damage.getHull().max,
    );
    expect(rig.vehicle.isWreckage()).toBe(false);
  });

  it("el airboat queda apoyado y quieto en tierra tras asentarse", async () => {
    const rig = await spawn({ presetId: "airboat", position: [0, 1.2, 0] });
    simulate(rig, 2);

    const trace = simulate(rig, 6);

    expect(trace.maxSpeed).toBeLessThan(0.5);
    expect(trace.maxHeight).toBeLessThan(1.2);
    expect(trace.maxTiltDegrees).toBeLessThan(10);
    expect(rig.vehicle.isWreckage()).toBe(false);
  });

  it("el airboat flota estable sobre el agua sin control", async () => {
    const rig = await spawn(
      { presetId: "airboat", position: [0, 1.2, 0] },
      { water: true },
    );
    simulate(rig, 4);

    const trace = simulate(rig, 6);

    expect(trace.maxSpeed).toBeLessThan(1.5);
    expect(trace.maxTiltDegrees).toBeLessThan(15);
    expect(rig.vehicle.getWorldPosition().y).toBeGreaterThan(0.4);
    expect(rig.vehicle.getWorldPosition().y).toBeLessThan(2.5);
  });

  it("el buggy avanza recto con acelerador y frena sin volcar", async () => {
    const rig = await spawn({ presetId: "buggy", position: [0, 1.2, 0] });
    simulate(rig, 2);

    const start = rig.vehicle.getWorldPosition();
    rig.vehicle.setControl({
      throttle: 1,
      steering: 0,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    const trace = simulate(rig, 4);
    const end = rig.vehicle.getWorldPosition();

    expect(end.z - start.z).toBeGreaterThan(6);
    expect(Math.abs(end.x - start.x)).toBeLessThan(2.5);
    expect(trace.maxTiltDegrees).toBeLessThan(35);
    expect(trace.maxHeight).toBeLessThan(2.5);
  });

  it("el buggy retrocede con acelerador negativo", async () => {
    const rig = await spawn({ presetId: "buggy", position: [0, 1.2, 0] });
    simulate(rig, 2);

    const start = rig.vehicle.getWorldPosition();
    rig.vehicle.setControl({
      throttle: -1,
      steering: 0,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    simulate(rig, 3);

    expect(rig.vehicle.getWorldPosition().z - start.z).toBeLessThan(-2);
  });

  it("el buggy responde al volante en ambos sentidos por igual", async () => {
    // Hacia qué lado va cada signo lo fija VehicleSteering.test.ts, que lo mide
    // contra el vector derecha del proyecto. Acá sólo interesa que el volante
    // haga girar el chasis y que sea simétrico.
    const right = await turnWheel(1);
    const left = await turnWheel(-1);

    expect(Math.abs(right.yaw)).toBeGreaterThan(1);
    expect(Math.sign(right.yaw)).toBe(-Math.sign(left.yaw));
    expect(Math.abs(right.yaw)).toBeCloseTo(Math.abs(left.yaw), 1);
  });

  it("frenar detiene el buggy mucho antes que soltar el acelerador", async () => {
    // Rapier sólo consulta `wheel.brake` cuando la fuerza motriz es EXACTAMENTE
    // cero. Con un acelerador que decae exponencialmente nunca llegaba a serlo,
    // así que el freno era código muerto y la tecla de retroceso no hacía nada.
    const coasting = await stoppingDistance({ brake: 0, handbrake: 0 });
    const braking = await stoppingDistance({ brake: 1, handbrake: 0 });

    expect(braking.distance).toBeLessThan(coasting.distance * 0.5);
    expect(braking.seconds).toBeLessThan(3);
    // Y el freno de mano no puede frenar mejor que los frenos de servicio.
    const handbraking = await stoppingDistance({ brake: 0, handbrake: 1 });
    expect(handbraking.distance).toBeGreaterThan(braking.distance * 0.9);
  });

  it("soltar el acelerador frena por motor en vez de rodar sin fin", async () => {
    const rig = await spawn({ presetId: "buggy", position: [0, 1.2, 0] });
    simulate(rig, 2);
    accelerate(rig, 6);

    const before = rig.vehicle.getTelemetry().forwardSpeed;
    rig.vehicle.setControl({
      throttle: 0,
      steering: 0,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    simulate(rig, 3);

    const after = rig.vehicle.getTelemetry().forwardSpeed;
    expect(after).toBeLessThan(before - 8);
    expect(after).toBeGreaterThan(0);
  });

  it("el freno de mano derrapa en vez de clavarse", async () => {
    const planted = await corner(0);
    const sliding = await corner(1);

    expect(sliding.slip).toBeGreaterThan(planted.slip * 1.5);
    expect(sliding.yaw).toBeGreaterThan(planted.yaw);
  });

  it("el buggy se endereza tras un salto en vez de quedar dando vueltas", async () => {
    const rig = await spawn({ presetId: "buggy", position: [0, 1.2, 0] });
    simulate(rig, 2);
    rig.vehicle.body.setLinvel({ x: 0, y: 7, z: 18 }, true);
    rig.vehicle.body.setAngvel({ x: 2.5, y: 0.6, z: 1.8 }, true);

    const flight = simulate(rig, 4);

    expect(flight.maxSpin).toBeLessThan(7);
    const up = new Vector3(0, 1, 0).applyQuaternion(
      rig.vehicle.getWorldRotation(),
    );
    expect((up.angleTo(new Vector3(0, 1, 0)) * 180) / Math.PI).toBeLessThan(15);
    expect(rig.vehicle.isWreckage()).toBe(false);
  });

  it("el hidrodeslizador derrapa ancho al virar sin trompear", async () => {
    const rig = await spawn(
      { presetId: "airboat", position: [0, 1.2, 0] },
      { water: true },
    );
    simulate(rig, 3);
    accelerate(rig, 5);

    const cruise = rig.vehicle.getTelemetry().forwardSpeed;
    rig.vehicle.setControl({
      throttle: 1,
      steering: 1,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    const turn = simulate(rig, 3);

    // Vira de verdad...
    expect(Math.abs(turn.yaw)).toBeGreaterThan(0.6);
    // ...derrapando (el casco no apunta a donde viaja)...
    expect(turn.maxSlipDegrees).toBeGreaterThan(8);
    // ...pero sin quedar girando sobre sí mismo: conserva la marcha.
    expect(rig.vehicle.getTelemetry().forwardSpeed).toBeGreaterThan(
      cruise * 0.6,
    );
  });

  it("el freno de agua raspa velocidad del hidrodeslizador", async () => {
    const rig = await spawn(
      { presetId: "airboat", position: [0, 1.2, 0] },
      { water: true },
    );
    simulate(rig, 3);
    accelerate(rig, 5);

    const cruise = rig.vehicle.getTelemetry().forwardSpeed;
    rig.vehicle.setControl({
      throttle: 0,
      steering: 0,
      brake: 0,
      handbrake: 1,
      boost: false,
    });
    simulate(rig, 3);

    expect(rig.vehicle.getTelemetry().forwardSpeed).toBeLessThan(cruise * 0.25);
  });

  it("un hidrodeslizador varado puede volver al agua", async () => {
    // Sin esto el jugador que encalla queda obligado a bajarse y seguir a pie.
    const rig = await spawn({ presetId: "airboat", position: [0, 1.2, 0] });
    simulate(rig, 3);

    const start = rig.vehicle.getWorldPosition();
    accelerate(rig, 5);

    const travelled = rig.vehicle.getWorldPosition().z - start.z;
    expect(travelled).toBeGreaterThan(4);
    // Pero arrastrándose: en el agua recorrería mucho más en el mismo tiempo.
    expect(travelled).toBeLessThan(40);
  });

  it("el airboat responde al acelerador sobre el agua", async () => {
    const rig = await spawn(
      { presetId: "airboat", position: [0, 1.2, 0] },
      { water: true },
    );
    simulate(rig, 1.5);

    const start = rig.vehicle.getWorldPosition();
    rig.vehicle.setControl({
      throttle: 1,
      steering: 0,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    const trace = simulate(rig, 4);
    const end = rig.vehicle.getWorldPosition();

    expect(end.z - start.z).toBeGreaterThan(4);
    expect(trace.maxSpeed).toBeLessThan(30);
    expect(trace.maxTiltDegrees).toBeLessThan(35);
  });

  it("el airboat responde al timón en ambos sentidos por igual", async () => {
    // La dirección la fija VehicleSteering.test.ts. Esta versión antes exigía
    // que el morro girara hacia +X, que es la izquierda: tenía la convención
    // al revés y por eso el timón del hidrodeslizador quedó invertido.
    const right = await rudder(1);
    const left = await rudder(-1);

    expect(Math.abs(right)).toBeGreaterThan(0.2);
    expect(Math.sign(right)).toBe(-Math.sign(left));
  });

  it("conducir normalmente no daña al propio vehículo", async () => {
    const rig = await spawn(
      { presetId: "airboat", position: [0, 1.2, 0] },
      { water: true },
    );
    simulate(rig, 3);
    rig.vehicle.setControl({
      throttle: 1,
      steering: 0.3,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    simulate(rig, 6);

    expect(rig.vehicle.damage.getHull().current).toBe(
      rig.vehicle.damage.getHull().max,
    );
    expect(rig.impacts).toBe(0);
    expect(rig.vehicle.isWreckage()).toBe(false);
  });

  it("ningún vehículo genera impactos de daño estando quieto", async () => {
    for (const presetId of ["buggy", "airboat"] as const) {
      const rig = await spawn({ presetId, position: [0, 0.9, 0] });
      simulate(rig, 4);
      expect(
        `${presetId}:${rig.impacts}`,
        `${presetId} reportó impactos en reposo`,
      ).toBe(`${presetId}:0`);
    }
  });

  it("el peso de reposo no cuenta como impacto contra el ocupante", async () => {
    // Un casco apoyado transmite su propio peso por el contacto: el airboat son
    // ~16 kN, por encima del viejo umbral fijo de 14 kN, así que se "chocaba"
    // solo y lastimaba a quien iba a bordo.
    for (const presetId of ["buggy", "airboat"] as const) {
      const rig = await spawn({ presetId, position: [0, 0.9, 0] });
      simulate(rig, 3);
      // Descartar el golpe del aterrizaje: acá interesa sólo el reposo.
      rig.physics.consumeContactForceEvents();

      simulate(rig, 4);
      for (const contact of rig.physics.consumeContactForceEvents()) {
        rig.vehicle.processContactForce(contact, null);
      }
      expect(
        `${presetId}:${rig.vehicle.damage.getHull().current}`,
        `${presetId} se dañó solo estando apoyado`,
      ).toBe(`${presetId}:${rig.vehicle.damage.getHull().max}`);
      expect(rig.impacts).toBe(0);
    }
  });

  it("la rueda dibujada apoya donde la apoya el raycast", async () => {
    const rig = await spawn({ presetId: "buggy", position: [0, 1.2, 0] });
    simulate(rig, 3);

    // `suspension` va en metros desde la extensión total, y el nodo visual de la
    // rueda arranca en esa pose: sumarlos da el centro real de la rueda.
    const telemetry = rig.vehicle.getTelemetry();
    const restLength = 0.36;
    const connectionY = 0.75 - 0.24;
    const bodyY = rig.vehicle.getWorldPosition().y;
    for (const wheel of telemetry.wheels) {
      if (!wheel.inContact) continue;
      const wheelCenterY = bodyY + connectionY - wheel.suspensionLength;
      const visualBaseY = connectionY - restLength;
      const visualCenterY =
        bodyY + visualBaseY + (restLength - wheel.suspensionLength);
      expect(visualCenterY).toBeCloseTo(wheelCenterY, 6);
      // Y el borde inferior toca el piso (y = 0) con el radio del raycast.
      expect(wheelCenterY - 0.46).toBeCloseTo(0, 1);
    }
  });
});

interface Rig {
  readonly physics: PhysicsWorld;
  readonly vehicle: VehicleEntity;
  impacts: number;
}

interface Trace {
  readonly maxSpeed: number;
  readonly maxHeight: number;
  readonly maxTiltDegrees: number;
  /** Guiñada acumulada y con signo, inmune al solape de `atan2`. */
  readonly yaw: number;
  readonly maxSpin: number;
  /** Mayor ángulo entre el morro y la velocidad, en grados. */
  readonly maxSlipDegrees: number;
}

const WORLD_UP = new Vector3(0, 1, 0);

function simulate(rig: Rig, seconds: number): Trace {
  let maxSpeed = 0;
  let maxHeight = -Infinity;
  let maxTilt = 0;
  let maxSpin = 0;
  let maxSlip = 0;
  let yaw = 0;
  let previousHeading = heading(rig);
  for (let frame = 0; frame < Math.round(seconds / DT); frame += 1) {
    rig.physics.step(DT);
    const position = rig.vehicle.getWorldPosition();
    const rotation = rig.vehicle.getWorldRotation();
    const localUp = new Vector3(0, 1, 0).applyQuaternion(rotation).normalize();
    const velocity = rig.vehicle.getLinearVelocity();
    maxSpeed = Math.max(maxSpeed, velocity.length());
    maxHeight = Math.max(maxHeight, position.y);
    maxTilt = Math.max(maxTilt, localUp.angleTo(WORLD_UP));
    maxSpin = Math.max(
      maxSpin,
      rig.vehicle.getTelemetry().state.angularVelocity.length(),
    );
    if (velocity.length() > 3) {
      const forward = new Vector3(0, 0, 1).applyQuaternion(rotation).setY(0);
      maxSlip = Math.max(maxSlip, velocity.clone().setY(0).angleTo(forward));
    }
    const current = heading(rig);
    yaw += wrapToPi(current - previousHeading);
    previousHeading = current;
  }
  return {
    maxSpeed,
    maxHeight,
    maxTiltDegrees: (maxTilt * 180) / Math.PI,
    yaw,
    maxSpin,
    maxSlipDegrees: (maxSlip * 180) / Math.PI,
  };
}

function heading(rig: Rig): number {
  const forward = new Vector3(0, 0, 1).applyQuaternion(
    rig.vehicle.getWorldRotation(),
  );
  return Math.atan2(forward.x, forward.z);
}

function wrapToPi(angle: number): number {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
}

function accelerate(rig: Rig, seconds: number): void {
  rig.vehicle.setControl({
    throttle: 1,
    steering: 0,
    brake: 0,
    handbrake: 0,
    boost: false,
  });
  simulate(rig, seconds);
}

async function stoppingDistance(stop: {
  brake: number;
  handbrake: number;
}): Promise<{ distance: number; seconds: number }> {
  const rig = await spawn({ presetId: "buggy", position: [0, 1.2, 0] });
  simulate(rig, 2);
  accelerate(rig, 6);

  const start = rig.vehicle.getWorldPosition().z;
  rig.vehicle.setControl({
    throttle: 0,
    steering: 0,
    brake: stop.brake,
    handbrake: stop.handbrake,
    boost: false,
  });
  const frames = Math.round(10 / DT);
  for (let frame = 0; frame < frames; frame += 1) {
    rig.physics.step(DT);
    if (rig.vehicle.getTelemetry().forwardSpeed <= 0.2) {
      return {
        distance: rig.vehicle.getWorldPosition().z - start,
        seconds: frame * DT,
      };
    }
  }
  return {
    distance: rig.vehicle.getWorldPosition().z - start,
    seconds: Infinity,
  };
}

async function turnWheel(steering: number): Promise<{ yaw: number }> {
  const rig = await spawn({ presetId: "buggy", position: [0, 1.2, 0] });
  simulate(rig, 2);
  rig.vehicle.setControl({
    throttle: 0.8,
    steering,
    brake: 0,
    handbrake: 0,
    boost: false,
  });
  return { yaw: simulate(rig, 2).yaw };
}

async function rudder(steering: number): Promise<number> {
  const rig = await spawn(
    { presetId: "airboat", position: [0, 1.2, 0] },
    { water: true },
  );
  simulate(rig, 3);
  rig.vehicle.setControl({
    throttle: 0.8,
    steering,
    brake: 0,
    handbrake: 0,
    boost: false,
  });
  return simulate(rig, 4).yaw;
}

async function corner(handbrake: number): Promise<{
  slip: number;
  yaw: number;
}> {
  const rig = await spawn({ presetId: "buggy", position: [0, 1.2, 0] });
  simulate(rig, 2);
  accelerate(rig, 5);

  let slip = 0;
  let yaw = 0;
  const right = new Vector3();
  for (let frame = 0; frame < Math.round(2 / DT); frame += 1) {
    rig.vehicle.setControl({
      throttle: 0.6,
      steering: 1,
      brake: 0,
      handbrake,
      boost: false,
    });
    rig.physics.step(DT);
    right.set(1, 0, 0).applyQuaternion(rig.vehicle.getWorldRotation());
    slip = Math.max(slip, Math.abs(rig.vehicle.getLinearVelocity().dot(right)));
    yaw = Math.max(
      yaw,
      Math.abs(rig.vehicle.getTelemetry().state.angularVelocity.y),
    );
  }
  return { slip, yaw };
}

async function spawn(
  definition: Partial<VehicleDefinition> & { presetId: "buggy" | "airboat" },
  options: { readonly water?: boolean } = {},
): Promise<Rig> {
  const physics = new PhysicsWorld();
  await physics.init();
  // Largo de sobra: a 36 m/s el buggy recorre 100 m en 3 s, y si se pasa del
  // borde queda en el aire y deja de frenar, falseando cualquier medición.
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(600, 1, 3000),
  });

  const water = new WaterVolumeSystem(new Scene());
  if (options.water) {
    const volume: WaterVolumeDefinition = {
      id: "canal",
      position: [0, -0.5, 0],
      size: [200, 3, 200],
      surface: "canal",
    };
    water.load([volume]);
  }

  const rig: Rig = {
    physics,
    vehicle: new VehicleEntity(
      physics,
      new Scene(),
      { cast: vi.fn(() => null) } as unknown as RaycastSource,
      water,
      { id: "test", position: [0, 1.2, 0], ...definition },
      new Map(),
      new EventBus<GameEventMap>(),
      {
        registerEntity: vi.fn(),
        registerConnections: vi.fn(),
        fireOutput: vi.fn(),
      } as unknown as EntityIOSystem,
      {
        onImpact: () => {
          rig.impacts += 1;
        },
        onCrashStarted: vi.fn(),
        onCrashFinished: vi.fn(),
        onDestroyed: vi.fn(),
      },
    ),
    impacts: 0,
  };
  physics.updateQueryPipeline();
  return rig;
}
