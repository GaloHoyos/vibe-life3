import { Vector3 } from "three";
import { BackgroundAmbienceSystem } from "@engine/audio/systems/BackgroundAmbienceSystem";
import { FootstepSoundSystem } from "@engine/audio/systems/FootstepSoundSystem";
import { MusicManager } from "@engine/audio/core/MusicManager";
import type { Engine } from "@engine/core/Engine";
import { EventBus } from "@engine/core/EventBus";
import { EngineTokens } from "@engine/core/ServiceTokens";
import type { Time } from "@engine/core/Time";
import { SpawnValidator } from "@engine/physics/character/SpawnValidator";
import { Raycast } from "@engine/physics/Raycast";
import { CharacterFactory } from "@game/characters/CharacterFactory";
import { FootstepsConfig } from "@game/config/audio.config";
import { Dialogue, MenuStrings } from "@game/config/strings";
import { DialogueAudioSystem } from "@game/audio/DialogueAudioSystem";
import { EnemySoundSystem } from "@game/audio/EnemySoundSystem";
import { UISoundSystem } from "@game/audio/UISoundSystem";
import { WeaponSoundSystem } from "@game/audio/WeaponSoundSystem";
import type { GameEventMap } from "./GameEvents";
import { GameTokens } from "./ServiceTokens";
import { DebugMenu } from "@game/ui/overlay/debug/DebugMenu";
import { AiTraceModule } from "@game/ui/overlay/debug/modules/AiTraceModule";
import { AiViewModule } from "@game/ui/overlay/debug/modules/AiViewModule";
import { NpcsModule } from "@game/ui/overlay/debug/modules/NpcsModule";
import { PlayerModule } from "@game/ui/overlay/debug/modules/PlayerModule";
import { SceneModule } from "@game/ui/overlay/debug/modules/SceneModule";
import { StatsModule } from "@game/ui/overlay/debug/modules/StatsModule";
import { WeaponsModule } from "@game/ui/overlay/debug/modules/WeaponsModule";
import { Controls } from "@game/gameplay/player/Controls";
import { Player } from "@game/gameplay/player/Player";
import { WeaponEffects } from "@game/gameplay/weapons/effects/WeaponEffects";
import { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import { InteractSystem, type SlidingDoor } from "@game/gameplay/interactions";
import type { NavGraph } from "@engine/ai/NavGraph";
import type { CoverSystem } from "@game/levels/CoverSystem";
import type { CombatSquadCoordinator } from "@game/npc/combat/CombatSquadCoordinator";
import type {
  DynamicBoxDefinition,
  LevelDefinition,
  NPCDefinition,
} from "@game/levels/LevelDefinition";
import { LevelLoader } from "@game/levels/LevelLoader";
import { getLevel, type LevelId } from "@game/levels/LevelRegistry";
import { TriggerSystem } from "@game/levels/TriggerSystem";
import type { ActorSnapshot, INpc, NpcUpdateContext } from "@game/npc/core/INpc";
import { ActorSpatialIndex } from "@game/npc/core/ActorSpatialIndex";
import { DialogueSystem } from "@game/narrative/DialogueSystem";
import { LevelEvents } from "@game/narrative/LevelEvents";
import { WeaponPickup } from "@game/gameplay/weapons/pickup/WeaponPickup";
import type { WeaponId } from "@game/gameplay/weapons/core/WeaponDefinition";
import { WEAPON_ORDER, WeaponDefinitions } from "@game/config/weapons.config";
import { HUD } from "@game/ui/hud/HUD";
import { Subtitles } from "@game/ui/subtitles/Subtitles";
import { MainMenu } from "@game/ui/menu/MainMenu";
import type { GameMenuState } from "@game/ui/menu/MainMenuState";
import { createBoxMesh } from "@engine/render/PrimitiveFactory";
import { tupleToVector3 } from "@shared/math/VectorTuple";

/**
 * Bootstrap del contenido del juego.
 *
 * Recibe un `Engine` ya construido, registra todos los servicios
 * especÃ­ficos del juego (UI, audio reactiva a eventos, gameplay,
 * narrativa) y maneja el bucle principal a travÃ©s del engine.
 *
 * El nivel no se carga en `init()`: solo cuando el usuario elige un mapa
 * desde el menÃº principal (`startNewGame`). "Salir al menÃº principal"
 * desde la pausa reinicia la pÃ¡gina para garantizar un teardown limpio.
 */
export interface GameOptions {
  /** Opcional: bootear directamente en un nivel concreto sin pasar por el menÃº. */
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
  private pendingExitTimeoutId: number | null = null;
  private actionSpawnSerial = 0;
  private readonly npcContextRadius = 90;

  constructor(private readonly engine: Engine, options: GameOptions = {}) {
    this.root = engine.root;
    this.bootIntoLevel = options.bootIntoLevel;

    this.registerEventBus();
    this.registerAudio();
    this.registerGameplay();
    this.registerUi();

    this.engine.services
      .resolve(GameTokens.MainMenu)
      .setDebugEnabled(this.engine.services.resolve(GameTokens.DebugMenu).isVisible());
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

    if (this.pendingExitTimeoutId !== null) {
      window.clearTimeout(this.pendingExitTimeoutId);
      this.pendingExitTimeoutId = null;
    }

    this.npcs.forEach((npc) => npc.dispose());
    this.npcs = [];

    const s = this.engine.services;
    s.resolve(GameTokens.Dialogue).dispose();
    s.resolve(GameTokens.WeaponEffects).dispose();
    s.resolve(GameTokens.Grenades).dispose();
    this.player?.dispose();
    s.resolve(GameTokens.HUD).dispose();
    s.resolve(GameTokens.Subtitles).dispose();
    s.resolve(GameTokens.MainMenu).dispose();
    s.resolve(GameTokens.DebugMenu).dispose();
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
    const raycast = s.resolve(EngineTokens.Raycast);
    const positionalSounds = s.resolve(EngineTokens.PositionalSound);
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
    s.register(
      GameTokens.Grenades,
      new GrenadeSystem(
        physics,
        scene.scene,
        assets,
        raycast,
        eventBus,
        positionalSounds,
      ),
    );
    s.register(GameTokens.InteractSystem, new InteractSystem(eventBus));
    s.register(GameTokens.TriggerSystem, new TriggerSystem(eventBus));

    eventBus.on("npc.weapon.dropped", (payload) => {
      void this.handleWeaponDrop(payload.npcId, payload.weaponId, payload.position);
    });
    eventBus.on("level.action", ({ action, position }) => {
      void this.handleLevelAction(action, position);
    });
  }

  private async handleWeaponDrop(
    npcId: string,
    weaponId: string,
    position: Vector3,
  ): Promise<void> {
    if (!(weaponId in WeaponDefinitions)) {
      console.warn(`[Game] Dropped weapon '${weaponId}' no estÃ¡ en WeaponDefinitions`);
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

  private async handleLevelAction(
    action: GameEventMap["level.action"]["action"],
    position: Vector3,
  ): Promise<void> {
    if (!this.currentLevel) {
      return;
    }

    switch (action) {
      case "respawnEncounters":
        await this.respawnLevelEncounters(this.currentLevel);
        this.engine.services.resolve(GameTokens.EventBus).emit("dialogue.show", {
          speaker: "Consola",
          text: "Entidades respawneadas.",
          duration: 2.5,
        });
        return;
      case "spawnAllWeapons":
        await this.spawnWeaponSet(position);
        this.engine.services.resolve(GameTokens.EventBus).emit("dialogue.show", {
          speaker: "Consola",
          text: "Arsenal desplegado.",
          duration: 2.5,
        });
        return;
    }
  }

  private async respawnLevelEncounters(level: LevelDefinition): Promise<void> {
    this.actionSpawnSerial += 1;
    await this.spawnNpcs(level.npcs, `respawn-${this.actionSpawnSerial}`);
    this.spawnDynamicBoxes(level.dynamicBoxes, `respawn-${this.actionSpawnSerial}`);
  }

  private async spawnNpcs(
    definitions: NPCDefinition[],
    idPrefix: string,
  ): Promise<void> {
    const services = this.engine.services;
    const characters = services.resolve(GameTokens.Characters);
    const scene = services.resolve(EngineTokens.Scene);
    const physics = services.resolve(EngineTokens.Physics);
    const spawnValidator = new SpawnValidator(new Raycast(physics));

    for (const definition of definitions) {
      const requested = tupleToVector3(definition.position);
      const validation = spawnValidator.validate(requested);
      const npc = await characters.createNPC(
        definition.characterId,
        `${idPrefix}-${definition.id}`,
        validation.position,
        definition.patrol?.map(tupleToVector3) ?? [],
      );
      scene.scene.add(npc.mesh);
      this.npcs.push(npc);
    }
  }

  private spawnDynamicBoxes(
    definitions: DynamicBoxDefinition[],
    idPrefix: string,
  ): void {
    const services = this.engine.services;
    const scene = services.resolve(EngineTokens.Scene);
    const physics = services.resolve(EngineTokens.Physics);

    definitions.forEach((definition) => {
      const id = `${idPrefix}-${definition.id}`;
      const mesh = createBoxMesh({
        id,
        position: definition.position,
        size: definition.size,
        material: definition.material,
        castShadow: true,
        receiveShadow: true,
      });
      scene.scene.add(mesh);
      physics.createDynamicBox(
        {
          id,
          position: tupleToVector3(definition.position),
          size: tupleToVector3(definition.size),
          mass: definition.mass,
        },
        mesh,
      );
    });
  }

  private async spawnWeaponSet(origin: Vector3): Promise<void> {
    this.actionSpawnSerial += 1;
    const services = this.engine.services;
    const scene = services.resolve(EngineTokens.Scene);
    const assets = services.resolve(EngineTokens.Assets);
    const physics = services.resolve(EngineTokens.Physics);
    const weaponIds: WeaponId[] = [...WEAPON_ORDER, "grenade", "grenade", "grenade"];

    for (let i = 0; i < weaponIds.length; i += 1) {
      const row = Math.floor(i / 5);
      const column = i % 5;
      const position = origin
        .clone()
        .add(new Vector3((column - 2) * 1.4, 0.2, 2.6 + row * 1.4));
      const pickup = await WeaponPickup.create(scene.scene, physics, assets, {
        id: `action-weapon-${this.actionSpawnSerial}-${i}-${weaponIds[i]}`,
        weaponId: weaponIds[i],
        position,
      });
      this.weaponPickups.push(pickup);
    }
  }

  private registerUi(): void {
    const s = this.engine.services;
    const eventBus = s.resolve(GameTokens.EventBus);
    const audio = s.resolve(EngineTokens.Audio);
    const controls = s.resolve(GameTokens.Controls);
    const input = s.resolve(EngineTokens.Input);
    const scene = s.resolve(EngineTokens.Scene);

    s.register(GameTokens.HUD, new HUD(this.root, eventBus));

    const debugMenu = new DebugMenu(this.root, input, controls, eventBus);
    debugMenu.register(new StatsModule());
    debugMenu.register(new PlayerModule(eventBus));
    debugMenu.register(new WeaponsModule());
    debugMenu.register(new NpcsModule());
    debugMenu.register(new AiViewModule(scene.scene));
    debugMenu.register(new AiTraceModule(eventBus));
    debugMenu.register(new SceneModule(scene.scene));
    s.register(GameTokens.DebugMenu, debugMenu);

    s.register(
      GameTokens.MainMenu,
      new MainMenu(this.root, {
        onStartChapter: (chapterId) => {
          void this.startNewGame(chapterId as LevelId);
        },
        onResume: () => this.setGameState("playing"),
        onExitToMain: () => this.exitToMainMenu(),
        onToggleDebug: (enabled) => debugMenu.setVisible(enabled),
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
    const debugMenu = s.resolve(GameTokens.DebugMenu);

    this.tickDebug(time, debugMenu);

    if (input.wasKeyPressed("F2") && this.player) {
      const enabled = this.player.health.toggleGodMode();
      this.engine.services
        .resolve(GameTokens.EventBus)
        .emit("subtitle.show", enabled ? Dialogue.godModeOn : Dialogue.godModeOff);
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

  private tickDebug(time: Time, debugMenu: DebugMenu): void {
    const s = this.engine.services;
    const physics = s.resolve(EngineTokens.Physics);
    const renderer = s.resolve(EngineTokens.Renderer);
    debugMenu.update({
      delta: time.delta,
      elapsed: time.elapsed,
      fps: time.fps,
      player: this.player,
      npcs: this.npcs,
      navGraph: this.navGraph,
      rendererInfo: renderer.renderer.info,
      physicsBodies: physics.getBodyCount(),
      playerPosition: this.player?.getPosition() ?? null,
    });
  }

  /** Tick completo cuando el juego estÃ¡ activo (no en menÃº/pausa). */
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
    const grenades = s.resolve(GameTokens.Grenades);

    if (input.isPointerLocked()) {
      camera.updateLook(input);
      player.update(time.delta, input, controls, camera, time.elapsed);
    }

    footsteps.update(time.delta, player.getMoveIntensity());

    let playerPosition = player.getPosition();
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
      const npcIndex = new ActorSpatialIndex(npcSnapshots);
      const ctx: NpcUpdateContext = {
        delta: time.delta,
        elapsed: time.elapsed,
        aiLod: "near",
        player: playerSnapshot,
        npcs: [],
        coverSystem: this.coverSystem,
        navGraph: this.navGraph,
        squad: this.squad,
        grenades,
      };
      this.npcs.forEach((npc) => {
        ctx.aiLod = this.computeNpcAiLod(npc.position, playerPosition);
        ctx.npcs = npcIndex.query(npc.position, this.npcContextRadius, npc.id);
        npc.update(ctx);
      });
      this.squad.tickAssignments(time.elapsed, null);
    }
    this.doors.forEach((door) => door.update(time.delta));
    physics.step(time.delta);
    this.npcs.forEach((npc) => npc.syncFromPhysics());
    grenades.update(time.delta, time.elapsed);

    playerPosition = player.getPosition();
    camera.syncToPosition(player.getEyePosition());
    // Update the viewmodel after the camera follows the resolved physics pose.
    player.tickRender(time.delta, camera);
    interactSystem.update(
      camera.camera.position,
      camera.getForwardDirection(),
      controls,
    );
    triggerSystem.update(playerPosition);
    subtitles.update(time.delta);
    weaponEffects.update(time.delta);
    gizmos.update(time.delta);
  }

  private computeNpcAiLod(position: Vector3, playerPosition: Vector3): NpcUpdateContext["aiLod"] {
    const distanceSq = position.distanceToSquared(playerPosition);
    if (distanceSq < 55 * 55) {
      return "near";
    }
    if (distanceSq < 115 * 115) {
      return "mid";
    }
    return "far";
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
    const debugMenu = this.engine.services.resolve(GameTokens.DebugMenu);
    const debugRelease = debugMenu.isDebugMouseRelease();
    if (
      !input.isPointerLocked() &&
      this.gameState === "playing" &&
      !debugRelease
    ) {
      this.setGameState("paused");
    }
    if (!input.isPointerLocked()) {
      input.unlockKeyboard();
    }
  };

  /**
   * Pointer lock + keyboard lock. El fullscreen es decisión del jugador
   * desde Opciones → Video; sin él, lockKeyboard() no captura Ctrl+W/F11
   * pero la API se silencia limpiamente.
   */
  private enterCapture(): void {
    const input = this.engine.services.resolve(EngineTokens.Input);
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

    // Permitir que el navegador pinte la pantalla de carga antes del trabajo sÃ­ncrono.
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

    this.npcs.forEach((npc) => npc.dispose());

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
      services.resolve(GameTokens.Grenades),
    );

    camera.syncToPosition(this.player.getEyePosition());
    levelEvents.announceLevel(level.title);
  }

  /**
   * Salir al menÃº principal desde la pausa.
   *
   * Reinicia la pÃ¡gina: es la forma mÃ¡s robusta de devolver el motor,
   * la fÃ­sica y la escena al estado inicial. La pÃ¡gina vuelve a bootear
   * en el menÃº principal y el usuario puede cargar cualquier mapa otra
   * vez (incluido el que acaba de salir).
   */
  private exitToMainMenu(): void {
    const s = this.engine.services;
    const mainMenu = s.resolve(GameTokens.MainMenu);
    const ambience = s.resolve(GameTokens.BackgroundAmbience);
    const music = s.resolve(GameTokens.Music);

    ambience.stop();
    music.stopMusic();
    mainMenu.showLoading(MenuStrings.exitingToMainMenu);

    // PequeÃ±a espera para que el overlay de carga llegue a pintarse antes de
    // que el navegador descarte la pÃ¡gina por el reload.
    this.pendingExitTimeoutId = window.setTimeout(() => {
      this.pendingExitTimeoutId = null;
      window.location.reload();
    }, 250);
  }
}
