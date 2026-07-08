import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Object3D, Quaternion, Scene, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import {
  PhysicsGrabController,
  type GrabTuning,
} from "@engine/physics/grab/PhysicsGrabController";
import { PortalPairState, type PortalFrame } from "@engine/portals/PortalFrame";
import {
  PortalTravellerSystem,
  type PortalTravellerOptions,
} from "@engine/portals/PortalTravellerSystem";

beforeAll(async () => {
  await RAPIER.init();
});

const TRAVELLER_OPTIONS: PortalTravellerOptions = {
  apertureRadius: 2.2,
  apertureThickness: 0.1,
  suppressMinIntoSpeed: 1.2,
  suppressLookaheadSeconds: 0.1,
  cloneEnabled: true,
  crossingMargin: 1.15,
  dynamicTriggerOffset: 0.25,
  cooldownSeconds: 0.15,
  minExitSpeed: 1.5,
  dynamicExitClearance: 0.35,
  dynamicQueryRadius: 3,
};

const TUNING: GrabTuning = {
  holdDistance: 2.4,
  minHoldDistance: 0.9,
  wallClampMargin: 0.3,
  maxLinearSpeed: 14,
  linearGain: 12,
  maxAngularSpeed: 12,
  angularGain: 10,
  dropErrorDistance: 0.9,
  dropErrorTime: 0.5,
  teleportGraceSeconds: 0.3,
};

interface Rig {
  physics: PhysicsWorld;
  pair: PortalPairState;
  traveller: PortalTravellerSystem;
  grab: PhysicsGrabController;
  box: RAPIER.RigidBody;
  teleports: () => number;
  countDynamic: () => number;
}

/** Pared con portal de entrada en x=0 (normal +X); salida en el piso en (8,0). */
async function makeRig(): Promise<Rig> {
  const physics = new PhysicsWorld();
  await physics.init();
  const floorBody = physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(40, 1, 40),
  });
  const floor = floorBody.collider(0);
  const wallBody = physics.createStaticBox({
    id: "wall",
    position: new Vector3(-0.5, 2, 0),
    size: new Vector3(1, 4, 10),
  });
  const wall = wallBody.collider(0);

  const pair = new PortalPairState();
  const entry: PortalFrame = {
    position: new Vector3(0, 1.5, 0),
    quaternion: new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)),
    halfWidth: 0.55,
    halfHeight: 0.95,
  };
  const exit: PortalFrame = {
    position: new Vector3(8, 0, 0),
    quaternion: new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)),
    halfWidth: 0.55,
    halfHeight: 0.95,
  };
  pair.set("a", entry);
  pair.set("b", exit);

  let teleports = 0;
  const traveller = new PortalTravellerSystem(physics, new Scene(), pair, {
    ...TRAVELLER_OPTIONS,
    onTeleport: () => {
      teleports += 1;
    },
  });
  traveller.setPortal("a", entry, [wall, floor]);
  traveller.setPortal("b", exit, [floor]);

  const raycast = new Raycast(physics);
  const grab = new PhysicsGrabController(physics, raycast, TUNING, pair);

  const box = physics.createDynamicBox(
    { id: "crate", position: new Vector3(1.2, 1.5, 0), size: new Vector3(0.3, 0.3, 0.3), mass: 1 },
    new Object3D(),
  );

  const countDynamic = (): number => {
    let n = 0;
    physics.world.bodies.forEach((b) => {
      if (b.isDynamic()) n += 1;
    });
    return n;
  };

  return { physics, pair, traveller, grab, box, teleports: () => teleports, countDynamic };
}

function simulate(rig: Rig, steps: number, camPos: Vector3, camDir: Vector3, camQuat: Quaternion, startAt = 0): number {
  const dt = 1 / 60;
  let maxDynamic = 0;
  for (let i = 0; i < steps; i += 1) {
    rig.grab.update(dt, camPos, camDir, camQuat);
    rig.physics.step(dt);
    rig.traveller.update((startAt + i) * dt, dt);
    maxDynamic = Math.max(maxDynamic, rig.countDynamic());
  }
  return maxDynamic;
}

