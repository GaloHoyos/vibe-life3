import { describe, expect, it } from "vitest";
import {
  VehicleDriverInputModel,
  type VehicleDriverIntent,
} from "@engine/physics/vehicle/VehicleDriverInput";

const DT = 1 / 60;

const IDLE: VehicleDriverIntent = {
  forward: false,
  back: false,
  left: false,
  right: false,
  handbrake: false,
  boost: false,
};

/**
 * El modelo de conducción de Half-Life 2: acelerador y freno no son el mismo
 * eje. La tecla contraria a la marcha frena, y sólo da marcha atrás una vez
 * que el vehículo se detuvo de verdad.
 */
describe("VehicleDriverInputModel", () => {
  it("retroceder frena antes de dar marcha atrás", () => {
    const model = new VehicleDriverInputModel();

    // A 20 m/s hacia adelante, la tecla de retroceso es el freno.
    const control = hold(model, { ...IDLE, back: true }, 20, 0.5);

    expect(control.brake).toBeGreaterThan(0.9);
    expect(control.throttle).toBe(0);
  });

  it("una vez detenido, la misma tecla da marcha atrás", () => {
    const model = new VehicleDriverInputModel();
    hold(model, { ...IDLE, back: true }, 20, 0.5);

    const control = hold(model, { ...IDLE, back: true }, 0, 0.5);

    expect(control.throttle).toBeLessThan(-0.9);
    expect(control.brake).toBe(0);
  });

  it("avanzar frena si el vehículo va marcha atrás", () => {
    const model = new VehicleDriverInputModel();

    const control = hold(model, { ...IDLE, forward: true }, -8, 0.5);

    expect(control.brake).toBeGreaterThan(0.9);
    expect(control.throttle).toBe(0);
  });

  it("frena más rápido yendo hacia adelante que hacia atrás", () => {
    const forward = new VehicleDriverInputModel();
    const backward = new VehicleDriverInputModel();

    const braking = hold(forward, { ...IDLE, back: true }, 20, 0.12);
    const arresting = hold(backward, { ...IDLE, forward: true }, -20, 0.12);

    expect(braking.brake).toBeGreaterThan(arresting.brake);
  });

  it("soltar todo deja el vehículo rodando, no frenado", () => {
    const model = new VehicleDriverInputModel();
    hold(model, { ...IDLE, forward: true }, 12, 1);

    const control = hold(model, IDLE, 12, 0.5);

    expect(control.throttle).toBe(0);
    expect(control.brake).toBe(0);
  });

  it("el volante llega a tope y se centra solo al soltar", () => {
    const model = new VehicleDriverInputModel();

    const turning = hold(model, { ...IDLE, right: true }, 10, 1);
    expect(turning.steering).toBeCloseTo(1, 5);

    const released = hold(model, IDLE, 10, 1);
    expect(released.steering).toBeCloseTo(0, 5);
  });

  it("el volante tarda en llegar a tope: no es un interruptor", () => {
    const model = new VehicleDriverInputModel();

    const control = model.update({ ...IDLE, right: true }, 10, DT);

    expect(control.steering).toBeGreaterThan(0);
    expect(control.steering).toBeLessThan(0.2);
  });

  it("doblar recorta el acelerador a velocidad alta", () => {
    const straight = new VehicleDriverInputModel();
    const turning = new VehicleDriverInputModel();

    const full = hold(straight, { ...IDLE, forward: true }, 30, 2);
    const cornering = hold(turning, { ...IDLE, forward: true, right: true }, 30, 2);

    expect(full.throttle).toBeCloseTo(1, 5);
    expect(cornering.throttle).toBeLessThan(0.8);
  });

  it("arrancar en curva no recorta el acelerador", () => {
    const model = new VehicleDriverInputModel();

    const control = hold(model, { ...IDLE, forward: true, right: true }, 0, 2);

    expect(control.throttle).toBeCloseTo(1, 5);
  });

  it("el impulso no se activa sin acelerador", () => {
    const model = new VehicleDriverInputModel();

    const coasting = hold(model, { ...IDLE, boost: true }, 20, 0.5);
    expect(coasting.boost).toBe(false);

    const accelerating = hold(model, { ...IDLE, forward: true, boost: true }, 20, 0.5);
    expect(accelerating.boost).toBe(true);
  });

  it("el freno de mano pasa directo y no depende de la marcha", () => {
    const model = new VehicleDriverInputModel();

    expect(hold(model, { ...IDLE, handbrake: true }, 25, 0.2).handbrake).toBe(1);
    expect(hold(model, { ...IDLE, handbrake: true }, -3, 0.2).handbrake).toBe(1);
    expect(hold(model, IDLE, 25, 0.2).handbrake).toBe(0);
  });

  it("reset descarta el estado del vehículo anterior", () => {
    const model = new VehicleDriverInputModel();
    hold(model, { ...IDLE, forward: true, right: true }, 20, 2);

    model.reset();
    const control = model.update(IDLE, 0, DT);

    expect(control.throttle).toBe(0);
    expect(control.steering).toBe(0);
    expect(control.brake).toBe(0);
  });
});

function hold(
  model: VehicleDriverInputModel,
  intent: VehicleDriverIntent,
  forwardSpeed: number,
  seconds: number,
): ReturnType<VehicleDriverInputModel["update"]> {
  let control = model.update(intent, forwardSpeed, DT);
  for (let frame = 1; frame < Math.round(seconds / DT); frame += 1) {
    control = model.update(intent, forwardSpeed, DT);
  }
  return control;
}
