import { AmbientLight, DirectionalLight, HemisphereLight, Scene } from 'three';

export class LightingSystem {
  private readonly lights = {
    ambient: new AmbientLight(0x9fb7c5, 0.32),
    hemisphere: new HemisphereLight(0xbfd8ff, 0x1d2429, 1.6),
    key: new DirectionalLight(0xd9f2ff, 2.3),
  };

  attach(scene: Scene): void {
    this.lights.key.position.set(8, 12, 6);
    this.lights.key.castShadow = true;
    this.lights.key.shadow.mapSize.set(2048, 2048);
    this.lights.key.shadow.camera.near = 0.5;
    this.lights.key.shadow.camera.far = 60;
    this.lights.key.shadow.camera.left = -25;
    this.lights.key.shadow.camera.right = 25;
    this.lights.key.shadow.camera.top = 25;
    this.lights.key.shadow.camera.bottom = -25;

    scene.add(this.lights.ambient, this.lights.hemisphere, this.lights.key);
  }
}
