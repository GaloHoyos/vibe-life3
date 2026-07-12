import { describe, expect, it } from "vitest";
import type { INpc } from "@game/npc/core/INpc";
import { NpcDirectory } from "@game/script/NpcDirectory";

function fakeNpc(id: string, alive = true): INpc {
  return { id, isAlive: () => alive } as unknown as INpc;
}

describe("NpcDirectory", () => {
  it("resuelve nombre↔id en ambos sentidos y soporta targetnames compartidos", () => {
    const dir = new NpcDirectory();
    const a = fakeNpc("wave-1-a");
    const b = fakeNpc("wave-1-b");
    dir.register("wave", a);
    dir.register("wave", b);

    expect(dir.byName("wave")).toHaveLength(2);
    expect(dir.nameOf("wave-1-a")).toBe("wave");
    expect(dir.nameOf("wave-1-b")).toBe("wave");
  });

  it("firstAlive prefiere un NPC vivo", () => {
    const dir = new NpcDirectory();
    dir.register("guard", fakeNpc("g1", false));
    const alive = fakeNpc("g2", true);
    dir.register("guard", alive);

    expect(dir.firstAlive("guard")).toBe(alive);
  });

  it("firstAlive no devuelve cadáveres", () => {
    const dir = new NpcDirectory();
    dir.register("guard", fakeNpc("g1", false));
    expect(dir.firstAlive("guard")).toBeNull();
  });

  it("unregister quita el NPC sin perder a los demás del nombre", () => {
    const dir = new NpcDirectory();
    dir.register("wave", fakeNpc("a"));
    dir.register("wave", fakeNpc("b"));

    dir.unregister("a");
    expect(dir.byName("wave")).toHaveLength(1);
    expect(dir.nameOf("a")).toBeNull();
    expect(dir.nameOf("b")).toBe("wave");
  });

  it("clear vacía el índice", () => {
    const dir = new NpcDirectory();
    dir.register("x", fakeNpc("x1"));
    dir.clear();
    expect(dir.byName("x")).toHaveLength(0);
    expect(dir.nameOf("x1")).toBeNull();
  });
});
