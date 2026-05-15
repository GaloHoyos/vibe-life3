import { Vector3 } from "three";
import type { NPC } from "../ai/NPC";
import { AssetManager } from "./assets/AssetManager";
import { AudioSystem } from "./audio/AudioSystem";
import { BackgroundAmbienceSystem } from "./audio/BackgroundAmbienceSystem";
import { DialogueAudioSystem } from "./audio/DialogueAudioSystem";
import { EnemySoundSystem } from "./audio/EnemySoundSystem";
import { FootstepSoundSystem } from "./audio/FootstepSoundSystem";
import { MusicManager } from "./audio/MusicManager";
import { PositionalSoundManager } from "./audio/PositionalSoundManager";
import { SoundManager } from "./audio/SoundManager";
import { UISoundSystem } from "./audio/UISoundSystem";
import { WeaponSoundSystem } from "./audio/WeaponSoundSystem";
import { CharacterFactory } from "../characters/CharacterFactory";
import { DebugOverlay } from "./debug/DebugOverlay";
import { Gizmos } from "./debug/Gizmos";
import { Player } from "../gameplay/Player";
import type { WeaponPickup } from "../gameplay/weapons/WeaponPickup";
import { WeaponEffects } from "../gameplay/weapons/WeaponEffects";
import { InteractSystem, type SlidingDoor } from "../gameplay/interactions";
import { DemoLevel } from "../levels/DemoLevel";
import { LevelLoader } from "../levels/LevelLoader";
import { TriggerSystem } from "../levels/TriggerSystem";
import { DialogueSystem } from "../narrative/DialogueSystem";
import { LevelEvents } from "../narrative/LevelEvents";
import { PhysicsWorld } from "./physics/PhysicsWorld";
import { Raycast } from "./physics/Raycast";
import { CameraSystem } from "./render/CameraSystem";
import { LightingSystem } from "./render/LightingSystem";
import { Renderer } from "./render/Renderer";
import { HUD } from "../ui/HUD";
import { Subtitles } from "../ui/Subtitles";
import { MainMenu } from "../ui/menu/MainMenu";
import type { GameMenuState } from "../ui/menu/MainMenuState";
import { EventBus } from "./EventBus";
import type { GameEventMap } from "./GameEvents";
import { GameLoop } from "./GameLoop";
import { Input } from "./Input";
import { ResourceManager } from "./ResourceManager";
import { SceneManager } from "./SceneManager";
import { ServiceContainer } from "./ServiceContainer";
import { Tokens } from "./ServiceTokens";
import type { Time } from "./Time";

/**
 * Orquestador raíz del motor.
 *
 * Su única responsabilidad es:
 *  - Construir e instalar los subsistemas del núcleo.
 *  - Registrarlos en un {@link ServiceContainer} para que el contenido
 *    los resuelva sin acoplarse a la construcción.
 *  - Correr el game loop con un orden explícito y mantenible.
 *
 * Las dependencias específicas del juego (`DemoLevel`, `Player`) viven
 * todavía aquí en esta fase del refactor y se moverán a una clase
 * `Game` separada en la siguiente etapa.
 */
export class Engine {
  private readonly root: HTMLDivElement;
  private readonly services = new ServiceContainer();
  private readonly loop = new GameLoop();

  private gameState: GameMenuState = "mainMenu";
  private player: Player | null = null;
  private npcs: NPC[] = [];
  private doors: SlidingDoor[] = [];
  private weaponPickups: WeaponPickup[] = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "game-root";
    container.append(this.root);

    this.registerCoreServices();
    this.registerAudioServices();
    this.registerGameplayServices();
    this.registerUiServices();

    this.services.resolve(Tokens.MainMenu).setDebugEnabled(
      this.services.resolve(Tokens.DebugOverlay).isEnabled(),
    );
    this.setGameState("mainMenu");
    this.bindBrowserEvents();
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  /** Carga el nivel inicial. Asíncrono porque Rapier y los assets lo son. */
  async init(): Promise<void> {
    const physics = this.services.resolve(Tokens.Physics);
    const sceneManager = this.services.resolve(Tokens.Scene);
    const lighting = this.services.resolve(Tokens.Lighting);
    const resources = this.services.resolve(Tokens.Resources);
    const eventBus = this.services.resolve(Tokens.EventBus);
    const interactSystem = this.services.resolve(Tokens.InteractSystem);
    const triggerSystem = this.services.resolve(Tokens.TriggerSystem);
    const characters = this.services.resolve(Tokens.Characters);
    const assets = this.services.resolve(Tokens.Assets);
    const raycast = this.services.resolve(Tokens.Raycast);
    const camera = this.services.resolve(Tokens.Camera);

    await physics.init();
    sceneManager.setBackground(DemoLevel.background);
    lighting.attach(sceneManager.scene);
    resources.register("level.demo", DemoLevel);

    const levelEvents = new LevelEvents(eventBus);
    const loader = new LevelLoader(
      sceneManager.scene,
      physics,
      eventBus,
      interactSystem,
      triggerSystem,
      characters,
      assets,
    );

    const loaded = await loader.load(DemoLevel);
    this.npcs = loaded.npcs;
    this.doors = loaded.doors;
    this.weaponPickups = loaded.weaponPickups;

    this.player = new Player(
      new Vector3(...DemoLevel.playerStart),
      physics,
      raycast,
      assets,
      sceneManager.scene,
      eventBus,
    );

    camera.syncToPosition(this.player.getEyePosition());
    levelEvents.announceLevel(DemoLevel.title);
  }

