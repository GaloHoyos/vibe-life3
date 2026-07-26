import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Object3D, Quaternion, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import {
  PhysicsGrabController,
  type GrabDropReason,
  type GrabTuning,
} from "@engine/physics/grab/PhysicsGrabController";
import { PortalPairState, type PortalFrame } from "@engine/portals/PortalFrame";

beforeAll(async () => {
  await RAPIER.init();
});

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

async function makeWorld(): Promise<{ physics: PhysicsWorld; raycast: Raycast }> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(40, 1, 40),
  });
  return { physics, raycast: new Raycast(physics) };
}

function makeBox(physics: PhysicsWorld, position: Vector3): RAPIER.RigidBody {
  return physics.createDynamicBox(
    { id: "crate", position, size: new Vector3(0.4, 0.4, 0.4), mass: 1 },
    new Object3D(),
  );
}

function simulate(
  physics: PhysicsWorld,
  grab: PhysicsGrabController,
  steps: number,
  camPos: Vector3,
  camDir: Vector3,
  camQuat: Quaternion,
  onStep?: () => void,
): void {
  const dt = 1 / 60;
  for (let i = 0; i < steps; i += 1) {
    grab.update(dt, camPos, camDir, camQuat);
    physics.step(dt);
    onStep?.();
  }
}

