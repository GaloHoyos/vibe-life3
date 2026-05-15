import { Vector3 } from "three";
import type { NPC } from "../ai/NPC";
import { AssetManager } from "../assets/AssetManager";
import { CharacterFactory } from "../characters/CharacterFactory";
import { DebugOverlay } from "../debug/DebugOverlay";
import { Gizmos } from "../debug/Gizmos";
import { Player } from "../gameplay/Player";
import type { WeaponPickup } from "../gameplay/weapons/WeaponPickup";
import { InteractSystem, type SlidingDoor } from "../gameplay/interactions";
import { DemoLevel } from "../levels/DemoLevel";
import { LevelEvents } from "../narrative/LevelEvents";
import { LevelLoader } from "../levels/LevelLoader";
import { TriggerSystem } from "../levels/TriggerSystem";
import { PhysicsWorld } from "../physics/PhysicsWorld";
import { Raycast } from "../physics/Raycast";
import { CameraSystem } from "../render/CameraSystem";
import { LightingSystem } from "../render/LightingSystem";
import { Renderer } from "../render/Renderer";
import { DialogueSystem } from "../narrative/DialogueSystem";
import { WeaponEffects } from "../gameplay/weapons/WeaponEffects";
import { HUD } from "../ui/HUD";
import { MainMenu } from "../ui/menu/MainMenu";
import type { GameMenuState } from "../ui/menu/MainMenuState";
import { Subtitles } from "../ui/Subtitles";
import { EventBus } from "./EventBus";
import type { GameEventMap } from "./GameEvents";
import { GameLoop } from "./GameLoop";
import { Input } from "./Input";
import { ResourceManager } from "./ResourceManager";
import { SceneManager } from "./SceneManager";
import type { Time } from "./Time";
import { AudioSystem } from "../audio/AudioSystem";
import { SoundManager } from "../audio/SoundManager";
import { BackgroundAmbienceSystem } from "../audio/BackgroundAmbienceSystem";
import { MusicManager } from "../audio/MusicManager";
import { PositionalSoundManager } from "../audio/PositionalSoundManager";
import { FootstepSoundSystem } from "../audio/FootstepSoundSystem";
import { WeaponSoundSystem } from "../audio/WeaponSoundSystem";
import { EnemySoundSystem } from "../audio/EnemySoundSystem";
import { DialogueAudioSystem } from "../audio/DialogueAudioSystem";
import { UISoundSystem } from "../audio/UISoundSystem";

export class Engine {
  private readonly root: HTMLDivElement;
  private readonly eventBus = new EventBus<GameEventMap>();
  private readonly resources = new ResourceManager();
  private readonly assets = new AssetManager();
  private readonly characters: CharacterFactory;
  private readonly sceneManager = new SceneManager();
  private readonly renderer: Renderer;
  private readonly cameraSystem: CameraSystem;
  private readonly lighting = new LightingSystem();
  private readonly physics = new PhysicsWorld();
  private readonly raycast: Raycast;
  private readonly input: Input;
  private readonly loop = new GameLoop();
  private readonly hud: HUD;
  private readonly subtitles: Subtitles;
  private readonly dialogueSystem: DialogueSystem;
  private readonly weaponEffects: WeaponEffects;
  private readonly debugOverlay: DebugOverlay;
  private readonly gizmos: Gizmos;
  private readonly interactSystem: InteractSystem;
  private readonly triggerSystem: TriggerSystem;
  private readonly mainMenu: MainMenu;
  private readonly audioSystem: AudioSystem;
  private readonly soundManager: SoundManager;
  private readonly backgroundAmbience: BackgroundAmbienceSystem;
  private readonly musicManager: MusicManager;
  private readonly positionalSounds: PositionalSoundManager;
  private readonly footstepSounds: FootstepSoundSystem;
  private readonly weaponSounds: WeaponSoundSystem;
  private readonly enemySounds: EnemySoundSystem;
  private readonly dialogueSounds: DialogueAudioSystem;
  private readonly uiSounds: UISoundSystem;
  private gameState: GameMenuState = "mainMenu";

