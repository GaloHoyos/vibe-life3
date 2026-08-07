import { describe, expect, it, vi } from "vitest";
import { MeshStandardMaterial, Quaternion, Scene, Vector3 } from "three";

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
