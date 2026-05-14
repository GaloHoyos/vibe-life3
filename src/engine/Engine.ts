import { Vector3 } from 'three';
import type { NPC } from '../ai/NPC';
import { AssetManager } from '../assets/AssetManager';
import { CharacterFactory } from '../characters/CharacterFactory';
import { DebugOverlay } from '../debug/DebugOverlay';
import { Gizmos } from '../debug/Gizmos';
import { Player } from '../gameplay/Player';
import { InteractSystem, type SlidingDoor } from '../gameplay/interactions';
import { DemoLevel } from '../levels/DemoLevel';
import { LevelEvents } from '../narrative/LevelEvents';
import { LevelLoader } from '../levels/LevelLoader';
import { TriggerSystem } from '../levels/TriggerSystem';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Raycast } from '../physics/Raycast';
import { CameraSystem } from '../render/CameraSystem';
import { LightingSystem } from '../render/LightingSystem';
import { Renderer } from '../render/Renderer';
import { DialogueSystem } from '../narrative/DialogueSystem';
import { HUD } from '../ui/HUD';
import { MainMenu } from '../ui/MainMenu';
import { PauseMenu } from '../ui/PauseMenu';
import { Subtitles } from '../ui/Subtitles';
import { EventBus } from './EventBus';
import type { GameEventMap } from './GameEvents';
import { GameLoop } from './GameLoop';
import { Input } from './Input';
import { ResourceManager } from './ResourceManager';
import { SceneManager } from './SceneManager';
import type { Time } from './Time';

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
  private readonly debugOverlay: DebugOverlay;
  private readonly gizmos: Gizmos;
  private readonly interactSystem: InteractSystem;
  private readonly triggerSystem: TriggerSystem;
  private readonly pauseMenu: PauseMenu;
  private readonly mainMenu: MainMenu;

  private player: Player | null = null;
  private npcs: NPC[] = [];
  private doors: SlidingDoor[] = [];

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'game-root';
    container.append(this.root);

    this.renderer = new Renderer(this.root);
    this.cameraSystem = new CameraSystem(this.root);
    this.input = new Input(this.renderer.canvas);
    this.raycast = new Raycast(this.physics);
    this.characters = new CharacterFactory(this.assets, this.physics, this.eventBus);
    this.hud = new HUD(this.root, this.eventBus);
    this.subtitles = new Subtitles(this.root);
    this.debugOverlay = new DebugOverlay(this.root, this.eventBus);
    this.gizmos = new Gizmos(this.sceneManager.scene);
    this.interactSystem = new InteractSystem(this.eventBus);
    this.triggerSystem = new TriggerSystem(this.eventBus);
    this.pauseMenu = new PauseMenu(this.root);
    this.mainMenu = new MainMenu(this.root, () => this.input.requestPointerLock());

    this.dialogueSystem = new DialogueSystem(this.eventBus, this.subtitles);
    this.bindBrowserEvents();
  }

  async init(): Promise<void> {
    await this.physics.init();
    this.sceneManager.setBackground(DemoLevel.background);
    this.lighting.attach(this.sceneManager.scene);
    this.resources.register('level.demo', DemoLevel);

    const levelEvents = new LevelEvents(this.eventBus);
    const loader = new LevelLoader(
      this.sceneManager.scene,
      this.physics,
      this.eventBus,
      this.interactSystem,
      this.triggerSystem,
      this.characters,
    );
    const loaded = await loader.load(DemoLevel);
    this.npcs = loaded.npcs;
    this.doors = loaded.doors;
    this.player = new Player(new Vector3(...DemoLevel.playerStart), this.physics, this.raycast, this.eventBus);
    this.cameraSystem.syncToPosition(this.player.getEyePosition());
    levelEvents.announceLevel(DemoLevel.title);
  }

  start(): void {
    this.loop.start((time) => this.update(time));
  }

  dispose(): void {
    this.loop.stop();
    this.renderer.canvas.removeEventListener('click', this.handleCanvasClick);
    document.removeEventListener('pointerlockchange', this.handlePointerLockChange);
    this.dialogueSystem.dispose();
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

    if (this.input.wasKeyPressed('F3')) {
      this.debugOverlay.toggle();
    }

    if (this.input.isPointerLocked()) {
      this.cameraSystem.updateLook(this.input);
      this.player.update(time.delta, this.input, this.cameraSystem, time.elapsed);
    }

    const playerPosition = this.player.getPosition();
    this.npcs.forEach((npc) => npc.update(time.delta, playerPosition));
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
    this.renderer.canvas.addEventListener('click', this.handleCanvasClick);
    document.addEventListener('pointerlockchange', this.handlePointerLockChange);
  }

  private readonly handleCanvasClick = (): void => {
    this.input.requestPointerLock();
    this.mainMenu.hide();
  };

  private readonly handlePointerLockChange = (): void => {
    const paused = !this.input.isPointerLocked();
    this.pauseMenu.setVisible(paused && this.mainMenu.element.classList.contains('is-hidden'));
  };
}
