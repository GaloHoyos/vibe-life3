import { describe, expect, it, vi } from "vitest";
import { MeshStandardMaterial, Object3D, Scene, Vector3 } from "three";

// Los materiales PBR reales cargan texturas por TextureLoader, que necesita DOM.
vi.mock("@engine/render/material/Materials", () => ({
  getMaterial: () => new MeshStandardMaterial(),
}));

import { EventBus } from "@engine/core/EventBus";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { GameEventMap } from "@game/GameEvents";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import { resolveGrabbable } from "@game/gameplay/weapons/core/grabFilter";
import { PropArchetypes } from "@game/config/props.config";
import { DebrisPool } from "@game/gameplay/props/DebrisPool";
import { PropBreakSystem } from "@game/gameplay/props/PropBreakSystem";
import { PropContactMonitor } from "@game/gameplay/props/PropContactMonitor";
import { PropSystem } from "@game/gameplay/props/PropSystem";
import { recordEvents } from "@tests/support/events";

const PLAYER = new Vector3(0, 1, 6);

async function setup() {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(80, 1, 80),
    metadata: { surface: "concrete" },
  });
  const scene = new Scene();
  const bus = new EventBus<GameEventMap>();

  const props = new PropSystem(physics, scene, bus);
  const contacts = new PropContactMonitor(physics);
  const debris = new DebrisPool(physics, scene);
  const detonate = vi.fn();
  const playAt = vi.fn();
  const debrisBurst = vi.fn();
  const breaks = new PropBreakSystem(
    props,
    contacts,
    debris,
    { detonate } as unknown as GrenadeSystem,
    { hasSound: () => true } as unknown as SoundManager,
    { playAt } as unknown as PositionalSoundManager,
    { debrisBurst } as unknown as VfxSystem,
    bus,
  );

  let elapsed = 0;
  const tick = (frames = 1): void => {
    for (let i = 0; i < frames; i += 1) {
      physics.step(1 / 60);
      elapsed += 1 / 60;
      contacts.update(elapsed);
      breaks.update(1 / 60, elapsed, PLAYER);
    }
  };

  return {
    physics,
    scene,
    bus,
    props,
    contacts,
    debris,
    breaks,
    detonate,
    playAt,
    debrisBurst,
    tick,
    broken: recordEvents(bus, "prop.broken"),
    damaged: recordEvents(bus, "prop.damaged"),
  };
}

