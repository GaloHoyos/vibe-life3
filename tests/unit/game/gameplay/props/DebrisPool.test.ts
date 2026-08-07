import { describe, expect, it, vi } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { BoxGeometry, MeshStandardMaterial, Quaternion, Scene, Vector3 } from "three";
import type { PropChunkSource } from "@game/assets/props/PropAssetRegistry";

// Los materiales PBR reales cargan texturas por TextureLoader, que necesita DOM.
vi.mock("@engine/render/material/Materials", () => ({
  getMaterial: () => new MeshStandardMaterial(),
}));

import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { DebrisConfig, DebrisPool } from "@game/gameplay/props/DebrisPool";

const ORIGIN = new Vector3(0, 5, 0);

async function makePool(): Promise<{ physics: PhysicsWorld; scene: Scene; pool: DebrisPool }> {
  const physics = new PhysicsWorld();
  await physics.init();
  const scene = new Scene();
  return { physics, scene, pool: new DebrisPool(physics, scene) };
}

function makeChunk(
  center: [number, number, number],
  sector: [number, number, number],
  massFraction: number,
): PropChunkSource {
  return {
    geometry: new BoxGeometry(0.2, 0.2, 0.2),
    material: new MeshStandardMaterial(),
    sector,
    massFraction,
    size: [0.2, 0.2, 0.2],
    center,
  };
}

function burst(pool: DebrisPool, count: number, seed: number, origin = ORIGIN): number {
  return pool.spawn({
    count,
    origin,
    rotation: new Quaternion(),
    bounds: [1, 1, 1],
    mass: 20,
    surface: "wood",
    inheritedVelocity: new Vector3(),
    burstSpeed: 3,
    seed,
  });
}

