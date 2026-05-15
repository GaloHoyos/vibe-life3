import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Vector3,
  type Object3D,
} from "three";
import type { AssetManager } from "../../../engine/assets/AssetManager";
import type { CameraSystem } from "../../../engine/render/CameraSystem";
import { MuzzleFlash } from "./MuzzleFlash";
import type { Recoil } from "./Recoil";
import type { WeaponDefinition } from "./WeaponDefinition";

export class WeaponViewModel {
  private readonly root = new Group();
  private readonly modelRoot = new Group();
  private readonly muzzleFlash = new MuzzleFlash();
  private model: Object3D | null = null;
  private equipped: WeaponDefinition | null = null;
  private loadToken = 0;
  private bobTime = 0;
  private reloadTime = 0;
  private reloadDuration = 0;
  private reloadPitch = 0;

  constructor(
    private readonly scene: Scene,
    private readonly assets: AssetManager,
  ) {
    this.root.name = "weapon-viewmodel";
    this.modelRoot.rotation.y = -Math.PI / 2;
    this.root.add(this.modelRoot);
    this.root.add(this.muzzleFlash.mesh, this.muzzleFlash.light);
    this.scene.add(this.root);
  }

  async equip(definition: WeaponDefinition | null): Promise<void> {
    this.equipped = definition;
    this.loadToken += 1;
    const token = this.loadToken;
    this.clearModel();

    if (!definition) {
      this.root.visible = false;
      return;
    }

    this.root.visible = true;
    this.setModel(createFallbackModel(definition));
    const instance = await this.assets.instantiateModel(definition.modelId);
    if (token !== this.loadToken || !instance.root) {
      return;
    }

    this.setModel(instance.root);
  }

  update(
    delta: number,
    cameraSystem: CameraSystem,
    recoil: Recoil,
    speed: number,
  ): void {
    if (!this.equipped) {
      return;
    }

    this.bobTime += delta * Math.max(1, speed * 0.7);
    const offset = this.equipped.viewModelOffset.clone();
    offset.x += recoil.offset.x;
    offset.y +=
      Math.sin(this.bobTime * 7) * 0.008 * Math.min(speed, 1) - recoil.offset.y;
    offset.z += Math.cos(this.bobTime * 5) * 0.006 * Math.min(speed, 1);

    this.root.position.copy(cameraSystem.camera.localToWorld(offset));
    const rotation = new Quaternion().setFromEuler(
      this.equipped.viewModelRotation,
    );
    this.root.quaternion
      .copy(cameraSystem.camera.quaternion)
      .multiply(rotation);
    this.root.scale.setScalar(this.equipped.viewModelScale);

    if (this.reloadTime > 0) {
      this.reloadTime = Math.max(0, this.reloadTime - delta);
      const reloadProgress = 1 - this.reloadTime / this.reloadDuration;
      this.modelRoot.rotation.x =
        -Math.sin(reloadProgress * Math.PI) * this.reloadPitch;
    } else {
      this.modelRoot.rotation.x = 0;
    }

    this.muzzleFlash.update(delta);
  }

  fire(): void {
    if (this.equipped && this.equipped.type !== "melee") {
      this.muzzleFlash.flash(this.equipped.muzzleFlash);
    }
  }

  reload(): void {
    if (!this.equipped) {
      return;
    }

    this.reloadDuration = Math.max(this.equipped.reloadTime, 0.25);
    this.reloadPitch = this.equipped.reloadAnimationPitch;
    this.reloadTime = this.reloadDuration;
  }

  dispose(): void {
    this.root.removeFromParent();
  }

  private setModel(model: Object3D): void {
    this.clearModel();
    this.model = model;
    this.model.name = "weapon-viewmodel-instance";
    this.model.traverse((object) => {
      object.frustumCulled = false;
      if ("castShadow" in object) {
        object.castShadow = false;
      }
    });
    this.modelRoot.add(this.model);
  }

  private clearModel(): void {
    this.model?.removeFromParent();
    this.model = null;
  }
}

function createFallbackModel(definition: WeaponDefinition): Object3D {
  const mesh = new Mesh(
    new BoxGeometry(0.18, 0.12, 0.5),
    new MeshStandardMaterial({
      color: definition.type === "special" ? 0x3aa7d8 : 0x24282c,
      roughness: 0.6,
    }),
  );
  mesh.position.set(0, 0, -0.16);
  return mesh;
}