// Cámara a 2 m del portal de pared mirando hacia adentro: el target (2.4 m)
// queda 0.4 m del otro lado — el prop sostenido debe cruzar.
const CAM_POS = new Vector3(2, 1.5, 0);
const CAM_DIR = new Vector3(-1, 0, 0);
const CAM_QUAT = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));

describe("hold a través del portal (grab + traveller)", () => {
  it("un prop sostenido empujado al portal cruza con clon dual-body y se sigue sosteniendo; el throw sale transformado", async () => {
    const rig = await makeRig();
    rig.grab.grab(rig.box, CAM_QUAT);

    const maxDynamic = simulate(rig, 240, CAM_POS, CAM_DIR, CAM_QUAT);

    // Cruzó con clon (dos cuerpos a la vez a mitad de cruce, como el resto de
    // los props) y colapsó a uno; sigue sostenido del otro lado.
    expect(maxDynamic).toBe(2);
    expect(rig.countDynamic()).toBe(1);
    expect(rig.teleports()).toBeGreaterThanOrEqual(1);
    expect(rig.grab.isHolding()).toBe(true);
    expect(rig.grab.isHoldingThroughPortal()).toBe(true);
    const pos = rig.box.translation();
    expect(pos.x).toBeGreaterThan(7);
    expect(pos.y).toBeGreaterThan(-0.5);
    expect(pos.y).toBeLessThan(1.5);

    // Throw "hacia adelante" (−X de la cámara) → sale por la boca del piso (+Y).
    const released = rig.grab.release(new Vector3(-30, 0, 0));
    expect(released).toBe(rig.box);
    expect(rig.box.linvel().y).toBeCloseTo(30, 1);

    rig.traveller.dispose();
  });

  it("al retroceder, el prop vuelve ENTRANDO por el portal de salida (no a campo traviesa)", async () => {
    const rig = await makeRig();
    rig.grab.grab(rig.box, CAM_QUAT);

    // Fase 1: cruzar (igual que el test anterior).
    simulate(rig, 240, CAM_POS, CAM_DIR, CAM_QUAT);
    expect(rig.grab.isHoldingThroughPortal()).toBe(true);
    const crossings = rig.teleports();

    // Fase 2: el jugador retrocede a 4 m — la mira ya no cruza (t=4 > 2.4).
    // El prop debe volver por el portal: teleport de vuelta + hold directo.
    const backPos = new Vector3(4, 1.5, 0);
    let flewAcrossMap = false;
    const dt = 1 / 60;
    for (let i = 0; i < 300; i += 1) {
      rig.grab.update(dt, backPos, CAM_DIR, CAM_QUAT);
      rig.physics.step(dt);
      rig.traveller.update((240 + i) * dt, dt);
      const p = rig.box.translation();
      // A campo traviesa pasaría por la zona intermedia lejos de ambos
      // portales (p.ej. x≈4..6 a más de 1.5 m de altura sobre el piso).
      if (p.x > 3 && p.x < 6.5 && p.y > 1.0) flewAcrossMap = true;
    }

    expect(rig.teleports()).toBeGreaterThan(crossings);
    expect(rig.grab.isHolding()).toBe(true);
    expect(rig.grab.isHoldingThroughPortal()).toBe(false);
    expect(flewAcrossMap).toBe(false);
    // Terminó en la mano: target directo = backPos + dir×2.4 = (1.6, 1.5, 0).
    const pos = rig.box.translation();
    expect(Math.abs(pos.x - 1.6)).toBeLessThan(0.5);
    expect(Math.abs(pos.y - 1.5)).toBeLessThan(0.5);

    rig.traveller.dispose();
  });
});
