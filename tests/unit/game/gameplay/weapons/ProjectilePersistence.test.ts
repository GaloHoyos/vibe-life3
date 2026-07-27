import { describe, expect, it, vi } from "vitest";
import { Object3D, Scene, Vector3 } from "three";
import type { AssetManager } from "@engine/assets/AssetManager";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import { EventBus } from "@engine/core/EventBus";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast, RaycastHit } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { GameEventMap } from "@game/GameEvents";
import {
  BoltSystem,
  type BoltSystemSaveState,
} from "@game/gameplay/weapons/bolt/BoltSystem";
import { EnergyBallSystem } from "@game/gameplay/weapons/energyball/EnergyBallSystem";
import {
  GrenadeSystem,
  type GrenadeSystemSaveState,
} from "@game/gameplay/weapons/grenade/GrenadeSystem";
import { RocketSystem } from "@game/gameplay/weapons/rocket/RocketSystem";
import { assertJsonValue } from "@game/save/JsonValue";
import { toJsonObject } from "@game/save/GameSaveState";
import { SaveEntityRegistry } from "@game/save/SaveEntityRegistry";
import { rawSaveEnvelope } from "@tests/unit/game/save/SaveTestSupport";
import {
  fakeAssets,
  fakePositionalSounds,
  fakeRaycast,
  fakeVfx,
} from "@tests/support/fakes";

