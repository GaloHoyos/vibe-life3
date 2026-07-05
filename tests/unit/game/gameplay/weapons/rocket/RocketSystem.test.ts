import { describe, expect, it, vi } from "vitest";
import { Object3D, Quaternion, Scene, Vector3 } from "three";
import type { AssetManager, ModelInstance, ModelLoadResult } from "@engine/assets/AssetManager";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { ModelAssetId } from "@engine/assets/AssetManifest";
import type { Raycast, RaycastHit } from "@engine/physics/Raycast";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import { PortalPairState, type PortalFrame } from "@engine/portals/PortalFrame";
import { PortalRaycast } from "@engine/portals/PortalRaycast";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import { RocketSystem } from "@game/gameplay/weapons/rocket/RocketSystem";

function setup(
  raycastImpl: Raycast["cast"] = vi.fn(() => null),
  portals?: PortalRaycast,
) {
  const scene = new Scene();
  const grenades = {
    detonate: vi.fn(),
  };
  const vfx = {
    rocketTrail: vi.fn(),
  };
  const positionalSounds = {
    attachToObject: vi.fn(),
    stopAttached: vi.fn(),
  };
  const system = new RocketSystem(
    scene,
    fakeRocketAssets(),
    { cast: raycastImpl } as Raycast,
    grenades as unknown as GrenadeSystem,
    vfx as unknown as VfxSystem,
    positionalSounds as unknown as PositionalSoundManager,
    portals,
  );
  return { scene, system, grenades, vfx, positionalSounds };
}

function spawn(system: RocketSystem): string {
  return system.spawn({
    origin: new Vector3(0, 0, 0),
    direction: new Vector3(0, 0, 1),
    damage: 200,
    radius: 5.1,
    impulse: 26,
    ownerKind: "player",
    sourceId: "player",
    sourceFaction: "player",
    weaponName: "RPG",
    now: 0,
  });
}

function hit(kind: NonNullable<RaycastHit["metadata"]>["kind"], point: Vector3, toi: number): RaycastHit {
  return {
    collider: {} as RaycastHit["collider"],
    metadata: { id: `${kind}-hit`, kind },
    point,
    normal: new Vector3(0, 0, -1),
    toi,
  };
}