  start(): void {
    this.loop.start((time) => this.update(time));
  }

  dispose(): void {
    this.loop.stop();
    this.unbindBrowserEvents();
    this.services.resolve(Tokens.Dialogue).dispose();
    this.services.resolve(Tokens.WeaponEffects).dispose();
    this.player?.dispose();
    this.services.resolve(Tokens.HUD).dispose();
    this.services.resolve(Tokens.Input).dispose();
    this.services.resolve(Tokens.Renderer).dispose();
    this.services.resolve(Tokens.Camera).dispose();
    this.services.resolve(Tokens.EventBus).clear();
    this.services.clear();
  }

  // ---------------------------------------------------------------------------
  // Service installers — agrupan la construcción del constructor para que
  // la dependencia entre subsistemas quede explícita y localizada.
  // ---------------------------------------------------------------------------

  private registerCoreServices(): void {
    const c = this.services;

    const eventBus = c.register(Tokens.EventBus, new EventBus<GameEventMap>());
    c.register(Tokens.Resources, new ResourceManager());
    const assets = c.register(Tokens.Assets, new AssetManager());

    c.register(Tokens.Scene, new SceneManager());
    const renderer = c.register(Tokens.Renderer, new Renderer(this.root));
    c.register(Tokens.Camera, new CameraSystem(this.root));
    c.register(Tokens.Lighting, new LightingSystem());

    const physics = c.register(Tokens.Physics, new PhysicsWorld());
    c.register(Tokens.Raycast, new Raycast(physics));
    c.register(Tokens.Input, new Input(renderer.canvas));

    c.register(
      Tokens.Characters,
      new CharacterFactory(assets, physics, eventBus),
    );
  }

  private registerAudioServices(): void {
    const c = this.services;
    const eventBus = c.resolve(Tokens.EventBus);
    const scene = c.resolve(Tokens.Scene);
    const camera = c.resolve(Tokens.Camera);

    const audio = c.register(Tokens.Audio, new AudioSystem());
    const sound = c.register(Tokens.Sound, new SoundManager(audio));

    c.register(Tokens.BackgroundAmbience, new BackgroundAmbienceSystem(sound));
    c.register(Tokens.Music, new MusicManager(sound));
    c.register(
      Tokens.PositionalSound,
      new PositionalSoundManager(audio, sound, scene.scene, camera.camera),
    );
    c.register(Tokens.Footsteps, new FootstepSoundSystem(sound));
    c.register(Tokens.WeaponSounds, new WeaponSoundSystem(eventBus, sound));
    c.register(Tokens.EnemySounds, new EnemySoundSystem(eventBus, sound));
    c.register(Tokens.DialogueSounds, new DialogueAudioSystem(eventBus, sound));
    c.register(Tokens.UISounds, new UISoundSystem(eventBus, sound));
  }

  private registerGameplayServices(): void {
    const c = this.services;
    const eventBus = c.resolve(Tokens.EventBus);
    const scene = c.resolve(Tokens.Scene);
    const subtitles = c.register(Tokens.Subtitles, new Subtitles(this.root));

    c.register(Tokens.Dialogue, new DialogueSystem(eventBus, subtitles));
    c.register(Tokens.WeaponEffects, new WeaponEffects(scene.scene, eventBus));
    c.register(Tokens.InteractSystem, new InteractSystem(eventBus));
    c.register(Tokens.TriggerSystem, new TriggerSystem(eventBus));
  }

