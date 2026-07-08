import RAPIER from "@dimforge/rapier3d-compat";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Group, Scene, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast, RaycastHit } from "@engine/physics/Raycast";
import { Raycast as RealRaycast } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { GameEventMap } from "@game/GameEvents";
import { IceConfig } from "@game/config/ice.config";
import { IceGunSystem } from "@game/gameplay/weapons/ice/IceGunSystem";
import type { NpcFreezeHandle } from "@game/npc/core/INpc";

beforeAll(async () => {
  await RAPIER.init();
});

function fakeVfx(): VfxSystem {
  return { explosion: vi.fn() } as unknown as VfxSystem;
}

/** Mundo real con piso en y=0 para tests de pintado/rampas/carveo. */
async function setupWorld() {
  const scene = new Scene();
  const bus = new EventBus<GameEventMap>();
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(60, 1, 60),
  });
  physics.updateQueryPipeline();
  const raycast = new RealRaycast(physics);
  const vfx = fakeVfx();
  const system = new IceGunSystem(scene, physics, raycast, bus, vfx);
  return { scene, bus, physics, raycast, vfx, system };
}

/** Raycast mockeado para tests de freeze contra NPCs sintéticos. */
function setupMocked() {
  const scene = new Scene();
  const bus = new EventBus<GameEventMap>();
  let hit: RaycastHit | null = null;
  const raycast = {
    cast: vi.fn(() => hit),
  } as unknown as Raycast;
  const removeBody = vi.fn();
  const createDynamicBox = vi.fn(
    () =>
      ({
        applyImpulseAtPoint: vi.fn(),
        isValid: () => true,
      }) as unknown as RAPIER.RigidBody,
  );
  const physics = {
    createStaticTrimesh: vi.fn(),
    removeBody,
    createDynamicBox,
  } as unknown as PhysicsWorld;
  const vfx = fakeVfx();
  const system = new IceGunSystem(scene, physics, raycast, bus, vfx);
  return {
    scene,
    bus,
    system,
    vfx,
    removeBody,
    createDynamicBox,
    setHit: (next: RaycastHit | null) => {
      hit = next;
    },
  };
}

/**
 * Disparo en diagonal (45° hacia adelante): el impacto queda ~1.6 m frente al
 * tirador, fuera de `paint.shooterClearance`. Un disparo vertical a los pies
 * se bloquea a propósito (ver test de clearance).
 */
function fire(
  system: IceGunSystem,
  now: number,
  origin = new Vector3(0, 1.6, 0),
  direction = new Vector3(0, -1, 1).normalize(),
) {
  return system.fire({
    origin,
    direction,
    range: 18,
    now,
    sourceId: "player",
    weaponName: "Ice Gun",
  });
}

function npcHit(metadata: PhysicsMetadata): RaycastHit {
  return {
    collider: {} as RAPIER.Collider,
    metadata,
    point: new Vector3(0, 1, -2),
    normal: new Vector3(0, 0, 1),
    toi: 2,
  };
}

function freezeHandle(id: string): NpcFreezeHandle & {
  freezeSolidCalls: { count: number };
  alive: { value: boolean };
} {
  const alive = { value: true };
  const freezeSolidCalls = { count: 0 };
  return {
    id,
    radius: 0.35,
    height: 1.8,
    getPosition: () => new Vector3(0, 1, -2),
    isAlive: () => alive.value,
    freezeSolid: () => {
      freezeSolidCalls.count += 1;
      if (!alive.value) return null;
      alive.value = false;
      const visual = new Group();
      visual.position.set(0, 1, -2);
      return visual;
    },
    freezeSolidCalls,
    alive,
  };
}

