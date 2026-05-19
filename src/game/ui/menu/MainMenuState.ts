import { getAllLevels } from "@game/levels/LevelRegistry";

export type GameMenuState =
  | "mainMenu"
  | "newGameMenu"
  | "loadGame"
  | "options"
  | "credits"
  | "playing"
  | "paused"
  | "loading";

export interface MenuChapter {
  id: string;
  title: string;
  description: string;
}

/** Construye la lista de capÃ­tulos seleccionables a partir del `LevelRegistry`. */
export function buildChapters(): MenuChapter[] {
  return getAllLevels().map((level, index) => ({
    id: level.id,
    title: `Capitulo ${index + 1}. ${level.title}`,
    description:
      level.description ?? "Mapa disponible para iniciar una nueva partida.",
  }));
}