  private player: Player | null = null;
  private npcs: NPC[] = [];
  private doors: SlidingDoor[] = [];
  private weaponPickups: WeaponPickup[] = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement("div");
    this.root.className = "game-root";
    container.append(this.root);

    this.renderer = new Renderer(this.root);
    this.cameraSystem = new CameraSystem(this.root);
    this.input = new Input(this.renderer.canvas);
    this.raycast = new Raycast(this.physics);
    this.characters = new CharacterFactory(
      this.assets,
      this.physics,
      this.eventBus,
    );
    this.audioSystem = new AudioSystem();
    this.soundManager = new SoundManager(this.audioSystem);
    this.backgroundAmbience = new BackgroundAmbienceSystem(this.soundManager);
    this.musicManager = new MusicManager(this.soundManager);
    this.positionalSounds = new PositionalSoundManager(
      this.audioSystem,
      this.soundManager,
      this.sceneManager.scene,
      this.cameraSystem.camera,
    );
    this.footstepSounds = new FootstepSoundSystem(this.soundManager);
    this.weaponSounds = new WeaponSoundSystem(this.eventBus, this.soundManager);
    this.enemySounds = new EnemySoundSystem(this.eventBus, this.soundManager);
    this.dialogueSounds = new DialogueAudioSystem(
      this.eventBus,
      this.soundManager,
    );
    this.uiSounds = new UISoundSystem(this.eventBus, this.soundManager);
    void this.musicManager;
    void this.positionalSounds;
    void this.footstepSounds;
    void this.weaponSounds;
    void this.enemySounds;
    void this.dialogueSounds;
    void this.uiSounds;
    this.hud = new HUD(this.root, this.eventBus);
    this.subtitles = new Subtitles(this.root);
    this.debugOverlay = new DebugOverlay(this.root, this.eventBus);
    this.gizmos = new Gizmos(this.sceneManager.scene);
    this.interactSystem = new InteractSystem(this.eventBus);
    this.triggerSystem = new TriggerSystem(this.eventBus);
    this.mainMenu = new MainMenu(this.root, {
      onStartChapter: (chapterId) => this.startNewGame(chapterId),
      onResume: () => this.setGameState("playing"),
      onReturnToMain: () => this.setGameState("mainMenu"),
      onToggleDebug: (enabled) => this.debugOverlay.setEnabled(enabled),
      onVolumeChange: (bus, value) => this.audioSystem.setVolume(bus, value),
      onGetVolume: (bus) => this.audioSystem.getVolume(bus),
    });

