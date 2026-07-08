import type { WeaponId } from "@game/gameplay/weapons/core/WeaponDefinition";

/**
 * Iconos line-art para el HUD. Todos usan `stroke="currentColor"` o
 * `fill="currentColor"` para heredar el color del contenedor CSS. Los
 * viewBox se eligieron para que cada arma respete su silueta natural
 * (pistolas anchas-cortas, fusiles largos, gravity gun chunky).
 */

export const HealthIcon = `
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect x="1.5" y="1.5" width="29" height="29" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <rect x="13" y="7" width="6" height="18" fill="currentColor"/>
  <rect x="7" y="13" width="18" height="6" fill="currentColor"/>
</svg>`.trim();

export const ArmorIcon = `
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect x="1.5" y="1.5" width="29" height="29" fill="none" stroke="currentColor" stroke-width="1.6"/>
  <path d="M 19 5 L 9 17 L 15 17 L 13 27 L 23 14 L 17 14 L 19 5 Z" fill="currentColor"/>
</svg>`.trim();

const Crowbar = `
<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" xmlns="http://www.w3.org/2000/svg">
  <path d="M 3 13 L 36 13 L 44 6"/>
  <path d="M 3 13 L 3 16"/>
  <path d="M 44 6 L 41 4"/>
</svg>`.trim();

const Pistol = `
<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" xmlns="http://www.w3.org/2000/svg">
  <path d="M 8 8 L 36 8 L 36 13 L 22 13 L 22 20 L 14 20 L 14 13 L 8 13 Z"/>
  <line x1="32" y1="11" x2="38" y2="11"/>
</svg>`.trim();

const Revolver = `
<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" xmlns="http://www.w3.org/2000/svg">
  <path d="M 8 8 L 34 8 L 34 13 L 23 13 L 23 20 L 15 20 L 15 13 L 8 13 Z"/>
  <line x1="30" y1="11" x2="40" y2="11"/>
  <circle cx="19" cy="11" r="3.4"/>
</svg>`.trim();

const Crossbow = `
<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" xmlns="http://www.w3.org/2000/svg">
  <line x1="6" y1="13" x2="45" y2="13"/>
  <path d="M 34 3 Q 40 13 34 23"/>
  <path d="M 30 6 L 38 13 L 30 20"/>
  <path d="M 6 13 L 9 18 L 13 18"/>
</svg>`.trim();

const Smg = `
<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" xmlns="http://www.w3.org/2000/svg">
  <path d="M 4 10 L 36 10 L 36 14 L 26 14 L 26 20 L 18 20 L 18 14 L 4 14 Z"/>
  <line x1="36" y1="12" x2="44" y2="12"/>
  <line x1="9" y1="14" x2="9" y2="19"/>
  <line x1="13" y1="14" x2="13" y2="19"/>
</svg>`.trim();

const Ar3 = `
<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" xmlns="http://www.w3.org/2000/svg">
  <path d="M 2 12 L 38 12 L 38 15 L 28 15 L 28 19 L 22 19 L 22 15 L 2 15 Z"/>
  <line x1="38" y1="13" x2="46" y2="13"/>
  <rect x="14" y="8" width="6" height="4"/>
  <line x1="22" y1="15" x2="22" y2="19"/>
</svg>`.trim();

const GravityGun = `
<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" xmlns="http://www.w3.org/2000/svg">
  <path d="M 6 8 L 28 8 L 32 4 L 44 4"/>
  <path d="M 6 16 L 28 16 L 32 20 L 44 20"/>
  <path d="M 6 8 L 6 16"/>
  <path d="M 28 8 L 28 16"/>
  <line x1="14" y1="16" x2="14" y2="20"/>
  <line x1="20" y1="16" x2="20" y2="20"/>
  <line x1="36" y1="4" x2="36" y2="8"/>
  <line x1="36" y1="16" x2="36" y2="20"/>
</svg>`.trim();

const IceGun = `
<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" xmlns="http://www.w3.org/2000/svg">
  <path d="M 5 9 L 27 9 L 32 5 L 42 5"/>
  <path d="M 5 15 L 27 15 L 32 19 L 42 19"/>
  <path d="M 5 9 L 5 15"/>
  <path d="M 27 9 L 27 15"/>
  <path d="M 36 8 L 39 5 L 42 8"/>
  <path d="M 36 16 L 39 19 L 42 16"/>
  <path d="M 13 18 L 18 18 L 15.5 22 Z"/>
  <path d="M 18 6 L 23 6 L 20.5 2 Z"/>
</svg>`.trim();

const Shotgun = `
<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" xmlns="http://www.w3.org/2000/svg">
  <path d="M 2 10 L 40 10 L 40 14 L 26 14 L 26 20 L 20 20 L 20 14 L 2 14 Z"/>
  <line x1="40" y1="11" x2="46" y2="11"/>
  <line x1="40" y1="13" x2="46" y2="13"/>
</svg>`.trim();

const Grenade = `
<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" xmlns="http://www.w3.org/2000/svg">
  <rect x="18" y="9" width="12" height="14"/>
  <rect x="20" y="5" width="8" height="4"/>
  <line x1="24" y1="2" x2="24" y2="5"/>
  <line x1="24" y1="2" x2="30" y2="2"/>
</svg>`.trim();

const Rpg = `
<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" xmlns="http://www.w3.org/2000/svg">
  <path d="M 4 12 L 32 12"/>
  <path d="M 12 8 L 35 8 L 41 12 L 35 16 L 12 16 Z"/>
  <path d="M 12 9 L 7 6"/>
  <path d="M 12 15 L 7 18"/>
  <line x1="28" y1="16" x2="28" y2="21"/>
  <line x1="34" y1="10" x2="44" y2="10"/>
</svg>`.trim();

const PortalGun = `
<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter" xmlns="http://www.w3.org/2000/svg">
  <path d="M 5 9 L 26 9 L 30 5 L 40 5"/>
  <path d="M 5 15 L 26 15 L 30 19 L 40 19"/>
  <path d="M 5 9 L 5 15"/>
  <path d="M 26 9 L 26 15"/>
  <path d="M 40 5 L 44 9"/>
  <path d="M 40 19 L 44 15"/>
  <ellipse cx="41" cy="12" rx="2.4" ry="4"/>
  <line x1="14" y1="15" x2="14" y2="20"/>
</svg>`.trim();

const ICONS: Record<WeaponId, string> = {
  crowbar: Crowbar,
  pistol: Pistol,
  revolver: Revolver,
  smg: Smg,
  ar3: Ar3,
  crossbow: Crossbow,
  gravityGun: GravityGun,
  iceGun: IceGun,
  portalGun: PortalGun,
  shotgun: Shotgun,
  grenade: Grenade,
  rpg: Rpg,
};

export function getWeaponIcon(id: WeaponId): string {
  return ICONS[id];
}
