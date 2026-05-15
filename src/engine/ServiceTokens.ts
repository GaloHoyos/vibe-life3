import type { AssetManager } from "./assets/AssetManager";
import type { AudioSystem } from "./audio/AudioSystem";
import type { BackgroundAmbienceSystem } from "./audio/BackgroundAmbienceSystem";
import type { DialogueAudioSystem } from "./audio/DialogueAudioSystem";
import type { EnemySoundSystem } from "./audio/EnemySoundSystem";
import type { FootstepSoundSystem } from "./audio/FootstepSoundSystem";
import type { MusicManager } from "./audio/MusicManager";
import type { PositionalSoundManager } from "./audio/PositionalSoundManager";
import type { SoundManager } from "./audio/SoundManager";
import type { UISoundSystem } from "./audio/UISoundSystem";
import type { WeaponSoundSystem } from "./audio/WeaponSoundSystem";
import type { CharacterFactory } from "../characters/CharacterFactory";
import type { DebugOverlay } from "./debug/DebugOverlay";
import type { Gizmos } from "./debug/Gizmos";
import type { InteractSystem } from "../gameplay/interactions";
import type { WeaponEffects } from "../gameplay/weapons/WeaponEffects";
import type { TriggerSystem } from "../levels/TriggerSystem";
import type { DialogueSystem } from "../narrative/DialogueSystem";
import type { PhysicsWorld } from "./physics/PhysicsWorld";
import type { Raycast } from "./physics/Raycast";
import type { CameraSystem } from "./render/CameraSystem";
import type { LightingSystem } from "./render/LightingSystem";
import type { Renderer } from "./render/Renderer";
import type { HUD } from "../ui/HUD";
import type { MainMenu } from "../ui/menu/MainMenu";
import type { Subtitles } from "../ui/Subtitles";
import type { EventBus } from "./EventBus";
import type { GameEventMap } from "./GameEvents";
import type { Input } from "./Input";
import type { ResourceManager } from "./ResourceManager";
import type { SceneManager } from "./SceneManager";
import { ServiceToken } from "./ServiceContainer";

/**
 * Tokens canónicos para todos los servicios del motor.
 *
 * La capa de juego importa estos tokens para resolver servicios desde el
 * `ServiceContainer` sin acoplarse a la construcción del Engine.
 */
export const Tokens = {
  EventBus: new ServiceToken<EventBus<GameEventMap>>("EventBus"),
  Resources: new ServiceToken<ResourceManager>("ResourceManager"),
  Assets: new ServiceToken<AssetManager>("AssetManager"),
  Characters: new ServiceToken<CharacterFactory>("CharacterFactory"),
  Scene: new ServiceToken<SceneManager>("SceneManager"),
  Renderer: new ServiceToken<Renderer>("Renderer"),
  Camera: new ServiceToken<CameraSystem>("CameraSystem"),
  Lighting: new ServiceToken<LightingSystem>("LightingSystem"),
  Physics: new ServiceToken<PhysicsWorld>("PhysicsWorld"),
  Raycast: new ServiceToken<Raycast>("Raycast"),
  Input: new ServiceToken<Input>("Input"),
  HUD: new ServiceToken<HUD>("HUD"),
  Subtitles: new ServiceToken<Subtitles>("Subtitles"),
  Dialogue: new ServiceToken<DialogueSystem>("DialogueSystem"),
  WeaponEffects: new ServiceToken<WeaponEffects>("WeaponEffects"),
  DebugOverlay: new ServiceToken<DebugOverlay>("DebugOverlay"),
  Gizmos: new ServiceToken<Gizmos>("Gizmos"),
  InteractSystem: new ServiceToken<InteractSystem>("InteractSystem"),
  TriggerSystem: new ServiceToken<TriggerSystem>("TriggerSystem"),
  MainMenu: new ServiceToken<MainMenu>("MainMenu"),
  Audio: new ServiceToken<AudioSystem>("AudioSystem"),
  Sound: new ServiceToken<SoundManager>("SoundManager"),
  BackgroundAmbience: new ServiceToken<BackgroundAmbienceSystem>(
    "BackgroundAmbienceSystem",
  ),
  Music: new ServiceToken<MusicManager>("MusicManager"),
  PositionalSound: new ServiceToken<PositionalSoundManager>(
    "PositionalSoundManager",
  ),
  Footsteps: new ServiceToken<FootstepSoundSystem>("FootstepSoundSystem"),
  WeaponSounds: new ServiceToken<WeaponSoundSystem>("WeaponSoundSystem"),
  EnemySounds: new ServiceToken<EnemySoundSystem>("EnemySoundSystem"),
  DialogueSounds: new ServiceToken<DialogueAudioSystem>("DialogueAudioSystem"),
  UISounds: new ServiceToken<UISoundSystem>("UISoundSystem"),
} as const;
