import type { AssetManager } from "@engine/assets/AssetManager";
import type { AudioSystem } from "@engine/audio/core/AudioSystem";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { Gizmos } from "@engine/debug/Gizmos";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import type { CameraSystem } from "@engine/render/CameraSystem";
import type { EnvironmentSystem } from "@engine/render/environment/EnvironmentSystem";
import type { LightingSystem } from "@engine/render/environment/LightingSystem";
import type { Renderer } from "@engine/render/Renderer";
import type { Input } from "@engine/input/Input";
import type { ResourceManager } from "./ResourceManager";
import type { SceneManager } from "./SceneManager";
import { ServiceToken } from "./ServiceContainer";

/**
 * Tokens canÃ³nicos para los servicios genÃ©ricos del motor.
 *
 * La capa de juego importa estos tokens para resolver subsistemas del
 * engine desde el `ServiceContainer` sin acoplarse a su construcciÃ³n.
 * Los servicios especÃ­ficos de contenido viven en `game/ServiceTokens.ts`.
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
