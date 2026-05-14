export class MainMenu {
  readonly element: HTMLDivElement;

  constructor(container: HTMLElement, onStart: () => void) {
    this.element = document.createElement('div');
    this.element.className = 'main-menu';
    this.element.innerHTML = `
      <div class="main-menu__panel">
        <h1 class="main-menu__title">FPS Engine Base</h1>
        <p class="main-menu__text">Click para capturar el mouse e iniciar la escena.</p>
        <button class="main-menu__button" type="button">Iniciar</button>
      </div>
    `;

    const button = this.element.querySelector<HTMLButtonElement>('button');
    button?.addEventListener('click', () => {
      this.hide();
      onStart();
    });

    container.append(this.element);
  }

  hide(): void {
    this.element.classList.add('is-hidden');
  }

  show(): void {
    this.element.classList.remove('is-hidden');
  }
}