describe("PhysicsGrabController — shadow hold", () => {
  it("el cuerpo sostenido persigue el target frente a la cámara sin gravedad", async () => {
    const { physics, raycast } = await makeWorld();
    const grab = new PhysicsGrabController(physics, raycast, TUNING);
    const box = makeBox(physics, new Vector3(0, 0.2, 0));

    const camPos = new Vector3(0, 1.6, -3);
    const camDir = new Vector3(0, 0, 1);
    const camQuat = new Quaternion();

    grab.grab(box, camQuat);
    expect(box.gravityScale()).toBe(0);
    expect(box.isCcdEnabled()).toBe(true);
    expect(physics.isHeldBody(box.handle)).toBe(true);

    simulate(physics, grab, 120, camPos, camDir, camQuat);

    const target = camPos.clone().addScaledVector(camDir, TUNING.holdDistance);
    const pos = box.translation();
    expect(new Vector3(pos.x, pos.y, pos.z).distanceTo(target)).toBeLessThan(0.3);

    const released = grab.release();
    expect(released).toBe(box);
    expect(box.gravityScale()).toBe(1);
    expect(physics.isHeldBody(box.handle)).toBe(false);
  });

  it("clampea el target contra una pared: el cuerpo jamás la atraviesa", async () => {
    const { physics, raycast } = await makeWorld();
    // Pared con cara frontal en x = 2.
    physics.createStaticBox({
      id: "wall",
      position: new Vector3(2.5, 2, 0),
      size: new Vector3(1, 4, 10),
    });
    const grab = new PhysicsGrabController(physics, raycast, TUNING);
    const box = makeBox(physics, new Vector3(1.0, 1.6, 0));

    const camPos = new Vector3(0, 1.6, 0);
    const camDir = new Vector3(1, 0, 0);
    const camQuat = new Quaternion().setFromEuler(new Euler(0, -Math.PI / 2, 0));

    grab.grab(box, camQuat);

    // El target crudo (x = 2.4) queda dentro de la pared; el clamp lo frena.
    let maxX = -Infinity;
    simulate(physics, grab, 240, camPos, camDir, camQuat, () => {
      maxX = Math.max(maxX, box.translation().x);
    });

    expect(grab.isHolding()).toBe(true);
    // Cara del cuerpo (centro + half extent 0.2) siempre de este lado de la pared.
    expect(maxX + 0.2).toBeLessThan(2.05);
  });

  it("se suelta solo cuando el cuerpo queda obstruido lejos del target", async () => {
    const { physics, raycast } = await makeWorld();
    physics.createStaticBox({
      id: "wall",
      position: new Vector3(2.5, 2, 0),
      size: new Vector3(1, 4, 10),
    });
    const drops: GrabDropReason[] = [];
    const grab = new PhysicsGrabController(
      physics,
      raycast,
      TUNING,
      null,
      (_body, reason) => drops.push(reason),
    );
    const box = makeBox(physics, new Vector3(1.0, 1.6, 0));

    const camQuat = new Quaternion();
    grab.grab(box, camQuat);

    // La cámara pasa al otro lado de la pared: el target queda inalcanzable.
    const camPos = new Vector3(5, 1.6, 0);
    const camDir = new Vector3(1, 0, 0);
    simulate(physics, grab, 90, camPos, camDir, camQuat);

    expect(grab.isHolding()).toBe(false);
    expect(drops).toEqual(["obstructed"]);
    expect(box.gravityScale()).toBe(1);
  });

  it("restaura el gravityScale original (flyer que vive con gravityScale 0)", async () => {
    const { physics, raycast } = await makeWorld();
    const body = physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 1.5, 0)
        .setGravityScale(0),
    );
    const collider = physics.world.createCollider(
      RAPIER.ColliderDesc.ball(0.3).setDensity(8),
      body,
    );
    physics.registerCollider(collider, { id: "manhack", kind: "npc" });

    const grab = new PhysicsGrabController(physics, raycast, TUNING);
    grab.grab(body, new Quaternion());
    expect(body.isCcdEnabled()).toBe(true);
    grab.release(new Vector3(0, 0, -20));

    expect(body.gravityScale()).toBe(0);
    expect(body.isCcdEnabled()).toBe(false);
    expect(body.linvel().z).toBeCloseTo(-20, 5);
  });

  it("respeta un nuevo gravityScale de restitución si el dueño cambia mientras está held", async () => {
    const { physics, raycast } = await makeWorld();
    const body = makeBox(physics, new Vector3(0, 1.6, 0));
    body.setGravityScale(0.2, true);
    const grab = new PhysicsGrabController(physics, raycast, TUNING);

    grab.grab(body, new Quaternion());
    physics.setHeldRestoreGravityScale(body.handle, 1);
    grab.release();

    expect(body.gravityScale()).toBeCloseTo(1, 6);
    expect(physics.isHeldBody(body.handle)).toBe(false);
  });

  it("limpia el registro held si el rigid body se remueve directamente", async () => {
    const { physics, raycast } = await makeWorld();
    const body = makeBox(physics, new Vector3(0, 1.6, 0));
    const handle = body.handle;
    const grab = new PhysicsGrabController(physics, raycast, TUNING);

    grab.grab(body, new Quaternion());
    expect(physics.isHeldBody(handle)).toBe(true);
    physics.removeBody(body);

    expect(physics.isHeldBody(handle)).toBe(false);
    expect(() => grab.release()).not.toThrow();
  });

  it("usa impactOwnerId para acercar un fragmento a su cuerpo original", async () => {
    const { physics, raycast } = await makeWorld();
    const fragment = makeBox(physics, new Vector3(0, 1.6, 0));
    const shellPart = makeBox(physics, new Vector3(0, 1.6, 0.8));
    physics.registerCollider(fragment.collider(0), {
      id: "blob-chunk-0",
      impactOwnerId: "blob-1",
      kind: "dynamic",
    });
    physics.registerCollider(shellPart.collider(0), {
      id: "blob-shell-1",
      ownerId: "blob-1",
      kind: "npc",
    });
    physics.updateQueryPipeline();

    const grab = new PhysicsGrabController(physics, raycast, TUNING);
    grab.grab(fragment, new Quaternion());
    grab.update(
      1 / 60,
      new Vector3(0, 1.6, 0),
      new Vector3(0, 0, 1),
      new Quaternion(),
    );

    // Sin excluir al owner original, el shell de z=0.8 clampearía el target
    // a 0.9 m y la velocidad quedaría en 10.8 m/s. El target libre satura el
    // shadow controller en sus 14 m/s configurados.
    expect(fragment.linvel().z).toBeCloseTo(TUNING.maxLinearSpeed, 5);
    expect(grab.isHolding()).toBe(true);

    grab.release();
  });

  it("release transforma la velocidad cuando el hold está mapeado por el portal", async () => {
    const { physics, raycast } = await makeWorld();
    const pair = new PortalPairState();
    // Portal de pared en x=0 mirando +X; salida en el piso mirando +Y.
    const entry: PortalFrame = {
      position: new Vector3(0, 1.5, 0),
      quaternion: new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0)),
      halfWidth: 0.55,
      halfHeight: 0.95,
    };
    const exit: PortalFrame = {
      position: new Vector3(6, 0.5, 0),
      quaternion: new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)),
      halfWidth: 0.55,
      halfHeight: 0.95,
    };
    pair.set("a", entry);
    pair.set("b", exit);
    const grab = new PhysicsGrabController(physics, raycast, TUNING, pair);

    // Cuerpo ya del lado de salida, cerca del target mapeado (~(6, 0.9, 0)).
    const box = makeBox(physics, new Vector3(6, 1.0, 0));
    grab.grab(box, new Quaternion());

    // Cámara a 2 m del portal mirando hacia adentro: la mira cruza el óvalo.
    const camPos = new Vector3(2, 1.5, 0);
    const camDir = new Vector3(-1, 0, 0);
    const camQuat = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0));
    grab.update(1 / 60, camPos, camDir, camQuat);

    expect(grab.isHoldingThroughPortal()).toBe(true);

    // La posición lógica trae al cuerpo de vuelta por el mapeo inverso: queda
    // "cerca" del jugador aunque en el mundo esté al lado del portal de piso.
    const logical = grab.getHeldLogicalPosition(new Vector3())!;
    expect(logical.x).toBeLessThan(0.1);
    expect(camPos.distanceTo(logical)).toBeLessThan(3);

    // Throw "hacia adelante" (−X en el frame de la cámara): sale por la boca
    // del piso, o sea hacia +Y.
    grab.release(new Vector3(-10, 0, 0));
    expect(box.linvel().y).toBeCloseTo(10, 3);
    expect(Math.abs(box.linvel().x)).toBeLessThan(0.01);
  });
});