describe("RocketSystem", () => {
  it("gira suavemente hacia el laser target", () => {
    const { system } = setup();
    const id = spawn(system);

    system.updateLaser("player", new Vector3(0, 0, 0), new Vector3(1, 0, 0));
    system.update(0, 0.4);

    const snapshot = system.getRocketSnapshot(id);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.direction.x).toBeGreaterThan(0);
    expect(snapshot!.direction.z).toBeGreaterThan(0.9);
  });

  it("detona al impactar y delega explosion radial a GrenadeSystem", () => {
    const impact = hit("static", new Vector3(0, 0, 1.5), 1.5);
    const { system, grenades, positionalSounds } = setup(vi.fn(() => impact));
    const id = spawn(system);

    system.update(0.1, 0.1);

    expect(system.hasRocket(id)).toBe(false);
    expect(grenades.detonate).toHaveBeenCalledTimes(1);
    expect(grenades.detonate).toHaveBeenCalledWith(
      impact.point,
      expect.objectContaining({
        damage: 200,
        radius: 5.1,
        impulse: 26,
        ownerKind: "player",
        sourceId: "player",
        sourceFaction: "player",
        weaponName: "RPG",
      }),
    );
    expect(positionalSounds.stopAttached).toHaveBeenCalled();
  });

  it("ignora weapon pickups y detona contra el siguiente impacto valido", () => {
    const cast = vi
      .fn()
      .mockReturnValueOnce(hit("weaponPickup", new Vector3(0, 0, 0.2), 0.2))
      .mockReturnValueOnce(hit("door", new Vector3(0, 0, 1.2), 0.9));
    const { system, grenades } = setup(cast);

    spawn(system);
    system.update(0.1, 0.1);

    expect(cast).toHaveBeenCalledTimes(2);
    expect(grenades.detonate).toHaveBeenCalledTimes(1);
    expect(grenades.detonate.mock.calls[0][0]).toEqual(new Vector3(0, 0, 1.2));
  });

  describe("a traves de portales", () => {
    // Pared frontal en z=5 (portales A y B sobre ella) y pared trasera en
    // z=-25. El laser entra por A (centro) y sale por B hacia -z: el dot
    // termina en la pared trasera frente a B, en (12, 1.6, -25).
    const facingMinusZ = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    const frame = (x: number): PortalFrame => ({
      position: new Vector3(x, 1.6, 5),
      quaternion: facingMinusZ.clone(),
      halfWidth: 0.8,
      halfHeight: 1.2,
    });

    const wallCast: Raycast["cast"] = (origin, direction, maxDistance) => {
      const planes: Array<{ z: number; normal: Vector3 }> = [
        { z: 5, normal: new Vector3(0, 0, -1) },
        { z: -25, normal: new Vector3(0, 0, 1) },
      ];
      let best: RaycastHit | null = null;
      for (const plane of planes) {
        if (Math.abs(direction.z) < 1e-6) {
          continue;
        }
        const toi = (plane.z - origin.z) / direction.z;
        if (toi <= 0 || toi > maxDistance) {
          continue;
        }
        if (direction.dot(plane.normal) >= 0) {
          continue;
        }
        if (!best || toi < best.toi) {
          best = {
            collider: {} as RaycastHit["collider"],
            metadata: { id: "wall", kind: "static" },
            point: origin.clone().addScaledVector(direction, toi),
            normal: plane.normal.clone(),
            toi,
          };
        }
      }
      return best;
    };

    function portalSetup() {
      const pair = new PortalPairState();
      pair.set("a", frame(0));
      pair.set("b", frame(12));
      const raycast = { cast: wallCast } as Raycast;
      return setup(wallCast, new PortalRaycast(raycast, pair));
    }

    function simulate(
      system: RocketSystem,
      id: string,
      seconds: number,
      onFrame?: (elapsed: number) => void,
    ): void {
      const delta = 1 / 60;
      let elapsed = 0;
      const laserOrigin = new Vector3(0, 1.6, -15);
      const laserDir = new Vector3(0, 0, 1);
      for (let i = 0; i < seconds * 60 && system.hasRocket(id); i += 1) {
        system.updateLaser("player", laserOrigin, laserDir);
        elapsed += delta;
        system.update(delta, elapsed);
        onFrame?.(elapsed);
      }
    }

    function spawnFar(system: RocketSystem): string {
      return system.spawn({
        origin: new Vector3(0, 1.6, -15),
        direction: new Vector3(0, 0, 1),
        damage: 200,
        radius: 5.1,
        impulse: 26,
        ownerKind: "player",
        sourceId: "player",
        sourceFaction: "player",
        weaponName: "RPG",
        now: 0,
      });
    }

    it("el dot del laser aparece del otro lado del portal", () => {
      const { scene, system } = portalSetup();
      system.updateLaser("player", new Vector3(0, 1.6, -15), new Vector3(0, 0, 1));

      const dot = scene.getObjectByName("player-rpg-laser-dot");
      expect(dot).toBeDefined();
      expect(dot!.position.x).toBeCloseTo(12, 1);
      expect(dot!.position.z).toBeLessThan(-24.5);
    });

    it("en el lado cercano persigue el cruce sobre el disco, no el punto final", () => {
      const { system } = portalSetup();
      const id = spawnFar(system);

      // A 0.45 s el homing ya corrio ~9 frames y el cohete sigue a ~3 m del
      // portal: si persiguiera el punto final (12, 1.6, -25) en linea recta
      // ya habria girado lejos del disco.
      simulate(system, id, 0.45);
      const snapshot = system.getRocketSnapshot(id);
      expect(snapshot).not.toBeNull();
      expect(snapshot!.direction.z).toBeGreaterThan(0.95);
      expect(Math.abs(snapshot!.position.x)).toBeLessThan(0.5);
    });

    it("cruza el portal y sigue al laser hasta el punto final sin volver a la boca", () => {
      const { system, grenades } = portalSetup();
      const id = spawnFar(system);

      let sawExitSide = false;
      simulate(system, id, 4, () => {
        const snapshot = system.getRocketSnapshot(id);
        if (snapshot && snapshot.position.x > 10 && snapshot.position.z > 3) {
          sawExitSide = true;
        }
      });

      expect(sawExitSide).toBe(true);
      expect(grenades.detonate).toHaveBeenCalledTimes(1);
      const point = grenades.detonate.mock.calls[0][0] as Vector3;
      expect(point.z).toBeLessThan(-24);
      expect(point.x).toBeCloseTo(12, 0);
    });
  });

  it("limpia cohetes y laser dot en clear/dispose", () => {
    const { scene, system, positionalSounds } = setup();

    spawn(system);
    expect(positionalSounds.attachToObject).toHaveBeenCalledWith(
      "weapons.rpg.hl2.rocketLoop",
      expect.any(Object3D),
      expect.objectContaining({ loop: true }),
    );
    system.updateLaser("player", new Vector3(), new Vector3(0, 0, 1));
    expect(scene.children.length).toBeGreaterThan(0);

    system.clear();
    expect(scene.children.filter((child) => child.visible)).toHaveLength(0);
    expect(positionalSounds.stopAttached).toHaveBeenCalled();

    system.dispose();
    expect(scene.children).toHaveLength(0);
  });
});

function fakeRocketAssets(): AssetManager {
  const fallbackAsset = (id: ModelAssetId) => ({
    id,
    path: "",
    type: "prop" as const,
    debug: false,
  });
  return {
    loadModel: async (id: ModelAssetId): Promise<ModelLoadResult> => ({
      asset: fallbackAsset(id),
      gltf: null,
      loaded: false,
      hasSkeleton: false,
      animationsIgnored: true,
    }),
    instantiateModel: async (id: ModelAssetId): Promise<ModelInstance> => ({
      asset: fallbackAsset(id),
      root: null,
      source: "fallback",
      hasSkeleton: false,
      animationsIgnored: true,
    }),
  } as AssetManager;
}
