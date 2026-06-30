import { describe, expect, it, vi } from "vitest";
import { Object3D, Vector3 } from "three";
import { SlidingDoor } from "@game/gameplay/interactions/SlidingDoor";

describe("SlidingDoor", () => {
  it("toggles open state and moves kinematic body toward target", () => {
    const mesh = new Object3D();
    const body = { setNextKinematicTranslation: vi.fn() };
    const door = new SlidingDoor("door-1", mesh, body as never, new Vector3(0, 0, 10), 1);

    expect(door.isOpen()).toBe(false);
    expect(door.toggle()).toBe(true);
    door.update(0.5);

    expect(mesh.position.z).toBe(5);
    expect(body.setNextKinematicTranslation).toHaveBeenCalledWith({ x: 0, y: 0, z: 5 });

    door.setOpen(false);
    door.update(1);

    expect(mesh.position.z).toBe(0);
  });
});
