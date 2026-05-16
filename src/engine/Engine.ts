import { AssetManager } from "./assets/AssetManager";
import { AudioSystem } from "./audio/AudioSystem";
import { PositionalSoundManager } from "./audio/PositionalSoundManager";
import { SoundManager } from "./audio/SoundManager";
import { Gizmos } from "./debug/Gizmos";
import { PhysicsWorld } from "./physics/PhysicsWorld";
import { Raycast } from "./physics/Raycast";
import { CameraSystem } from "./render/CameraSystem";
import { EnvironmentSystem } from "./render/EnvironmentSystem";
import { LightingSystem } from "./render/LightingSystem";
import { Renderer } from "./render/Renderer";
import { GameLoop } from "./GameLoop";
import { Input } from "./Input";
import { ResourceManager } from "./ResourceManager";
import { SceneManager } from "./SceneManager";
import { ServiceContainer } from "./ServiceContainer";
import { EngineTokens } from "./ServiceTokens";
import type { Time } from "./Time";

/**
 * Núcleo del motor: orquesta los subsistemas genéricos (render, física,
 * input, audio, scene, assets) y expone un `ServiceContainer` que la capa
 * de juego utiliza para resolverlos.
 *
 * El motor no conoce nada del contenido (niveles, armas, NPCs, UI). Esos
 * elementos se inyectan desde la clase `Game`, que recibe esta instancia
 * y registra sus propios servicios.
 */
export class Engine {
  readonly root: HTMLDivElement;
  readonly services = new ServiceContainer();

  private readonly loop = new GameLoop();

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "game-root";
    container.append(this.root);

    this.registerServices();
  }

  /** Inicializa subsistemas asíncronos (Rapier, GLTFs, …). */
  async init(): Promise<void> {
    await this.services.resolve(EngineTokens.Physics).init();
  }

  /** Arranca el bucle principal con el callback de actualización del juego. */
  start(update: (time: Time) => void): void {
    this.loop.start(update);
  }

  stop(): void {
    this.loop.stop();
  }

  /**
   * Renderiza un frame. Útil cuando el game loop está pausado y el juego
   * quiere mantener la imagen viva (menús, transiciones).
   */
  renderFrame(): void {
    const renderer = this.services.resolve(EngineTokens.Renderer);
    const scene = this.services.resolve(EngineTokens.Scene);
    const camera = this.services.resolve(EngineTokens.Camera);
    renderer.render(scene.scene, camera.camera);
  }

  dispose(): void {
    this.loop.stop();
    this.services.resolve(EngineTokens.Input).dispose();
    this.services.resolve(EngineTokens.Environment).dispose();
    this.services.resolve(EngineTokens.Renderer).dispose();
    this.services.resolve(EngineTokens.Camera).dispose();
    this.services.clear();
  }

  // ---------------------------------------------------------------------------
  // Service registration
  // ---------------------------------------------------------------------------

  private registerServices(): void {
    const c = this.services;

    c.register(EngineTokens.Resources, new ResourceManager());
    c.register(EngineTokens.Assets, new AssetManager());

    const scene = c.register(EngineTokens.Scene, new SceneManager());
    const renderer = c.register(EngineTokens.Renderer, new Renderer(this.root));
    const camera = c.register(EngineTokens.Camera, new CameraSystem(this.root));
    c.register(EngineTokens.Lighting, new LightingSystem());
    c.register(EngineTokens.Environment, new EnvironmentSystem(renderer.renderer));

    const physics = c.register(EngineTokens.Physics, new PhysicsWorld());
    c.register(EngineTokens.Raycast, new Raycast(physics));
    c.register(EngineTokens.Input, new Input(renderer.canvas));

    const audio = c.register(EngineTokens.Audio, new AudioSystem());
    const sound = c.register(EngineTokens.Sound, new SoundManager(audio));
    c.register(
      EngineTokens.PositionalSound,
      new PositionalSoundManager(audio, sound, scene.scene, camera.camera),
    );

    c.register(EngineTokens.Gizmos, new Gizmos(scene.scene));
  }
}
