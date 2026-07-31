import type { Input } from "@engine/input/Input";
import { KeyBindings } from "@engine/input/KeyBindings";
import {
  ActionContexts,
  DefaultBindings,
  type GameAction,
} from "@game/config/controls.config";

const STORAGE_KEY = "vibe-life3:controls";

/**
 * `KeyBindings` especÃ­fico del juego con persistencia en localStorage.
 *
 * Estrategia de load: hidrata desde storage *antes* de registrar el
 * listener de auto-save, asÃ­ la rehidrataciÃ³n no dispara escrituras.
 */
export class Controls extends KeyBindings<GameAction> {
  constructor(input: Input) {
    super(input, DefaultBindings, ActionContexts);
    this.hydrateFromStorage();
    this.onChange(() => this.saveToStorage());
  }

  resetToDefaults(): void {
    this.resetTo(DefaultBindings);
  }

  private hydrateFromStorage(): void {
    const raw = readStorage();
    if (!raw) return;
    for (const action of Object.keys(DefaultBindings) as GameAction[]) {
      const codes = raw[action];
      if (!Array.isArray(codes)) continue;
      const sanitized = codes.filter((c): c is string => typeof c === "string");
      this.setBinding(action, sanitized);
    }
  }

  private saveToStorage(): void {
    try {
      const data: Record<string, string[]> = {};
      for (const action of this.getAllActions()) {
        data[action] = [...this.getCodes(action)];
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // localStorage puede estar deshabilitado o lleno; el binding sigue
      // funcionando en memoria.
    }
  }
}

function readStorage(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
