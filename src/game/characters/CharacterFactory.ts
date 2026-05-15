import { Bone, BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SphereGeometry, Vector3 } from 'three';
import type { AssetManager } from '../../engine/assets/AssetManager';
import { NPC } from '../npc/NPC';
import type { GameEventBus } from "../GameEvents";
import type { PhysicsWorld } from '../../engine/physics/PhysicsWorld';
import { getMaterial } from '../../engine/render/Materials';
import { CharacterPresets } from './CharacterPresets';
import type { CharacterId } from '../../engine/characters/CharacterDefinition';

export class CharacterFactory {
  constructor(
    private readonly assets: AssetManager,
    private readonly physics: PhysicsWorld,
    private readonly eventBus: GameEventBus,
  ) {}

  async createNPC(characterId: CharacterId, instanceId: string, position: Vector3): Promise<NPC> {
    const definition = CharacterPresets[characterId] ?? CharacterPresets.placeholderHumanoid;
    const model = definition.modelId ? await this.assets.instantiateModel(definition.modelId) : null;
    const visualRoot = model?.root ?? createPlaceholderHumanoid();

    visualRoot.scale.multiplyScalar(definition.visualScale);
    visualRoot.rotation.y += definition.visualRotationY;
    visualRoot.position.copy(definition.visualOffset);

    return new NPC({
      id: instanceId,
      definition,
      position,
      visualRoot,
      physics: this.physics,
      eventBus: this.eventBus,
      hasSkeleton: model?.hasSkeleton ?? false,
    });
  }
}

function createPlaceholderHumanoid(): Object3D {
  const root = new Group();
  root.name = 'placeholder-humanoid';
  const material = getMaterial('npc');
  const hips = createBone('Hips', 0, 0.55, 0);
  const spine = createBone('Spine', 0, 0.25, 0);
  const chest = createBone('Chest', 0, 0.36, 0);
  const neck = createBone('Neck', 0, 0.28, 0);
  const head = createBone('Head', 0, 0.2, 0);
  const leftUpperArm = createBone('LeftArm', -0.42, 0.14, 0);
  const leftForearm = createBone('LeftForeArm', 0, -0.45, 0);
  const leftHand = createBone('LeftHand', 0, -0.38, 0);
  const rightUpperArm = createBone('RightArm', 0.42, 0.14, 0);
  const rightForearm = createBone('RightForeArm', 0, -0.45, 0);
  const rightHand = createBone('RightHand', 0, -0.38, 0);
  const leftThigh = createBone('LeftUpLeg', -0.22, -0.08, 0);
  const leftShin = createBone('LeftLeg', 0, -0.54, 0);
  const leftFoot = createBone('LeftFoot', 0, -0.46, 0.12);
  const rightThigh = createBone('RightUpLeg', 0.22, -0.08, 0);
  const rightShin = createBone('RightLeg', 0, -0.54, 0);
  const rightFoot = createBone('RightFoot', 0, -0.46, 0.12);

  root.add(hips);
  hips.add(spine, leftThigh, rightThigh);
  spine.add(chest);
  chest.add(neck, leftUpperArm, rightUpperArm);
  neck.add(head);
  leftUpperArm.add(leftForearm);
  leftForearm.add(leftHand);
  rightUpperArm.add(rightForearm);
  rightForearm.add(rightHand);
  leftThigh.add(leftShin);
  leftShin.add(leftFoot);
  rightThigh.add(rightShin);
  rightShin.add(rightFoot);

  hips.add(createBoxPart('hips-mesh', [0.45, 0.24, 0.3], [0, 0, 0], material));
  chest.add(createBoxPart('chest-mesh', [0.62, 0.62, 0.34], [0, 0.04, 0], material));
  head.add(createHeadPart(material));
  leftUpperArm.add(createBoxPart('left-upper-arm-mesh', [0.16, 0.42, 0.16], [0, -0.22, 0], material));
  leftForearm.add(createBoxPart('left-forearm-mesh', [0.14, 0.36, 0.14], [0, -0.2, 0], material));
  rightUpperArm.add(createBoxPart('right-upper-arm-mesh', [0.16, 0.42, 0.16], [0, -0.22, 0], material));
  rightForearm.add(createBoxPart('right-forearm-mesh', [0.14, 0.36, 0.14], [0, -0.2, 0], material));
  leftThigh.add(createBoxPart('left-thigh-mesh', [0.18, 0.48, 0.18], [0, -0.26, 0], material));
  leftShin.add(createBoxPart('left-shin-mesh', [0.16, 0.44, 0.16], [0, -0.24, 0], material));
  leftFoot.add(createBoxPart('left-foot-mesh', [0.18, 0.1, 0.32], [0, -0.03, 0.08], material));
  rightThigh.add(createBoxPart('right-thigh-mesh', [0.18, 0.48, 0.18], [0, -0.26, 0], material));
  rightShin.add(createBoxPart('right-shin-mesh', [0.16, 0.44, 0.16], [0, -0.24, 0], material));
  rightFoot.add(createBoxPart('right-foot-mesh', [0.18, 0.1, 0.32], [0, -0.03, 0.08], material));

  return root;
}

function createBone(name: string, x: number, y: number, z: number): Bone {
  const bone = new Bone();
  bone.name = name;
  bone.position.set(x, y, z);
  return bone;
}

function createBoxPart(
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  material: MeshStandardMaterial,
): Mesh {
  const mesh = new Mesh(new BoxGeometry(size[0], size[1], size[2]), material);
  mesh.name = name;
  mesh.position.set(position[0], position[1], position[2]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createHeadPart(material: MeshStandardMaterial): Mesh {
  const mesh = new Mesh(new SphereGeometry(0.24, 12, 10), material);
  mesh.name = 'head-mesh';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
