import type { Vector3 } from "three";
import type { EventBus } from "./EventBus";

export interface GameEventMap {
  "weapon.fired": {
    weaponName: string;
    ammo: number;
    origin: Vector3;
    direction: Vector3;
    range: number;
  };
  "weapon.hit": {
    weaponName: string;
    targetId?: string;
    surfaceKind?:
      | "static"
      | "dynamic"
      | "door"
      | "npc"
      | "player"
      | "ragdoll"
      | "weaponPickup";
    point: Vector3;
    normal?: Vector3;
    damage: number;
  };
  "weapon.reloaded": {
    weaponName: string;
    ammo: number;
    reserve: number;
  };
  "weapon.empty": {
    weaponName: string;
  };
  "ammo.changed": {
    current: number;
    reserve: number;
  };
  "weapon.ammo.changed": {
    current: number;
    reserve: number;
  };
  "weapon.changed": {
    weaponName: string;
    ammo: number;
    reserve: number;
  };
  "npc.damaged": {
    id: string;
    amount: number;
    health: number;
  };
  "npc.alert": {
    id: string;
  };
  "npc.attack": {
    id: string;
  };
  "npc.footstep": {
    id: string;
    position?: Vector3;
  };
  "npc.killed": {
    id: string;
  };
  "door.opened": {
    id: string;
    open: boolean;
  };
  "trigger.entered": {
    id: string;
  };
  "dialogue.show": {
    speaker?: string;
    text: string;
    duration: number;
  };
  "player.healthChanged": {
    current: number;
    max: number;
  };
  "player.health.changed": {
    current: number;
    max: number;
  };
  "player.armor.changed": {
    current: number;
    max: number;
  };
  "player.damaged": {
    amount: number;
    direction?: Vector3;
  };
  "player.dead": {
    reason: string;
  };
  "player.pickup.health": {
    amount: number;
  };
  "player.pickup.ammo": {
    amount: number;
    weaponName?: string;
  };
  "player.pickup.weapon": {
    weaponName: string;
  };
  "interact.changed": {
    label?: string;
  };
  "interaction.focus": {
    label: string;
  };
  "interaction.blur": Record<string, never>;
  "subtitle.show": {
    speaker?: string;
    text: string;
    duration: number;
  };
  "objective.updated": {
    text: string;
  };
  "debug.toggle": {
    enabled: boolean;
  };
}

export type GameEventBus = EventBus<GameEventMap>;
