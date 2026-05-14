import { Color, Scene } from 'three';

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
