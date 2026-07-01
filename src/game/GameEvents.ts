import type { Vector3 } from "three";
import type { Faction } from "@engine/ai/Faction";
import type { CharacterId } from "@engine/characters/CharacterDefinition";
import type { EventBus } from "@engine/core/EventBus";
import type { WeaponId, WeaponType } from "@game/gameplay/weapons/core/WeaponDefinition";
import type { TriggerAction } from "@game/levels/LevelDefinition";
import type { HazardKind } from "@game/levels/HazardVolumeSystem";

export type LevelActionKind = "respawnEncounters" | "spawnAllWeapons";
export type CombatEventSourceKind = "player" | "npc" | "system";

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
    sourceId?: string;
    sourceKind?: CombatEventSourceKind;
    sourceFaction?: Faction;
  };
  /**
   * Tracer suelto, desacoplado del sonido/flash de `weapon.fired`. Lo usan las
   * armas que disparan varios rayos por trigger (escopeta = un tracer por
   * perdigón) sin querer N gunshots. El `WeaponEffects` dibuja la línea.
   */
  "weapon.tracer": {
    origin: Vector3;
    direction: Vector3;
    range: number;
    sourceId?: string;
    sourceKind?: CombatEventSourceKind;
    sourceFaction?: Faction;
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
    sourceId?: string;
    sourceKind?: CombatEventSourceKind;
    sourceFaction?: Faction;
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
    sourceId?: string;
    sourceKind?: CombatEventSourceKind;
    sourceFaction?: Faction;
  };
  "strider.cannon.impact": {
    point: Vector3;
    /** Boca del cañón al disparar — origen del tracer. */
    origin: Vector3;
    normal?: Vector3;
    damage: number;
    radius: number;
    impulse: number;
    sourceId: string;
    sourceFaction: Faction;
  };
  "weapon.reloaded": {
    weaponName: string;
    ammo: number;
    reserve: number;
  };
  "weapon.empty": {
    weaponName: string;
  };
  /** El arma activa entró/salió de mira telescópica (scope del crossbow). */
  "weapon.scope.changed": {
    active: boolean;
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
  "level.action": {
    id: string;
    action: LevelActionKind;
    position: Vector3;
  };
  "npc.damaged": {
    id: string;
    characterId: CharacterId;
    amount: number;
    health: number;
    point?: Vector3;
    direction?: Vector3;
    bodyPart?: string;
    attackerId?: string;
  };
  "npc.alert": {
    id: string;
    characterId: CharacterId;
    /** Posición del NPC, para reproducir la vocalización en 3D. */
    position?: Vector3;
  };
  /**
   * Un NPC vio un threat â€” broadcast a la facciÃ³n para que aliados cercanos
   * reciban la LKP. SÃ³lo NPCs hostiles a `threatFaction` deberÃ­an reaccionar.
   */
  "npc.threat.spotted": {
    spotterId: string;
    spotterFaction: Faction;
    threatId: string;
    threatPosition: Vector3;
    spotterPosition: Vector3;
  };
  "world.noise": {
    kind: "gunshot" | "explosion" | "impact" | "movement";
    position: Vector3;
    radius: number;
    sourceId?: string;
    sourceFaction?: Faction;
  };
  "npc.attack": {
    id: string;
    characterId: CharacterId;
    /** Posición del NPC, para reproducir el sonido de ataque en 3D. */
    position?: Vector3;
  };
  /** El NPC entra en fase de carga/telegraph de un ataque (e.g. cañón del strider). */
  "npc.charge": {
    id: string;
    characterId: CharacterId;
    /** Posición del NPC, para reproducir el sonido de carga en 3D. */
    position?: Vector3;
  };
  "npc.footstep": {
    id: string;
    characterId: CharacterId;
    position?: Vector3;
  };
  "npc.killed": {
    id: string;
    characterId: CharacterId;
    /** Posición del NPC al morir, para reproducir el sonido de muerte en 3D. */
    position?: Vector3;
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
  /**
   * Una acción de un trigger quedó lista para ejecutarse (ya pasó su `delay`).
   * `Game` la despacha; el `TriggerSystem` no conoce la lógica del juego.
   */
  "trigger.action": {
    triggerId: string;
    action: TriggerAction;
    position: Vector3;
  };
  /** El jugador cruzó un volumen de checkpoint. `position` = punto de reaparición. */
  "checkpoint.reached": {
    id: string;
    position: Vector3;
  };
  "dialogue.show": {
    speaker?: string;
    text: string;
    duration: number;
  };
  /**
   * Objetivo actual del jugador. `text` vacío oculta el panel. `completed`
   * marca el objetivo como cumplido (flash + fade). `marker` ubica un waypoint
   * world-space para la brújula del HUD; `null` lo limpia.
   */
  "objective.updated": {
    text: string;
    completed?: boolean;
    marker?: Vector3 | null;
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
  /**
   * Daño de un volumen de peligro (kill-volume). `HazardVolumeSystem` lo emite
   * en ticks mientras el jugador está adentro; `Game` lo aplica a la vida.
   * `instant` = letal inmediato (vacío).
   */
  "player.hazard": {
    amount: number;
    kind: HazardKind;
    instant: boolean;
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
  "workshop.list.loaded": {
    count: number;
  };
  "workshop.subscribed": {
    id: string;
    title: string;
  };
  "workshop.unsubscribed": {
    id: string;
  };
  "workshop.enabled": {
    id: string;
    enabled: boolean;
  };
  "workshop.published": {
    id: string;
    title: string;
  };
  "workshop.rated": {
    id: string;
    rating: number;
  };
  "workshop.commented": {
    id: string;
  };
  "workshop.error": {
    action: string;
    message: string;
  };
}

export type GameEventBus = EventBus<GameEventMap>;
