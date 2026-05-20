import type { GameEventBus } from "@game/GameEvents";
import { Dialogue } from "@game/config/strings";
import type { Player } from "@game/gameplay/player/Player";
import type { DebugFrame, DebugModule } from "../DebugModule";
import { buildButton, buildSection } from "../widgets";

/**
 * Toggles cheap del player: god mode + (futuro) infinite ammo, slow-mo, etc.
 * Mantiene un puntero debil al `Player` actual via el frame; el modulo se
 * registra una sola vez y el player puede cambiar entre niveles.
 */
export class PlayerModule implements DebugModule {
  readonly id = "player";
  readonly label = "Player";
  private active = false;
  private currentPlayer: Player | null = null;
  private godStatus: HTMLDivElement | null = null;

  constructor(private readonly eventBus: GameEventBus) {}

  mount(container: HTMLElement): void {
    const section = buildSection("Player cheats", "#99ffaa");

    const row = document.createElement("div");
    row.className = "debug-row";

    const godButton = buildButton("God mode (F2)", () => this.toggleGodMode());
    row.appendChild(godButton);

    this.godStatus = document.createElement("div");
    this.godStatus.className = "debug-status";
    this.godStatus.textContent = "Estado: off";
    row.appendChild(this.godStatus);

    section.appendChild(row);
    container.appendChild(section);
  }

  update(frame: DebugFrame): void {
    this.currentPlayer = frame.player;
    if (!this.godStatus) return;
    const enabled = this.currentPlayer?.health.isGodMode() ?? false;
    this.godStatus.textContent = `Estado: ${enabled ? "ON" : "off"}`;
    this.godStatus.classList.toggle("is-on", enabled);
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  isActive(): boolean {
    return this.active;
  }

  dispose(): void {
    this.godStatus = null;
    this.currentPlayer = null;
  }

  private toggleGodMode(): void {
    if (!this.currentPlayer) return;
    const enabled = this.currentPlayer.health.toggleGodMode();
    this.eventBus.emit(
      "subtitle.show",
      enabled ? Dialogue.godModeOn : Dialogue.godModeOff,
    );
  }
}
