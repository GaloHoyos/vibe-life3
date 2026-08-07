import { describe, expect, it, vi } from "vitest";
import { MeshStandardMaterial, Scene, Vector3 } from "three";

vi.mock("@engine/render/material/Materials", () => ({
  getMaterial: () => new MeshStandardMaterial(),
}));

import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { GameEventMap } from "@game/GameEvents";
import { PropArchetypes } from "@game/config/props.config";
import { PropSystem } from "@game/gameplay/props/PropSystem";
import { ExplosiveBarrelSystem } from "@game/gameplay/hazards/ExplosiveBarrelSystem";
import type { ExplosiveBarrelDefinition } from "@game/gameplay/hazards/ExplosiveBarrel";

const DEFINITION: ExplosiveBarrelDefinition = {
  id: "barrel-1",
  position: [2, 0, -3],
  rotation: [0, 0.4, 0],
};

async function setup() {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(40, 1, 40),
  });
  const scene = new Scene();
  const props = new PropSystem(physics, scene, new EventBus<GameEventMap>());
  const barrels = new ExplosiveBarrelSystem(props);
  return { physics, props, barrels };
}

/** Lo que el loader hace con cada `ExplosiveBarrelDefinition` del nivel. */
function load(
  props: PropSystem,
  barrels: ExplosiveBarrelSystem,
  definitions: readonly ExplosiveBarrelDefinition[],
): void {
  for (const definition of definitions) {
    barrels.track(definition.id);
    props.spawn(ExplosiveBarrelSystem.toPropDefinition(definition));
  }
}

describe("migracion del barril explosivo a prop del catalogo", () => {
  it("traduce la definicion vieja conservando sus valores por defecto", () => {
    const converted = ExplosiveBarrelSystem.toPropDefinition(DEFINITION);

    expect(converted).toMatchObject({
      id: "barrel-1",
      archetypeId: "explosiveBarrel",
      position: [2, 0, -3],
      rotation: [0, 0.4, 0],
      health: 25,
      breakOverride: { kind: "explode", damage: 90, radius: 4.5, impulse: 14 },
    });
  });

  it("respeta los overrides autorados en el nivel", () => {
    const converted = ExplosiveBarrelSystem.toPropDefinition({
      ...DEFINITION,
      health: 60,
      damage: 150,
      radius: 8,
      impulse: 22,
    });

    expect(converted.health).toBe(60);
    expect(converted.breakOverride).toEqual({
      kind: "explode",
      damage: 150,
      radius: 8,
      impulse: 22,
    });
  });

  it("el barril spawnea como prop, con vida y reaccion explosiva", async () => {
    const { physics, props, barrels } = await setup();
    load(props, barrels, [DEFINITION]);

    const prop = props.get("barrel-1")!;
    expect(prop.archetype.id).toBe("explosiveBarrel");
    expect(prop.currentHealth()).toBe(25);
    expect(prop.breakReaction).toMatchObject({ kind: "explode", damage: 90 });
    // Ahora es un cuerpo indexado como prop, no un destructible aparte.
    expect(physics.getBodiesByKind("prop")).toHaveLength(1);
    expect(prop.getBody()!.mass()).toBeCloseTo(
      PropArchetypes.explosiveBarrel.physics.mass,
      3,
    );
  });

  it("captura el formato v1 desde el estado del prop", async () => {
    const { props, barrels } = await setup();
    load(props, barrels, [DEFINITION]);
    props.get("barrel-1")!.applyDamage(10, undefined, undefined, "player", undefined, "bullet");

    const snapshot = barrels.captureSaveState();

    expect(snapshot.version).toBe(1);
    expect(snapshot.barrels).toHaveLength(1);
    const entry = snapshot.barrels[0]!;
    expect(entry.destroyed).toBe(false);
    if (entry.destroyed) throw new Error("esperaba un barril vivo");
    expect(entry.id).toBe("barrel-1");
    expect(entry.health).toBe(15);
    expect(entry.alive).toBe(true);
    expect(entry.lastAttackerId).toBe("player");
    expect(entry.body).toBeDefined();
  });

  it("una partida vieja recupera vida y pose del barril", async () => {
    const { props, barrels } = await setup();
    load(props, barrels, [DEFINITION]);
    props.get("barrel-1")!.applyDamage(10, undefined, undefined, "player", undefined, "bullet");
    const saved = barrels.captureSaveState();

    // Se "cura" el barril, como pasaría al recargar el nivel de cero.
    const { props: freshProps, barrels: freshBarrels } = await setup();
    load(freshProps, freshBarrels, [DEFINITION]);
    expect(freshProps.get("barrel-1")!.currentHealth()).toBe(25);

    freshBarrels.restoreSaveState(saved);

    expect(freshProps.get("barrel-1")!.currentHealth()).toBe(15);
    expect(freshProps.get("barrel-1")!.isAlive()).toBe(true);
  });

  it("un barril ya destruido sigue destruido al restaurar", async () => {
    const { props, barrels } = await setup();
    load(props, barrels, [DEFINITION]);
    props.remove(props.get("barrel-1")!);
    const saved = barrels.captureSaveState();

    expect(saved.barrels[0]).toEqual({ id: "barrel-1", destroyed: true });

    const { props: freshProps, barrels: freshBarrels } = await setup();
    load(freshProps, freshBarrels, [DEFINITION]);
    freshBarrels.restoreSaveState(saved);

    expect(freshProps.get("barrel-1")).toBeUndefined();
  });

  it("tolera un snapshot con barriles que este nivel ya no tiene", async () => {
    const { props, barrels } = await setup();
    load(props, barrels, [DEFINITION]);

    expect(() =>
      barrels.restoreSaveState({
        version: 1,
        barrels: [{ id: "barril-de-otro-nivel", destroyed: true }],
      }),
    ).not.toThrow();
    expect(props.get("barrel-1")).toBeDefined();
  });
});