describe("IceGunSystem (blobulator)", () => {
  it("spraying the floor bakes walkable ice with a raycastable trimesh", async () => {
    const { system, physics, raycast } = await setupWorld();

    expect(fire(system, 0)).toBe(true);
    expect(system.getDepositedBlobCount()).toBe(1);
    system.flushChunks();
    physics.updateQueryPipeline();

    const hit = raycast.cast(new Vector3(0, 2, 1.6), new Vector3(0, -1, 0), 5);
    expect(hit).not.toBeNull();
    expect(hit!.metadata?.id.startsWith("ice-")).toBe(true);
    expect(hit!.metadata?.surface).toBe("snow");
    expect(hit!.point.y).toBeGreaterThan(0.05);
  });

  it("spraying on top of existing ice keeps stacking (mounds grow)", async () => {
    const { system, physics, raycast } = await setupWorld();

    // Ángulo bajo: la masa crece sin entrar en la zona de clearance del tirador.
    const direction = new Vector3(0, -1, 2).normalize();
    for (let i = 0; i < 6; i += 1) {
      fire(system, i * 0.15, undefined, direction);
      system.flushChunks();
      physics.updateQueryPipeline();
    }

    // La masa se apila remontando el rayo: escanear la franja de impacto.
    let peak = 0;
    for (let z = 1.2; z <= 3.6; z += 0.2) {
      const hit = raycast.cast(new Vector3(0, 3, z), new Vector3(0, -1, 0), 5);
      if (hit) {
        peak = Math.max(peak, hit.point.y);
      }
    }
    // Tras varias capas, la masa supera con holgura un solo blob.
    expect(peak).toBeGreaterThan(0.5);
    expect(system.getDepositedBlobCount()).toBeGreaterThanOrEqual(6);
  });

  it("bridges the stroke between consecutive spray ticks", async () => {
    const { system } = await setupWorld();

    fire(system, 0, new Vector3(0, 1.6, 0));
    fire(system, 0.15, new Vector3(1.2, 1.6, 0));

    // 2 depósitos directos + puentes intermedios del stroke.
    expect(system.getDepositedBlobCount()).toBeGreaterThan(2);
  });

  it("throttles spray deposits to the paint interval", async () => {
    const { system } = await setupWorld();

    fire(system, 0);
    fire(system, IceConfig.paint.interval / 2);
    expect(system.getDepositedBlobCount()).toBe(1);

    fire(system, IceConfig.paint.interval + 0.01);
    expect(system.getDepositedBlobCount()).toBe(2);
  });

  it("skips deposits inside the shooter clearance (no clipping into the player)", async () => {
    const { system } = await setupWorld();

    // Vertical a los propios pies: el blob quedaría dentro de la cápsula.
    expect(
      fire(system, 0, new Vector3(0, 1.6, 0), new Vector3(0, -1, 0)),
    ).toBe(true);
    expect(system.getDepositedBlobCount()).toBe(0);
  });

  it("RMB grows an ascending ramp anchored on the ground and caps its length", async () => {
    const { system } = await setupWorld();
    const origin = new Vector3(0, 1.6, 0);
    const direction = new Vector3(0, 0, 1);

    let steps = 0;
    let now = 0;
    while (
      system.surf({ origin, direction, now, sourceId: "player" }) &&
      steps < 100
    ) {
      steps += 1;
      now += IceConfig.ramp.cooldown + 0.01;
    }

    const expectedSteps = Math.ceil(
      IceConfig.ramp.maxLength /
        Math.hypot(IceConfig.ramp.step, IceConfig.ramp.rise),
    );
    expect(steps).toBeGreaterThan(3);
    expect(steps).toBeLessThanOrEqual(expectedSteps + 1);
    expect(system.getDepositedBlobCount()).toBe(
      steps * IceConfig.ramp.lateralOffsets.length,
    );
  });

  it("melts the oldest blobs when the budget is exceeded", async () => {
    const { system } = await setupWorld();
    const over = 5;
    const total = IceConfig.paint.budget + over;
    for (let i = 0; i < total; i += 1) {
      // Separados más que strokeBridgeMax para que no haya puentes, y con la
      // grilla centrada para no salirse del piso de 60×60.
      fire(
        system,
        i * 0.15,
        new Vector3((i % 16) * 2.9 - 22, 1.6, Math.floor(i / 16) * 2.9 - 22),
      );
    }
    expect(system.getDepositedBlobCount()).toBe(total);

    system.update(1 / 60, total * 0.15 + IceConfig.melt.seconds + 0.2, []);
    expect(system.getDepositedBlobCount()).toBe(IceConfig.paint.budget);
  });

  it("weapon damage on ice carves blobs around the impact", async () => {
    const { system, bus, vfx } = await setupWorld();
    fire(system, 0);
    fire(system, 0.15);
    expect(system.getDepositedBlobCount()).toBe(2);

    system.update(1 / 60, 1, []);
    bus.emit("weapon.hit", {
      weaponName: "SMG",
      targetId: "ice-0,0,0",
      surfaceKind: "static",
      point: new Vector3(0, 0.3, 1.6),
      normal: new Vector3(0, 1, 0),
      damage: 40,
      sourceId: "player",
    });
    system.update(1 / 60, 1.5, []);

    expect(system.getDepositedBlobCount()).toBe(0);
    expect(vfx.explosion).toHaveBeenCalled();
  });

  it("freeze meter fills on NPCs and kills them frozen solid (falling statue)", () => {
    const { system, bus, setHit, createDynamicBox } = setupMocked();
    const handle = freezeHandle("combine-1");
    const frozenEvents: string[] = [];
    bus.on("ice.frozen", (payload) => frozenEvents.push(payload.targetId));

    setHit(
      npcHit({
        id: "combine-body",
        ownerId: "combine-1",
        kind: "npc",
        characterId: "combine",
        damageable: { applyDamage: vi.fn(), isAlive: () => true },
      }),
    );

    system.update(1 / 60, 0, [handle]);
    for (let i = 0; i < 7; i += 1) {
      fire(system, i * 0.06);
    }
    expect(system.getFreezeAmount("combine-1")).toBe(98);
    expect(handle.freezeSolidCalls.count).toBe(0);

    fire(system, 0.48);
    expect(handle.freezeSolidCalls.count).toBe(1);
    expect(handle.alive.value).toBe(false);
    expect(system.isFrozen("combine-1")).toBe(true);
    expect(frozenEvents).toEqual(["combine-1"]);
    // Estatua = cuerpo dinámico único (caja) que cae rígido.
    expect(createDynamicBox).toHaveBeenCalledTimes(1);
  });

  it("spraying an existing statue does not re-freeze it", () => {
    const { system, setHit } = setupMocked();
    const handle = freezeHandle("combine-1");
    setHit(
      npcHit({
        id: "combine-body",
        ownerId: "combine-1",
        kind: "npc",
        characterId: "combine",
        damageable: { applyDamage: vi.fn(), isAlive: () => true },
      }),
    );
    system.update(1 / 60, 0, [handle]);
    for (let i = 0; i < 8; i += 1) {
      fire(system, i * 0.06);
    }
    expect(system.isFrozen("combine-1")).toBe(true);

    for (let i = 0; i < 4; i += 1) {
      fire(system, 1 + i * 0.06);
    }
    expect(handle.freezeSolidCalls.count).toBe(1);
    expect(system.isFrozen("combine-1")).toBe(true);
  });

  it("weapon hits on a statue shatter it with an ice burst", () => {
    const { system, bus, setHit, vfx, removeBody } = setupMocked();
    const handle = freezeHandle("combine-1");
    setHit(
      npcHit({
        id: "combine-body",
        ownerId: "combine-1",
        kind: "npc",
        characterId: "combine",
        damageable: { applyDamage: vi.fn(), isAlive: () => handle.alive.value },
      }),
    );
    system.update(1 / 60, 0, [handle]);
    for (let i = 0; i < 8; i += 1) {
      fire(system, i * 0.06);
    }
    expect(system.isFrozen("combine-1")).toBe(true);

    bus.emit("weapon.hit", {
      weaponName: "SMG",
      targetId: "ice-statue-combine-1",
      surfaceKind: "dynamic",
      point: new Vector3(0, 1, -2),
      normal: new Vector3(0, 0, 1),
      damage: 25,
      sourceId: "player",
    });
    expect(system.isFrozen("combine-1")).toBe(false);
    expect(vfx.explosion).toHaveBeenCalled();
    expect(removeBody).toHaveBeenCalledTimes(1);
  });

  it("targets without a freeze handle die of cold at threshold (fallback)", () => {
    const { system, setHit, vfx } = setupMocked();
    let alive = true;
    const applyDamage = vi.fn((amount: number) => {
      if (amount >= 1000) alive = false;
    });
    setHit(
      npcHit({
        id: "turret-body",
        ownerId: "turret-1",
        kind: "npc",
        characterId: "combine",
        damageable: { applyDamage, isAlive: () => alive },
      }),
    );

    for (let i = 0; i < 8; i += 1) {
      fire(system, i * 0.06);
    }
    expect(applyDamage).toHaveBeenCalledWith(
      1000,
      expect.any(Vector3),
      undefined,
      "player",
      expect.any(Vector3),
    );
    expect(vfx.explosion).toHaveBeenCalled();
  });

  it("freeze-resistant characters take light cold damage instead", () => {
    const { system, setHit } = setupMocked();
    const applyDamage = vi.fn();
    setHit(
      npcHit({
        id: "strider-body",
        ownerId: "strider-1",
        kind: "npc",
        characterId: "strider",
        damageable: { applyDamage, isAlive: () => true },
      }),
    );

    fire(system, 0);
    expect(applyDamage).toHaveBeenCalledWith(
      IceConfig.freeze.bossColdDamage,
      expect.any(Vector3),
      undefined,
      "player",
      expect.any(Vector3),
    );
    expect(system.getFreezeAmount("strider-1")).toBe(0);
  });

  it("clear removes all ice, statues and physics bodies", async () => {
    const { system, physics } = await setupWorld();
    for (let i = 0; i < 5; i += 1) {
      fire(system, i * 0.15, new Vector3(i * 3, 1.6, 0));
    }
    system.flushChunks();
    expect(system.getDepositedBlobCount()).toBe(5);

    system.clear();
    expect(system.getDepositedBlobCount()).toBe(0);
    // Solo queda el piso del setup.
    expect(physics.getBodyCount()).toBe(1);
  });
});
