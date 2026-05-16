import type { AssetManager } from "./assets/AssetManager";
import type { AudioSystem } from "./audio/AudioSystem";
import type { PositionalSoundManager } from "./audio/PositionalSoundManager";
import type { SoundManager } from "./audio/SoundManager";
import type { Gizmos } from "./debug/Gizmos";
import type { PhysicsWorld } from "./physics/PhysicsWorld";
import type { Raycast } from "./physics/Raycast";
import type { CameraSystem } from "./render/CameraSystem";
import type { EnvironmentSystem } from "./render/EnvironmentSystem";
import type { LightingSystem } from "./render/LightingSystem";
import type { Renderer } from "./render/Renderer";
import type { Input } from "./Input";
import type { ResourceManager } from "./ResourceManager";
import type { SceneManager } from "./SceneManager";
import { ServiceToken } from "./ServiceContainer";

/**
 * Tokens canónicos para los servicios genéricos del motor.
 *
 * La capa de juego importa estos tokens para resolver subsistemas del
 * engine desde el `ServiceContainer` sin acoplarse a su construcción.
 * Los servicios específicos de contenido viven en `game/ServiceTokens.ts`.
 */
export const EngineTokens = {
  Resources: new ServiceToken<ResourceManager>("ResourceManager"),
  Assets: new ServiceToken<AssetManager>("AssetManager"),
  Scene: new ServiceToken<SceneManager>("SceneManager"),
  Renderer: new ServiceToken<Renderer>("Renderer"),
  Camera: new ServiceToken<CameraSystem>("CameraSystem"),
  Lighting: new ServiceToken<LightingSystem>("LightingSystem"),
  Environment: new ServiceToken<EnvironmentSystem>("EnvironmentSystem"),
  Physics: new ServiceToken<PhysicsWorld>("PhysicsWorld"),
  Raycast: new ServiceToken<Raycast>("Raycast"),
  Input: new ServiceToken<Input>("Input"),
  Audio: new ServiceToken<AudioSystem>("AudioSystem"),
  Sound: new ServiceToken<SoundManager>("SoundManager"),
  PositionalSound: new ServiceToken<PositionalSoundManager>(
    "PositionalSoundManager",
  ),
  Gizmos: new ServiceToken<Gizmos>("Gizmos"),
} as const;