    this.dialogueSystem = new DialogueSystem(this.eventBus, this.subtitles);
    this.weaponEffects = new WeaponEffects(
      this.sceneManager.scene,
      this.eventBus,
    );
    this.mainMenu.setDebugEnabled(this.debugOverlay.isEnabled());
    this.setGameState("mainMenu");
    this.bindBrowserEvents();
  }

  async init(): Promise<void> {
    await this.physics.init();
    this.sceneManager.setBackground(DemoLevel.background);
    this.lighting.attach(this.sceneManager.scene);
    this.resources.register("level.demo", DemoLevel);

    const levelEvents = new LevelEvents(this.eventBus);
    const loader = new LevelLoader(
      this.sceneManager.scene,
      this.physics,
      this.eventBus,
      this.interactSystem,
      this.triggerSystem,
      this.characters,
      this.assets,
    );
    const loaded = await loader.load(DemoLevel);
    this.npcs = loaded.npcs;
    this.doors = loaded.doors;
    this.weaponPickups = loaded.weaponPickups;
    this.player = new Player(
      new Vector3(...DemoLevel.playerStart),
      this.physics,
      this.raycast,
      this.assets,
      this.sceneManager.scene,
      this.eventBus,
    );
    this.cameraSystem.syncToPosition(this.player.getEyePosition());
    levelEvents.announceLevel(DemoLevel.title);
  }

  start(): void {
    this.loop.start((time) => this.update(time));
  }

  dispose(): void {
    this.loop.stop();
    this.renderer.canvas.removeEventListener("click", this.handleCanvasClick);
    document.removeEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
    this.dialogueSystem.dispose();
    this.weaponEffects.dispose();
    this.player?.dispose();
    this.hud.dispose();
    this.input.dispose();
    this.renderer.dispose();
    this.cameraSystem.dispose();
    this.eventBus.clear();
  }

  private update(time: Time): void {
    if (!this.player) {
      return;
    }

    if (this.input.wasKeyPressed("F3")) {
      this.debugOverlay.toggle();
    }

    if (this.input.wasKeyPressed("Escape") && this.gameState === "playing") {
      this.setGameState("paused");
    }

    if (this.gameState !== "playing") {
      this.renderer.render(this.sceneManager.scene, this.cameraSystem.camera);
      this.input.endFrame();
      return;
    }

    if (this.input.isPointerLocked()) {
      this.cameraSystem.updateLook(this.input);
      this.player.update(
        time.delta,
        this.input,
        this.cameraSystem,
        time.elapsed,
      );
    }

    this.footstepSounds.update(
      time.delta,
      this.player.getMoveIntensity(this.input),
    );

    const playerPosition = this.player.getPosition();
    this.weaponPickups.forEach((pickup) =>
      pickup.update(time.delta, playerPosition, this.player!.weapons),
    );
    this.npcs.forEach((npc) =>
      npc.update(time.delta, playerPosition, this.player!),
    );
    this.doors.forEach((door) => door.update(time.delta));
    this.physics.step(time.delta);
    this.npcs.forEach((npc) => npc.syncFromPhysics());

    this.cameraSystem.syncToPosition(this.player.getEyePosition());
    this.interactSystem.update(
      this.cameraSystem.camera.position,
      this.cameraSystem.getForwardDirection(),
      this.input,
    );
    this.triggerSystem.update(playerPosition);
    this.subtitles.update(time.delta);
    this.weaponEffects.update(time.delta);
    this.gizmos.update(time.delta);
    this.debugOverlay.update({
      fps: time.fps,
      playerPosition,
      physicsBodies: this.physics.getBodyCount(),
      npcStates: this.npcs.map((npc) => `${npc.id}:${npc.getState()}`),
    });

    this.renderer.render(this.sceneManager.scene, this.cameraSystem.camera);
    this.input.endFrame();
  }

  private bindBrowserEvents(): void {
    this.renderer.canvas.addEventListener("click", this.handleCanvasClick);
    document.addEventListener(
      "pointerlockchange",
      this.handlePointerLockChange,
    );
  }

  private readonly handleCanvasClick = (): void => {
    this.audioSystem.unlock();
    if (this.gameState === "playing") {
      this.input.requestPointerLock();
    }
  };

  private readonly handlePointerLockChange = (): void => {
    if (!this.input.isPointerLocked() && this.gameState === "playing") {
      this.setGameState("paused");
    }
  };

  private setGameState(state: GameMenuState): void {
    this.gameState = state;
    this.mainMenu.setState(state);
    this.hud.setVisible(state === "playing");

    if (state === "playing") {
      this.mainMenu.setStatus("Sistema activo. Preparado para combate.");
      this.input.requestPointerLock();
    } else if (state === "mainMenu") {
      this.backgroundAmbience.stopForLevel("demo");
    }
  }

  private startNewGame(chapterId: string): void {
    this.mainMenu.setStatus("Cargando mapa de pruebas...");
    this.audioSystem.unlock();
    this.backgroundAmbience.startForLevel(chapterId);
    this.setGameState("playing");
  }
}
