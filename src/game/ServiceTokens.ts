import type { EventBus } from "../engine/EventBus";
import { ServiceToken } from "../engine/ServiceContainer";
import type { BackgroundAmbienceSystem } from "../engine/audio/BackgroundAmbienceSystem";
import type { FootstepSoundSystem } from "../engine/audio/FootstepSoundSystem";
import type { MusicManager } from "../engine/audio/MusicManager";
import type { CharacterFactory } from "./characters/CharacterFactory";
import type { DialogueAudioSystem } from "./audio/DialogueAudioSystem";
import type { EnemySoundSystem } from "./audio/EnemySoundSystem";
import type { UISoundSystem } from "./audio/UISoundSystem";
import type { WeaponSoundSystem } from "./audio/WeaponSoundSystem";
import type { GameEventMap } from "./GameEvents";
import type { DialogueSystem } from "./narrative/DialogueSystem";
import type { InteractSystem } from "./gameplay/interactions";
import type { TriggerSystem } from "./levels/TriggerSystem";
import type { WeaponEffects } from "./gameplay/weapons/WeaponEffects";
import type { DebugOverlay } from "./ui/DebugOverlay";
import type { HUD } from "./ui/HUD";
import type { Subtitles } from "./ui/Subtitles";
import type { MainMenu } from "./ui/menu/MainMenu";

/**
 * Tokens de servicios específicos del juego.
 *
 * Comparten el `ServiceContainer` con los `EngineTokens`, pero su
 * registro es responsabilidad de `Game`, no del motor.
 */
export const GameTokens = {
  EventBus: new ServiceToken<EventBus<GameEventMap>>("EventBus"),
  Characters: new ServiceToken<CharacterFactory>("CharacterFactory"),
  Subtitles: new ServiceToken<Subtitles>("Subtitles"),
  Dialogue: new ServiceToken<DialogueSystem>("DialogueSystem"),
  WeaponEffects: new ServiceToken<WeaponEffects>("WeaponEffects"),
  InteractSystem: new ServiceToken<InteractSystem>("InteractSystem"),
  TriggerSystem: new ServiceToken<TriggerSystem>("TriggerSystem"),
  HUD: new ServiceToken<HUD>("HUD"),
  MainMenu: new ServiceToken<MainMenu>("MainMenu"),
  DebugOverlay: new ServiceToken<DebugOverlay>("DebugOverlay"),
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
