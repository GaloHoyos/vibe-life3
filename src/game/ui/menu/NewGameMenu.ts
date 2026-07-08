import type { MenuChapter } from "./MainMenuState";
import {
  DIFFICULTY_ORDER,
  type DifficultyLevel,
} from "@game/config/difficulty.config";
import { DifficultyStrings, DifficultyMenuStrings } from "@game/config/strings";

export interface NewGameDifficultyControls {
  getDifficulty: () => DifficultyLevel;
  onSetDifficulty: (level: DifficultyLevel) => void;
}

export class NewGameMenu {
  readonly element = document.createElement("section");

  constructor(
    chapters: MenuChapter[],
    onStart: (chapterId: string) => void,
    onBack: () => void,
    difficulty: NewGameDifficultyControls,
  ) {
    this.element.className = "hl2-panel hl2-panel--content";
    this.element.innerHTML = `
      <div class="hl2-panel__header">
        <h2>NUEVA PARTIDA</h2>
        <p>Selecciona dificultad y capitulo para iniciar.</p>
      </div>
      <div class="hl2-difficulty">
        <span class="hl2-difficulty__title">${DifficultyMenuStrings.title.toUpperCase()}</span>
        <div class="hl2-difficulty__options" role="group">
          ${DIFFICULTY_ORDER.map(
            (level) => `
            <button class="hl2-button hl2-difficulty__option" type="button" data-difficulty="${level}">
              <span class="hl2-button__marker"></span>
              <span class="hl2-button__label">${DifficultyStrings[level].label}</span>
            </button>
          `,
          ).join("")}
        </div>
        <p class="hl2-difficulty__desc" data-difficulty-desc></p>
      </div>
      <ul class="hl2-chapters"></ul>
      <div class="hl2-actions">
        <button class="hl2-button" type="button" data-action="back">
          <span class="hl2-button__marker"></span>
          <span class="hl2-button__label">VOLVER</span>
        </button>
      </div>
    `;

    this.wireDifficulty(difficulty);

    const list = this.element.querySelector(".hl2-chapters") as HTMLUListElement;

    if (chapters.length === 0) {
      const empty = document.createElement("li");
      empty.className = "hl2-chapter hl2-chapter--empty";
      empty.textContent = "No hay capitulos disponibles.";
      list.append(empty);
    } else {
      chapters.forEach((chapter, index) => {
        const item = document.createElement("li");
        item.className = "hl2-chapter";
        item.tabIndex = 0;
        item.dataset.chapterId = chapter.id;
        item.innerHTML = `
          <span class="hl2-chapter__index">${String(index + 1).padStart(2, "0")}</span>
          <div class="hl2-chapter__body">
            <div class="hl2-chapter__title">${chapter.title}</div>
            <div class="hl2-chapter__desc">${chapter.description}</div>
          </div>
          <span class="hl2-chapter__cta">JUGAR &gt;</span>
        `;

        const trigger = (): void => onStart(chapter.id);
        item.addEventListener("click", trigger);
        item.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            trigger();
          }
        });
        list.append(item);
      });
    }

    const backButton = this.element.querySelector(
      '[data-action="back"]',
    ) as HTMLButtonElement;
    backButton.addEventListener("click", onBack);
  }

  private wireDifficulty(controls: NewGameDifficultyControls): void {
    const buttons = this.element.querySelectorAll<HTMLButtonElement>(
      "[data-difficulty]",
    );
    const desc = this.element.querySelector(
      "[data-difficulty-desc]",
    ) as HTMLElement;

    const render = (selected: DifficultyLevel): void => {
      buttons.forEach((button) => {
        button.classList.toggle(
          "is-active",
          button.dataset.difficulty === selected,
        );
      });
      desc.textContent = DifficultyStrings[selected].description;
    };

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const level = button.dataset.difficulty as DifficultyLevel;
        controls.onSetDifficulty(level);
        render(level);
      });
    });

    render(controls.getDifficulty());
  }
}
