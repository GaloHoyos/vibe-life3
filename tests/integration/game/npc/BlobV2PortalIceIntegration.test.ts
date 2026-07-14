import type RAPIER from "@dimforge/rapier3d-compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Scene,
  Vector3,
} from "three";
import type { AssetManager, ModelInstance } from "@engine/assets/AssetManager";
import type { ModelAssetId } from "@engine/assets/AssetManifest";
import { blobSurfaceScheduler } from "@engine/blob/BlobSurfaceScheduler";
import type { BlobOrganismSnapshot } from "@engine/blob/v2";
import { EventBus } from "@engine/core/EventBus";
import type { PortalFrame } from "@engine/portals/PortalFrame";
import { PortalPairState } from "@engine/portals/PortalFrame";
import {
  enforceExitClearance,
  portalDeltaQuaternion,
  portalNormal,
  transformDirectionThroughPortal,
  transformPointThroughPortal,
} from "@engine/portals/PortalMath";
import type { PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast, RaycastHit } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { NpcRuntimeServices } from "@game/characters/CharacterFactory";
import type { GameEventMap } from "@game/GameEvents";
import { IceGunSystem } from "@game/gameplay/weapons/ice/IceGunSystem";
import { PortalGunSystem } from "@game/gameplay/weapons/portal/PortalGunSystem";
import { BuildingRegistry } from "@game/levels/buildings/BuildingRegistry";
import { blobV2Runtimes } from "@game/npc/blob/v2/BlobV2RuntimeRegistry";
import type { ActorSnapshot, AiFrameContext, INpc } from "@game/npc/core/INpc";

vi.mock("@engine/render/material/Materials", () => ({
  getMaterial: () => new MeshBasicMaterial(),
}));

const allocatedWorlds: PhysicsWorld[] = [];
const allocatedNpcs: INpc[] = [];
const allocatedIceSystems: IceGunSystem[] = [];

afterEach(() => {
  for (const npc of allocatedNpcs.splice(0)) npc.dispose();
  for (const ice of allocatedIceSystems.splice(0)) ice.dispose();
  for (const physics of allocatedWorlds.splice(0)) physics.reset();
  blobV2Runtimes.reset();
  blobSurfaceScheduler.clear();
});

