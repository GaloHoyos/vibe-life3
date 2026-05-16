import { Vector3 } from "three";
import { BackgroundAmbienceSystem } from "../engine/audio/BackgroundAmbienceSystem";
import { FootstepSoundSystem } from "../engine/audio/FootstepSoundSystem";
import { MusicManager } from "../engine/audio/MusicManager";
import type { Engine } from "../engine/Engine";
import { EventBus } from "../engine/EventBus";
import { EngineTokens } from "../engine/ServiceTokens";
import type { Time } from "../engine/Time";
import { CharacterFactory } from "./characters/CharacterFactory";
import { FootstepsConfig } from "./config/audio.config";
import { MenuStrings } from "./config/strings";
import { DialogueAudioSystem } from "./audio/DialogueAudioSystem";
import { EnemySoundSystem } from "./audio/EnemySoundSystem";
import { UISoundSystem } from "./audio/UISoundSystem";
import { WeaponSoundSystem } from "./audio/WeaponSoundSystem";
import type { GameEventMap } from "./GameEvents";
import { GameTokens } from "./ServiceTokens";
import { Player } from "./gameplay/Player";
import { WeaponEffects } from "./gameplay/weapons/WeaponEffects";
import { InteractSystem, type SlidingDoor } from "./gameplay/interactions";
import type { LevelDefinition } from "./levels/LevelDefinition";
import { LevelLoader } from "./levels/LevelLoader";
import { getLevel, type LevelId } from "./levels/LevelRegistry";
import { TriggerSystem } from "./levels/TriggerSystem";
import type { NPC } from "./npc/NPC";
import { DialogueSystem } from "./narrative/DialogueSystem";
import { LevelEvents } from "./narrative/LevelEvents";
import type { WeaponPickup } from "./gameplay/weapons/WeaponPickup";
import { DebugOverlay } from "./ui/DebugOverlay";
import { HUD } from "./ui/HUD";
import { Subtitles } from "./ui/Subtitles";
import { MainMenu } from "./ui/menu/MainMenu";
import type { GameMenuState } from "./ui/menu/MainMenuState";

/**
 * Bootstrap del contenido del juego.
 *
 * Recibe un `Engine` ya construido, registra todos los servicios
 * específicos del juego (UI, audio reactiva a eventos, gameplay,
 * narrativa) y maneja el bucle principal a través del engine.
 *
 * El nivel no se carga en `init()`: solo cuando el usuario elige un mapa
 * desde el menú principal (`startNewGame`). "Salir al menú principal"
 * desde la pausa reinicia la página para garantizar un teardown limpio.
 */
export interface GameOptions {
  /** Opcional: bootear directamente en un nivel concreto sin pasar por el menú. */
  bootIntoLevel?: LevelId;
}

export class Game {
  private readonly root: HTMLElement;
  private readonly bootIntoLevel?: LevelId;

  private gameState: GameMenuState = "mainMenu";
  private currentLevel: LevelDefinition | null = null;
  private player: Player | null = null;
  private npcs: NPC[] = [];
  private doors: SlidingDoor[] = [];
  private weaponPickups: WeaponPickup[] = [];

  constructor(private readonly engine: Engine, options: GameOptions = {}) {
    this.root = engine.root;
    this.bootIntoLevel = options.bootIntoLevel;

    this.registerEventBus();
    this.registerAudio();
    this.registerGameplay();
    this.registerUi();

    this.engine.services
      .resolve(GameTokens.MainMenu)
      .setDebugEnabled(this.engine.services.resolve(GameTokens.DebugOverlay).isEnabled());
    this.setGameState("mainMenu");
    this.bindBrowserEvents();
  }

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    await this.engine.init();

    const services = this.engine.services;
    const sceneManager = services.resolve(EngineTokens.Scene);
    const lighting = services.resolve(EngineTokens.Lighting);
    const footsteps = services.resolve(GameTokens.Footsteps);

    lighting.attach(sceneManager.scene);
    footsteps.configure(FootstepsConfig);

