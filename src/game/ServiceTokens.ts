import type { EventBus } from "@engine/core/EventBus";
import { ServiceToken } from "@engine/core/ServiceContainer";
import type { BackgroundAmbienceSystem } from "@engine/audio/systems/BackgroundAmbienceSystem";
import type { FootstepSoundSystem } from "@engine/audio/systems/FootstepSoundSystem";
import type { MusicManager } from "@engine/audio/core/MusicManager";
import type { CharacterFactory } from "@game/characters/CharacterFactory";
import type { Controls } from "@game/gameplay/player/Controls";
import type { DifficultyService } from "@game/gameplay/difficulty/DifficultyService";
import type { DialogueAudioSystem } from "@game/audio/DialogueAudioSystem";
import type { EnemySoundSystem } from "@game/audio/EnemySoundSystem";
import type { HevSuitSoundSystem } from "@game/audio/HevSuitSoundSystem";
import type { SoundscapeSystem } from "@game/audio/SoundscapeSystem";
import type { UISoundSystem } from "@game/audio/UISoundSystem";
import type { WeaponSoundSystem } from "@game/audio/WeaponSoundSystem";
import type { GameEventMap } from "./GameEvents";
import type { DialogueSystem } from "@game/narrative/DialogueSystem";
import type { GrabSystem, InteractSystem } from "@game/gameplay/interactions";
import type { TriggerSystem } from "@game/levels/TriggerSystem";
import type { CheckpointSystem } from "@game/levels/CheckpointSystem";
import type { HazardVolumeSystem } from "@game/levels/HazardVolumeSystem";
import type { WeaponEffects } from "@game/gameplay/weapons/effects/WeaponEffects";
import type { NpcBloodEffects } from "@game/gameplay/effects/NpcBloodEffects";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { RocketSystem } from "@game/gameplay/weapons/rocket/RocketSystem";
import type { BoltSystem } from "@game/gameplay/weapons/bolt/BoltSystem";
import type { EnergyBallSystem } from "@game/gameplay/weapons/energyball/EnergyBallSystem";
import type { IceGunSystem } from "@game/gameplay/weapons/ice/IceGunSystem";
import type { PortalGunSystem } from "@game/gameplay/weapons/portal/PortalGunSystem";
import type { ExplosiveBarrelSystem } from "@game/gameplay/hazards/ExplosiveBarrelSystem";
import type { PropImpactSystem } from "@game/gameplay/combat/PropImpactSystem";
import type { PlayerSquadService } from "@game/gameplay/squad/PlayerSquadService";
import type { ScopeOverlay } from "@game/ui/overlay/ScopeOverlay";
import type { DebugMenu } from "@game/ui/overlay/debug/DebugMenu";
import type { HUD } from "@game/ui/hud/HUD";
import type { Subtitles } from "@game/ui/subtitles/Subtitles";
import type { MainMenu } from "@game/ui/menu/MainMenu";
import type { LevelEditor } from "@game/editor/LevelEditor";
import type { WorkshopService } from "@game/workshop/WorkshopService";

/**
 * Tokens de servicios especificos del juego.
 *
 * Comparten el `ServiceContainer` con los `EngineTokens`, pero su
 * registro es responsabilidad de `Game`, no del motor.
 */
export const GameTokens = {
  EventBus: new ServiceToken<EventBus<GameEventMap>>("EventBus"),
  Controls: new ServiceToken<Controls>("Controls"),
  Difficulty: new ServiceToken<DifficultyService>("DifficultyService"),
  Characters: new ServiceToken<CharacterFactory>("CharacterFactory"),
  Subtitles: new ServiceToken<Subtitles>("Subtitles"),
  Dialogue: new ServiceToken<DialogueSystem>("DialogueSystem"),
  WeaponEffects: new ServiceToken<WeaponEffects>("WeaponEffects"),
  NpcBloodEffects: new ServiceToken<NpcBloodEffects>("NpcBloodEffects"),
  Grenades: new ServiceToken<GrenadeSystem>("GrenadeSystem"),
  Rockets: new ServiceToken<RocketSystem>("RocketSystem"),
  Bolts: new ServiceToken<BoltSystem>("BoltSystem"),
  EnergyBalls: new ServiceToken<EnergyBallSystem>("EnergyBallSystem"),
  IceGun: new ServiceToken<IceGunSystem>("IceGunSystem"),
  Portals: new ServiceToken<PortalGunSystem>("PortalGunSystem"),
  ExplosiveBarrels: new ServiceToken<ExplosiveBarrelSystem>("ExplosiveBarrelSystem"),
  PropImpacts: new ServiceToken<PropImpactSystem>("PropImpactSystem"),
  PlayerSquad: new ServiceToken<PlayerSquadService>("PlayerSquadService"),
  InteractSystem: new ServiceToken<InteractSystem>("InteractSystem"),
  GrabSystem: new ServiceToken<GrabSystem>("GrabSystem"),
  TriggerSystem: new ServiceToken<TriggerSystem>("TriggerSystem"),
  CheckpointSystem: new ServiceToken<CheckpointSystem>("CheckpointSystem"),
  HazardVolumes: new ServiceToken<HazardVolumeSystem>("HazardVolumeSystem"),
  HUD: new ServiceToken<HUD>("HUD"),
  ScopeOverlay: new ServiceToken<ScopeOverlay>("ScopeOverlay"),
  MainMenu: new ServiceToken<MainMenu>("MainMenu"),
  DebugMenu: new ServiceToken<DebugMenu>("DebugMenu"),
  LevelEditor: new ServiceToken<LevelEditor>("LevelEditor"),
  Workshop: new ServiceToken<WorkshopService>("WorkshopService"),
  BackgroundAmbience: new ServiceToken<BackgroundAmbienceSystem>(
    "BackgroundAmbienceSystem",
  ),
  Soundscapes: new ServiceToken<SoundscapeSystem>("SoundscapeSystem"),
  Music: new ServiceToken<MusicManager>("MusicManager"),
  Footsteps: new ServiceToken<FootstepSoundSystem>("FootstepSoundSystem"),
  WeaponSounds: new ServiceToken<WeaponSoundSystem>("WeaponSoundSystem"),
  EnemySounds: new ServiceToken<EnemySoundSystem>("EnemySoundSystem"),
  DialogueSounds: new ServiceToken<DialogueAudioSystem>("DialogueAudioSystem"),
  HevSuitSounds: new ServiceToken<HevSuitSoundSystem>("HevSuitSoundSystem"),
  UISounds: new ServiceToken<UISoundSystem>("UISoundSystem"),
} as const;