describe("Blob V2 real portal and ice adapters", () => {
  it("moves only the attached component through a full portal frame", async () => {
    const entry: PortalFrame = {
      position: new Vector3(0, 1.2, 0),
      quaternion: new Quaternion(),
      halfWidth: 1.8,
      halfHeight: 1.8,
    };
    const exit: PortalFrame = {
      position: new Vector3(8, 0, 4),
      quaternion: new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0)),
      halfWidth: 1.8,
      halfHeight: 1.8,
    };
    const pair = new PortalPairState();
    pair.set("a", entry);
    pair.set("b", exit);
    const { npc, physics, bus } = await createBlob(
      "blob-portal-integration",
      new Vector3(0, 1.2, 0.25),
      pair,
    );
    const source = blobV2Runtimes.debugSources()[0];
    expect(source).toBeDefined();
    source?.scenario?.("split-return");
    expect((source?.snapshot() as BlobOrganismSnapshot).fragments).toHaveLength(1);

    const handle = npc.getPortalTraversalHandle();
    expect(handle?.teleportThroughPortal).toBeTypeOf("function");
    if (!handle || !source) throw new Error("Blob portal integration was not constructed");

    const inputVelocity = new Vector3(0, 0, -3);
    const front = new Vector3(0, 1.2, 0.25);
    const behind = new Vector3(0, 1.2, -0.1);
    handle.teleport(front, inputVelocity, 0);
    const portalSystem = portalHarness(pair, bus);
    portalSystem.updateNpcTraversal(1, [handle]);
    handle.teleport(behind, inputVelocity, 0);

    const before = source.snapshot() as BlobOrganismSnapshot;
    const fragmentBefore = new Vector3(
      before.fragments[0]!.position.x,
      before.fragments[0]!.position.y,
      before.fragments[0]!.position.z,
    );
    const coreCellId = before.cells.find((cell) => cell.isCore)!.id;
    const tracked = before.particles.find(
      (particle) =>
        particle.islandId === before.islands.find((island) => island.kind === "main")!.id &&
        particle.cellId !== coreCellId,
    )!;
    const beforeRelative = new Vector3(
      tracked.position.x - before.core.position.x,
      tracked.position.y - before.core.position.y,
      tracked.position.z - before.core.position.z,
    );

    portalSystem.updateNpcTraversal(1.1, [handle]);
    const after = source.snapshot() as BlobOrganismSnapshot;
    const actualCore = new Vector3(
      after.core.position.x,
      after.core.position.y,
      after.core.position.z,
    );
    const expectedCore = transformPointThroughPortal(behind, entry, exit);
    const exitNormal = portalNormal(exit);
    const clearance = Math.abs(exitNormal.y) > 0.7
      ? npc.radius * 3 + 0.05
      : npc.radius + 0.05;
    enforceExitClearance(expectedCore, exit.position, exitNormal, clearance);

    const expectedVelocity = transformDirectionThroughPortal(
      inputVelocity,
      entry,
      exit,
    );
    const actualVelocity = handle.getVelocity();
    expect(actualCore.distanceTo(expectedCore)).toBeLessThanOrEqual(0.1);
    expect(
      actualVelocity.clone().normalize().dot(expectedVelocity.clone().normalize()),
    ).toBeGreaterThanOrEqual(0.98);
    expect(actualVelocity.length()).toBeGreaterThanOrEqual(inputVelocity.length() * 0.9);

    const fragmentAfter = after.fragments[0]!.position;
    expect(
      fragmentBefore.distanceTo(
        new Vector3(fragmentAfter.x, fragmentAfter.y, fragmentAfter.z),
      ),
    ).toBeLessThan(1e-6);

    const trackedAfter = after.particles.find(
      (particle) => particle.cellId === tracked.cellId,
    )!;
    const actualRelative = new Vector3(
      trackedAfter.position.x - after.core.position.x,
      trackedAfter.position.y - after.core.position.y,
      trackedAfter.position.z - after.core.position.z,
    );
    const deltaRotation = portalDeltaQuaternion(entry, exit);
    expect(
      actualRelative.distanceTo(beforeRelative.applyQuaternion(deltaRotation)),
    ).toBeLessThan(1e-5);
    expect(enabledOwnerColliders(physics, npc.id)).toBeGreaterThan(0);
  });

  it("freezes one coherent hierarchy and shatters every Blob runtime resource once", async () => {
    blobSurfaceScheduler.clear();
    const pair = new PortalPairState();
    const { npc, physics, bus } = await createBlob(
      "blob-ice-integration",
      new Vector3(2, 1, -3),
      pair,
    );
    npc.update(idleFrame(bus));
    expect(blobSurfaceScheduler.pendingCount).toBeGreaterThan(0);

    const presenter = npc.mesh.getObjectByName(
      "blob-v2-presenter-blob-ice-integration",
    ) as Group;
    const core = npc.mesh.getObjectByName(
      "blob-v2-core-blob-ice-integration",
    ) as Mesh;
    const disposeCoreGeometry = vi.spyOn(core.geometry, "dispose");
    npc.mesh.updateWorldMatrix(true, true);
    const coreBefore = core.getWorldPosition(new Vector3());

    const scene = new Scene();
    scene.add(npc.mesh);
    const hit = npcRaycastHit(npc);
    const raycast = { cast: vi.fn(() => hit) } as unknown as Raycast;
    const vfx = { explosion: vi.fn() } as unknown as VfxSystem;
    const ice = new IceGunSystem(scene, physics, raycast, bus, vfx);
    allocatedIceSystems.push(ice);
    const freezeHandle = npc.getFreezeHandle();
    if (!freezeHandle) throw new Error("Blob freeze handle was not created");
    ice.update(1 / 60, 0, [freezeHandle]);
    for (let index = 0; index < 8; index++) {
      ice.fire({
        origin: new Vector3(2, 2, 0),
        direction: new Vector3(0, 0, -1),
        range: 18,
        now: index * 0.06,
        sourceId: "player",
        weaponName: "Ice Gun",
      });
    }

    expect(ice.isFrozen(npc.id)).toBe(true);
    expect(npc.isAlive()).toBe(true);
    expect(blobV2Runtimes.debugSources()).toHaveLength(1);
    expect(blobSurfaceScheduler.pendingCount).toBe(0);
    expect(disposeCoreGeometry).not.toHaveBeenCalled();
    expect(npc.mesh.parent?.name).toBe(`ice-statue-${npc.id}`);
    expect(enabledOwnerColliders(physics, npc.id)).toBe(0);
    scene.updateMatrixWorld(true);
    expect(core.getWorldPosition(new Vector3()).distanceTo(coreBefore)).toBeLessThan(1e-6);

    const removeBody = vi.spyOn(physics, "removeBody");
    bus.emit("weapon.hit", {
      weaponName: "Shotgun",
      targetId: `ice-statue-${npc.id}`,
      surfaceKind: "dynamic",
      point: coreBefore.clone(),
      normal: new Vector3(0, 0, 1),
      damage: 25,
      sourceId: "player",
    });

    expect(ice.isFrozen(npc.id)).toBe(false);
    expect(npc.isAlive()).toBe(false);
    expect(blobV2Runtimes.debugSources()).toHaveLength(0);
    expect(blobSurfaceScheduler.pendingCount).toBe(0);
    expect(presenter.parent).toBeNull();
    expect(disposeCoreGeometry).toHaveBeenCalledOnce();
    expect(removeBody).toHaveBeenCalledOnce();

    npc.dispose();
    npc.dispose();
    ice.dispose();
    expect(disposeCoreGeometry).toHaveBeenCalledOnce();
    expect(removeBody).toHaveBeenCalledOnce();
  });
});

