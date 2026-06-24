import type { Disposable } from "@shared/types/lifecycle";
import { GameOverStrings } from "@game/config/strings";

export interface DeathScreenCallbacks {
  /** Reanimar desde el último checkpoint (recarga). */
  onRespawn: () => void;
  /** Abandonar al menú principal. */
  onExit: () => void;
}

/** Opacidad máxima del oscurecido cuando la caída termina. */
const MAX_TINT = 0.78;

/**
 * Pantalla de muerte con la estética del arranque del traje H.E.V. de Black
 * Mesa: terminal ámbar con diagnóstico de sistemas, ID de usuario y un esquema
 * del traje, reportando fallo total. Los vitales (salud/traje) NO se dibujan
 * acá: se reusa el HUD real, que ya muestra 0 al morir y queda por encima del
 * oscurecido (de ahí que el tinte sea un layer aparte, debajo del HUD).
 *
 * El oscurecido sube con la caída de la cámara; al asentarse aparece el
 * terminal. Cualquier clic o tecla reanima (o, sin checkpoint, sale al menú);
 * `Esc` siempre sale al menú. El input se habilita recién al mostrar el prompt
 * para no "comerse" la caída.
 */
export class DeathScreen implements Disposable {
  /** Terminal H.E.V. (z alto, sobre el HUD). */
  readonly element = document.createElement("div");
  /** Oscurecido de pantalla (z bajo, debajo del HUD para no tapar los vitales). */
  private readonly tint = document.createElement("div");
  private readonly hint = document.createElement("p");
  private promptActive = false;
  private canRespawn = true;

  constructor(
    container: HTMLElement,
    private readonly callbacks: DeathScreenCallbacks,
  ) {
    this.tint.className = "hev-death-tint";

    this.element.className = "hev-death";
    const hud = document.createElement("div");
    hud.className = "hev-death__hud";

    const user = document.createElement("p");
    user.className = "hev-death__user";
    user.textContent = GameOverStrings.userId;

    const diag = document.createElement("div");
    diag.className = "hev-death__diag";
    const head = document.createElement("p");
    head.className = "hev-death__head";
    head.textContent = GameOverStrings.header;
    const systems = document.createElement("ul");
    systems.className = "hev-death__systems";
    GameOverStrings.systems.forEach((system) => {
      const line = document.createElement("li");
      line.className = "hev-line";
      const label = document.createElement("span");
      label.className = "hev-line__label";
      label.textContent = system.label;
      const dots = document.createElement("span");
      dots.className = "hev-line__dots";
      const status = document.createElement("span");
      status.className = "hev-line__status";
      status.textContent = system.status;
      line.append(label, dots, status);
      systems.append(line);
    });
    diag.append(head, systems);

    const suit = document.createElement("div");
    suit.className = "hev-death__suit";
    suit.innerHTML = SUIT_SVG;
    const bio = document.createElement("div");
    bio.className = "hev-death__bio";
    bio.innerHTML = [
      GameOverStrings.height,
      GameOverStrings.weight,
      GameOverStrings.fitLine,
      `<span class="hev-death__dead">${GameOverStrings.fitDone}</span>`,
    ]
      .map((line) => `<p>${line}</p>`)
      .join("");
    suit.append(bio);

    const prompt = document.createElement("div");
    prompt.className = "hev-death__prompt";
    this.hint.className = "hev-death__hint hev-death__hint--primary";
    this.hint.textContent = GameOverStrings.respawnHint;
    const exitHint = document.createElement("p");
    exitHint.className = "hev-death__hint";
    exitHint.textContent = GameOverStrings.exitHint;
    prompt.append(this.hint, exitHint);

    hud.append(user, diag, suit, prompt);
    this.element.append(hud);
    container.append(this.tint, this.element);
  }

  /** Inicia la fase de caída: muestra el oscurecido (en cero) y oculta el terminal. */
  begin(): void {
    this.promptActive = false;
    this.element.classList.remove("is-prompt");
    this.setIntensity(0);
  }

  /** Intensidad del oscurecido según el progreso de la caída (0→1). */
  setIntensity(progress: number): void {
    this.tint.style.opacity = String(MAX_TINT * Math.max(0, Math.min(1, progress)));
  }

  /** Revela el terminal H.E.V. y habilita el input de reanimación/salida. */
  showPrompt(canRespawn: boolean): void {
    this.canRespawn = canRespawn;
    this.promptActive = true;
    this.hint.textContent = canRespawn
      ? GameOverStrings.respawnHint
      : GameOverStrings.noRespawnHint;
    this.element.classList.add("is-prompt");
    document.addEventListener("keydown", this.handleKey);
    document.addEventListener("mousedown", this.handleClick);
  }

  hide(): void {
    this.promptActive = false;
    this.element.classList.remove("is-prompt");
    this.tint.style.opacity = "0";
    document.removeEventListener("keydown", this.handleKey);
    document.removeEventListener("mousedown", this.handleClick);
  }

  dispose(): void {
    this.hide();
    this.element.remove();
    this.tint.remove();
  }

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (!this.promptActive) {
      return;
    }
    if (event.code === "Escape") {
      this.callbacks.onExit();
      return;
    }
    this.trigger();
  };

  private readonly handleClick = (): void => {
    if (this.promptActive) {
      this.trigger();
    }
  };

  private trigger(): void {
    // Desarmar de inmediato: la reanimación recarga la página y no queremos
    // disparar dos veces si llegan click y tecla casi juntos.
    this.promptActive = false;
    if (this.canRespawn) {
      this.callbacks.onRespawn();
    } else {
      this.callbacks.onExit();
    }
  }
}

/** Esquema del traje H.E.V. (wireframe ámbar) al estilo del arranque de Black Mesa. */
const SUIT_SVG = `
<svg class="hev-death__figure" viewBox="0 0 120 250" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
    <rect x="46" y="6" width="28" height="30" rx="11"/>
    <line x1="51" y1="22" x2="69" y2="22"/>
    <path d="M45 37 H75"/>
    <rect x="31" y="40" width="18" height="15" rx="6"/>
    <rect x="71" y="40" width="18" height="15" rx="6"/>
    <path d="M46 40 H74 L79 99 Q60 108 41 99 Z"/>
    <line x1="44" y1="57" x2="76" y2="57"/>
    <line x1="44" y1="72" x2="76" y2="72"/>
    <line x1="48" y1="87" x2="72" y2="87"/>
    <path d="M33 52 L28 99 L39 100 L44 56 Z"/>
    <path d="M87 52 L92 99 L81 100 L76 56 Z"/>
    <rect x="26" y="99" width="14" height="16" rx="4"/>
    <rect x="80" y="99" width="14" height="16" rx="4"/>
    <path d="M44 103 H76 L72 122 H48 Z"/>
    <rect x="46" y="124" width="13" height="46" rx="4"/>
    <rect x="61" y="124" width="13" height="46" rx="4"/>
    <rect x="47" y="172" width="11" height="40" rx="3"/>
    <rect x="62" y="172" width="11" height="40" rx="3"/>
    <rect x="44" y="214" width="16" height="14" rx="3"/>
    <rect x="60" y="214" width="16" height="14" rx="3"/>
  </g>
</svg>`;
