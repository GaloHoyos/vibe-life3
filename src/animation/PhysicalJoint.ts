import type RAPIER from '@dimforge/rapier3d-compat';
import type { Vector3 } from 'three';

export interface PhysicalJoint {
  name: string;
  parentName: string;
  childName: string;
  joint?: RAPIER.ImpulseJoint;
  localAnchorToParent: Vector3;
  localAnchorToChild: Vector3;
  mode: 'spherical' | 'fixed-fallback';
}
