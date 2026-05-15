export class CreditsMenu {
  readonly element = document.createElement("section");

  constructor(onBack: () => void) {
    this.element.className = "hl3-panel hl3-panel--content";
    this.element.innerHTML = `
      <div class="hl3-panel__header">
        <h2>Creditos</h2>
        <p>Placeholder temporal.</p>
      </div>
      <div class="hl3-credits">
        <p>Proyecto experimental inspirado en Half-Life.</p>
        <p>Equipo: Desarrollo local.</p>
      </div>
      <div class="hl3-actions">
        <button class="hl3-button" type="button" data-action="back">Volver</button>
      </div>
    `;

    const backButton = this.element.querySelector(
      '[data-action="back"]',
    ) as HTMLButtonElement;
    backButton.addEventListener("click", onBack);
  }
}
