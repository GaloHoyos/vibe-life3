import { Camera, Scene, WebGLRenderer } from 'three';

/**
 * Wrapper del `WebGLRenderer` de Three.js: monta el canvas en el
 * contenedor del juego, configura pixel ratio + shadows y maneja resize
 * automático. Las escenas se pasan en cada `render()`.
 */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;

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
