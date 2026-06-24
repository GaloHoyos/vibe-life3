import { Color, Scene } from 'three';
import type { Object3D } from 'three';

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

  /**
   * Remueve toda la geometría del nivel salvo los objetos `preserved` (las
   * luces persistentes). Solo desparenta — NO dispone geometrías/materiales,
   * porque las mallas de GLB comparten esos recursos con la caché del
   * `AssetManager` y disponerlos rompería el próximo nivel. El leak de GPU de
   * las geometrías únicas (cajas/terreno) por transición es despreciable.
   */
  clearLevel(preserved: Object3D[]): void {
    const keep = new Set(preserved);
    for (const child of [...this.scene.children]) {
      if (!keep.has(child)) {
        this.scene.remove(child);
      }
    }
  }
}
