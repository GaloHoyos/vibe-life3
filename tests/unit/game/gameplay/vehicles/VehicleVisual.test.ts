import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from "three";
import { describe, expect, it, vi } from "vitest";
import { prepareVehicleModelSource } from "@game/assets/vehicles/VehicleAssetRegistry";
import {
  createVehicleVisual,
  type VehicleVisualModelLease,
} from "@game/gameplay/vehicles/VehicleVisual";

describe("VehicleVisual", () => {
  it("instala el GLB, usa sus anchors y anima ruedas y torreta", () => {
    const model = buggyModel();
    prepareVehicleModelSource(model, "buggy");
    const release = vi.fn();
    const lease: VehicleVisualModelLease = {
      root: model,
      dispose: release,
    };
    const visual = createVehicleVisual("buggy");

    expect(visual.installModel(lease)).toBe(true);
    expect(visual.hasGeneratedModel()).toBe(true);
    expect(visual.seatAnchors.get("driver")?.name).toBe("seat_driver");
    expect(visual.cameraAnchors.get("driver")?.name).toBe("camera_driver");
    expect(visual.exitAnchors.get("driver")?.map((node) => node.name)).toEqual([
      "exit_left",
      "exit_right",
    ]);
    expect(visual.muzzle?.name).toBe("muzzle");

    visual.update(1 / 60, {
      speed: 16,
      steering: 0.5,
      wheelRotation: 2,
      suspension: [0.5, 0, 0, 0],
      engine01: 0.8,
    });
    visual.aim(0.3, 0.2);

    const wheel = model.getObjectByName("wheel_front_left")!;
    // `suspension` va en metros de compresión desde la extensión total, y se
    // suma directo a la pose de reposo del nodo (baseY = 1 en este fixture).
    expect(wheel.position.y).toBeCloseTo(1.5);
    expect(wheel.rotation.x).toBeCloseTo(2);
    // Signo negativo: girar sobre +Y lleva la rueda hacia +X, que es la
    // izquierda. Ver la convención en VehicleSteering.test.ts.
    expect(wheel.rotation.y).toBeCloseTo(-0.24);
    expect(model.getObjectByName("turret_yaw")?.rotation.y).toBeCloseTo(0.3);
    expect(model.getObjectByName("turret_pitch")?.rotation.x).toBeCloseTo(
      -0.2,
    );

    visual.setWreckage(true);
    expect(model.getObjectByName("runtime_visual_lods")?.visible).toBe(false);
    expect(model.getObjectByName("wreckage")?.visible).toBe(true);

    visual.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("mantiene el modelo procedural si el lease no es instalable", () => {
    const release = vi.fn();
    const invalidLease: VehicleVisualModelLease = {
      root: new Group(),
      dispose: release,
    };
    const visual = createVehicleVisual("airboat");

    expect(visual.installModel(invalidLease)).toBe(false);
    expect(visual.hasGeneratedModel()).toBe(false);
    expect(visual.seatAnchors.get("driver")?.name).toBe("seat_driver");
    expect(release).toHaveBeenCalledTimes(1);

    visual.dispose();
  });
});

function buggyModel(): Group {
  const scene = new Group();
  const root = named("buggy_vehicle");
  scene.add(root);
  for (const index of [0, 1, 2]) {
    const lod = named(`visual_lod${index}`);
    lod.add(
      new Mesh(
        new BoxGeometry(2, 1, 3),
        new MeshStandardMaterial({ color: 0x8d714b }),
      ),
    );
    root.add(lod);
  }

  const level0 = root.getObjectByName("visual_lod0")!;
  const wheel = named("wheel_front_left");
  wheel.position.y = 1;
  level0.add(wheel);
  const turretYaw = named("turret_yaw");
  const turretPitch = named("turret_pitch");
  turretYaw.add(turretPitch);
  level0.add(turretYaw);

  for (const [name, position] of [
    ["seat_driver", [4, 1, 0]],
    ["seat_gunner", [-4, 1, 0]],
    ["camera_driver", [4, 2, 0]],
    ["exit_left", [-3, 0, 0]],
    ["exit_right", [3, 0, 0]],
    ["muzzle", [0, 2, 3]],
  ] as const) {
    const anchor = named(name);
    anchor.position.set(position[0], position[1], position[2]);
    root.add(anchor);
  }

  const wreckage = named("wreckage");
  wreckage.add(
    new Mesh(
      new BoxGeometry(1, 0.5, 1),
      new MeshStandardMaterial({ color: 0x211b16 }),
    ),
  );
  root.add(wreckage);
  return scene;
}

function named(name: string): Group {
  const object = new Group();
  object.name = name;
  return object;
}
