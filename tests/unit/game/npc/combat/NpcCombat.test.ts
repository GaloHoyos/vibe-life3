import { describe, expect, it, vi } from "vitest";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { RaycastSource } from "@engine/physics/Raycast";
import type { GameEventMap } from "@game/GameEvents";
import { CharacterPresets } from "@game/characters/CharacterPresets";
import { NpcCombat } from "@game/npc/combat/NpcCombat";

function target(damage: ReturnType<typeof vi.fn>) {
  return {
    isAlive: () => true,
    applyDamage: damage,
  };
}

function attackWith(
  raycast: RaycastSource,
  damage: ReturnType<typeof vi.fn>,
  targetId = "player",
): void {
  const combat = new NpcCombat(
    "zombie-test",
    CharacterPresets.zombie,
    new EventBus<GameEventMap>(),
    raycast,
  );
  combat.start(new Vector3(0, 0, -0.7));
  combat.tickAttack(CharacterPresets.zombie.attack.windup, {
    npcPosition: new Vector3(0, 0, -0.7),
    npcForward: new Vector3(0, 0, 1),
    targetPosition: new Vector3(0, 0, 0.7),
    target: target(damage) as never,
    targetId,
    balanceLocked: false,
  });
}

describe("NpcCombat — impacto melee", () => {
  it("no daña a través de una pared aunque el centro esté dentro del rango", () => {
    const damage = vi.fn();
    const cast = vi.fn((..._args: Parameters<RaycastSource["cast"]>) => (
      { metadata: { id: "wall" } } as never
    ));

    attackWith({ cast }, damage);

    expect(CharacterPresets.zombie.attack.requireLineOfSight).toBe(true);
    expect(damage).not.toHaveBeenCalled();
    expect(cast.mock.calls[0]?.[4]).toBe("zombie-test");
  });

  it("mantiene el golpe cuando el raycast portal-aware alcanza al target", () => {
    const damage = vi.fn();
    const cast = vi.fn((..._args: Parameters<RaycastSource["cast"]>) => (
      { metadata: { id: "player" } } as never
    ));

    attackWith({ cast }, damage);

    expect(damage).toHaveBeenCalledOnce();
    expect(damage).toHaveBeenCalledWith(
      CharacterPresets.zombie.attack.damage,
      expect.any(Vector3),
      undefined,
      "zombie-test",
      expect.any(Vector3),
      "melee",
    );
  });

  it("daña la cubierta que intercepta el melee antes que el núcleo", () => {
    const coreDamage = vi.fn();
    const armorDamage = vi.fn();
    const cast = vi.fn((..._args: Parameters<RaycastSource["cast"]>) => (
      {
        point: new Vector3(0, 0.4, 0.3),
        metadata: {
          id: "blob-target-blob-4",
          ownerId: "blob-target",
          kind: "npc",
          damageable: target(armorDamage),
          bodyPart: { name: "blob-armor-4", damageMultiplier: 1 },
        },
      } as never
    ));

    attackWith({ cast }, coreDamage, "blob-target");

    expect(coreDamage).not.toHaveBeenCalled();
    expect(armorDamage).toHaveBeenCalledWith(
      CharacterPresets.zombie.attack.damage,
      expect.any(Vector3),
      "blob-armor-4",
      "zombie-test",
      new Vector3(0, 0.4, 0.3),
      "melee",
    );
  });
});
