import { HudStrings } from '@game/config/strings';

/**
 * Contador del squad del jugador (estilo HL2): "ESCUADRÓN 3/4" sobre los
 * vitales, visible solo mientras haya miembros. Sin timers ni listeners —
 * la lógica vive en `HUD` (eventos `squad.*`).
 */
export class SquadHUD {
  readonly element = document.createElement('div');

  constructor() {
    this.element.className = 'hev-squad is-hidden';
  }

  setSize(size: number, max: number): void {
    this.element.classList.toggle('is-hidden', size <= 0);
    this.element.textContent = HudStrings.squadSize(size, max);
  }
}
