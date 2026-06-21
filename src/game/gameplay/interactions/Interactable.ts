import type { Object3D } from 'three';

export interface Interactable {
  id: string;
  label: string;
  object: Object3D;
  maxDistance: number;
  /** Acción discreta al presionar USE (puertas, botones). */
  interact(): void;
  /**
   * Tick por frame mientras el jugador MANTIENE USE con foco en este
   * interactable (cargadores estilo HL2). Opcional.
   */
  interactHeld?(delta: number): void;
  /** Se llama al soltar el hold o perder el foco. Opcional. */
  interactEnd?(): void;
}
