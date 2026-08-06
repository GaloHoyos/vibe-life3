import type { AudioBusName } from "@engine/audio/core/AudioSystem";
import type { AudioRole } from "./MixProfile";

/**
 * Deriva el rol de mezcla de un clip a partir de su id. El catálogo tiene 215
 * entradas cuyos ids ya codifican el rol (`...hl2.shot1`, `...hl2.reload2`,
 * `...hl2.step3`); repetir esa información a mano sería 215 oportunidades de
 * equivocarse. Cualquier clip que no encaje declara `role` explícito.
 */

export interface ClipRoleInput {
  readonly id: string;
  readonly bus: AudioBusName;
  readonly loop?: boolean;
}

export function inferAudioRole(clip: ClipRoleInput): AudioRole {
  const segment = lastSegment(clip.id);
  const domain = clip.id.split(".")[0] ?? "";

  switch (domain) {
    case "footsteps":
      return "footstep";
    case "background":
      return clip.loop ? "ambienceBed" : "ambienceOneShot";
    case "ui":
      return "uiClick";
    case "music":
      return "music";
    case "hev":
      return clip.id.startsWith("hev.fvox.") ? "voice" : "hevBeep";
    case "voice":
      return "voice";
    case "vehicles":
      return clip.loop ? "engineLoop" : "impact";
    case "enemies":
      return enemyRole(segment, clip);
    case "weapons":
      return weaponRole(segment, clip);
    case "player":
      return playerRole(segment);
    // `world` son las fuentes del entorno: el fuego que arde, la chispa que
    // salta. Lo que se sostiene es lecho; lo que golpea es impacto.
    case "world":
      return clip.loop ? "ambienceBed" : "impact";
    // `physics` y `doors` caen al default: todo lo que hacen es golpear.
    default:
      return "impact";
  }
}

/**
 * El jugador tiene voz propia (el gruñido al recibir daño) y objetos que suenan
 * alrededor suyo (el casquillo que cae). No es la voz del traje: eso es `hev`.
 */
function playerRole(segment: string): AudioRole {
  if (segment.startsWith("heartbeat")) {
    return "hevBeep";
  }
  if (startsWithAny(segment, ["pain", "drown", "burn", "fall", "breathe"])) {
    return "vocalization";
  }
  return "impact";
}

function weaponRole(segment: string, clip: ClipRoleInput): AudioRole {
  if (segment.includes("explosion")) {
    return "explosion";
  }
  // Antes que `shot*`: `shotdown` es el impacto del cohete derribado.
  if (
    segment === "shotdown" ||
    startsWithAny(segment, ["hit", "bounce", "disintegrate", "skewer", "launch"])
  ) {
    return "impact";
  }
  if (clip.loop || startsWithAny(segment, ["flyby", "fly"])) {
    return "engineLoop";
  }
  // `dryfire` es el clic del arma vacía, no un disparo.
  if (
    segment === "fire" ||
    segment === "secondary" ||
    startsWithAny(segment, ["shot", "altfire"])
  ) {
    return "weaponFire";
  }
  return "weaponHandling";
}

function enemyRole(segment: string, clip: ClipRoleInput): AudioRole {
  if (segment.startsWith("step") || segment === "footstep") {
    return "footstep";
  }
  // El catálogo ya rutea el fuego de torretas y striders al bus de armas.
  if (clip.bus === "weapons") {
    return "weaponFire";
  }
  if (clip.loop || segment === "engine") {
    return "engineLoop";
  }
  if (segment === "fire" || segment === "minigun" || segment === "cannon") {
    return "weaponFire";
  }
  if (
    startsWithAny(segment, ["deploy", "retract", "active", "cannoncharge"])
  ) {
    return "weaponHandling";
  }
  return "vocalization";
}

function lastSegment(id: string): string {
  const parts = id.split(".");
  return (parts[parts.length - 1] ?? id).toLowerCase();
}

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}
