interface KeyBinding {
  key: string;
  action: string;
}

const KEY_BINDINGS: KeyBinding[] = [
  { key: "W A S D", action: "Mover" },
  { key: "Mouse", action: "Mirar" },
  { key: "Clic izquierdo", action: "Disparar / Atacar" },
  { key: "Clic derecho", action: "Funcion alternativa" },
  { key: "R", action: "Recargar" },
  { key: "E", action: "Interactuar" },
  { key: "Espacio", action: "Saltar" },
  { key: "Shift", action: "Correr" },
  { key: "1 - 5", action: "Seleccionar arma" },
  { key: "Rueda", action: "Cambiar arma" },
  { key: "F3", action: "Mostrar / ocultar debug" },
  { key: "Esc", action: "Pausa" },
];

export class ControlsMenu {
  readonly element = document.createElement("section");

  constructor(onBack: () => void) {
    this.element.className = "hl2-panel hl2-panel--content";
    this.element.innerHTML = `
      <div class="hl2-panel__header">
        <h2>CONTROLES</h2>
        <p>Asignacion actual del teclado y raton.</p>
      </div>
      <table class="hl2-keymap">
        <thead>
          <tr>
            <th>TECLA</th>
            <th>ACCION</th>
          </tr>
        </thead>
        <tbody>
          ${KEY_BINDINGS.map(
            (row) => `
              <tr>
                <td><kbd>${row.key}</kbd></td>
                <td>${row.action}</td>
              </tr>
            `,
          ).join("")}
        </tbody>
      </table>
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
