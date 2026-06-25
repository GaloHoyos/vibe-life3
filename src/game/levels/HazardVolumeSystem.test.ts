import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { HazardVolumeSystem, type HazardVfx } from "./HazardVolumeSystem";

const noopVfx: HazardVfx = {
  createEmitter: () => ({ setActive: () => {}, dispose: () => {} }),
};

function setup() {
  const bus = new EventBus<GameEventMap>();
  const events: GameEventMap["player.hazard"][] = [];
  bus.on("player.hazard", (e) => events.push(e));
  return { system: new HazardVolumeSystem(bus, noopVfx), events };
}

describe("HazardVolumeSystem", () => {
  it("no daña fuera del volumen", () => {
    const { system, events } = setup();
    system.addVolume({ id: "h", position: [0, 0, 0], size: [2, 2, 2], kind: "toxic", damagePerSecond: 20 });
    system.update(new Vector3(10, 0, 0), 0.1);
    expect(events).toHaveLength(0);
  });

  it("pega un tick al entrar y luego uno por intervalo", () => {
    const { system, events } = setup();
    system.addVolume({ id: "h", position: [0, 0, 0], size: [4, 4, 4], kind: "toxic", damagePerSecond: 20 });
    const inside = new Vector3(0, 0, 0);

    // Primer frame dentro: el tick está armado, pega de inmediato un chunk (dps * intervalo).
    system.update(inside, 0.016);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "toxic", instant: false, amount: 8 });

    // Frame corto: no alcanza el intervalo → sin tick nuevo.
    system.update(inside, 0.1);
    expect(events).toHaveLength(1);

    // Acumula hasta el intervalo → nuevo tick.
    system.update(inside, 0.3);
    expect(events).toHaveLength(2);
  });

  it("instantKill emite daño letal una sola vez por frame", () => {
    const { system, events } = setup();
    system.addVolume({ id: "void", position: [0, 0, 0], size: [4, 4, 4], kind: "void", damagePerSecond: 0, instantKill: true });
    system.update(new Vector3(0, 0, 0), 0.016);
    expect(events).toHaveLength(1);
    expect(events[0].instant).toBe(true);
    expect(events[0].amount).toBeGreaterThanOrEqual(1000);
  });

  it("re-arma el tick al salir: la próxima entrada vuelve a pegar de inmediato", () => {
    const { system, events } = setup();
    system.addVolume({ id: "h", position: [0, 0, 0], size: [4, 4, 4], kind: "fire", damagePerSecond: 30 });
    const inside = new Vector3(0, 0, 0);
    const outside = new Vector3(20, 0, 0);

    system.update(inside, 0.016);
    expect(events).toHaveLength(1);
    system.update(outside, 0.016); // sale
    system.update(inside, 0.016); // reentra → tick inmediato otra vez
    expect(events).toHaveLength(2);
  });
});

/** VfxSystem que cuenta emisores creados/dispuestos sin tocar WebGL. */
function countingVfx() {
  const state = { created: 0, disposed: 0 };
  const vfx: HazardVfx = {
    createEmitter: () => {
      state.created += 1;
      return { setActive: () => {}, dispose: () => { state.disposed += 1; } };
    },
  };
  return { vfx, state };
}

describe("HazardVolumeSystem efectos", () => {
  it("crea emisores para fuego/tóxico/eléctrico y los dispone al limpiar", () => {
    const { vfx, state } = countingVfx();
    const system = new HazardVolumeSystem(new EventBus<GameEventMap>(), vfx);
    system.addVolume({ id: "fire", position: [0, 0, 0], size: [4, 2, 4], kind: "fire", damagePerSecond: 10 });
    expect(state.created).toBeGreaterThan(0);
    const afterFire = state.created;

    system.addVolume({ id: "tox", position: [10, 0, 0], size: [4, 2, 4], kind: "toxic", damagePerSecond: 10 });
    expect(state.created).toBeGreaterThan(afterFire);

    system.clear();
    expect(state.disposed).toBe(state.created);
  });

  it("no crea efecto cuando showEffect es false, ni para void", () => {
    const { vfx, state } = countingVfx();
    const system = new HazardVolumeSystem(new EventBus<GameEventMap>(), vfx);
    system.addVolume({ id: "off", position: [0, 0, 0], size: [4, 2, 4], kind: "fire", damagePerSecond: 10, showEffect: false });
    system.addVolume({ id: "void", position: [10, 0, 0], size: [4, 2, 4], kind: "void", damagePerSecond: 0, instantKill: true });
    expect(state.created).toBe(0);
  });
});
