import { Color, PMREMGenerator, type Scene, type Texture, type WebGLRenderer } from 'three';
import { getSkyboxHdr, type SkyboxId } from './Skybox';

/**
 * Aplica skybox e Image-Based Lighting a la escena. Convierte el HDRI
 * equirectangular en una `envMap` pre-filtrada (PMREM) que `MeshStandardMaterial`
 * usa automáticamente vía `scene.environment` para reflejos y ambient. El
 * mismo HDRI también se asigna a `scene.background` para que se vea como cielo.
 *
 * Si el HDRI no existe (archivo faltante) o falla la carga, hace fallback a
 * un color sólido sin envMap — la escena queda visible aunque más opaca.
 */
export class EnvironmentSystem {
  private readonly pmrem: PMREMGenerator;
  private currentEnvMap: Texture | null = null;

  constructor(renderer: WebGLRenderer) {
    this.pmrem = new PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /**
   * Carga el HDRI indicado y lo aplica como background + environment. Si el
   * archivo no existe, deja la escena con `fallbackColor` y sin IBL.
   */
  async applySkybox(scene: Scene, id: SkyboxId, fallbackColor: number): Promise<void> {
    const hdr = await getSkyboxHdr(id);
    this.disposeCurrent();

    if (!hdr) {
      scene.background = new Color(fallbackColor);
      scene.environment = null;
      return;
    }

    const envMap = this.pmrem.fromEquirectangular(hdr).texture;
    scene.background = hdr;
    scene.environment = envMap;
    this.currentEnvMap = envMap;
  }

  dispose(): void {
    this.disposeCurrent();
    this.pmrem.dispose();
  }

  private disposeCurrent(): void {
    if (this.currentEnvMap) {
      this.currentEnvMap.dispose();
      this.currentEnvMap = null;
    }
  }
}
