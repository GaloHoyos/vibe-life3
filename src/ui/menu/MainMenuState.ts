export type GameMenuState =
  | "mainMenu"
  | "newGameMenu"
  | "loadGame"
  | "options"
  | "controls"
  | "credits"
  | "playing"
  | "paused";

export interface MenuChapter {
  id: string;
  title: string;
  description: string;
}

export const DefaultChapters: MenuChapter[] = [
  {
    id: "demo",
    title: "Mapa de Pruebas",
    description:
      "Entorno de desarrollo para probar armas, NPCs, fisicas e interaccion.",
  },
];
