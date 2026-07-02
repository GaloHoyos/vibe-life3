import type RAPIER from "@dimforge/rapier3d-compat";
import { describe, expect, it, vi } from "vitest";
import { Scene, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast, RaycastHit } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { GameEventMap } from "@game/GameEvents";
import { IceGunSystem } from "@game/gameplay/weapons/ice/IceGunSystem";

interface FakeBody {
  isValid(): boolean;
  invalidate(): void;
}

function setup() {
  const scene = new Scene();
  const bus = new EventBus<GameEventMap>();
  let hit: RaycastHit | null = null;
  const raycast = {
    cast: vi.fn(() => hit),
  } as unknown as Raycast;
  const createStaticBox = vi.fn((_options: unknown) => {
    let valid = true;
    const body: FakeBody = {
      isValid: () => valid,
      invalidate: () => {
        valid = false;
      },
    };
    return body as unknown as RAPIER.RigidBody;
  });
  const removeBody = vi.fn((body: RAPIER.RigidBody) => {
    (body as unknown as FakeBody).invalidate();
  });
  const physics = {
    createStaticBox,
    removeBody,
  } as unknown as PhysicsWorld;
  const vfx = {
    explosion: vi.fn(),
  } as unknown as VfxSystem;
  const system = new IceGunSystem(scene, physics, raycast, bus, vfx);

  return {
    bus,
    scene,
    system,
    raycast,
    createStaticBox,
    removeBody,
    vfx,
    setHit: (next: RaycastHit | null) => {
      hit = next;
    },
  };
}

function fire(system: IceGunSystem, now: number, direction = new Vector3(0, 0, -1)) {
  return system.fire({
    origin: new Vector3(0, 1.6, 3),
    direction,
    range: 18,
    now,
    sourceId: "player",
    weaponName: "Ice Gun",
  });
}

function surf(system: IceGunSystem, now: number, direction = new Vector3(0, 0, -1)) {
  return system.surf({
    origin: new Vector3(0, 1.6, 3),
    direction,
    now,
    sourceId: "player",
  });
}

function worldHit(point: Vector3): RaycastHit {
  return {
    collider: {} as RAPIER.Collider,
    metadata: {
      id: "world",
      kind: "static",
      surface: "concrete",
    },
    point,
    normal: new Vector3(0, 1, 0),
    toi: 1,
  };
}

