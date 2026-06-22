import type { EventBus } from "@engine/core/EventBus";
import { ServiceToken } from "@engine/core/ServiceContainer";
import type { BackgroundAmbienceSystem } from "@engine/audio/systems/BackgroundAmbienceSystem";
import type { FootstepSoundSystem } from "@engine/audio/systems/FootstepSoundSystem";
import type { MusicManager } from "@engine/audio/core/MusicManager";
import type { CharacterFactory } from "@game/characters/CharacterFactory";
import type { Controls } from "@game/gameplay/player/Controls";
import type { DialogueAudioSystem } from "@game/audio/DialogueAudioSystem";
import type { EnemySoundSystem } from "@game/audio/EnemySoundSystem";
import type { UISoundSystem } from "@game/audio/UISoundSystem";
import type { WeaponSoundSystem } from "@game/audio/WeaponSoundSystem";
import type { GameEventMap } from "./GameEvents";
import type { DialogueSystem } from "@game/narrative/DialogueSystem";
import type { InteractSystem } from "@game/gameplay/interactions";
import type { TriggerSystem } from "@game/levels/TriggerSystem";
import type { WeaponEffects } from "@game/gameplay/weapons/effects/WeaponEffects";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { DebugMenu } from "@game/ui/overlay/debug/DebugMenu";
import type { HUD } from "@game/ui/hud/HUD";
import type { Subtitles } from "@game/ui/subtitles/Subtitles";
import type { MainMenu } from "@game/ui/menu/MainMenu";
import type { LevelEditor } from "@game/editor/LevelEditor";

/**
 * Tokens de servicios especificos del juego.
 *
 * Comparten el `ServiceContainer` con los `EngineTokens`, pero su
 * registro es responsabilidad de `Game`, no del motor.
 */
export const GameTokens = {
  EventBus: new ServiceToken<EventBus<GameEventMap>>("EventBus"),
  Controls: new ServiceToken<Controls>("Controls"),
  Characters: new ServiceToken<CharacterFactory>("CharacterFactory"),
  Subtitles: new ServiceToken<Subtitles>("Subtitles"),
  Dialogue: new ServiceToken<DialogueSystem>("DialogueSystem"),
  WeaponEffects: new ServiceToken<WeaponEffects>("WeaponEffects"),
  Grenades: new ServiceToken<GrenadeSystem>("GrenadeSystem"),
  InteractSystem: new ServiceToken<InteractSystem>("InteractSystem"),
  TriggerSystem: new ServiceToken<TriggerSystem>("TriggerSystem"),
  HUD: new ServiceToken<HUD>("HUD"),
  MainMenu: new ServiceToken<MainMenu>("MainMenu"),
  DebugMenu: new ServiceToken<DebugMenu>("DebugMenu"),
  LevelEditor: new ServiceToken<LevelEditor>("LevelEditor"),
  BackgroundAmbience: new ServiceToken<BackgroundAmbienceSystem>(
    "BackgroundAmbienceSystem",
  ),
  Music: new ServiceToken<MusicManager>("MusicManager"),
  Footsteps: new ServiceToken<FootstepSoundSystem>("FootstepSoundSystem"),
  WeaponSounds: new ServiceToken<WeaponSoundSystem>("WeaponSoundSystem"),
  EnemySounds: new ServiceToken<EnemySoundSystem>("EnemySoundSystem"),
  DialogueSounds: new ServiceToken<DialogueAudioSystem>("DialogueAudioSystem"),
  UISounds: new ServiceToken<UISoundSystem>("UISoundSystem"),
} as const;
