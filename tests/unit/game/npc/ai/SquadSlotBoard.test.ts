import { describe, expect, it } from "vitest";
import { SquadSlotBoard } from "@game/npc/ai/SquadSlotBoard";

describe("SquadSlotBoard", () => {
  it("limita los slots de ataque a 2 por faccion", () => {
    const board = new SquadSlotBoard();
    expect(board.tryClaim("attack", "a", "combine")).toBe(true);
    expect(board.tryClaim("attack", "b", "combine")).toBe(true);
    expect(board.tryClaim("attack", "c", "combine")).toBe(false);
    expect(board.holds("attack", "a", "combine")).toBe(true);
    expect(board.holds("attack", "c", "combine")).toBe(false);
  });

  it("es idempotente para el holder y las facciones no compiten entre si", () => {
    const board = new SquadSlotBoard();
    expect(board.tryClaim("attack", "a", "combine")).toBe(true);
    expect(board.tryClaim("attack", "a", "combine")).toBe(true);
    expect(board.canClaim("attack", "a", "combine")).toBe(true);
    // La resistencia tiene sus propios slots.
    expect(board.tryClaim("attack", "r1", "resistance")).toBe(true);
    expect(board.tryClaim("attack", "r2", "resistance")).toBe(true);
    expect(board.tryClaim("attack", "b", "combine")).toBe(true);
  });

  it("release libera el cupo y unregister libera todos los slots del NPC", () => {
    const board = new SquadSlotBoard();
    board.tryClaim("attack", "a", "combine");
    board.tryClaim("attack", "b", "combine");
    board.release("attack", "a", "combine");
    expect(board.tryClaim("attack", "c", "combine")).toBe(true);

    board.tryClaim("overwatch", "b", "combine");
    board.unregister("b");
    expect(board.holds("attack", "b", "combine")).toBe(false);
    expect(board.canClaim("overwatch", "c", "combine")).toBe(true);
  });

  it("overwatch y granada son slots unicos", () => {
    const board = new SquadSlotBoard();
    expect(board.tryClaim("overwatch", "a", "combine")).toBe(true);
    expect(board.tryClaim("overwatch", "b", "combine")).toBe(false);
    expect(board.canClaim("overwatch", "a", "combine")).toBe(true);
    expect(board.tryClaim("grenade", "b", "combine")).toBe(true);
    expect(board.tryClaim("grenade", "c", "combine")).toBe(false);
  });

  it("el lockout veda el slot a toda la squad hasta que expira", () => {
    const board = new SquadSlotBoard();
    board.tick(10);
    board.tryClaim("grenade", "a", "combine");
    board.release("grenade", "a", "combine", 6);
    expect(board.canClaim("grenade", "b", "combine")).toBe(false);
    expect(board.tryClaim("grenade", "b", "combine")).toBe(false);
    board.tick(16.5);
    expect(board.tryClaim("grenade", "b", "combine")).toBe(true);
  });
});