  private registerUiServices(): void {
    const c = this.services;
    const eventBus = c.resolve(Tokens.EventBus);
    const audio = c.resolve(Tokens.Audio);
    const scene = c.resolve(Tokens.Scene);

    c.register(Tokens.HUD, new HUD(this.root, eventBus));
    const debugOverlay = c.register(
      Tokens.DebugOverlay,
      new DebugOverlay(this.root, eventBus),
    );
    c.register(Tokens.Gizmos, new Gizmos(scene.scene));

    c.register(
      Tokens.MainMenu,
      new MainMenu(this.root, {
        onStartChapter: (chapterId) => this.startNewGame(chapterId),
        onResume: () => this.setGameState("playing"),
        onReturnToMain: () => this.setGameState("mainMenu"),
        onToggleDebug: (enabled) => debugOverlay.setEnabled(enabled),
        onVolumeChange: (bus, value) => audio.setVolume(bus, value),
        onGetVolume: (bus) => audio.getVolume(bus),
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  private update(time: Time): void {
    if (!this.player) {
      return;
    }

    const input = this.services.resolve(Tokens.Input);
    const debugOverlay = this.services.resolve(Tokens.DebugOverlay);
    const renderer = this.services.resolve(Tokens.Renderer);
    const sceneManager = this.services.resolve(Tokens.Scene);
    const camera = this.services.resolve(Tokens.Camera);

    if (input.wasKeyPressed("F3")) {
      debugOverlay.toggle();
    }

    if (input.wasKeyPressed("Escape") && this.gameState === "playing") {
      this.setGameState("paused");
    }

    if (this.gameState !== "playing") {
      renderer.render(sceneManager.scene, camera.camera);
      input.endFrame();
      return;
    }

    this.tickPlaying(time);

    renderer.render(sceneManager.scene, camera.camera);
    input.endFrame();
  }

  /** Tick completo cuando el juego está activo (no en menú/pausa). */
  private tickPlaying(time: Time): void {
    const player = this.player!;
    const input = this.services.resolve(Tokens.Input);
    const camera = this.services.resolve(Tokens.Camera);
    const physics = this.services.resolve(Tokens.Physics);
    const interactSystem = this.services.resolve(Tokens.InteractSystem);
    const triggerSystem = this.services.resolve(Tokens.TriggerSystem);
    const weaponEffects = this.services.resolve(Tokens.WeaponEffects);
    const subtitles = this.services.resolve(Tokens.Subtitles);
    const gizmos = this.services.resolve(Tokens.Gizmos);
    const footsteps = this.services.resolve(Tokens.Footsteps);
    const debugOverlay = this.services.resolve(Tokens.DebugOverlay);

    if (input.isPointerLocked()) {
      camera.updateLook(input);
      player.update(time.delta, input, camera, time.elapsed);
    }

    footsteps.update(time.delta, player.getMoveIntensity(input));

    const playerPosition = player.getPosition();
    this.weaponPickups.forEach((pickup) =>
      pickup.update(time.delta, playerPosition, player.weapons),
    );
    this.npcs.forEach((npc) => npc.update(time.delta, playerPosition, player));
    this.doors.forEach((door) => door.update(time.delta));
    physics.step(time.delta);
    this.npcs.forEach((npc) => npc.syncFromPhysics());

    camera.syncToPosition(player.getEyePosition());
    interactSystem.update(camera.camera.position, camera.getForwardDirection(), input);
    triggerSystem.update(playerPosition);
    subtitles.update(time.delta);
    weaponEffects.update(time.delta);
    gizmos.update(time.delta);

    debugOverlay.update({
      fps: time.fps,
      playerPosition,
      physicsBodies: physics.getBodyCount(),
      npcStates: this.npcs.map((npc) => `${npc.id}:${npc.getState()}`),
    });
  }

  // ---------------------------------------------------------------------------
  // State / browser glue
  // ---------------------------------------------------------------------------

  private bindBrowserEvents(): void {
    this.services
      .resolve(Tokens.Renderer)
      .canvas.addEventListener("click", this.handleCanvasClick);
    document.addEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
  }

  private unbindBrowserEvents(): void {
    this.services
      .resolve(Tokens.Renderer)
      .canvas.removeEventListener("click", this.handleCanvasClick);
    document.removeEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
  }

  private readonly handleCanvasClick = (): void => {
    this.services.resolve(Tokens.Audio).unlock();
    if (this.gameState === "playing") {
      this.services.resolve(Tokens.Input).requestPointerLock();
    }
  };

  private readonly handlePointerLockChange = (): void => {
    const input = this.services.resolve(Tokens.Input);
    if (!input.isPointerLocked() && this.gameState === "playing") {
      this.setGameState("paused");
    }
  };

  private setGameState(state: GameMenuState): void {
    this.gameState = state;
    const mainMenu = this.services.resolve(Tokens.MainMenu);
    const hud = this.services.resolve(Tokens.HUD);
    const input = this.services.resolve(Tokens.Input);
    const ambience = this.services.resolve(Tokens.BackgroundAmbience);

    mainMenu.setState(state);
    hud.setVisible(state === "playing");

    if (state === "playing") {
      mainMenu.setStatus("Sistema activo. Preparado para combate.");
      input.requestPointerLock();
    } else if (state === "mainMenu") {
      ambience.stopForLevel("demo");
    }
  }

  private startNewGame(chapterId: string): void {
    const mainMenu = this.services.resolve(Tokens.MainMenu);
    const audio = this.services.resolve(Tokens.Audio);
    const ambience = this.services.resolve(Tokens.BackgroundAmbience);

    mainMenu.setStatus("Cargando mapa de pruebas...");
    audio.unlock();
    ambience.startForLevel(chapterId);
    this.setGameState("playing");
  }
}
