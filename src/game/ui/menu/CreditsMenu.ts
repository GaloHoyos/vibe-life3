export class CreditsMenu {
  readonly element = document.createElement("section");

  constructor(onBack: () => void) {
    this.element.className = "hl2-panel hl2-panel--content";
    this.element.innerHTML = `
      <div class="hl2-panel__header">
        <h2>CREDITOS</h2>
        <p>Equipo y reconocimientos.</p>
      </div>
      <div class="hl2-credits">
        <div class="hl2-credits__block">
          <h3>DIRECCION</h3>
          <p>Galo Hoyos</p>
        </div>
        <div class="hl2-credits__block">
          <h3>PROGRAMACION</h3>
          <p>Galo Hoyos</p>
          <p class="hl2-credits__muted">Asistencia IA: Claude (Anthropic)</p>
        </div>
        <div class="hl2-credits__block">
          <h3>STACK</h3>
          <p>Three.js, Rapier3D, TypeScript, Vite</p>
        </div>
        <div class="hl2-credits__block">
          <h3>INSPIRACION</h3>
          <p>Half-Life, Valve Software</p>
        </div>
        <p class="hl2-credits__note">Proyecto fan no comercial.</p>
      </div>
      <div class="hl2-actions">
        <button class="hl2-button" type="button" data-action="back">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">VOLVER</span>
        </button>
      </div>
    `;

    const backButton = this.element.querySelector(
      '[data-action="back"]',
    ) as HTMLButtonElement;
    backButton.addEventListener("click", onBack);
  }
}
