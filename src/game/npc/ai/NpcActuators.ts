import { Vector3 } from "three";

export interface NpcActuatorIntent {
  moveTarget: Vector3 | null;
  aimTarget: Vector3 | null;
  wantsMove: boolean;
  wantsFire: boolean;
  wantsReload: boolean;
  wantsCrouch: boolean;
  voiceLine: string | null;
}

export function createNpcActuatorIntent(): NpcActuatorIntent {
  return {
    moveTarget: null,
    aimTarget: null,
    wantsMove: false,
    wantsFire: false,
    wantsReload: false,
    wantsCrouch: false,
    voiceLine: null,
  };
}
