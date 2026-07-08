/**
 * Bandos lógicos del mundo (estilo HL2). Define quién es enemigo de quién — los
 * sistemas de combate consultan `isHostileTo` para decidir si pueden atacar a
 * un target.
 *
 * - `player`     — el jugador.
 * - `resistance` — la resistencia (Alyx). Aliada del jugador.
 * - `combine`    — fuerzas Combine: soldados y manhacks.
 * - `zombies`    — infestación headcrab: headcrabs y zombies. Hostiles a todo
 *                  lo vivo no-zombie.
 * - `neutral`    — props, civiles, no participan en combate.
 */
export type Faction = "player" | "resistance" | "combine" | "zombies" | "neutral";

/**
 * Matriz de hostilidad. `true` significa que la fila ataca a la columna. No es
 * simétrica necesariamente. Player y resistance son aliados (no se atacan);
 * combine y zombies se atacan entre sí además de al lado del jugador.
 */
const HOSTILITY: Record<Faction, ReadonlySet<Faction>> = {
  player: new Set<Faction>(["combine", "zombies"]),
  resistance: new Set<Faction>(["combine", "zombies"]),
  combine: new Set<Faction>(["player", "resistance", "zombies"]),
  zombies: new Set<Faction>(["player", "resistance", "combine"]),
  neutral: new Set<Faction>(),
};

export function isHostileTo(self: Faction, other: Faction): boolean {
  return HOSTILITY[self].has(other);
}

/** Bando del jugador: él mismo y la resistencia cuentan como aliados. */
function isPlayerSide(faction: Faction): boolean {
  return faction === "player" || faction === "resistance";
}

export function isAlliedWith(self: Faction, other: Faction): boolean {
  if (self === "neutral" || other === "neutral") return false;
  if (self === other) return true;
  return isPlayerSide(self) && isPlayerSide(other);
}