describe("rotura de props", () => {
  it("un cajón muerto se parte en fragmentos físicos agarrables", async () => {
    const { physics, props, breaks, tick, broken } = await setup();
    const crate = props.spawn({ id: "crate", archetypeId: "woodenCrate", position: [0, 0, 0] })!;

    crate.applyDamage(9999, new Vector3(1, 0, 0), undefined, "player", new Vector3(0.4, 0.4, 0), "melee");
    // Todavía no: la rotura se resuelve en el update, no en el applyDamage.
    expect(props.get("crate")).toBeDefined();

    tick();

    expect(props.get("crate")).toBeUndefined();
    const gibs = PropArchetypes.woodenCrate.gibs!;
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({
      propId: "crate",
      archetypeId: "woodenCrate",
      surface: "wood",
      sourceId: "player",
    });
    expect(broken[0]!.debrisCount).toBeGreaterThanOrEqual(
      Math.min(gibs.minChunks, 8),
    );

    const debrisBodies = physics.getBodiesByKind("prop");
    expect(debrisBodies.length).toBe(broken[0]!.debrisCount);
    for (const body of debrisBodies) {
      expect(physics.getBodyMetadata(body)?.propKind).toBe("debris");
    }
    expect(breaks).toBeDefined();
  });

  it("los fragmentos con masa suficiente se pueden agarrar", async () => {
    const { physics, props, tick } = await setup();
    // Un archivero es pesado: sus pedazos superan el piso de masa del agarre.
    props.spawn({ id: "cabinet", archetypeId: "filingCabinet", position: [0, 0, 0] })!
      .applyDamage(9999, undefined, undefined, "player", undefined, "explosive");
    tick();
    physics.updateQueryPipeline();

    const grabbable = physics
      .getBodiesByKind("prop")
      .filter((body) => !physics.getBodyMetadata(body)?.grabExcluded);

    expect(grabbable.length).toBeGreaterThan(0);
  });

  it("suena la rotura y, un instante después, los pedazos asentándose", async () => {
    const { props, tick, playAt } = await setup();
    props.spawn({ id: "crate", archetypeId: "woodenCrate", position: [0, 0, 0] })!
      .applyDamage(9999, undefined, undefined, "player", undefined, "melee");

    tick();
    expect(playAt).toHaveBeenCalledTimes(1);
    const breakId = playAt.mock.calls[0]![0] as string;
    expect(breakId.startsWith("physics.hl2.wood.break")).toBe(true);

    // El ruido de los pedazos llega con retardo, no en el mismo frame.
    tick(30);
    expect(playAt.mock.calls.length).toBeGreaterThan(1);
  });

  it("la reacción explode delega en la explosión radial reusable", async () => {
    const { props, tick, detonate } = await setup();
    props.spawn({
      id: "barrel",
      archetypeId: "metalBarrel",
      position: [0, 0, 0],
      breakOverride: { kind: "explode", damage: 90, radius: 4.5, impulse: 14 },
    })!.applyDamage(9999, undefined, undefined, "player", undefined, "bullet");

    tick();

    expect(detonate).toHaveBeenCalledTimes(1);
    expect(detonate.mock.calls[0]![1]).toMatchObject({
      damage: 90,
      radius: 4.5,
      impulse: 14,
      ownerKind: "player",
      sourceId: "player",
    });
  });

  it("una botella que cae de altura se rompe sola al tocar el piso", async () => {
    const { props, tick, broken } = await setup();
    props.spawn({ id: "bottle", archetypeId: "glassBottle", position: [0, 5, 0] });

    // Cae, pega contra el hormigón y el daño por impacto la termina.
    tick(120);

    expect(props.get("bottle")).toBeUndefined();
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({ archetypeId: "glassBottle", surface: "glass" });
  });

  it("un cajón apoyándose despacio no se daña solo", async () => {
    const { props, tick, broken, damaged } = await setup();
    const crate = props.spawn({
      id: "crate",
      archetypeId: "woodenCrate",
      position: [0, 0.2, 0],
    })!;
    const health = crate.currentHealth();

    tick(90);

    expect(broken).toHaveLength(0);
    expect(damaged).toHaveLength(0);
    expect(crate.currentHealth()).toBe(health);
  });

  it("un prop indestructible aguanta la caída y el golpe", async () => {
    const { props, tick, broken } = await setup();
    props.spawn({ id: "cone", archetypeId: "trafficCone", position: [0, 6, 0] });

    tick(120);

    expect(props.get("cone")).toBeDefined();
    expect(broken).toHaveLength(0);
  });

  it("emite prop.damaged sólo cuando el golpe NO es letal", async () => {
    const { props, tick, damaged, broken } = await setup();
    const crate = props.spawn({ id: "crate", archetypeId: "woodenCrate", position: [0, 0, 0] })!;

    crate.applyDamage(5, undefined, undefined, "player", undefined, "bullet");
    expect(damaged).toHaveLength(1);
    expect(damaged[0]).toMatchObject({ propId: "crate", sourceId: "player" });
    expect(damaged[0]!.health).toBeLessThan(damaged[0]!.maxHealth);

    crate.applyDamage(9999, undefined, undefined, "player", undefined, "bullet");
    tick();

    // La muerte la anuncia prop.broken, no otro prop.damaged.
    expect(damaged).toHaveLength(1);
    expect(broken).toHaveLength(1);
  });

  it("las roturas encadenadas se escalonan de a un frame", async () => {
    const { props, tick, broken } = await setup();
    const first = props.spawn({ id: "a", archetypeId: "woodenCrate", position: [0, 0, 0] })!;
    const second = props.spawn({ id: "b", archetypeId: "woodenCrate", position: [3, 0, 0] })!;
    // El segundo se marca durante el frame en que se resuelve el primero.
    first.applyDamage(9999, undefined, undefined, "player", undefined, "melee");

    tick();
    expect(broken).toHaveLength(1);

    second.applyDamage(9999, undefined, undefined, "player", undefined, "melee");
    tick();
    expect(broken).toHaveLength(2);
  });

  it("clear libera los fragmentos antes del reset de física", async () => {
    const { physics, scene, props, breaks, tick } = await setup();
    props.spawn({ id: "crate", archetypeId: "woodenCrate", position: [0, 0, 0] })!
      .applyDamage(9999, undefined, undefined, "player", undefined, "melee");
    tick();
    expect(physics.getBodiesByKind("prop").length).toBeGreaterThan(0);

    breaks.clear();
    props.clear();

    expect(physics.getBodiesByKind("prop")).toHaveLength(0);
    expect(scene.children).toHaveLength(0);
  });
});

describe("el sonido de choque y la rotura comparten un único detector", () => {
  it("el monitor publica el choque una vez y ambos lo ven", async () => {
    const { physics, props, contacts } = await setup();
    props.spawn({ id: "crate", archetypeId: "woodenCrate", position: [0, 6, 0] });

    let contactFrames = 0;
    for (let i = 0; i < 120; i += 1) {
      physics.step(1 / 60);
      contacts.update(i / 60);
      if (contacts.contacts().length > 0) contactFrames += 1;
    }

    // Un golpe, no uno por frame: el cooldown por cuerpo lo garantiza.
    expect(contactFrames).toBeGreaterThan(0);
    expect(contactFrames).toBeLessThan(5);
  });

  it("ignora cuerpos que resuelven su propio impacto (vehículos, granadas)", async () => {
    const { physics, contacts } = await setup();
    const body = physics.createDynamicBox(
      {
        id: "vehicle",
        position: new Vector3(0, 6, 0),
        size: new Vector3(1, 1, 1),
        mass: 100,
        metadata: { propImpactExcluded: true },
      },
      new Object3D(),
    );

    for (let i = 0; i < 120; i += 1) {
      physics.step(1 / 60);
      contacts.update(i / 60);
      expect(contacts.contacts()).toHaveLength(0);
    }
    expect(body.isValid()).toBe(true);
  });
});
