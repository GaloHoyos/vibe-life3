/**
 * Bandos lógicos del mundo. Define quién es enemigo de quién — los
 * sistemas de combate consultan `isHostileTo` para decidir si pueden
 * atacar a un target.
 *
 * - `player`     — el jugador y aliados del jugador (Alyx).
 * - `combine`    — fuerzas hostiles humanoides armadas.
 * - `creatures`  — criaturas hostiles (zombies, headcrabs).
 * - `neutral`    — props, civiles, no participan en combate.
 */
export type Faction = "player" | "combine" | "creatures" | "neutral";

/**
 * Matriz de hostilidad. `true` significa que la fila ataca a la columna.
 * No es simétrica necesariamente (player vs combine sí, pero algún día
 * podríamos tener bandos que se ignoran).
 */
const HOSTILITY: Record<Faction, ReadonlySet<Faction>> = {
  player: new Set<Faction>(["combine", "creatures"]),
  combine: new Set<Faction>(["player", "creatures"]),
  creatures: new Set<Faction>(["player", "combine"]),
  neutral: new Set<Faction>(),
};

export function isHostileTo(self: Faction, other: Faction): boolean {
  return HOSTILITY[self].has(other);
}

export function isAlliedWith(self: Faction, other: Faction): boolean {
  return self === other && self !== "neutral";
}
