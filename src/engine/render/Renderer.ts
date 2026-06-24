import { ACESFilmicToneMapping, Camera, Scene, WebGLRenderer } from 'three';

/**
 * Wrapper del `WebGLRenderer` de Three.js: monta el canvas en el
 * contenedor del juego, configura pixel ratio + shadows y maneja resize
 * automático. Las escenas se pasan en cada `render()`.
 */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  constructor(container: HTMLElement) {
    // `logarithmicDepthBuffer`: la fachada tiene mucha geometria casi coplanar
    // (losas vs paredes, sills/bandas/zocalo/cornisa embebidos) que con el depth
    // buffer lineal (near 0.05 / far 350) hace z-fighting a la distancia. El
    // buffer logaritmico reparte la precision y lo elimina globalmente.
    this.renderer = new WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.canvas = this.renderer.domElement;
    this.canvas.className = 'game-canvas';
    container.append(this.canvas);

    window.addEventListener('resize', this.handleResize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
  }

  render(scene: Scene, camera: Camera): void {
    this.renderer.render(scene, camera);
  }

  private readonly handleResize = (): void => {
    const parent = this.canvas.parentElement;

    if (!parent) {
      return;
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(parent.clientWidth, parent.clientHeight);
  };
}
