export class PauseMenu {
  readonly element: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'pause-menu is-hidden';
    this.element.innerHTML = `
      <div class="pause-menu__panel">
        <h2 class="pause-menu__title">Pausa</h2>
        <p class="pause-menu__text">Click en la escena para volver a capturar el mouse.</p>
      </div>
    `;
    container.append(this.element);
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle('is-hidden', !visible);
  }
}
