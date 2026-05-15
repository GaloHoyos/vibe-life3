import { Color, Scene } from 'three';

/**
 * Wrapper de la `Scene` raíz de Three.js con helpers de fondo.
 * El motor expone una única instancia compartida por toda la app.
 */
export class SceneManager {
  readonly scene = new Scene();

  constructor() {
    this.scene.background = new Color(0x071019);
  }

  setBackground(color: number): void {
    this.scene.background = new Color(color);
  }

  clear(): void {
    this.scene.clear();
  }
}
