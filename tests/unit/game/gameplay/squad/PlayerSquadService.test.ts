import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { EventBus } from "@engine/core/EventBus";
import type { GameEventMap } from "@game/GameEvents";
import { PlayerSquadService } from "@game/gameplay/squad/PlayerSquadService";
import { recordEvents } from "@tests/support/events";

function candidate(id: string, x: number, options: { alive?: boolean; eligible?: boolean } = {}) {
  return {
    id,
    position: new Vector3(x, 0, 0),
    isAlive: options.alive ?? true,
    eligible: options.eligible ?? true,
  };
}

const playerAt = new Vector3(0, 0, 0);

describe("PlayerSquadService", () => {
  it("auto-join por cercania con cap de 4 y solo elegibles", () => {
    const bus = new EventBus<GameEventMap>();
    const changed = recordEvents(bus, "squad.changed");
    const squad = new PlayerSquadService(bus);

    squad.update(0, playerAt, true, [
      candidate("r1", 3),
      candidate("r2", 5),
      candidate("r3", 8),
      candidate("r4", 9),
      candidate("r5", 4), // sexto elegible: no entra (cap)
      candidate("lejos", 50),
      candidate("zombie", 2, { eligible: false }),
    ]);

    expect(squad.size()).toBe(4);
    expect(squad.isMember("r1")).toBe(true);
    expect(squad.isMember("r5")).toBe(false);
    expect(squad.isMember("lejos")).toBe(false);
    expect(squad.isMember("zombie")).toBe(false);
    expect(squad.memberIds()).toEqual(["r1", "r2", "r3", "r4"]);
    expect(changed.at(-1)).toMatchObject({ size: 4, max: 4 });
  });

  it("expulsa muertos y deja entrar al siguiente elegible", () => {
    const bus = new EventBus<GameEventMap>();
    const squad = new PlayerSquadService(bus);
    squad.update(0, playerAt, true, [candidate("r1", 3), candidate("r2", 4)]);
    expect(squad.size()).toBe(2);

    squad.update(1, playerAt, true, [candidate("r1", 3, { alive: false }), candidate("r2", 4)]);
    expect(squad.size()).toBe(1);
    expect(squad.isMember("r1")).toBe(false);
  });

  it("orden ir-a-punto con TTL: expira y vuelve a follow", () => {
    const bus = new EventBus<GameEventMap>();
    const commands = recordEvents(bus, "squad.command");
    const squad = new PlayerSquadService(bus);
    squad.update(0, playerAt, true, [candidate("r1", 3)]);

    squad.commandMove(new Vector3(10, 0, 10), 5);
    expect(squad.getOrderPosition()?.x).toBe(10);
    expect(commands.at(-1)).toMatchObject({ kind: "move" });

    // Antes del TTL sigue vigente; pasado, expira sola.
    squad.update(15, playerAt, true, [candidate("r1", 3)]);
    expect(squad.getOrderPosition()).not.toBeNull();
    squad.update(20.1, playerAt, true, [candidate("r1", 3)]);
    expect(squad.getOrderPosition()).toBeNull();
  });

  it("recall cancela la orden y sin miembros las ordenes son no-op", () => {
    const bus = new EventBus<GameEventMap>();
    const commands = recordEvents(bus, "squad.command");
    const squad = new PlayerSquadService(bus);

    squad.commandMove(new Vector3(1, 0, 1), 0);
    expect(commands).toHaveLength(0);

    squad.update(0, playerAt, true, [candidate("r1", 3)]);
    squad.commandMove(new Vector3(1, 0, 1), 0);
    squad.recall();
    expect(squad.getOrderPosition()).toBeNull();
    expect(commands.at(-1)).toMatchObject({ kind: "regroup" });
  });

  it("offsets de formacion deterministas y distintos por miembro", () => {
    const bus = new EventBus<GameEventMap>();
    const squad = new PlayerSquadService(bus);
    squad.update(0, playerAt, true, [candidate("r1", 3), candidate("r2", 4)]);

    const a = squad.formationOffsetFor("r1");
    const b = squad.formationOffsetFor("r2");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.distanceTo(b!)).toBeGreaterThan(0.5);
    expect(squad.formationOffsetFor("r1")).toEqual(a);
    expect(squad.formationOffsetFor("desconocido")).toBeNull();
  });

  it("reset limpia miembros y notifica al HUD", () => {
    const bus = new EventBus<GameEventMap>();
    const changed = recordEvents(bus, "squad.changed");
    const squad = new PlayerSquadService(bus);
    squad.update(0, playerAt, true, [candidate("r1", 3)]);
    squad.reset();
    expect(squad.size()).toBe(0);
    expect(changed.at(-1)).toMatchObject({ size: 0 });
  });
});
