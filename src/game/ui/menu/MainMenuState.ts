import { getAllLevels } from "../../levels/LevelRegistry";

export type GameMenuState =
  | "mainMenu"
  | "newGameMenu"
  | "loadGame"
  | "options"
  | "controls"
  | "credits"
  | "playing"
  | "paused"
  | "loading";

export interface MenuChapter {
  id: string;
  title: string;
  description: string;
}

/** Construye la lista de capítulos seleccionables a partir del `LevelRegistry`. */
export function buildChapters(): MenuChapter[] {
  return getAllLevels().map((level, index) => ({
    id: level.id,
    title: `Capitulo ${index + 1}. ${level.title}`,
    description:
      level.description ?? "Mapa disponible para iniciar una nueva partida.",
  }));
}
