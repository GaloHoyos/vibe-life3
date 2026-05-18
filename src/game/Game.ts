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
import { Controls } from "./gameplay/Controls";
import { Player } from "./gameplay/Player";
import { WeaponEffects } from "./gameplay/weapons/WeaponEffects";
import { InteractSystem, type SlidingDoor } from "./gameplay/interactions";
import type { NavGraph } from "../engine/ai/NavGraph";
import type { CoverSystem } from "./levels/CoverSystem";
import type { CombatSquadCoordinator } from "./npc/CombatSquadCoordinator";
import type { LevelDefinition } from "./levels/LevelDefinition";
import { LevelLoader } from "./levels/LevelLoader";
import { getLevel, type LevelId } from "./levels/LevelRegistry";
import { TriggerSystem } from "./levels/TriggerSystem";
import type { ActorSnapshot, INpc, NpcUpdateContext } from "./npc/INpc";
import { DialogueSystem } from "./narrative/DialogueSystem";
import { LevelEvents } from "./narrative/LevelEvents";
import { WeaponPickup } from "./gameplay/weapons/WeaponPickup";
import type { WeaponId } from "./gameplay/weapons/WeaponDefinition";
import { WeaponDefinitions } from "./config/weapons.config";
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
  private npcs: INpc[] = [];
  private doors: SlidingDoor[] = [];
  private weaponPickups: WeaponPickup[] = [];
  private coverSystem: CoverSystem | null = null;
  private navGraph: NavGraph | null = null;
  private squad: CombatSquadCoordinator | null = null;

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
    const input = s.resolve(EngineTokens.Input);

    s.register(GameTokens.Controls, new Controls(input));
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

    eventBus.on("npc.weapon.dropped", (payload) => {
      void this.handleWeaponDrop(payload.npcId, payload.weaponId, payload.position);
    });
  }

  private async handleWeaponDrop(
    npcId: string,
    weaponId: string,
    position: Vector3,
  ): Promise<void> {
    if (!(weaponId in WeaponDefinitions)) {
      console.warn(`[Game] Dropped weapon '${weaponId}' no está en WeaponDefinitions`);
      return;
    }
    const s = this.engine.services;
    const scene = s.resolve(EngineTokens.Scene);
    const assets = s.resolve(EngineTokens.Assets);
    const physics = s.resolve(EngineTokens.Physics);
    try {
      const pickup = await WeaponPickup.create(scene.scene, physics, assets, {
        id: `drop-${npcId}-${Date.now()}`,
        weaponId: weaponId as WeaponId,
        position,
      });
      this.weaponPickups.push(pickup);
    } catch (error) {
      console.warn(`[Game] No se pudo crear pickup del weapon dropeado`, error);
    }
  }

  private registerUi(): void {
    const s = this.engine.services;
    const eventBus = s.resolve(GameTokens.EventBus);
    const audio = s.resolve(EngineTokens.Audio);
    const controls = s.resolve(GameTokens.Controls);

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
        controls,
      }),
    );
  }

  // ---------------------------------------------------------------------------
  // Game loop
  // ---------------------------------------------------------------------------

  private update(time: Time): void {
    const s = this.engine.services;
    const input = s.resolve(EngineTokens.Input);
    const controls = s.resolve(GameTokens.Controls);
    const debugOverlay = s.resolve(GameTokens.DebugOverlay);

    if (controls.wasPressed("toggleDebug")) {
      debugOverlay.toggle();
    }

    if (input.wasKeyPressed("F2") && this.player) {
      const enabled = this.player.health.toggleGodMode();
      this.engine.services.resolve(GameTokens.EventBus).emit("subtitle.show", {
        speaker: "Sistema",
        text: enabled ? "GOD MODE ON" : "GOD MODE OFF",
        duration: 2,
      });
    }

    if (controls.wasPressed("pause") && this.gameState === "playing") {
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
    const controls = s.resolve(GameTokens.Controls);
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
      player.update(time.delta, input, controls, camera, time.elapsed);
    }

    footsteps.update(time.delta, player.getMoveIntensity());

    const playerPosition = player.getPosition();
    this.weaponPickups.forEach((pickup) =>
      pickup.update(time.delta, playerPosition, player.weapons),
    );
    if (this.coverSystem && this.navGraph && this.squad) {
      const playerSnapshot: ActorSnapshot = {
        id: "player",
        position: playerPosition,
        faction: "player",
        entity: player,
        isAlive: player.isAlive(),
        radius: 0.35,
      };
      const npcSnapshots: ActorSnapshot[] = this.npcs.map((npc) => ({
        id: npc.id,
        position: npc.position,
        faction: npc.faction,
        entity: npc,
        isAlive: npc.isAlive(),
        radius: npc.radius,
      }));
      const ctx: NpcUpdateContext = {
        delta: time.delta,
        elapsed: time.elapsed,
        player: playerSnapshot,
        npcs: [],
        coverSystem: this.coverSystem,
        navGraph: this.navGraph,
        squad: this.squad,
      };
      this.npcs.forEach((npc, index) => {
        ctx.npcs = npcSnapshots.filter((_, j) => j !== index);
        npc.update(ctx);
      });
      this.squad.tickAssignments(time.elapsed, playerPosition);
    }
    this.doors.forEach((door) => door.update(time.delta));
    physics.step(time.delta);
    this.npcs.forEach((npc) => npc.syncFromPhysics());

    camera.syncToPosition(player.getEyePosition());
    interactSystem.update(
      camera.camera.position,
      camera.getForwardDirection(),
      controls,
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
      this.enterCapture();
    }
  };

  private readonly handlePointerLockChange = (): void => {
    const input = this.engine.services.resolve(EngineTokens.Input);
    if (!input.isPointerLocked() && this.gameState === "playing") {
      this.setGameState("paused");
    }
    if (!input.isPointerLocked()) {
      input.unlockKeyboard();
    }
  };

  /**
   * Fullscreen + pointer lock + keyboard lock. El keyboard lock requiere
   * fullscreen para capturar Ctrl+W, Ctrl+T, F11, etc. — sin él, esos
   * atajos siguen yendo al navegador y cierran/cambian la pestaña.
   */
  private enterCapture(): void {
    const input = this.engine.services.resolve(EngineTokens.Input);
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
    input.requestPointerLock();
    input.lockKeyboard();
  }

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
      this.enterCapture();
    } else {
      input.unlockKeyboard();
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
    const lighting = services.resolve(EngineTokens.Lighting);
    const environment = services.resolve(EngineTokens.Environment);
    const eventBus = services.resolve(GameTokens.EventBus);
    const interactSystem = services.resolve(GameTokens.InteractSystem);
    const triggerSystem = services.resolve(GameTokens.TriggerSystem);
    const characters = services.resolve(GameTokens.Characters);
    const footsteps = services.resolve(GameTokens.Footsteps);

    const level = getLevel(levelId);
    this.currentLevel = level;

    await environment.applySkybox(sceneManager.scene, level.skybox ?? 'default', level.background);
    lighting.configureSun(level.sun);
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
    this.coverSystem = loaded.coverSystem;
    this.navGraph = loaded.navGraph;
    this.squad = loaded.squad;

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
