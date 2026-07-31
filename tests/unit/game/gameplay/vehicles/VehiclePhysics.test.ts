import { beforeAll, describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Scene, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { RaycastSource } from "@engine/physics/Raycast";
import type { VehicleControlInput } from "@engine/physics/vehicle";
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

  it("un buggy estacionado no se mueve hasta encender, y ahí sí anda", async () => {
    const rig = await spawn({
      presetId: "buggy",
      position: [0, 1.2, 0],
      engineOn: false,
    });
    simulate(rig, 2);
    const throttle = {
      throttle: 1,
      steering: 0,
      brake: 0,
      handbrake: 0,
      boost: false,
    };

    const parked = rig.vehicle.getWorldPosition().clone();
    rig.vehicle.setControl(throttle);
    simulate(rig, 3);
    expect(rig.vehicle.getWorldPosition().distanceTo(parked)).toBeLessThan(0.5);

    // Sentarse al volante lo enciende: mismo acelerador, ahora avanza.
    expect(rig.vehicle.tryStartEngine()).toBe(true);
    const start = rig.vehicle.getWorldPosition().clone();
    rig.vehicle.setControl(throttle);
    simulate(rig, 3);
    expect(rig.vehicle.getWorldPosition().z - start.z).toBeGreaterThan(4);
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

  it("el transporte oruga se asienta y avanza sin volcar", async () => {
    const rig = await spawn({
      presetId: "rebelCrawler",
      position: [0, 1.4, 0],
    });
    simulate(rig, 2.5);

    const start = rig.vehicle.getWorldPosition();
    rig.vehicle.setControl({
      throttle: 1,
      steering: 0,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    const trace = simulate(rig, 5);
    const end = rig.vehicle.getWorldPosition();

    expect(end.z - start.z).toBeGreaterThan(5);
    expect(Math.abs(end.x - start.x)).toBeLessThan(2.5);
    expect(trace.maxTiltDegrees).toBeLessThan(30);
    expect(rig.vehicle.isWreckage()).toBe(false);
  });

  it("el deslizador Combine mantiene altura y avanza sobre tierra", async () => {
    const rig = await spawn({
      presetId: "combineGlider",
      position: [0, 1.4, 0],
    });
    simulate(rig, 3);

    const settledHeight = rig.vehicle.getWorldPosition().y;
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

    expect(settledHeight).toBeGreaterThan(0.55);
    expect(settledHeight).toBeLessThan(0.82);
    expect(end.z - start.z).toBeGreaterThan(6);
    expect(trace.maxTiltDegrees).toBeLessThan(25);
    expect(rig.vehicle.getTelemetry().grounded).toBe(true);
  });

  it("el deslizador Combine gira desde el reposo sobre tierra", async () => {
    const rig = await spawn({
      presetId: "combineGlider",
      position: [0, 1.15, 0],
      rotation: [0, Math.PI, 0],
    });
    simulate(rig, 2);

    rig.vehicle.setControl({
      throttle: 1,
      steering: 1,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    const turn = simulate(rig, 2);

    expect(Math.abs(turn.yaw)).toBeGreaterThan(0.35);
    expect(rig.vehicle.getTelemetry().grounded).toBe(true);
  });

  it("el deslizador Combine responde con precisión a cambios de dirección", async () => {
    const rig = await spawn({
      presetId: "combineGlider",
      position: [0, 1.15, 0],
    });
    simulate(rig, 2);
    rig.vehicle.setControl({
      throttle: 1,
      steering: 0,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    simulate(rig, 1);
    const speedAfterOneSecond = rig.vehicle.getTelemetry().forwardSpeed;

    rig.vehicle.setControl({
      throttle: 1,
      steering: 1,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    const turn = simulate(rig, 1);
    rig.vehicle.setControl({
      throttle: 1,
      steering: 0,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    simulate(rig, 0.6);
    expect(speedAfterOneSecond).toBeGreaterThan(6.5);
    expect(Math.abs(turn.yaw)).toBeGreaterThan(0.35);
    expect(Math.abs(turn.yaw)).toBeLessThan(0.65);
    expect(turn.maxSlipDegrees).toBeLessThan(15);
    expect(
      Math.abs(rig.vehicle.getTelemetry().state.angularVelocity.y),
    ).toBeLessThan(0.12);
  });

  it("el deslizador Combine gira de forma acentuada a baja velocidad", async () => {
    const rig = await spawn({
      presetId: "combineGlider",
      position: [0, 1.15, 0],
    });
    simulate(rig, 2);
    rig.vehicle.setControl({
      throttle: 0.3,
      steering: 1,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    const turn = simulate(rig, 1);

    expect(rig.vehicle.getTelemetry().forwardSpeed).toBeLessThan(4);
    expect(Math.abs(turn.yaw)).toBeGreaterThan(0.55);
    expect(turn.maxSlipDegrees).toBeLessThan(20);
  });

  it("el deslizador Combine cruza agua sin sumergirse", async () => {
    const rig = await spawn(
      { presetId: "combineGlider", position: [0, 1.8, 0] },
      { water: true },
    );
    simulate(rig, 4);

    expect(rig.vehicle.getWorldPosition().y).toBeGreaterThan(1.3);
    expect(rig.vehicle.getTelemetry().grounded).toBe(true);
    expect(rig.vehicle.getTelemetry().submergedRatio).toBeLessThan(0.1);
  });

  it("el deslizador Combine recupera una pose nivelada al salir del agua", async () => {
    const rig = await spawn(
      { presetId: "combineGlider", position: [0, 1.8, 82] },
      { water: true },
    );
    simulate(rig, 3);
    accelerate(rig, 5);

    expect(rig.vehicle.getWorldPosition().z).toBeGreaterThan(105);
    rig.vehicle.setControl({
      throttle: 0,
      steering: 0,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    simulate(rig, 3);

    const up = WORLD_UP.clone().applyQuaternion(rig.vehicle.getWorldRotation());
    expect((up.angleTo(WORLD_UP) * 180) / Math.PI).toBeLessThan(8);
    expect(rig.vehicle.getTelemetry().grounded).toBe(true);
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

  it("un buggy a máxima velocidad mata al NPC aunque Rapier lo frene al impactar", async () => {
    const rig = await spawn({ presetId: "buggy", position: [0, 1.2, 0] });
    simulate(rig, 2);
    accelerate(rig, 6);
    const speedBeforeImpact = rig.vehicle.getLinearVelocity().length();
    const targetPosition = rig.vehicle
      .getWorldPosition()
      .add(new Vector3(0, 0.25, 10));
    const applyDamage = vi.fn();
    rig.physics.createStaticBox({
      id: "combine-runover-target",
      position: targetPosition,
      size: new Vector3(3, 1.8, 0.8),
      metadata: {
        kind: "npc",
        ownerId: "combine-runover-target",
        damageable: {
          applyDamage,
          isAlive: () => true,
        },
      },
    });
    rig.physics.updateQueryPipeline();

    rig.vehicle.setControl({
      throttle: 1,
      steering: 0,
      brake: 0,
      handbrake: 0,
      boost: false,
    });
    let speedAfterImpact = speedBeforeImpact;
    for (
      let frame = 0;
      frame < 120 && applyDamage.mock.calls.length === 0;
      frame += 1
    ) {
      rig.physics.step(DT);
      for (const contact of rig.physics.consumeContactForceEvents()) {
        if (rig.vehicle.containsCollider(contact.collider1)) {
          rig.vehicle.processContactForce(
            contact,
            rig.physics.world.getCollider(contact.collider2),
          );
        } else if (rig.vehicle.containsCollider(contact.collider2)) {
          rig.vehicle.processContactForce(
            {
              ...contact,
              collider1: contact.collider2,
              collider2: contact.collider1,
              totalForce: contact.totalForce.clone().multiplyScalar(-1),
              maxForceDirection: contact.maxForceDirection
                .clone()
                .multiplyScalar(-1),
            },
            rig.physics.world.getCollider(contact.collider1),
          );
        }
      }
      rig.vehicle.update(DT, frame * DT, false, null);
      speedAfterImpact = rig.vehicle.getLinearVelocity().length();
    }

    expect(speedBeforeImpact).toBeGreaterThan(25.4);
    expect(speedAfterImpact).toBeLessThan(speedBeforeImpact * 0.5);
    expect(applyDamage).toHaveBeenCalledWith(
      500,
      expect.any(Vector3),
      undefined,
      rig.vehicle.id,
      expect.any(Vector3),
      "physics",
    );
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

/**
 * El helicóptero pilotable no tiene equivalente en Source, así que lo que se
 * verifica es el contrato del modelo híbrido: se posa solo, no se vuelca nunca,
 * la altitud la manda el colectivo y el ladeo vira sin tocar los pedales.
 */
describe("helicóptero de vuelo libre", () => {
  it("se posa solo desde el aire y queda quieto en el suelo", async () => {
    const rig = await spawn({ presetId: "helicopterFree", position: [0, 4, 0] });
    fly(rig, {});

    simulate(rig, 6);
    const settled = simulate(rig, 3);

    expect(rig.vehicle.getTelemetry().grounded).toBe(true);
    expect(rig.vehicle.getTelemetry().altitude).toBeLessThan(0.2);
    expect(settled.maxSpeed).toBeLessThan(0.6);
    expect(settled.maxTiltDegrees).toBeLessThan(6);
    expect(rig.vehicle.isWreckage()).toBe(false);
  });

  it("sin motor el rotor pierde empuje y el aparato cae", async () => {
    const dead = await spawn({
      presetId: "helicopterFree",
      position: [0, 40, 0],
      engineOn: false,
    });
    const live = await spawn({ presetId: "helicopterFree", position: [0, 40, 0] });
    fly(dead, { collective: 1 });
    fly(live, { collective: 1 });

    simulate(dead, 2);
    simulate(live, 2);

    // Mismo colectivo a fondo: el vivo trepa, el muerto se viene abajo. El rotor
    // sin potencia sigue frenando algo la caída, que es lo que hace un rotor
    // real en autorrotación, así que no cae como una piedra.
    expect(live.vehicle.getWorldPosition().y).toBeGreaterThan(45);
    expect(dead.vehicle.getWorldPosition().y).toBeLessThan(30);
  });

  it("el colectivo manda la altitud en ambos sentidos", async () => {
    const rig = await spawn({ presetId: "helicopterFree", position: [0, 20, 0] });
    fly(rig, { collective: 1 });
    simulate(rig, 3);
    const climbed = rig.vehicle.getWorldPosition().y;
    expect(climbed).toBeGreaterThan(25);

    // Bajar arranca contra la inercia de la trepada: el primer segundo se va
    // sólo en detener la subida.
    fly(rig, { collective: -1 });
    simulate(rig, 4);
    expect(rig.vehicle.getWorldPosition().y).toBeLessThan(climbed - 15);
  });

  it("el cíclico traslada sin volcar el aparato", async () => {
    const rig = await spawn({ presetId: "helicopterFree", position: [0, 25, 0] });
    fly(rig, { throttle: 1 });

    const start = rig.vehicle.getWorldPosition().z;
    const trace = simulate(rig, 5);
    const travelled = rig.vehicle.getWorldPosition().z - start;

    expect(travelled).toBeGreaterThan(20);
    // Inclinarse cuesta sustentación, pero el motor la compensa: nada de
    // desplomarse cada vez que el piloto quiere avanzar.
    expect(rig.vehicle.getWorldPosition().y).toBeGreaterThan(18);
    // El techo del cíclico es `maxPitch` = 0.42 rad; con margen para el PD.
    expect(trace.maxTiltDegrees).toBeLessThan(32);
  });

  it("los pedales guiñan hacia el lado correcto", async () => {
    const rig = await spawn({ presetId: "helicopterFree", position: [0, 25, 0] });
    fly(rig, { yaw: 1 });

    const trace = simulate(rig, 3);

    // La derecha del proyecto es `forward × up` = -X, o sea que virar a la
    // derecha BAJA `atan2(forward.x, forward.z)`.
    expect(trace.yaw).toBeLessThan(-0.9);
  });

  it("el ladeo vira solo, sin tocar los pedales", async () => {
    const rig = await spawn({ presetId: "helicopterFree", position: [0, 25, 0] });
    fly(rig, { throttle: 0.6, steering: 1 });

    const trace = simulate(rig, 4);

    expect(trace.yaw).toBeLessThan(-0.5);
    expect(trace.maxTiltDegrees).toBeLessThan(45);
  });

  it("sin nadie a los mandos se va de guiñada y se viene abajo", async () => {
    const rig = await spawn({ presetId: "helicopterFree", position: [0, 80, 0] });
    fly(rig, {});
    fall(rig, 2);
    const cruise = rig.vehicle.getWorldPosition().y;

    rig.vehicle.beginCrash();
    // Perder el control no es reventar: el aparato baja entero, y ese es el
    // margen que tiene quien va a bordo para saltar.
    expect(rig.vehicle.isWreckage()).toBe(false);

    const falling = fall(rig, 4);

    expect(rig.vehicle.getWorldPosition().y).toBeLessThan(cruise - 20);
    // El par del rotor sin nadie que lo contrarreste: se va girando.
    expect(Math.abs(falling.yaw)).toBeGreaterThan(2);
    // Y ladeado, porque ya nadie compensa la inclinación con el colectivo.
    expect(falling.maxTiltDegrees).toBeGreaterThan(30);
  });

  it("el estallido llega al tocar, no al perder el control", async () => {
    const rig = await spawn({ presetId: "helicopterFree", position: [0, 40, 0] });
    fly(rig, { collective: 0 });
    fall(rig, 1);

    rig.vehicle.beginCrash();
    fall(rig, 1);
    expect(rig.vehicle.isWreckage()).toBe(false);

    fall(rig, 10);
    expect(rig.vehicle.isWreckage()).toBe(true);
  });

  it("no se puede volcar ni con todos los mandos a fondo", async () => {
    const rig = await spawn({ presetId: "helicopterFree", position: [0, 45, 0] });
    fly(rig, { throttle: 1, steering: 1, yaw: 1, collective: 1 });
    const first = simulate(rig, 5);
    fly(rig, { throttle: -1, steering: -1, yaw: -1, collective: -1 });
    const second = simulate(rig, 5);

    expect(Math.max(first.maxTiltDegrees, second.maxTiltDegrees)).toBeLessThan(50);
    expect(rig.vehicle.isWreckage()).toBe(false);
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

function simulate(rig: Rig, seconds: number, tickEntity = false): Trace {
  let maxSpeed = 0;
  let maxHeight = -Infinity;
  let maxTilt = 0;
  let maxSpin = 0;
  let maxSlip = 0;
  let yaw = 0;
  let previousHeading = heading(rig);
  for (let frame = 0; frame < Math.round(seconds / DT); frame += 1) {
    rig.physics.step(DT);
    if (tickEntity) rig.vehicle.update(DT, frame * DT, false, null);
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

/**
 * Como `simulate`, pero tickeando también la entidad: el golpe que convierte la
 * caída en chatarra se decide en `VehicleEntity.update`, no en el step.
 */
function fall(rig: Rig, seconds: number): Trace {
  return simulate(rig, seconds, true);
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

/** Mandos de vuelo; lo que no se pasa queda en neutro. */
function fly(rig: Rig, control: Partial<VehicleControlInput>): void {
  rig.vehicle.setControl({
    throttle: 0,
    steering: 0,
    brake: 0,
    handbrake: 0,
    boost: false,
    collective: 0,
    yaw: 0,
    ...control,
  });
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
  definition: Partial<VehicleDefinition> & {
    presetId:
      | "buggy"
      | "airboat"
      | "rebelCrawler"
      | "combineGlider"
      | "helicopterFree";
  },
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
