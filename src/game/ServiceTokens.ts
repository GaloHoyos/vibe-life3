import type { EventBus } from "@engine/core/EventBus";
import { ServiceToken } from "@engine/core/ServiceContainer";
import type { BackgroundAmbienceSystem } from "@engine/audio/systems/BackgroundAmbienceSystem";
import type { AcousticSpaceSystem } from "@engine/audio/spatial/AcousticSpaceSystem";
import type { AmbientSoundSystem } from "@game/audio/AmbientSoundSystem";
import type { FootstepSoundSystem } from "@engine/audio/systems/FootstepSoundSystem";
import type { MusicManager } from "@engine/audio/core/MusicManager";
import type { CharacterFactory } from "@game/characters/CharacterFactory";
import type { Controls } from "@game/gameplay/player/Controls";
import type { DifficultyService } from "@game/gameplay/difficulty/DifficultyService";
import type { DialogueAudioSystem } from "@game/audio/DialogueAudioSystem";
import type { DoorSoundSystem } from "@game/audio/DoorSoundSystem";
import type { EnemySoundSystem } from "@game/audio/EnemySoundSystem";
import type { HevSuitSoundSystem } from "@game/audio/HevSuitSoundSystem";
import type { ImpactSoundSystem } from "@game/audio/ImpactSoundSystem";
import type { PlayerSoundSystem } from "@game/audio/PlayerSoundSystem";
import type { PropCollisionSoundSystem } from "@game/audio/PropCollisionSoundSystem";
import type { SoundscapeSystem } from "@game/audio/SoundscapeSystem";
import type { UISoundSystem } from "@game/audio/UISoundSystem";
import type { WeaponSoundSystem } from "@game/audio/WeaponSoundSystem";
import type { GameEventMap } from "./GameEvents";
import type { DialogueSystem } from "@game/narrative/DialogueSystem";
import type { GrabSystem, InteractSystem } from "@game/gameplay/interactions";
import type { TriggerSystem } from "@game/levels/TriggerSystem";
import type { EntityIOSystem } from "@game/script/EntityIOSystem";
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
import type { PropSystem } from "@game/gameplay/props/PropSystem";
import type { PropAssetRegistry } from "@game/assets/props/PropAssetRegistry";
import type { PropContactMonitor } from "@game/gameplay/props/PropContactMonitor";
import type { PropScrapeSystem } from "@game/audio/PropScrapeSystem";
import type { PropDeformationSystem } from "@game/gameplay/props/PropDeformationSystem";
import type { PropStructureSystem } from "@game/gameplay/props/PropStructureSystem";
import type { PropBreakSystem } from "@game/gameplay/props/PropBreakSystem";
import type { PropImpactSystem } from "@game/gameplay/combat/PropImpactSystem";
import type { PlayerSquadService } from "@game/gameplay/squad/PlayerSquadService";
import type { ScopeOverlay } from "@game/ui/overlay/ScopeOverlay";
import type { DebugMenu } from "@game/ui/overlay/debug/DebugMenu";
import type { HUD } from "@game/ui/hud/HUD";
import type { Subtitles } from "@game/ui/subtitles/Subtitles";
import type { MainMenu } from "@game/ui/menu/MainMenu";
import type { LevelEditor } from "@game/editor/LevelEditor";
import type { WorkshopService } from "@game/workshop/WorkshopService";
import type { VehicleSystem } from "@game/gameplay/vehicles/VehicleSystem";
import type {
  IndexedDbSaveStorage,
  SaveCoordinator,
  SaveEntityRegistry,
  SaveRepository,
} from "@game/save";

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
  Props: new ServiceToken<PropSystem>("PropSystem"),
  PropAssets: new ServiceToken<PropAssetRegistry>("PropAssetRegistry"),
  PropContacts: new ServiceToken<PropContactMonitor>("PropContactMonitor"),
  PropScrapeSounds: new ServiceToken<PropScrapeSystem>("PropScrapeSystem"),
  PropDeformation: new ServiceToken<PropDeformationSystem>("PropDeformationSystem"),
  PropStructures: new ServiceToken<PropStructureSystem>("PropStructureSystem"),
  PropBreaks: new ServiceToken<PropBreakSystem>("PropBreakSystem"),
  PropImpacts: new ServiceToken<PropImpactSystem>("PropImpactSystem"),
  PlayerSquad: new ServiceToken<PlayerSquadService>("PlayerSquadService"),
  Vehicles: new ServiceToken<VehicleSystem>("VehicleSystem"),
  InteractSystem: new ServiceToken<InteractSystem>("InteractSystem"),
  GrabSystem: new ServiceToken<GrabSystem>("GrabSystem"),
  TriggerSystem: new ServiceToken<TriggerSystem>("TriggerSystem"),
  EntityIO: new ServiceToken<EntityIOSystem>("EntityIOSystem"),
  CheckpointSystem: new ServiceToken<CheckpointSystem>("CheckpointSystem"),
  HazardVolumes: new ServiceToken<HazardVolumeSystem>("HazardVolumeSystem"),
  HUD: new ServiceToken<HUD>("HUD"),
  ScopeOverlay: new ServiceToken<ScopeOverlay>("ScopeOverlay"),
  MainMenu: new ServiceToken<MainMenu>("MainMenu"),
  DebugMenu: new ServiceToken<DebugMenu>("DebugMenu"),
  LevelEditor: new ServiceToken<LevelEditor>("LevelEditor"),
  Workshop: new ServiceToken<WorkshopService>("WorkshopService"),
  SaveStorage: new ServiceToken<IndexedDbSaveStorage>("IndexedDbSaveStorage"),
  SaveRepository: new ServiceToken<SaveRepository>("SaveRepository"),
  SaveEntities: new ServiceToken<SaveEntityRegistry>("SaveEntityRegistry"),
  Saves: new ServiceToken<SaveCoordinator>("SaveCoordinator"),
  BackgroundAmbience: new ServiceToken<BackgroundAmbienceSystem>(
    "BackgroundAmbienceSystem",
  ),
  Soundscapes: new ServiceToken<SoundscapeSystem>("SoundscapeSystem"),
  Acoustics: new ServiceToken<AcousticSpaceSystem>("AcousticSpaceSystem"),
  AmbientSounds: new ServiceToken<AmbientSoundSystem>("AmbientSoundSystem"),
  Music: new ServiceToken<MusicManager>("MusicManager"),
  Footsteps: new ServiceToken<FootstepSoundSystem>("FootstepSoundSystem"),
  WeaponSounds: new ServiceToken<WeaponSoundSystem>("WeaponSoundSystem"),
  EnemySounds: new ServiceToken<EnemySoundSystem>("EnemySoundSystem"),
  DialogueSounds: new ServiceToken<DialogueAudioSystem>("DialogueAudioSystem"),
  HevSuitSounds: new ServiceToken<HevSuitSoundSystem>("HevSuitSoundSystem"),
  UISounds: new ServiceToken<UISoundSystem>("UISoundSystem"),
  ImpactSounds: new ServiceToken<ImpactSoundSystem>("ImpactSoundSystem"),
  PropCollisionSounds: new ServiceToken<PropCollisionSoundSystem>(
    "PropCollisionSoundSystem",
  ),
  DoorSounds: new ServiceToken<DoorSoundSystem>("DoorSoundSystem"),
  PlayerSounds: new ServiceToken<PlayerSoundSystem>("PlayerSoundSystem"),
} as const;