describe("DebrisPool", () => {
  it("crea cuerpos físicos reales, no partículas", async () => {
    const { physics, scene, pool } = await makePool();

    expect(burst(pool, 6, 1)).toBe(6);
    expect(pool.count()).toBe(6);
    expect(physics.getBodiesByKind("prop")).toHaveLength(6);
    expect(scene.children).toHaveLength(6);

    const body = physics.getBodiesByKind("prop")[0]!;
    expect(physics.getBodyMetadata(body)).toMatchObject({
      propKind: "debris",
      surface: "wood",
      // Ocho astillas no deben empujar al jugador ni molerlo a daño.
      propImpactExcluded: true,
    });
    // Salen despedidos, no caen en el lugar.
    const velocity = body.linvel();
    expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeGreaterThan(0);
  });

  it("recorta cada rotura al techo por estallido", async () => {
    const { pool } = await makePool();

    expect(burst(pool, 40, 1)).toBe(DebrisConfig.perBreakMax);
    expect(pool.count()).toBe(DebrisConfig.perBreakMax);
  });

  it("al llenarse recicla el fragmento más viejo, no el más nuevo", async () => {
    const { physics, pool } = await makePool();
    burst(pool, DebrisConfig.perBreakMax, 1);
    const firstBatch = [...physics.getBodiesByKind("prop")];

    // Llena el pool con creces.
    for (let i = 0; i < 20; i += 1) burst(pool, DebrisConfig.perBreakMax, i + 2);

    expect(pool.count()).toBe(DebrisConfig.capacity);
    const survivors = new Set(physics.getBodiesByKind("prop"));
    for (const body of firstBatch) {
      expect(survivors.has(body)).toBe(false);
    }
  });

  it("un fragmento sostenido no envejece: no se evapora en la mano", async () => {
    const { physics, pool } = await makePool();
    burst(pool, 2, 1);
    const held = physics.getBodiesByKind("prop")[0]!;
    physics.markHeld(held, true);

    // Muy por encima de la vida absoluta.
    for (let i = 0; i < 200; i += 1) pool.update(0.5, ORIGIN);

    expect(physics.getBodiesByKind("prop")).toContain(held);
    expect(pool.count()).toBe(1);
  });

  it("expira por vida absoluta aunque nunca llegue a dormirse", async () => {
    const { pool } = await makePool();
    burst(pool, 4, 1);

    const total = DebrisConfig.lifetime + DebrisConfig.fadeDuration + 1;
    for (let elapsed = 0; elapsed < total; elapsed += 0.5) pool.update(0.5, ORIGIN);

    expect(pool.count()).toBe(0);
  });

  it("retira sin fade lo que quedó lejos del jugador", async () => {
    const { pool } = await makePool();
    burst(pool, 5, 1);

    pool.update(1 / 60, new Vector3(DebrisConfig.cullDistance * 4, 0, 0));

    expect(pool.count()).toBe(0);
  });

  it("clear libera cuerpos y mallas", async () => {
    const { physics, scene, pool } = await makePool();
    burst(pool, 8, 1);

    pool.clear();

    expect(pool.count()).toBe(0);
    expect(physics.getBodiesByKind("prop")).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
  });

  it("con fragmentos autorados los coloca donde estaban en el prop", async () => {
    const { physics, pool } = await makePool();
    // Dos fragmentos en extremos opuestos del prop.
    const chunks = [
      makeChunk([0.4, 0, 0], [1, 0, 0], 0.5),
      makeChunk([-0.4, 0, 0], [-1, 0, 0], 0.5),
    ];

    const spawned = pool.spawn({
      count: 8,
      origin: ORIGIN,
      rotation: new Quaternion(),
      bounds: [1, 1, 1],
      mass: 20,
      surface: "wood",
      inheritedVelocity: new Vector3(),
      burstSpeed: 3,
      seed: 5,
      chunks,
    });

    expect(spawned).toBe(2);
    const xs = physics
      .getBodiesByKind("prop")
      .map((body) => body.translation().x)
      .sort((a, b) => a - b);
    // No aparecen en el centro: cada uno nace en su sitio original.
    expect(xs[0]).toBeCloseTo(ORIGIN.x - 0.4, 4);
    expect(xs[1]).toBeCloseTo(ORIGIN.x + 0.4, 4);
  });

  it("los fragmentos autorados acompañan la escala de la instancia", async () => {
    const { physics, pool } = await makePool();
    // La geometría de los fragmentos es compartida por el pack, siempre en
    // tamaño base: un prop escalado tiene que escalarla al romperse.
    const chunks = [makeChunk([0.4, 0, 0], [1, 0, 0], 1)];

    pool.spawn({
      count: 1,
      origin: ORIGIN,
      rotation: new Quaternion(),
      bounds: [2, 2, 2],
      mass: 40,
      surface: "wood",
      inheritedVelocity: new Vector3(),
      burstSpeed: 3,
      seed: 3,
      chunks,
      scale: 2,
    });

    const body = physics.getBodiesByKind("prop")[0]!;
    expect(body.translation().x).toBeCloseTo(ORIGIN.x + 0.8, 4);
    const shape = body.collider(0).shape;
    expect(shape.type).toBe(RAPIER.ShapeType.Cuboid);
    expect((shape as RAPIER.Cuboid).halfExtents.x).toBeCloseTo(0.2, 4);
  });

  it("con coreSurvives el pedazo mas grande se queda en el lugar", async () => {
    const { physics, pool } = await makePool();
    const chunks = [
      makeChunk([0, -0.3, 0], [0, -1, 0], 0.7),
      makeChunk([0.3, 0.2, 0], [1, 0.5, 0], 0.15),
      makeChunk([-0.3, 0.2, 0], [-1, 0.5, 0], 0.15),
    ];

    pool.spawn({
      count: 8,
      origin: ORIGIN,
      rotation: new Quaternion(),
      bounds: [1, 1, 1],
      mass: 60,
      surface: "metal",
      inheritedVelocity: new Vector3(),
      burstSpeed: 5,
      seed: 9,
      chunks,
      coreSurvives: true,
    });

    const speeds = physics.getBodiesByKind("prop").map((body) => {
      const v = body.linvel();
      return Math.hypot(v.x, v.y, v.z);
    });
    const still = speeds.filter((speed) => speed < 0.01);
    // Exactamente uno se queda quieto: el chasis.
    expect(still).toHaveLength(1);
    expect(speeds.filter((speed) => speed > 1).length).toBe(2);
  });

  it("el estallido es direccional: revienta del lado del golpe", async () => {
    const { physics, pool } = await makePool();

    // Golpe desde +X: los pedazos deben irse mayormente hacia -X.
    pool.spawn({
      count: DebrisConfig.perBreakMax,
      origin: ORIGIN,
      rotation: new Quaternion(),
      bounds: [1, 1, 1],
      mass: 20,
      surface: "wood",
      inheritedVelocity: new Vector3(),
      impactPoint: ORIGIN.clone().add(new Vector3(1, 0, 0)),
      burstSpeed: 6,
      seed: 7,
    });

    let awayFromImpact = 0;
    let towardImpact = 0;
    for (const body of physics.getBodiesByKind("prop")) {
      const vx = body.linvel().x;
      if (vx < 0) awayFromImpact += -vx;
      else towardImpact += vx;
    }
    expect(awayFromImpact).toBeGreaterThan(towardImpact);
  });
});