function iceHit(id: string, point: Vector3, normal = new Vector3(0, 0, 1)): RaycastHit {
  return {
    collider: {} as RAPIER.Collider,
    metadata: {
      id,
      kind: "static",
      surface: "snow",
    },
    point,
    normal,
    toi: 1,
  };
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

describe("IceGunSystem", () => {
  it("deposits a wall blob at the beam impact point immediately", () => {
    const { system, setHit, raycast, createStaticBox } = setup();

    setHit(worldHit(new Vector3(0, 0, 0)));
    expect(fire(system, 0)).toBe(true);

    expect(raycast.cast).toHaveBeenCalled();
    expect(system.getStructureCount()).toBe(1);
    expect(system.getDepositedBlobCount()).toBe(1);
    expect(createStaticBox).toHaveBeenCalledTimes(1);
    expect(createStaticBox).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ice-0",
        metadata: { surface: "snow" },
      }),
    );
  });

  it("merges nearby LMB impacts into one connected blob structure", () => {
    const { system, setHit, createStaticBox } = setup();

    setHit(worldHit(new Vector3(0, 0, 0)));
    fire(system, 0);
    setHit(worldHit(new Vector3(0.24, 0, 0.08)));
    fire(system, 0.06);

    expect(system.getStructureCount()).toBe(1);
    expect(system.getDepositedBlobCount()).toBe(2);
    expect(createStaticBox).toHaveBeenCalledTimes(2);
  });

  it("creates a separate wall structure when the beam is moved far away", () => {
    const { system, setHit } = setup();

    setHit(worldHit(new Vector3(0, 0, 0)));
    fire(system, 0);
    setHit(worldHit(new Vector3(5, 0, 0)));
    fire(system, 0.06);

    expect(system.getStructureCount()).toBe(2);
    expect(system.getDepositedBlobCount()).toBe(2);
  });

  it("updates the grouped collider as the wall bounds grow", () => {
    const { system, setHit, createStaticBox, removeBody } = setup();

    setHit(worldHit(new Vector3(0, 0, 0)));
    fire(system, 0);
    const firstSize = (createStaticBox.mock.calls.at(-1)?.[0] as { size: Vector3 } | undefined)?.size.clone();
    setHit(worldHit(new Vector3(0.95, 0, 0)));
    fire(system, 0.06);
    const lastSize = (createStaticBox.mock.calls.at(-1)?.[0] as { size: Vector3 } | undefined)?.size.clone();

    expect(firstSize).toBeDefined();
    expect(lastSize).toBeDefined();
    expect(lastSize!.x).toBeGreaterThan(firstSize!.x);
    expect(lastSize!.z).toBeLessThanOrEqual(0.36);
    expect(removeBody).toHaveBeenCalled();
  });

  it("keeps wall painting on the existing ice plane when the beam hits its collider face", () => {
    const { system, setHit, createStaticBox } = setup();

    setHit(worldHit(new Vector3(0, 0, 0)));
    fire(system, 0);
    const firstPosition = (createStaticBox.mock.calls.at(-1)?.[0] as { position: Vector3 } | undefined)?.position.clone();

    expect(firstPosition).toBeDefined();
    setHit(iceHit("ice-0", new Vector3(0.12, firstPosition!.y, firstPosition!.z + 0.65)));
    fire(system, 0.06);
    const lastPosition = (createStaticBox.mock.calls.at(-1)?.[0] as { position: Vector3 } | undefined)?.position.clone();
    const lastSize = (createStaticBox.mock.calls.at(-1)?.[0] as { size: Vector3 } | undefined)?.size.clone();

    expect(system.getStructureCount()).toBe(1);
    expect(system.getDepositedBlobCount()).toBe(2);
    expect(lastPosition).toBeDefined();
    expect(lastSize).toBeDefined();
    expect(Math.abs(lastPosition!.z - firstPosition!.z)).toBeLessThan(0.05);
    expect(lastSize!.z).toBeLessThanOrEqual(0.36);
  });

  it("RMB creates a connected surf ramp whose collider climbs over time", () => {
    const { system, setHit, createStaticBox } = setup();

    setHit(worldHit(new Vector3(0, 0, 2)));
    expect(surf(system, 0)).toBe(true);
    const firstY = (createStaticBox.mock.calls.at(-1)?.[0] as { position: Vector3 } | undefined)?.position.y;
    setHit(null);
    expect(surf(system, 0.1)).toBe(true);
    const lastY = (createStaticBox.mock.calls.at(-1)?.[0] as { position: Vector3 } | undefined)?.position.y;
    const lastSize = (createStaticBox.mock.calls.at(-1)?.[0] as { size: Vector3 } | undefined)?.size.clone();

    expect(system.getStructureCount()).toBe(1);
    expect(system.getDepositedBlobCount()).toBe(6);
    expect(firstY).toBeDefined();
    expect(lastY).toBeDefined();
    expect(lastY!).toBeGreaterThan(firstY!);
    expect(lastSize).toBeDefined();
    expect(lastSize!.x).toBeGreaterThanOrEqual(1.48);
    expect(lastSize!.y).toBeLessThan(0.55);
  });

  it("beam freeze accumulates on normal NPCs and kills only at threshold", () => {
    const { system, setHit, vfx } = setup();
    let alive = true;
    const applyDamage = vi.fn((amount: number) => {
      if (amount >= 1000) {
        alive = false;
      }
    });
    setHit(
      npcHit({
        id: "combine-body",
        ownerId: "combine-1",
        kind: "npc",
        characterId: "combine",
        damageable: {
          applyDamage,
          isAlive: () => alive,
        },
      }),
    );

    for (let i = 0; i < 7; i += 1) {
      fire(system, i * 0.06);
    }
    expect(system.getFreezeAmount("combine-1")).toBe(98);

    fire(system, 0.48);

    expect(applyDamage).toHaveBeenCalledTimes(1);
    expect(applyDamage).toHaveBeenCalledWith(
      1000,
      expect.any(Vector3),
      undefined,
      "player",
      expect.any(Vector3),
    );
    expect(system.getFreezeAmount("combine-1")).toBe(0);
    expect(vfx.explosion).toHaveBeenCalledWith(
      expect.any(Vector3),
      expect.objectContaining({ scale: 0.75 }),
    );
  });

  it("freeze-resistant NPCs receive light cold damage and do not store freeze", () => {
    const { system, setHit } = setup();
    const applyDamage = vi.fn();
    setHit(
      npcHit({
        id: "strider-body",
        ownerId: "strider-1",
        kind: "npc",
        characterId: "strider",
        damageable: {
          applyDamage,
          isAlive: () => true,
        },
      }),
    );

    fire(system, 0);

    expect(applyDamage).toHaveBeenCalledWith(
      4,
      expect.any(Vector3),
      undefined,
      "player",
      expect.any(Vector3),
    );
    expect(system.getFreezeAmount("strider-1")).toBe(0);
  });

  it("breaks ice structures when weapon.hit depletes their health", () => {
    const { bus, system, setHit, removeBody, vfx } = setup();
    const point = new Vector3(0, 1, 0);

    setHit(worldHit(new Vector3(0, 0, 0)));
    fire(system, 0);
    bus.emit("weapon.hit", {
      weaponName: "SMG",
      targetId: "ice-0",
      surfaceKind: "static",
      point,
      normal: new Vector3(0, 1, 0),
      damage: 200,
      sourceId: "player",
    });

    expect(system.getStructureCount()).toBe(0);
    expect(removeBody).toHaveBeenCalled();
    expect(vfx.explosion).toHaveBeenCalledWith(
      point,
      expect.objectContaining({ scale: 0.65 }),
    );
  });

  it("TTL, caps and clear remove blobs, beams, meshes and bodies", () => {
    const { scene, system, setHit, removeBody } = setup();

    for (let i = 0; i < 50; i += 1) {
      setHit(worldHit(new Vector3(i * 3, 0, 0)));
      fire(system, i * 0.06);
    }

    expect(system.getStructureCount()).toBe(48);
    expect(system.getDepositedBlobCount()).toBe(48);
    expect(removeBody).toHaveBeenCalled();

    system.update(1 / 60, 20);
    expect(system.getStructureCount()).toBe(0);

    setHit(worldHit(new Vector3(0, 0, 0)));
    fire(system, 21);
    expect(scene.children.length).toBeGreaterThan(0);
    system.clear();

    expect(system.getStructureCount()).toBe(0);
    expect(system.getDepositedBlobCount()).toBe(0);
    expect(scene.children).toHaveLength(0);
  });
});
