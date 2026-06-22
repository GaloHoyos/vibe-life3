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

const ICONS: Record<WeaponId, string> = {
  crowbar: Crowbar,
  pistol: Pistol,
  smg: Smg,
  ar3: Ar3,
  gravityGun: GravityGun,
  shotgun: Shotgun,
  grenade: Grenade,
};

export function getWeaponIcon(id: WeaponId): string {
  return ICONS[id];
}
