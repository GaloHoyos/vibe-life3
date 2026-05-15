import type { Vector3 } from "three";
import type { CharacterId } from "../engine/characters/CharacterDefinition";
import type { EventBus } from "../engine/EventBus";

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
    characterId: CharacterId;
    amount: number;
    health: number;
  };
  "npc.alert": {
    id: string;
    characterId: CharacterId;
  };
  "npc.attack": {
    id: string;
    characterId: CharacterId;
  };
  "npc.footstep": {
    id: string;
    characterId: CharacterId;
    position?: Vector3;
  };
  "npc.killed": {
    id: string;
    characterId: CharacterId;
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
