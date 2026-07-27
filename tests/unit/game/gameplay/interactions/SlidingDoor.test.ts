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

  it("emite cada transición una vez y preserva su activator", () => {
    const mesh = new Object3D();
    const body = { setNextKinematicTranslation: vi.fn() };
    const changed = vi.fn();
    const door = new SlidingDoor(
      "door-1",
      mesh,
      body as never,
      new Vector3(0, 3, 0),
      1,
      changed,
    );

    door.setOpen(true, { kind: "player" });
    door.setOpen(true, { kind: "none" });
    door.toggle({ kind: "entity", key: "npc-1", name: "guard" });

    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenNthCalledWith(1, true, { kind: "player" });
    expect(changed).toHaveBeenNthCalledWith(2, false, {
      kind: "entity",
      key: "npc-1",
      name: "guard",
    });
  });

  it("restaura apertura y pose intermedia sin emitir outputs", () => {
    const mesh = new Object3D();
    mesh.position.set(1, 2, 3);
    const body = {
      setTranslation: vi.fn(),
      setRotation: vi.fn(),
      setNextKinematicTranslation: vi.fn(),
      setNextKinematicRotation: vi.fn(),
    };
    const changed = vi.fn();
    const door = new SlidingDoor(
      "door-1",
      mesh,
      body as never,
      new Vector3(0, 0, 10),
      1,
      changed,
    );

    door.restoreSaveState({
      version: 1,
      id: "door-1",
      open: true,
      position: [1, 2, 7],
      rotation: [0, 0, 0, 1],
    });

    expect(door.isOpen()).toBe(true);
    expect(mesh.position.toArray()).toEqual([1, 2, 7]);
    expect(changed).not.toHaveBeenCalled();
    expect(body.setNextKinematicTranslation).toHaveBeenCalledWith(
      mesh.position,
    );
  });
});
