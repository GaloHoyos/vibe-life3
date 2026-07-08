import { describe, expect, it, vi } from "vitest";
import { Object3D, Scene, Vector3 } from "three";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import { EventBus } from "@engine/core/EventBus";
import type { Raycast } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { GameEventMap } from "@game/GameEvents";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import { EnergyBallSystem } from "@game/gameplay/weapons/energyball/EnergyBallSystem";

describe("EnergyBallSystem", () => {
  it("attaches fly audio to spawned balls and clears it with the mesh", () => {
    const scene = new Scene();
    const positionalSounds = {
      attachToObject: vi.fn(),
      stopAttached: vi.fn(),
      playAt: vi.fn(),
    };
    const system = new EnergyBallSystem(
      scene,
      { cast: vi.fn(() => null) } as unknown as Raycast,
      new EventBus<GameEventMap>(),
      { detonate: vi.fn() } as unknown as GrenadeSystem,
      { explosion: vi.fn() } as unknown as VfxSystem,
      positionalSounds as unknown as PositionalSoundManager,
    );

    system.spawn({
      origin: new Vector3(0, 1, 0),
      direction: new Vector3(0, 0, -1),
      speed: 45,
      sourceId: "player",
      now: 0,
    });

    expect(positionalSounds.attachToObject).toHaveBeenCalledWith(
      expect.stringMatching(/^weapons\.energyball\.hl2\.flyby/),
      expect.any(Object3D),
      expect.objectContaining({ loop: true }),
    );
    expect(scene.children).toHaveLength(1);

    system.clear();

    expect(positionalSounds.stopAttached).toHaveBeenCalledWith(expect.any(Object3D));
    expect(scene.children).toHaveLength(0);
  });
});
