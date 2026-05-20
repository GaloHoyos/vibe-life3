import type { Vector3 } from "three";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { EventBus } from "@engine/core/EventBus";
import type { WeaponId, WeaponType } from "@game/gameplay/weapons/core/WeaponDefinition";

/** Snapshot del estado del selector que se publica al HUD. */
export interface WeaponSelectorItemState {
  id: WeaponId;
  disabled: boolean;
}

export interface WeaponSelectorState {
  /** Por slot, las armas que el jugador tiene equipadas, en orden canÃ³nico. */
  slots: Array<{ slot: number; weapons: WeaponSelectorItemState[] }>;
  /** Slot actualmente abierto. */
  activeSlot: number;
  /** Arma tentativamente seleccionada (la que se equiparÃ¡ al confirmar). */
  tentativeId: WeaponId;
}

export interface GameEventMap {
  "weapon.fired": {
    weaponName: string;
    weaponType: WeaponType;
    ammo: number;
    origin: Vector3;
    direction: Vector3;
    range: number;
  };
  /**
   * Secundario distinto del primario (ej. lanzagranadas del SMG). El audio
   * usa este evento para reproducir un clip aparte. Las armas cuyo
   * secundario reusa el mismo sonido del primario emiten `weapon.fired`.
   */
  "weapon.alternate.fired": {
    weaponName: string;
    origin: Vector3;
    direction: Vector3;
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
  /**
   * Sonido mecnico discreto despus de un evento (pump-action de la
   * shotgun tras disparar y tras recargar el ltimo cartucho). El
   * `WeaponSoundSystem` lo mapea a `WeaponAudio[name].cock`.
   */
  "weapon.cocked": {
    weaponName: string;
  };
  "weapon.ammo.changed": {
    weaponId?: WeaponId;
    current: number;
    reserve: number;
  };
  "weapon.changed": {
    weaponId?: WeaponId;
    weaponName: string;
    ammo: number;
    reserve: number;
    secondaryAmmo?: number;
  };
  "weapon.selector.opened": WeaponSelectorState;
  "weapon.selector.cycled": WeaponSelectorState;
  "weapon.selector.closed": {
    committed: boolean;
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
  /**
   * Un NPC vio un threat â€” broadcast a la facciÃ³n para que aliados cercanos
   * reciban la LKP. SÃ³lo NPCs hostiles a `threatFaction` deberÃ­an reaccionar.
   */
  "npc.threat.spotted": {
    spotterId: string;
    spotterFaction: import("../engine/ai/Faction").Faction;
    threatId: string;
    threatPosition: Vector3;
    spotterPosition: Vector3;
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
  /** El NPC dropea su arma en la posiciÃ³n indicada (tÃ­picamente al morir). */
  "npc.weapon.dropped": {
    npcId: string;
    weaponId: string;
    position: Vector3;
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
  "player.stamina.changed": {
    current: number;
    max: number;
    depleted: boolean;
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
  "debug.toggle": {
    enabled: boolean;
  };
}

export type GameEventBus = EventBus<GameEventMap>;
