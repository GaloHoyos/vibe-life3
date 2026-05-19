/**
 * Todos los strings visibles al jugador en un solo lugar.
 *
 * El código emite `subtitle.show` / `dialogue.show` usando estas
 * estructuras en vez de literales inline. Si en algún momento agregamos
 * i18n, este archivo es el único punto que cambia.
 *
 * Convención: los textos están en español (idioma del juego). Los
 * identificadores se mantienen en inglés siguiendo la convención del
 * proyecto.
 */

export const Speakers = {
  hev: "HEV",
  system: "Sistema",
} as const;

export interface SubtitleLine {
  speaker?: string;
  text: string;
  duration: number;
}

export const Dialogue = {
  playerDead: {
    speaker: Speakers.hev,
    text: "FALLA CRITICA",
    duration: 3,
  },
  doorOpened: {
    speaker: Speakers.system,
    text: "Puerta de laboratorio abierta.",
    duration: 2.2,
  },
  doorClosed: {
    speaker: Speakers.system,
    text: "Puerta de laboratorio cerrada.",
    duration: 2.2,
  },
  npcKilled: {
    speaker: Speakers.system,
    text: "Entidad hostil neutralizada.",
    duration: 2.4,
  },
  godModeOn: {
    speaker: Speakers.system,
    text: "Modo invulnerable activado.",
    duration: 2,
  },
  godModeOff: {
    speaker: Speakers.system,
    text: "Modo invulnerable desactivado.",
    duration: 2,
  },
  levelLoading: (title: string): SubtitleLine => ({
    speaker: Speakers.system,
    text: `Cargando ${title}.`,
    duration: 2.5,
  }),
} satisfies Record<string, SubtitleLine | ((...args: never[]) => SubtitleLine)>;

export const MenuStrings = {
  ready: "Sistema activo. Preparado para combate.",
  loadingLevel: (title: string): string => `Cargando ${title}...`,
  loadingFallback: "Cargando nivel...",
  exitingToMainMenu: "Volviendo al menu principal...",
  fullscreenEnter: "ACTIVAR",
  fullscreenExit: "SALIR",
} as const;

export const HudStrings = {
  unarmed: "DESARMADO",
  weaponPickedUp: (weaponName: string): string => `arma adquirida: ${weaponName}`,
  healthPickedUp: (amount: number): string => `+${amount} vida`,
  ammoPickedUp: (amount: number, weaponName?: string): string =>
    `+${amount} ${weaponName ?? "munición"}`,
} as const;
