import type { GameEventBus } from "@game/GameEvents";
import {
  DEFAULT_DIFFICULTY,
  DifficultyTable,
  isDifficultyLevel,
  type DifficultyLevel,
  type DifficultyModifiers,
  type DifficultyProvider,
} from "@game/config/difficulty.config";

const STORAGE_KEY = "vibe-life3:difficulty";

/**
 * Autoridad de la dificultad activa. Persiste en localStorage (patron de
 * `Controls`), expone los multiplicadores a los sistemas de combate y avisa por
 * el bus cuando cambia. La vida enemiga se hornea al spawnear, asi que cambiar
 * de nivel a mitad de partida solo afecta a NPCs nuevos.
 */
export class DifficultyService implements DifficultyProvider {
  private level: DifficultyLevel;

  constructor(private readonly eventBus: GameEventBus) {
    this.level = readStoredLevel() ?? DEFAULT_DIFFICULTY;
  }

  getLevel(): DifficultyLevel {
    return this.level;
  }

  getModifiers(): DifficultyModifiers {
    return DifficultyTable[this.level];
  }

  setLevel(level: DifficultyLevel): void {
    if (level === this.level) return;
    this.level = level;
    this.saveToStorage();
    this.eventBus.emit("difficulty.changed", { level });
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, this.level);
    } catch {
      // localStorage deshabilitado o lleno; la dificultad sigue en memoria.
    }
  }
}

function readStoredLevel(): DifficultyLevel | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isDifficultyLevel(raw) ? raw : null;
  } catch {
    return null;
  }
}
