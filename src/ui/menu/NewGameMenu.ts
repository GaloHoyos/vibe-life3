import type { MenuChapter } from "./MainMenuState";

export class NewGameMenu {
  readonly element = document.createElement("section");
  private readonly startButton: HTMLButtonElement;
  private readonly chapterTitle: HTMLElement;
  private readonly chapterDescription: HTMLElement;

  constructor(
    chapters: MenuChapter[],
    onStart: (chapterId: string) => void,
    onBack: () => void,
  ) {
    this.element.className = "hl3-panel hl3-panel--content";
    this.element.innerHTML = `
      <div class="hl3-panel__header">
        <h2>Nueva Partida</h2>
        <p>Selecciona un capitulo para iniciar.</p>
      </div>
      <div class="hl3-chapter">
        <div class="hl3-chapter__title"></div>
        <div class="hl3-chapter__desc"></div>
      </div>
      <div class="hl3-actions">
        <button class="hl3-button hl3-button--primary" type="button">Iniciar</button>
        <button class="hl3-button" type="button" data-action="back">Volver</button>
      </div>
    `;

    const firstChapter = chapters[0];
    this.chapterTitle = this.element.querySelector(
      ".hl3-chapter__title",
    ) as HTMLElement;
    this.chapterDescription = this.element.querySelector(
      ".hl3-chapter__desc",
    ) as HTMLElement;
    this.chapterTitle.textContent = firstChapter?.title ?? "Mapa";
    this.chapterDescription.textContent = firstChapter?.description ?? "";

    this.startButton = this.element.querySelector(
      ".hl3-button--primary",
    ) as HTMLButtonElement;
    this.startButton.addEventListener("click", () => {
      if (firstChapter) {
        onStart(firstChapter.id);
      }
    });

    const backButton = this.element.querySelector(
      '[data-action="back"]',
    ) as HTMLButtonElement;
    backButton.addEventListener("click", onBack);
  }
}
