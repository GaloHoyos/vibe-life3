import { describe, expect, it, vi } from "vitest";
import { MeshStandardMaterial, Scene, Vector3 } from "three";

// Los materiales PBR reales cargan texturas por TextureLoader, que necesita DOM.
vi.mock("@engine/render/material/Materials", () => ({
  getMaterial: () => new MeshStandardMaterial(),
}));

import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import { resolveGrabbable } from "@game/gameplay/weapons/core/grabFilter";
import { PROP_ARCHETYPE_IDS, PropArchetypes } from "@game/config/props.config";
import { PropSystem } from "@game/gameplay/props/PropSystem";
import type { PropDefinition } from "@game/levels/LevelDefinition";

async function makeWorld(): Promise<{
  physics: PhysicsWorld;
  scene: Scene;
  bus: EventBus<GameEventMap>;
  props: PropSystem;
}> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(200, 1, 200),
    metadata: { surface: "concrete" },
  });
  const scene = new Scene();
  const bus = new EventBus<GameEventMap>();
  return { physics, scene, bus, props: new PropSystem(physics, scene, bus) };
}

function step(physics: PhysicsWorld, frames: number): void {
  for (let i = 0; i < frames; i += 1) physics.step(1 / 60);
}

describe("PropSystem: los 12 arquetipos sobre un piso", () => {
  it("todos se asientan, se duermen y no se hunden ni salen disparados", async () => {
    const { physics, props } = await makeWorld();

    PROP_ARCHETYPE_IDS.forEach((archetypeId, index) => {
      props.spawn({
        id: `prop-${archetypeId}`,
        archetypeId,
        // Espaciados para que no se toquen entre sí.
        position: [index * 4 - 22, 0, 0],
      });
    });

    expect(props.all()).toHaveLength(PROP_ARCHETYPE_IDS.length);
    step(physics, 150);

    for (const prop of props.all()) {
      const body = prop.getBody()!;
      const position = body.translation();
      const archetype = prop.archetype;
      // Un hull invertido o una densidad mal calculada se manifiesta acá: el
      // prop atraviesa el piso o sale disparado.
      expect(position.y, `${archetype.id} se hundió`).toBeGreaterThan(-0.5);
      expect(position.y, `${archetype.id} salió volando`).toBeLessThan(archetype.bounds[1] + 1);
      expect(Math.abs(position.x - prop.mesh.position.x)).toBeLessThan(0.5);
      expect(body.isSleeping(), `${archetype.id} nunca se durmió`).toBe(true);
    }
  });

  it("cada prop pesa lo que dice su arquetipo, escalado al cubo", async () => {
    const { physics, props } = await makeWorld();

    const normal = props.spawn({ id: "a", archetypeId: "woodenCrate", position: [0, 0, 0] })!;
    const big = props.spawn({
      id: "b",
      archetypeId: "woodenCrate",
      position: [6, 0, 0],
      scale: 2,
    })!;

    expect(normal.getBody()!.mass()).toBeCloseTo(PropArchetypes.woodenCrate.physics.mass, 3);
    expect(big.getBody()!.mass()).toBeCloseTo(PropArchetypes.woodenCrate.physics.mass * 8, 3);
    expect(physics.getBodiesByKind("prop")).toHaveLength(2);
  });

  it("un prop anclado es un cuerpo fijo y el dinámico no", async () => {
    const { props } = await makeWorld();

    const anchored = props.spawn({
      id: "anchored",
      archetypeId: "concreteBlock",
      position: [0, 0, 0],
      physicsMode: "anchored",
    })!;
    const dynamic = props.spawn({
      id: "dynamic",
      archetypeId: "concreteBlock",
      position: [4, 0, 0],
    })!;

    expect(anchored.getBody()!.isFixed()).toBe(true);
    expect(dynamic.getBody()!.isDynamic()).toBe(true);
  });

  it("la gravity gun ve los props, y respeta el veto del arquetipo", async () => {
    const { physics, props } = await makeWorld();
    props.spawn({ id: "crate", archetypeId: "woodenCrate", position: [0, 0, 0] });
    physics.updateQueryPipeline();

    const hit = new Raycast(physics).cast(new Vector3(-5, 0.4, 0), new Vector3(1, 0, 0), 20);

    expect(hit?.metadata?.kind).toBe("prop");
    expect(resolveGrabbable(hit!)).toMatchObject({ kind: "prop" });
  });

  it("el daño respeta los multiplicadores y la rotura queda diferida", async () => {
    const { props } = await makeWorld();
    const crate = props.spawn({ id: "crate", archetypeId: "woodenCrate", position: [0, 0, 0] })!;
    const health = PropArchetypes.woodenCrate.damage.health as number;
    const meleeMultiplier = PropArchetypes.woodenCrate.damage.multipliers?.melee ?? 1;

    crate.applyDamage(health / meleeMultiplier - 1, undefined, undefined, "player", undefined, "melee");
    expect(crate.isAlive()).toBe(true);

    crate.applyDamage(5, new Vector3(1, 0, 0), undefined, "player", new Vector3(0, 0.4, 0), "melee");

    expect(crate.isAlive()).toBe(false);
    // No se rompe solo: el sistema de rotura lo resuelve en su propio update.
    expect(crate.pendingBreak).toBe(true);
    expect(crate.lastAttackerId).toBe("player");
    expect(crate.breakPoint).toBeDefined();
    expect(props.all()).toHaveLength(1);
  });

  it("un prop indestructible aguanta cualquier golpe", async () => {
    const { props } = await makeWorld();
    const cone = props.spawn({ id: "cone", archetypeId: "trafficCone", position: [0, 0, 0] })!;

    cone.applyDamage(9999, undefined, undefined, "player", undefined, "explosive");

    expect(cone.isAlive()).toBe(true);
    expect(cone.pendingBreak).toBe(false);
  });

  it("clear libera cuerpos, mallas e índice antes del reset de física", async () => {
    const { physics, scene, props } = await makeWorld();
    PROP_ARCHETYPE_IDS.forEach((archetypeId, index) => {
      props.spawn({ id: `p-${index}`, archetypeId, position: [index * 4, 0, 0] });
    });
    const sceneChildren = scene.children.length;

    props.clear();

    expect(props.all()).toHaveLength(0);
    expect(physics.getBodiesByKind("prop")).toHaveLength(0);
    expect(scene.children.length).toBe(sceneChildren - PROP_ARCHETYPE_IDS.length);
  });
});

