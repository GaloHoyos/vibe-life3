import RAPIER from "@dimforge/rapier3d-compat";
import { BlobOrganismController } from "@engine/blob/v2";
import { PhysicsWorld, type PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import { BlobPreyClaimService } from "@game/npc/blob/BlobPreyClaimService";
import {
  BlobV2PropConsumption,
  type BlobV2PropConsumptionOptions,
} from "@game/npc/blob/v2/BlobV2PropConsumption";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(async () => {
  await RAPIER.init();
});

describe("BlobV2PropConsumption", () => {
  it("requires continuous attached-main coverage and restores an interrupted visual", async () => {
    const harness = await setup({ consumeSeconds: 1.5, biomass: 7 });
    const originalY = harness.mesh.position.y;

    harness.consumption.tick(0.75, harness.controller.snapshot());

    expect(harness.mesh.scale.x).toBeLessThan(1);
    expect(harness.mesh.position.y).toBeLessThan(originalY);
    expect(harness.controller.snapshot().biomass.total).toBe(192);
    expect(harness.claims.get(harness.claimId)?.ownerId).toBe("blob-a");

    harness.body.setTranslation({ x: 30, y: 1, z: 0 }, true);
    harness.physics.updateQueryPipeline();
    harness.consumption.tick(0.1, harness.controller.snapshot());

    expect(harness.mesh.scale.toArray()).toEqual([1, 1, 1]);
    expect(harness.mesh.position.toArray()).toEqual([30, 1, 0]);
    expect(harness.claims.get(harness.claimId)).toBeNull();

    const contact = mainParticlePosition(harness.controller);
    harness.body.setTranslation(contact, true);
    harness.mesh.position.copy(contact);
    harness.physics.updateQueryPipeline();
    harness.consumption.tick(1.49, harness.controller.snapshot());
    expect(harness.body.isValid()).toBe(true);

    harness.consumption.tick(0.01, harness.controller.snapshot());
    expect(harness.body.isValid()).toBe(false);
    expect(harness.controller.snapshot().biomass.total).toBe(199);
  });

  it("removes the body and visual exactly once without disposing shared render resources", async () => {
    const harness = await setup({ consumeSeconds: 0.2, biomass: 6 });
    const sibling = new Mesh(harness.geometry, harness.material);
    harness.root.add(sibling);
    const disposeGeometry = vi.spyOn(harness.geometry, "dispose");
    const disposeMaterial = vi.spyOn(harness.material, "dispose");
    const consumeBiomass = vi.spyOn(harness.controller, "consumeBiomass");

    harness.consumption.tick(0.2, harness.controller.snapshot());
    harness.consumption.tick(5, harness.controller.snapshot());

    expect(harness.physics.getBodyCount()).toBe(0);
    expect(harness.mesh.parent).toBeNull();
    expect(sibling.parent).toBe(harness.root);
    expect(disposeGeometry).not.toHaveBeenCalled();
    expect(disposeMaterial).not.toHaveBeenCalled();
    expect(consumeBiomass).toHaveBeenCalledTimes(1);
    expect(consumeBiomass).toHaveBeenCalledWith(6);
    expect(harness.onConsumed).toHaveBeenCalledTimes(1);
    expect(harness.onConsumed).toHaveBeenCalledWith({
      propId: "prop-a",
      position: {
        x: harness.contact.x,
        y: harness.contact.y,
        z: harness.contact.z,
      },
      biomass: 6,
      result: expect.objectContaining({ requested: 6, accepted: 6 }),
    });
  });

  it("uses the 1.5-second and four-biomass fallbacks for marker-only props", async () => {
    const harness = await setup({ blobConsumable: true });
    const consumeBiomass = vi.spyOn(harness.controller, "consumeBiomass");

    harness.consumption.tick(1.499, harness.controller.snapshot());
    expect(harness.body.isValid()).toBe(true);
    expect(consumeBiomass).not.toHaveBeenCalled();

    harness.consumption.tick(0.001, harness.controller.snapshot());
    expect(harness.body.isValid()).toBe(false);
    expect(consumeBiomass).toHaveBeenCalledOnce();
    expect(consumeBiomass).toHaveBeenCalledWith(4);
    expect(harness.onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ progress: 1, consumeSeconds: 1.5 }),
    );
  });

  it("prefers blobPrey biomass and consumeSeconds over legacy prop values", async () => {
    const harness = await setup({
      consumeSeconds: 5,
      biomass: 9,
      blobPrey: { consumeSeconds: 0.1, biomass: 5 },
    });
    const consumeBiomass = vi.spyOn(harness.controller, "consumeBiomass");

    harness.consumption.tick(0.1, harness.controller.snapshot());

    expect(consumeBiomass).toHaveBeenCalledWith(5);
    expect(harness.controller.snapshot().biomass.total).toBe(197);
  });

  it("excludes NPC colliders and dynamic bodies owned by another Blob", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const controller = makeController();
    const contact = mainParticlePosition(controller);
    const root = new Group();
    const npc = createBody(physics, root, contact, {
      id: "npc-prey",
      kind: "npc",
      characterId: "headcrab",
      blobConsumable: { consumeSeconds: 0, biomass: 20 },
    });
    const blobProp = createBody(physics, root, contact, {
      id: "blob-piece",
      kind: "dynamic",
      characterId: "blob",
      blobConsumable: { consumeSeconds: 0, biomass: 20 },
    });
    physics.updateQueryPipeline();
    const consumption = new BlobV2PropConsumption(controller, physics, {
      ownerId: "blob-a",
      claimService: new BlobPreyClaimService(),
    });

    consumption.tick(3, controller.snapshot());

    expect(npc.body.isValid()).toBe(true);
    expect(blobProp.body.isValid()).toBe(true);
    expect(physics.getBodyCount()).toBe(2);
    expect(controller.snapshot().biomass.total).toBe(192);
  });

  it("allows only one of two organisms to consume and receive the same prop", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const firstController = makeController();
    const secondController = makeController();
    const contact = mainParticlePosition(firstController);
    const root = new Group();
    const prop = createBody(physics, root, contact, {
      id: "contested-prop",
      kind: "dynamic",
      blobConsumable: { consumeSeconds: 0.2, biomass: 8 },
    });
    physics.updateQueryPipeline();
    const claims = new BlobPreyClaimService();
    const first = new BlobV2PropConsumption(firstController, physics, {
      ownerId: "blob-a",
      claimService: claims,
    });
    const second = new BlobV2PropConsumption(secondController, physics, {
      ownerId: "blob-b",
      claimService: claims,
    });

    first.tick(0, firstController.snapshot());
    second.tick(0, secondController.snapshot());
    first.tick(0.2, firstController.snapshot());
    second.tick(0.2, secondController.snapshot());

    expect(prop.body.isValid()).toBe(false);
    expect(firstController.snapshot().biomass.total).toBe(200);
    expect(secondController.snapshot().biomass.total).toBe(192);
  });

  it("dispose is idempotent, releases its claim and leaves unfinished props intact", async () => {
    const harness = await setup({ consumeSeconds: 2, biomass: 6 });
    harness.consumption.tick(1, harness.controller.snapshot());
    expect(harness.mesh.scale.x).toBeLessThan(1);

    harness.consumption.dispose();
    harness.consumption.dispose();
    harness.consumption.tick(4, harness.controller.snapshot());

    expect(harness.body.isValid()).toBe(true);
    expect(harness.mesh.parent).toBe(harness.root);
    expect(harness.mesh.scale.toArray()).toEqual([1, 1, 1]);
    expect(harness.claims.get(harness.claimId)).toBeNull();
    expect(harness.controller.snapshot().biomass.total).toBe(192);
  });
});

