export class ObjectiveHUD {
  readonly element = document.createElement('section');

  private readonly text = document.createElement('strong');

  constructor() {
    this.element.className = 'hev-objective';
    this.element.innerHTML = '<span>OBJECTIVE</span>';
    this.element.append(this.text);
  }

  setObjective(objective: string): void {
    this.text.textContent = objective.toUpperCase();
    this.element.classList.toggle('is-visible', objective.length > 0);
  }
}