    if (this.bootIntoLevel) {
      await this.startNewGame(this.bootIntoLevel);
    }
  }

  start(): void {
    this.engine.start((time) => this.update(time));
  }

  dispose(): void {
    this.engine.stop();
    this.unbindBrowserEvents();

    const s = this.engine.services;
    s.resolve(GameTokens.Dialogue).dispose();
    s.resolve(GameTokens.WeaponEffects).dispose();
    this.player?.dispose();
    s.resolve(GameTokens.HUD).dispose();
    s.resolve(GameTokens.Subtitles).dispose();
    s.resolve(GameTokens.MainMenu).dispose();
    s.resolve(GameTokens.DebugOverlay).dispose();
    s.resolve(GameTokens.EventBus).clear();

    this.engine.dispose();
  }

  // ---------------------------------------------------------------------------
  // Service installers
  // ---------------------------------------------------------------------------

  private registerEventBus(): void {
    this.engine.services.register(
      GameTokens.EventBus,
      new EventBus<GameEventMap>(),
    );
  }

  private registerAudio(): void {
    const s = this.engine.services;
    const eventBus = s.resolve(GameTokens.EventBus);
    const sound = s.resolve(EngineTokens.Sound);

    s.register(GameTokens.BackgroundAmbience, new BackgroundAmbienceSystem(sound));
    s.register(GameTokens.Music, new MusicManager(sound));
    s.register(GameTokens.Footsteps, new FootstepSoundSystem(sound));
    s.register(GameTokens.WeaponSounds, new WeaponSoundSystem(eventBus, sound));
    s.register(GameTokens.EnemySounds, new EnemySoundSystem(eventBus, sound));
    s.register(
      GameTokens.DialogueSounds,
      new DialogueAudioSystem(eventBus, sound),
    );
    s.register(GameTokens.UISounds, new UISoundSystem(eventBus, sound));
  }

  private registerGameplay(): void {
    const s = this.engine.services;
    const eventBus = s.resolve(GameTokens.EventBus);
    const scene = s.resolve(EngineTokens.Scene);
    const assets = s.resolve(EngineTokens.Assets);
    const physics = s.resolve(EngineTokens.Physics);

    s.register(
      GameTokens.Characters,
      new CharacterFactory(assets, physics, eventBus),
    );

    const subtitles = s.register(GameTokens.Subtitles, new Subtitles(this.root));
    s.register(GameTokens.Dialogue, new DialogueSystem(eventBus, subtitles));
    s.register(
      GameTokens.WeaponEffects,
      new WeaponEffects(scene.scene, eventBus),
    );
    s.register(GameTokens.InteractSystem, new InteractSystem(eventBus));
    s.register(GameTokens.TriggerSystem, new TriggerSystem(eventBus));
  }

  private registerUi(): void {
    const s = this.engine.services;
    const eventBus = s.resolve(GameTokens.EventBus);
    const audio = s.resolve(EngineTokens.Audio);

    s.register(GameTokens.HUD, new HUD(this.root, eventBus));
    const debugOverlay = s.register(
      GameTokens.DebugOverlay,
      new DebugOverlay(this.root, eventBus),
    );

    s.register(
      GameTokens.MainMenu,
      new MainMenu(this.root, {
        onStartChapter: (chapterId) => {
          void this.startNewGame(chapterId as LevelId);
        },
        onResume: () => this.setGameState("playing"),
        onExitToMain: () => this.exitToMainMenu(),
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
    const s = this.engine.services;
    const input = s.resolve(EngineTokens.Input);
    const debugOverlay = s.resolve(GameTokens.DebugOverlay);

    if (input.wasKeyPressed("F3")) {
      debugOverlay.toggle();
    }

    if (input.wasKeyPressed("Escape") && this.gameState === "playing") {
      this.setGameState("paused");
    }

    if (this.gameState !== "playing" || !this.player) {
      this.engine.renderFrame();
      input.endFrame();
      return;
    }

    this.tickPlaying(time);

    this.engine.renderFrame();
    input.endFrame();
  }

  /** Tick completo cuando el juego está activo (no en menú/pausa). */
  private tickPlaying(time: Time): void {
    const player = this.player!;
    const s = this.engine.services;
    const input = s.resolve(EngineTokens.Input);
    const camera = s.resolve(EngineTokens.Camera);
    const physics = s.resolve(EngineTokens.Physics);
    const gizmos = s.resolve(EngineTokens.Gizmos);
    const interactSystem = s.resolve(GameTokens.InteractSystem);
    const triggerSystem = s.resolve(GameTokens.TriggerSystem);
    const weaponEffects = s.resolve(GameTokens.WeaponEffects);
    const subtitles = s.resolve(GameTokens.Subtitles);
    const footsteps = s.resolve(GameTokens.Footsteps);
    const debugOverlay = s.resolve(GameTokens.DebugOverlay);

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
    interactSystem.update(
      camera.camera.position,
      camera.getForwardDirection(),
      input,
    );
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
    this.engine.services
      .resolve(EngineTokens.Renderer)
      .canvas.addEventListener("click", this.handleCanvasClick);
    document.addEventListener("pointerlockchange", this.handlePointerLockChange);
  }

  private unbindBrowserEvents(): void {
    this.engine.services
      .resolve(EngineTokens.Renderer)
      .canvas.removeEventListener("click", this.handleCanvasClick);
    document.removeEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
  }

  private readonly handleCanvasClick = (): void => {
    this.engine.services.resolve(EngineTokens.Audio).unlock();
    if (this.gameState === "playing") {
      this.engine.services.resolve(EngineTokens.Input).requestPointerLock();
    }
  };

  private readonly handlePointerLockChange = (): void => {
    const input = this.engine.services.resolve(EngineTokens.Input);
    if (!input.isPointerLocked() && this.gameState === "playing") {
      this.setGameState("paused");
    }
  };

  private setGameState(state: GameMenuState): void {
    this.gameState = state;
    const s = this.engine.services;
    const mainMenu = s.resolve(GameTokens.MainMenu);
    const hud = s.resolve(GameTokens.HUD);
    const input = s.resolve(EngineTokens.Input);

    mainMenu.setState(state);
    hud.setVisible(state === "playing");

    if (state === "playing") {
      mainMenu.setStatus(MenuStrings.ready);
      input.requestPointerLock();
    }
  }

  private async startNewGame(levelId: LevelId): Promise<void> {
    const s = this.engine.services;
    const mainMenu = s.resolve(GameTokens.MainMenu);
    const audio = s.resolve(EngineTokens.Audio);

    audio.unlock();

    const level = getLevel(levelId);
    mainMenu.showLoading(MenuStrings.loadingLevel(level.title));

    // Permitir que el navegador pinte la pantalla de carga antes del trabajo síncrono.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );

    await this.loadLevel(levelId);

    const ambience = s.resolve(GameTokens.BackgroundAmbience);
    const music = s.resolve(GameTokens.Music);

    if (this.currentLevel) {
      ambience.start(this.currentLevel.audio.ambiences);
      if (this.currentLevel.audio.music) {
        music.fadeToMusic(this.currentLevel.audio.music);
      } else {
        music.stopMusic();
      }
    }

    this.setGameState("playing");
  }

  private async loadLevel(levelId: LevelId): Promise<void> {
    const services = this.engine.services;
    const physics = services.resolve(EngineTokens.Physics);
    const sceneManager = services.resolve(EngineTokens.Scene);
    const resources = services.resolve(EngineTokens.Resources);
    const assets = services.resolve(EngineTokens.Assets);
    const raycast = services.resolve(EngineTokens.Raycast);
    const camera = services.resolve(EngineTokens.Camera);
    const eventBus = services.resolve(GameTokens.EventBus);
    const interactSystem = services.resolve(GameTokens.InteractSystem);
    const triggerSystem = services.resolve(GameTokens.TriggerSystem);
    const characters = services.resolve(GameTokens.Characters);
    const footsteps = services.resolve(GameTokens.Footsteps);

    const level = getLevel(levelId);
    this.currentLevel = level;

    sceneManager.setBackground(level.background);
    resources.register(`level.${level.id}`, level);
    footsteps.setSounds(level.audio.footstepSounds);

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

    const loaded = await loader.load(level);
    this.npcs = loaded.npcs;
    this.doors = loaded.doors;
    this.weaponPickups = loaded.weaponPickups;

    this.player = new Player(
      new Vector3(...level.playerStart),
      physics,
      raycast,
      assets,
      sceneManager.scene,
      eventBus,
    );

    camera.syncToPosition(this.player.getEyePosition());
    levelEvents.announceLevel(level.title);
  }

  /**
   * Salir al menú principal desde la pausa.
   *
   * Reinicia la página: es la forma más robusta de devolver el motor,
   * la física y la escena al estado inicial. La página vuelve a bootear
   * en el menú principal y el usuario puede cargar cualquier mapa otra
   * vez (incluido el que acaba de salir).
   */
  private exitToMainMenu(): void {
    const s = this.engine.services;
    const mainMenu = s.resolve(GameTokens.MainMenu);
    const ambience = s.resolve(GameTokens.BackgroundAmbience);
    const music = s.resolve(GameTokens.Music);

    ambience.stop();
    music.stopMusic();
    mainMenu.showLoading("Volviendo al menu principal...");

    // Pequeña espera para que el overlay de carga llegue a pintarse antes de
    // que el navegador descarte la página por el reload.
    window.setTimeout(() => {
      window.location.reload();
    }, 250);
  }
}
