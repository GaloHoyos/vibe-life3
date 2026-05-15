import { Mesh, MeshBasicMaterial, PointLight, SphereGeometry } from 'three';
import type { MuzzleFlashDefinition } from './WeaponDefinition';

export class MuzzleFlash {
  readonly mesh: Mesh;
  readonly light: PointLight;

  private remaining = 0;

  constructor() {
    this.mesh = new Mesh(new SphereGeometry(0.04, 10, 8), new MeshBasicMaterial({ color: 0xffb24a }));
    this.mesh.visible = false;
    this.mesh.position.set(0.08, 0.03, -0.62);
    this.light = new PointLight(0xffb24a, 0, 2);
    this.light.position.copy(this.mesh.position);
  }

  flash(definition: MuzzleFlashDefinition): void {
    this.mesh.scale.setScalar(definition.size);
    const material = this.mesh.material as MeshBasicMaterial;
    material.color.setHex(definition.color);
    this.light.color.setHex(definition.color);
    this.light.intensity = definition.intensity;
    this.mesh.visible = true;
    this.remaining = definition.duration;
  }

  update(delta: number): void {
    if (this.remaining <= 0) {
      return;
    }

    this.remaining -= delta;
    if (this.remaining <= 0) {
      this.mesh.visible = false;
      this.light.intensity = 0;
    }
  }
}
