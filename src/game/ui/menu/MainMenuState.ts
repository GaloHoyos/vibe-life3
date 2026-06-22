import {
  getCampaignLevels,
  getCustomFolderLevels,
} from "@game/levels/LevelRegistry";
import { listLibraryMaps } from "@game/editor/mapLibrary";
import { listWorkshopIndex } from "@game/workshop/workshopIndex";

export type GameMenuState =
  | "mainMenu"
  | "newGameMenu"
  | "customMaps"
  | "loadGame"
  | "options"
  | "credits"
  | "playing"
  | "paused"
  | "loading"
  | "editor"
  | "workshop";

export interface MenuChapter {
  id: string;
  title: string;
  description: string;
}

/** Origen de un mapa custom: carpeta `.ts`, biblioteca local, o suscripcion del Workshop. */
export type CustomMapSource = "folder" | "library" | "workshop";

export interface CustomMapEntry {
  id: string;
  title: string;
  description: string;
  source: CustomMapSource;
}

/** Construye la lista de capÃ­tulos de campaña a partir del `LevelRegistry`. */
export function buildChapters(): MenuChapter[] {
  return getCampaignLevels().map((level, index) => ({
    id: level.id,
    title: `Capitulo ${index + 1}. ${level.title}`,
    description:
      level.description ?? "Mapa disponible para iniciar una nueva partida.",
  }));
}

/** Combina los mapas custom de carpeta (`maps/custom/`) con la biblioteca local. */
export function buildCustomMaps(): CustomMapEntry[] {
  const folder: CustomMapEntry[] = getCustomFolderLevels().map((level) => ({
    id: level.id,
    title: level.title,
    description: level.description ?? "Mapa custom incluido con el juego.",
    source: "folder",
  }));
  const library: CustomMapEntry[] = listLibraryMaps().map((info) => ({
    id: info.id,
    title: info.title,
    description: "Mapa guardado en este navegador.",
    source: "library",
  }));
  const workshop: CustomMapEntry[] = listWorkshopIndex()
    .filter((sub) => sub.enabled)
    .map((sub) => ({
      id: sub.id,
      title: sub.title,
      description: "Mapa del Workshop (suscrito).",
      source: "workshop",
    }));
  return [...folder, ...library, ...workshop];
}
