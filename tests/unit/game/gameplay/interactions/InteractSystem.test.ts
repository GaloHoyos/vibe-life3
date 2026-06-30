import { describe, expect, it } from "vitest";
import { BoxGeometry, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { InteractSystem } from "@game/gameplay/interactions/InteractSystem";
import { recordEvents } from "@tests/support/events";
import { fakeControls, fakeInteractable } from "@tests/support/fakes";

describe("InteractSystem", () => {
  it("focuses, interacts, holds and ends held interactables", () => {
    const bus = new EventBus<GameEventMap>();
    const focus = recordEvents(bus, "interaction.focus");
    const blur = recordEvents(bus, "interaction.blur");
    const system = new InteractSystem(bus);
    const interactable = fakeInteractable({
      object: meshAt(0, 0, -2),
      maxDistance: 4,
      label: "Use charger",
    });
    system.register(interactable);

    system.update(
      0.16,
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1),
      fakeControls({ pressed: new Set(["interact"]), down: new Set(["interact"]) }),
    );

    expect(focus).toEqual([{ label: "Use charger" }]);
    expect(interactable.interact).toHaveBeenCalledTimes(1);
    expect(interactable.interactHeld).toHaveBeenCalledWith(0.16);

    system.update(
      0.16,
      new Vector3(0, 0, 0),
      new Vector3(0, 0, 1),
      fakeControls(),
    );

    expect(blur).toEqual([{}]);
    expect(interactable.interactEnd).toHaveBeenCalledTimes(1);
  });

  it("clears interactables and ends active hold", () => {
    const system = new InteractSystem(new EventBus<GameEventMap>());
    const interactable = fakeInteractable({ object: meshAt(0, 0, -2) });
    system.register(interactable);

    system.update(
      0.1,
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -1),
      fakeControls({ down: new Set(["interact"]) }),
    );
    system.clear();

    expect(interactable.interactEnd).toHaveBeenCalledTimes(1);
  });
});

function meshAt(x: number, y: number, z: number): Object3D {
  const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  mesh.position.set(x, y, z);
  mesh.updateMatrixWorld(true);
  return mesh;
}
