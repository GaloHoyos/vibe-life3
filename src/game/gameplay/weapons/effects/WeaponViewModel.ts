import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  NoBlending,
  Quaternion,
  Scene,
  Vector3,
  type Object3D,
} from "three";
import type { AssetManager } from "@engine/assets/AssetManager";
import type { CameraSystem } from "@engine/render/CameraSystem";
import { MuzzleFlash } from "./MuzzleFlash";
import type { Recoil } from "./Recoil";
import type { WeaponDefinition } from "@game/gameplay/weapons/core/WeaponDefinition";

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
  private attackTime = 0;
  private attackDuration = 0;
  private attackPitch = 0;
  private attackForward = 0;

  constructor(
    private readonly scene: Scene,
    private readonly assets: AssetManager,
  ) {
    this.root.name = "weapon-viewmodel";
    this.modelRoot.rotation.y = -Math.PI / 2;
    this.root.add(this.modelRoot);
    this.root.add(this.muzzleFlash.mesh);
    this.scene.add(this.root);
    // La luz del fogonazo va SUELTA en la escena, no bajo `root`. Three cuenta
    // las luces con `traverseVisible`, así que esconder el viewmodel (subir a un
    // vehículo, quedarse sin arma, los passes de portal) cambiaba
    // `NUM_POINT_LIGHTS` y recompilaba todos los materiales de la escena: un
    // freeze de varios segundos al montar. Su pose la sigue el mesh.
    this.scene.add(this.muzzleFlash.light);
  }

  /** Raíz del modelo en primera persona; los passes de portal la ocultan. */
  getRoot(): Group {
    return this.root;
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

    // Attack swing: empuja el arma hacia adelante (z local ms negativo)
    // y tira el pitch hacia abajo. Curva sinusoidal 0  peak  0.
    let attackPitch = 0;
    if (this.attackTime > 0) {
      this.attackTime = Math.max(0, this.attackTime - delta);
      const progress = 1 - this.attackTime / this.attackDuration;
      const swing = Math.sin(progress * Math.PI);
      offset.z -= this.attackForward * swing;
      attackPitch = -this.attackPitch * swing;
    }

    this.root.position.copy(cameraSystem.camera.localToWorld(offset));
    const rotation = new Quaternion().setFromEuler(
      this.equipped.viewModelRotation,
    );
    this.root.quaternion
      .copy(cameraSystem.camera.quaternion)
      .multiply(rotation);
    this.root.scale.setScalar(this.equipped.viewModelScale);

    let modelPitch = 0;
    if (this.reloadTime > 0) {
      this.reloadTime = Math.max(0, this.reloadTime - delta);
      const reloadProgress = 1 - this.reloadTime / this.reloadDuration;
      modelPitch -= Math.sin(reloadProgress * Math.PI) * this.reloadPitch;
    }
    modelPitch += attackPitch;
    this.modelRoot.rotation.x = modelPitch;

    this.muzzleFlash.update(delta);
    this.muzzleFlash.syncLightToMuzzle();
  }

  fire(): void {
    if (!this.equipped) {
      return;
    }
    if (
      this.equipped.type !== "melee" &&
      this.equipped.type !== "grenade"
    ) {
      this.muzzleFlash.flash(this.equipped.muzzleFlash);
    }
    const duration = this.equipped.attackAnimationDuration ?? 0;
    if (duration > 0) {
      this.attackDuration = duration;
      this.attackTime = duration;
      this.attackPitch = this.equipped.attackAnimationPitch ?? 0;
      this.attackForward = this.equipped.attackAnimationForward ?? 0;
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
    this.muzzleFlash.light.removeFromParent();
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
      // El arma en primera persona se dibuja SIEMPRE encima del mundo (sin
      // depth test, al final del pass): si no, al apoyarse contra una pared
      // o al entrar a un portal la geometría la oculta. Se clonan los
      // materiales porque el GLTF los comparte con los pickups del mundo.
      if (object instanceof Mesh) {
        object.renderOrder = 1000;
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        const patched = materials.map((material) => {
          const clone = material.clone();
          clone.depthTest = false;
          clone.depthWrite = false;
          // Three dibuja TODA la cola transparente después de la opaca, y
          // `renderOrder` sólo ordena dentro de cada una: un fragmento de prop
          // en fade o el vidrio de un televisor le ganaban al arma por más
          // renderOrder que tuviera. Entrar a la cola transparente la devuelve
          // al frente. `NoBlending` conserva el aspecto opaco: el alfa de la
          // textura se sigue ignorando, sólo cambia en qué pase se dibuja.
          clone.transparent = true;
          clone.blending = NoBlending;
          return clone;
        });
        object.material = Array.isArray(object.material)
          ? patched
          : patched[0];
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
