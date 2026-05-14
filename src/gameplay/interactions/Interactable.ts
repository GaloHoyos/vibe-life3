import type { Object3D } from 'three';

export interface Interactable {
  id: string;
  label: string;
  object: Object3D;
  maxDistance: number;
  interact(): void;
}