describe("PropSystem: guardado", () => {
  it("round-trippea vida, pose y props destruidos", async () => {
    const { physics, props } = await makeWorld();
    const definitions: PropDefinition[] = [
      { id: "crate", archetypeId: "woodenCrate", position: [0, 0, 0] },
      { id: "barrel", archetypeId: "metalBarrel", position: [5, 0, 0] },
    ];
    definitions.forEach((definition) => props.spawn(definition));
    step(physics, 30);

    props.get("crate")!.applyDamage(10, undefined, undefined, "player", undefined, "bullet");
    const snapshot = props.captureSaveState();
    const healthAfterHit = props.get("crate")!.currentHealth();

    // Se destruye uno y se cura el otro; el restore debe deshacer ambas cosas.
    props.remove(props.get("barrel")!);
    props.get("crate")!.applyDamage(5, undefined, undefined, "player", undefined, "bullet");
    props.restoreSaveState(snapshot);

    expect(props.get("crate")!.currentHealth()).toBeCloseTo(healthAfterHit, 5);
    expect(props.get("barrel")).toBeDefined();
    expect(physics.getBodiesByKind("prop")).toHaveLength(2);
  });

  it("un prop roto sigue roto al restaurar", async () => {
    const { props } = await makeWorld();
    props.spawn({ id: "crate", archetypeId: "woodenCrate", position: [0, 0, 0] });
    props.remove(props.get("crate")!);
    const snapshot = props.captureSaveState();

    expect(snapshot.props).toEqual([{ id: "crate", destroyed: true }]);

    props.restoreSaveState(snapshot);
    expect(props.get("crate")).toBeUndefined();
  });
});
