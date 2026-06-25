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

import type { HazardKind } from "@game/levels/HazardVolumeSystem";

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
  checkpointReached: {
    speaker: Speakers.system,
    text: "Punto de control alcanzado.",
    duration: 2,
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
  selectOption: "Selecciona una opcion.",
  buildLabel: "BUILD 0.1 · FAN PROJECT",
  workshopOnline: "WORKSHOP EN LINEA",
  workshopOffline: "WORKSHOP OFFLINE",
} as const;

/**
 * Pantalla de muerte con estetica del arranque del traje H.E.V. de Black Mesa:
 * terminal ambar con diagnostico de sistemas, ID de usuario y esquema del traje,
 * pero reportando fallo total en vez de "READY".
 */
export const GameOverStrings = {
  userId: "USUARIO ID# 4179 - FREEMAN, GORDON",
  header: "DIAGNOSTICO DE EMERGENCIA H.E.V.",
  systems: [
    { label: "MONITOREO BIOMETRICO", status: "SIN SEÑAL" },
    { label: "SISTEMA CARDIOVASCULAR", status: "PARO" },
    { label: "ADMIN. DE MORFINA", status: "SIN RESPUESTA" },
    { label: "ADMIN. DE ANTITOXINA", status: "OFFLINE" },
    { label: "SIGNOS VITALES", status: "NULOS" },
  ],
  height: "ALTURA: 5FT. 11.986 IN",
  weight: "PESO: 192.73 LB",
  fitLine: "RECALCULANDO AJUSTE...",
  fitDone: "USUARIO FALLECIDO",
  respawnHint: "CLIC o cualquier TECLA — reiniciar protocolo de reanimacion",
  noRespawnHint: "SIN PUNTO DE CONTROL — ESC para volver al menu",
  exitHint: "ESC — abandonar al menu principal",
} as const;

/** Strings del panel de detalle del Workshop (rating + comentarios). */
export const WorkshopStrings = {
  details: "DETALLES",
  rateHeading: "TU PUNTUACION",
  commentsHeading: "COMENTARIOS",
  comment: "COMENTAR",
  commentPlaceholder: "Escribe un comentario...",
  signInToRate: "Inicia sesion para puntuar este mapa.",
  signInToComment: "Inicia sesion para comentar.",
  noComments: "Todavia no hay comentarios. Se el primero.",
  loadingComments: "Cargando comentarios...",
  ratingSummary: (avg: number, count: number): string =>
    count > 0 ? `${avg.toFixed(1)} / 5 (${count} ${count === 1 ? "voto" : "votos"})` : "Sin votos",
} as const;

export const HudStrings = {
  unarmed: "DESARMADO",
  weaponPickedUp: (weaponName: string): string => `arma adquirida: ${weaponName}`,
  healthPickedUp: (amount: number): string => `+${amount} vida`,
  ammoPickedUp: (amount: number, weaponName?: string): string =>
    `+${amount} ${weaponName ?? "munición"}`,
} as const;

/** Anuncio del traje H.E.V. por tipo de peligro ambiental (estilo HL2). */
export const HazardStrings: Record<HazardKind, { title: string; detail: string }> = {
  toxic: { title: "Advertencia", detail: "Bioriesgo detectado" },
  fire: { title: "Advertencia", detail: "Temperatura crítica" },
  electric: { title: "Advertencia", detail: "Descarga eléctrica" },
  void: { title: "Peligro", detail: "Zona letal" },
};
