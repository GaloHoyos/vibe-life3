import type { Vector3 } from 'three';
import type { EventBus } from './EventBus';

export interface GameEventMap {
  'weapon.fired': {
    weaponName: string;
    ammo: number;
    origin: Vector3;
    direction: Vector3;
  };
  'weapon.hit': {
    weaponName: string;
    targetId?: string;
    point: Vector3;
    damage: number;
  };
  'ammo.changed': {
    current: number;
    reserve: number;
  };
  'npc.damaged': {
    id: string;
    amount: number;
    health: number;
  };
  'npc.killed': {
    id: string;
  };
  'door.opened': {
    id: string;
    open: boolean;
  };
  'trigger.entered': {
    id: string;
  };
  'dialogue.show': {
    speaker?: string;
    text: string;
    duration: number;
  };
  'player.healthChanged': {
    current: number;
    max: number;
  };
  'interact.changed': {
    label?: string;
  };
  'debug.toggle': {
    enabled: boolean;
  };
}

export type GameEventBus = EventBus<GameEventMap>;