describe("persistencia de proyectiles activos", () => {
  it("restaura granadas con física, timers y contador de ids", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const sounds = fakePositionalSounds();
    const system = new GrenadeSystem(
      physics,
      new Scene(),
      fakeAssets(),
      fakeRaycast(),
      new EventBus<GameEventMap>(),
      sounds,
      fakeVfx(),
    );
    system.spawn({
      mode: "fuse",
      origin: new Vector3(1, 2, 3),
      velocity: new Vector3(4, 5, 6),
      damage: 84,
      radius: 4.2,
      impulse: 11,
      fuseSeconds: 3,
      ownerKind: "npc",
      sourceId: "combine-grenadier",
      sourceFaction: "combine",
      weaponName: "Granada Combine",
      now: 12,
    });

    const before = system.capture();
    expect(() => assertJsonValue(before)).not.toThrow();
    system.restore(before);

    expect(system.capture()).toEqual(before);
    expect(physics.getBodyCount()).toBe(1);
    expect(sounds.playedAt).toHaveLength(0);

    system.spawn({
      mode: "impact",
      origin: new Vector3(),
      velocity: new Vector3(0, 0, 1),
      damage: 10,
      radius: 1,
      impulse: 1,
      ownerKind: "player",
      sourceId: "player",
      sourceFaction: "player",
      weaponName: "SMG",
      now: 12,
    });
    expect(system.capture().grenades.at(-1)?.id).toBe("grenade-1");
    system.dispose();
  });

  it("restaura cohetes y la guía láser sin detonar", () => {
    const scene = new Scene();
    const grenades = { detonate: vi.fn() };
    const sounds = {
      attachToObject: vi.fn(),
      stopAttached: vi.fn(),
    };
    const system = new RocketSystem(
      scene,
      inertAssets(),
      { cast: vi.fn(() => null) } as unknown as Raycast,
      grenades as unknown as GrenadeSystem,
      { rocketTrail: vi.fn() } as unknown as VfxSystem,
      sounds as unknown as PositionalSoundManager,
    );
    const id = system.spawn({
      origin: new Vector3(2, 3, 4),
      direction: new Vector3(1, 0, 1),
      damage: 200,
      radius: 5,
      impulse: 25,
      ownerKind: "npc",
      sourceId: "rebel-rocketeer",
      sourceFaction: "resistance",
      weaponName: "Lanzacohetes",
      now: 8,
    });
    system.updateLaser(
      "rebel-rocketeer",
      new Vector3(2, 3, 4),
      new Vector3(0, 0, 1),
    );
    system.update(0.05, 8.4);

    const before = system.capture();
    expect(() => assertJsonValue(before)).not.toThrow();
    system.restore(before);

    expect(system.capture()).toEqual(before);
    expect(system.hasRocket(id)).toBe(true);
    expect(grenades.detonate).not.toHaveBeenCalled();
    expect(scene.getObjectByName("rebel-rocketeer-rpg-laser-dot")?.visible).toBe(
      true,
    );
    system.dispose();
  });

  it("restaura virotes en vuelo y clavados sin repetir impactos", () => {
    const hitEvents: GameEventMap["weapon.hit"][] = [];
    const eventBus = new EventBus<GameEventMap>();
    eventBus.on("weapon.hit", (event) => hitEvents.push(event));
    const impact: RaycastHit = {
      collider: {
        parent: () => null,
      } as unknown as RaycastHit["collider"],
      metadata: { id: "wall", kind: "static" },
      point: new Vector3(2, 1, 2),
      normal: new Vector3(-1, 0, 0),
      toi: 2,
    };
    const system = new BoltSystem(
      new Scene(),
      {
        cast: vi.fn().mockReturnValueOnce(impact).mockReturnValue(null),
      } as unknown as Raycast,
      eventBus,
    );
    system.spawn({
      origin: new Vector3(0, 1, 2),
      direction: new Vector3(1, 0.2, 0),
      speed: 90,
      damage: 75,
      impulse: 4,
      weaponName: "Ballesta",
      sourceId: "rebel-crossbow",
      ownerKind: "npc",
      sourceFaction: "resistance",
      now: 20,
    });
    system.update(0.1, 20.1);

    const before = system.capture();
    expect(before.bolts[0]?.stuck).toBe(true);
    expect(() => assertJsonValue(before)).not.toThrow();
    hitEvents.length = 0;
    system.restore(before);

    expect(system.capture()).toEqual(before);
    expect(hitEvents).toHaveLength(0);
    system.dispose();
  });

  it("restaura bolas de energía con rebotes, facción y loop original", () => {
    const scene = new Scene();
    const grenades = { detonate: vi.fn() };
    const sounds = {
      attachToObject: vi.fn(),
      stopAttached: vi.fn(),
      playAt: vi.fn(),
    };
    const system = new EnergyBallSystem(
      scene,
      { cast: vi.fn(() => null) } as unknown as Raycast,
      new EventBus<GameEventMap>(),
      grenades as unknown as GrenadeSystem,
      { explosion: vi.fn() } as unknown as VfxSystem,
      sounds as unknown as PositionalSoundManager,
    );
    system.spawn({
      origin: new Vector3(-1, 1, 4),
      direction: new Vector3(0, 0, -1),
      speed: 42,
      sourceId: "combine-ar3",
      ownerKind: "npc",
      sourceFaction: "combine",
      now: 4,
    });
    system.update(0.1, 4.1, []);

    const before = system.capture();
    expect(() => assertJsonValue(before)).not.toThrow();
    const flyby = before.balls[0]?.flybySoundId;
    system.restore(before);

    expect(system.capture()).toEqual(before);
    expect(grenades.detonate).not.toHaveBeenCalled();
    expect(sounds.attachToObject).toHaveBeenLastCalledWith(
      flyby,
      expect.any(Object3D),
      expect.objectContaining({ loop: true }),
    );
    system.dispose();
  });

  it("los proyectiles cruzan el SaveEntityRegistry como los registra Game", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    const grenades = new GrenadeSystem(
      physics,
      new Scene(),
      fakeAssets(),
      fakeRaycast(),
      new EventBus<GameEventMap>(),
      fakePositionalSounds(),
      fakeVfx(),
    );
    const bolts = new BoltSystem(
      new Scene(),
      { cast: vi.fn(() => null) } as unknown as Raycast,
      new EventBus<GameEventMap>(),
    );
    const registry = new SaveEntityRegistry();
    registry.register({
      id: "system:grenades",
      entityType: "grenade-system",
      version: 1,
      phases: ["physics"],
      capture: () => toJsonObject(grenades.capture()),
      restore: (data) =>
        grenades.restore(data as unknown as GrenadeSystemSaveState),
    });
    registry.register({
      id: "system:bolts",
      entityType: "bolt-system",
      version: 1,
      phases: ["physics"],
      capture: () => toJsonObject(bolts.capture()),
      restore: (data) => bolts.restore(data as unknown as BoltSystemSaveState),
    });

    grenades.spawn({
      mode: "fuse",
      origin: new Vector3(1, 2, 3),
      velocity: new Vector3(0, 4, 0),
      damage: 84,
      radius: 4.2,
      impulse: 11,
      fuseSeconds: 3,
      ownerKind: "player",
      sourceId: "player",
      sourceFaction: "player",
      weaponName: "Granada",
      now: 5,
    });
    bolts.spawn({
      origin: new Vector3(0, 1, 2),
      direction: new Vector3(1, 0, 0),
      speed: 90,
      damage: 75,
      impulse: 4,
      weaponName: "Ballesta",
      sourceId: "player",
      ownerKind: "player",
      sourceFaction: "player",
      now: 5,
    });

    const captured = await registry.captureAll();
    expect(Object.keys(captured)).toEqual(["system:bolts", "system:grenades"]);

    // Estado limpio, como tras reconstruir el mundo al cargar.
    grenades.clear();
    bolts.clear();
    expect(physics.getBodyCount()).toBe(0);
    expect(bolts.capture().bolts).toHaveLength(0);

    const prepared = registry.prepareRestore(captured);
    await registry.restorePhase(prepared, "physics", rawSaveEnvelope(), null);

    expect(grenades.capture()).toEqual(captured["system:grenades"]?.data);
    expect(bolts.capture()).toEqual(captured["system:bolts"]?.data);
    expect(physics.getBodyCount()).toBe(1);

    grenades.dispose();
    bolts.dispose();
  });
});

function inertAssets(): AssetManager {
  return {
    loadModel: vi.fn(async () => ({
      asset: { id: "rpgRocket", path: "", type: "prop", debug: false },
      gltf: null,
      loaded: false,
      hasSkeleton: false,
      animationsIgnored: true,
    })),
    instantiateModel: vi.fn(async () => ({
      asset: { id: "rpgRocket", path: "", type: "prop", debug: false },
      root: null,
      source: "fallback",
      hasSkeleton: false,
      animationsIgnored: true,
    })),
  } as unknown as AssetManager;
}