async function createBlob(id: string, position: Vector3, pair: PortalPairState) {
  const [{ CharacterFactory }] = await Promise.all([
    import("@game/characters/CharacterFactory"),
  ]);
  const physics = new PhysicsWorld();
  await physics.init();
  allocatedWorlds.push(physics);
  const bus = new EventBus<GameEventMap>();
  const factory = new CharacterFactory(trackingAssets(), physics, bus);
  const npc = await factory.createNPC(
    "blob",
    id,
    position,
    [],
    runtimeServices(pair),
  );
  allocatedNpcs.push(npc);
  return { npc, physics, bus };
}

function portalHarness(
  pair: PortalPairState,
  eventBus: EventBus<GameEventMap>,
): PortalGunSystem {
  const system = Object.create(PortalGunSystem.prototype) as PortalGunSystem;
  Object.assign(system as unknown as Record<string, unknown>, {
    pair,
    portals: new Map([
      ["a", { frame: pair.a, backingColliders: [{ handle: 7001 }] }],
      ["b", { frame: pair.b, backingColliders: [{ handle: 7002 }] }],
    ]),
    npcStates: new Map(),
    npcFrame: 0,
    eventBus,
  });
  return system;
}

function runtimeServices(pair: PortalPairState): NpcRuntimeServices {
  const nullRaycast = { cast: () => null } as unknown as Raycast;
  return {
    navigation: {
      createAgent: vi.fn(() => null),
      releaseAgentReservations: vi.fn(),
      projectPoint: vi.fn(() => null),
    },
    navigationRequests: {
      cancel: vi.fn(),
      enqueue: vi.fn(),
    },
    buildingRegistry: new BuildingRegistry([]),
    raycast: nullRaycast,
    losRaycast: nullRaycast,
    portals: pair,
    tacticalMap: null,
    squadDirector: null,
  } as unknown as NpcRuntimeServices;
}

function idleFrame(eventBus: EventBus<GameEventMap>): AiFrameContext {
  const player: ActorSnapshot = {
    id: "player",
    position: new Vector3(50, 0, 50),
    faction: "player",
    entity: { applyDamage: vi.fn(), isAlive: () => false },
    isAlive: false,
    radius: 0.4,
  };
  return {
    delta: 1 / 30,
    elapsed: 0,
    aiLod: "near",
    viewerDistance: 4,
    player,
    npcs: [],
    tacticalMap: null as never,
    squadDirector: null as never,
    eventBus,
  };
}

function npcRaycastHit(npc: INpc): RaycastHit {
  const metadata: PhysicsMetadata = {
    id: `${npc.id}-mass`,
    ownerId: npc.id,
    kind: "npc",
    characterId: "blob",
    damageable: {
      applyDamage: (amount, direction, part, attacker, point) =>
        npc.applyDamage(amount, direction, part, attacker, point),
      isAlive: () => npc.isAlive(),
    },
  };
  return {
    collider: {} as RAPIER.Collider,
    metadata,
    point: npc.position.clone(),
    normal: new Vector3(0, 0, 1),
    toi: 2,
  };
}

function enabledOwnerColliders(physics: PhysicsWorld, ownerId: string): number {
  let count = 0;
  physics.world.colliders.forEach((collider) => {
    const metadata = physics.getColliderMetadata(collider);
    if ((metadata?.ownerId ?? metadata?.id) === ownerId && collider.isEnabled()) count++;
  });
  return count;
}

function trackingAssets(): AssetManager {
  return {
    instantiateModel: vi.fn(async (id: ModelAssetId): Promise<ModelInstance> => ({
      asset: { id, path: "", type: "character", debug: false },
      root: new Object3D(),
      source: "fallback",
      hasSkeleton: false,
      animationsIgnored: true,
    })),
  } as unknown as AssetManager;
}