interface SetupOptions {
  readonly consumeSeconds?: number;
  readonly biomass?: number;
  readonly blobConsumable?: boolean;
  readonly blobPrey?: { readonly consumeSeconds?: number; readonly biomass?: number };
}

async function setup(options: SetupOptions = {}) {
  const physics = new PhysicsWorld();
  await physics.init();
  const controller = makeController();
  const root = new Group();
  const contact = mainParticlePosition(controller);
  const metadata = {
    id: "prop-a",
    kind: "dynamic",
    blobConsumable: options.blobConsumable ?? {
      consumeSeconds: options.consumeSeconds ?? 1.5,
      biomass: options.biomass ?? 4,
    },
    ...(options.blobPrey ? { blobPrey: options.blobPrey } : {}),
  } as unknown as PhysicsMetadata;
  const created = createBody(physics, root, contact, metadata);
  physics.updateQueryPipeline();
  const claims = new BlobPreyClaimService();
  const onProgress = vi.fn<NonNullable<BlobV2PropConsumptionOptions["onProgress"]>>();
  const onConsumed = vi.fn<NonNullable<BlobV2PropConsumptionOptions["onConsumed"]>>();
  const consumption = new BlobV2PropConsumption(controller, physics, {
    ownerId: "blob-a",
    claimService: claims,
    onProgress,
    onConsumed,
  });
  return {
    physics,
    controller,
    root,
    contact,
    claims,
    claimId: `blob-prop:prop-a:${created.body.handle}`,
    consumption,
    onProgress,
    onConsumed,
    ...created,
  };
}

function makeController(): BlobOrganismController {
  return new BlobOrganismController({
    center: { x: 0, y: 1, z: 0 },
    seed: 427,
  });
}

function createBody(
  physics: PhysicsWorld,
  root: Group,
  position: Vector3,
  metadata: PhysicsMetadata,
) {
  const geometry = new BoxGeometry(0.4, 0.4, 0.4);
  const material = new MeshBasicMaterial();
  const mesh = new Mesh(geometry, material);
  mesh.position.copy(position);
  root.add(mesh);
  const body = physics.createDynamicBox(
    {
      id: metadata.id,
      position,
      size: new Vector3(0.4, 0.4, 0.4),
      mass: 1,
      metadata,
    },
    mesh,
  );
  return { body, mesh, geometry, material };
}

function mainParticlePosition(controller: BlobOrganismController): Vector3 {
  const snapshot = controller.snapshot();
  const main = snapshot.islands.find((island) => island.kind === "main");
  const particle = snapshot.particles.find(
    (candidate) => candidate.islandId === main?.id,
  );
  if (!particle) throw new Error("Expected an attached main particle");
  return new Vector3(particle.position.x, particle.position.y, particle.position.z);
}
