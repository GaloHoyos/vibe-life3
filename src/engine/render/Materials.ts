import { MeshStandardMaterial } from 'three';

export type MaterialKey =
  | 'floor'
  | 'wall'
  | 'trim'
  | 'crate'
  | 'dynamic'
  | 'door'
  | 'button'
  | 'npc'
  | 'npcDead'
  | 'hazard'
  | 'snow'
  | 'rock'
  | 'grass';

const materials: Record<MaterialKey, MeshStandardMaterial> = {
  floor: new MeshStandardMaterial({ color: 0x28323a, roughness: 0.9, metalness: 0.15 }),
  wall: new MeshStandardMaterial({ color: 0x33424a, roughness: 0.82, metalness: 0.2 }),
  trim: new MeshStandardMaterial({ color: 0x668899, roughness: 0.55, metalness: 0.3 }),
  crate: new MeshStandardMaterial({ color: 0x56616a, roughness: 0.8, metalness: 0.1 }),
  dynamic: new MeshStandardMaterial({ color: 0x9bb7c2, roughness: 0.65, metalness: 0.15 }),
  door: new MeshStandardMaterial({ color: 0x40525d, roughness: 0.55, metalness: 0.45 }),
  button: new MeshStandardMaterial({ color: 0x25c6da, emissive: 0x07343a, roughness: 0.35 }),
  npc: new MeshStandardMaterial({ color: 0xd76157, roughness: 0.75, metalness: 0.05 }),
  npcDead: new MeshStandardMaterial({ color: 0x34383c, roughness: 0.95, metalness: 0.05 }),
  hazard: new MeshStandardMaterial({ color: 0xf2b84b, roughness: 0.6, metalness: 0.05 }),
  snow: new MeshStandardMaterial({ color: 0xe8eef4, roughness: 0.95, metalness: 0.02 }),
  rock: new MeshStandardMaterial({ color: 0x5a5f63, roughness: 0.92, metalness: 0.08 }),
  grass: new MeshStandardMaterial({ color: 0x4a6c3a, roughness: 0.88, metalness: 0.02 }),
};

export function getMaterial(key: MaterialKey): MeshStandardMaterial {
  return materials[key].clone();
}
