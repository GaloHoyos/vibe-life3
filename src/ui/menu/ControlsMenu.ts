export class ControlsMenu {
  readonly element = document.createElement("section");

  constructor(onBack: () => void) {
    this.element.className = "hl3-panel hl3-panel--content";
    this.element.innerHTML = `
      <div class="hl3-panel__header">
        <h2>Controles</h2>
        <p>Configuracion actual.</p>
      </div>
      <ul class="hl3-controls">
        <li><strong>WASD</strong> mover</li>
        <li><strong>Mouse</strong> mirar</li>
        <li><strong>Click izquierdo</strong> disparar / atacar</li>
        <li><strong>R</strong> recargar</li>
        <li><strong>E</strong> usar / interactuar</li>
        <li><strong>Espacio</strong> saltar</li>
        <li><strong>Shift</strong> correr (si existe)</li>
        <li><strong>1-5</strong> seleccionar arma</li>
        <li><strong>Rueda del mouse</strong> cambiar arma</li>
        <li><strong>F3</strong> debug</li>
        <li><strong>Esc</strong> pausa / menu</li>
      </ul>
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
