import { describe, expect, it, vi } from "vitest";
import { Quaternion, Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import { PortalPairState, type PortalFrame } from "@engine/portals/PortalFrame";
import type { GameEventMap } from "@game/GameEvents";
import { PortalGunSystem } from "@game/gameplay/weapons/portal/PortalGunSystem";
import type { NpcPortalHandle } from "@game/npc/core/INpc";

function frame(x: number): PortalFrame {
  return {
    position: new Vector3(x, 1.2, 0),
    quaternion: new Quaternion(),
    halfWidth: 0.65,
    halfHeight: 1.1,
  };
}

function makeSystem(): PortalGunSystem {
  const pair = new PortalPairState();
  const a = frame(0);
  const b = frame(8);
  pair.set("a", a);
  pair.set("b", b);

  const system = Object.create(PortalGunSystem.prototype) as PortalGunSystem;
  Object.assign(system as unknown as Record<string, unknown>, {
    pair,
    portals: new Map([
      ["a", { frame: a, backingColliders: [{ handle: 77 }] }],
      ["b", { frame: b, backingColliders: [{ handle: 88 }] }],
    ]),
    npcStates: new Map(),
    npcFrame: 0,
    eventBus: new EventBus<GameEventMap>(),
  });
  return system;
}

function makeHandle(position: Vector3) {
  const exclusions: Array<ReadonlySet<number> | null> = [];
  const teleports: Vector3[] = [];
  const handle: NpcPortalHandle = {
    id: "zombie-test",
    radius: 0.35,
    getPosition: () => position.clone(),
    getVelocity: () => new Vector3(0, 0, -1),
    teleport: (next) => {
      position.copy(next);
      teleports.push(next.clone());
    },
    setColliderExclusions: (handles) => exclusions.push(handles),
  };
  return { handle, exclusions, teleports };
}

describe("PortalGunSystem — tránsito de NPCs terrestres", () => {
  it("no abre la pared ni teleporta al acercarse por detrás", () => {
    const system = makeSystem();
    const position = new Vector3(0, 1.2, -0.8);
    const { handle, exclusions, teleports } = makeHandle(position);

    system.updateNpcTraversal(1, [handle]);
    position.z = -0.2;
    system.updateNpcTraversal(1.1, [handle]);

    expect(exclusions).toHaveLength(0);
    expect(teleports).toHaveLength(0);
  });

  it("mantiene el hueco durante un cruce frontal y lo cierra al alejarse", () => {
    const system = makeSystem();
    const position = new Vector3(0, 1.2, 0.8);
    const { handle, exclusions, teleports } = makeHandle(position);

    system.updateNpcTraversal(1, [handle]);
    expect(exclusions.at(-1)?.has(77)).toBe(true);

    position.z = -0.1;
    system.updateNpcTraversal(1.1, [handle]);
    expect(teleports).toHaveLength(1);
    expect(exclusions.at(-1)).not.toBeNull();

    position.set(20, 1.2, 20);
    system.updateNpcTraversal(1.3, [handle]);
    expect(exclusions.at(-1)).toBeNull();
  });

  it("restaura el collider si el NPC deja de participar del update", () => {
    const system = makeSystem();
    const position = new Vector3(0, 1.2, 0.8);
    const { handle, exclusions } = makeHandle(position);

    system.updateNpcTraversal(1, [handle]);
    expect(exclusions.at(-1)?.has(77)).toBe(true);

    system.updateNpcTraversal(1.1, []);
    expect(exclusions.at(-1)).toBeNull();
  });

  it("prefers an atomic full-frame traversal for composite NPCs", () => {
    const system = makeSystem();
    const position = new Vector3(0, 1.2, 0.8);
    const { handle, teleports } = makeHandle(position);
    const composite = vi.fn((
      _entry: PortalFrame,
      _exit: PortalFrame,
      next: Vector3,
    ) => {
      position.copy(next);
      return true;
    });
    handle.teleportThroughPortal = composite;

    system.updateNpcTraversal(1, [handle]);
    position.z = -0.1;
    system.updateNpcTraversal(1.1, [handle]);

    expect(composite).toHaveBeenCalledOnce();
    expect(teleports).toHaveLength(0);
    expect(composite.mock.calls[0]?.[0]).toBeInstanceOf(Object);
    expect(composite.mock.calls[0]?.[1]).toBeInstanceOf(Object);
  });
});
