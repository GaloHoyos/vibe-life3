import { AmbientLight, DirectionalLight, HemisphereLight, Scene, Vector3 } from 'three';
import type { Object3D } from 'three';
import type { VectorTuple } from '@shared/math/VectorTuple';

export interface SunOptions {
  /**
   * DirecciÃ³n desde la escena hacia el sol (cualquier magnitud, se normaliza).
   * `[0, 1, 0]` = mediodÃ­a, `[1, 0.3, 0]` = atardecer bajo al este.
   */
  direction?: VectorTuple;
  /** Color del sol. Default cÃ¡lido neutro `0xfff2d6`. */
  color?: number;
  /** Intensidad. Default `3.0`. */
  intensity?: number;
}

const DEFAULT_SUN: Required<SunOptions> = {
  direction: [0.4, 1.0, 0.3],
  color: 0xfff2d6,
  intensity: 3.0,
};

const SUN_DISTANCE = 30;

/**
 * IluminaciÃ³n canÃ³nica del juego. Pensado para correr con IBL (HDRI vÃ­a
 * `EnvironmentSystem`) â€” por eso ambient + hemisphere quedan en fill bajo
 * y la luz principal direccional (`sun`) hace el trabajo pesado.
 *
 * El sol se reconfigura por nivel desde `configureSun()`.
 */
export class LightingSystem {
  private readonly lights = {
    ambient: new AmbientLight(0xffffff, 0.15),
    hemisphere: new HemisphereLight(0xbfd8ff, 0x1d2429, 0.25),
    sun: new DirectionalLight(DEFAULT_SUN.color, DEFAULT_SUN.intensity),
  };

  attach(scene: Scene): void {
    const sun = this.lights.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 80;
    sun.shadow.camera.left = -30;
    sun.shadow.camera.right = 30;
    sun.shadow.camera.top = 30;
    sun.shadow.camera.bottom = -30;
    sun.shadow.bias = -0.0005;

    this.applySunDirection(DEFAULT_SUN.direction);
    scene.add(this.lights.ambient, this.lights.hemisphere, sun);
  }

  /**
   * Las luces persistentes (se agregan a la escena una sola vez). El teardown
   * de nivel las preserva al limpiar la escena. El `sun.target` no es hijo de
   * la escena (su matriz se actualiza a mano), así que no hace falta preservarlo.
   */
  getLights(): Object3D[] {
    return [this.lights.ambient, this.lights.hemisphere, this.lights.sun];
  }

  /** Configura el sol del nivel actual. Cualquier campo no provisto cae al default. */
  configureSun(options: SunOptions = {}): void {
    const sun = this.lights.sun;
    sun.color.setHex(options.color ?? DEFAULT_SUN.color);
    sun.intensity = options.intensity ?? DEFAULT_SUN.intensity;
    this.applySunDirection(options.direction ?? DEFAULT_SUN.direction);
  }

  private applySunDirection(direction: VectorTuple): void {
    const v = new Vector3(...direction);
    if (v.lengthSq() === 0) v.set(0, 1, 0);
    v.normalize().multiplyScalar(SUN_DISTANCE);
    this.lights.sun.position.copy(v);
    this.lights.sun.target.position.set(0, 0, 0);
    this.lights.sun.target.updateMatrixWorld();
  }
}
