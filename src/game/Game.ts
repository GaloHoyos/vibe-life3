import { Color, Vector3 } from "three";
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
import type { NpcRuntimeServices } from "@game/characters/CharacterFactory";
import { CharacterPresets, isFlyingCharacter } from "@game/characters/CharacterPresets";
import { FootstepsConfig, SurfaceFootsteps } from "@game/config/audio.config";
import { Dialogue, MenuStrings } from "@game/config/strings";
import { DialogueAudioSystem } from "@game/audio/DialogueAudioSystem";
import { EnemySoundSystem } from "@game/audio/EnemySoundSystem";
import { HevSuitSoundSystem } from "@game/audio/HevSuitSoundSystem";
import { SoundscapeSystem } from "@game/audio/SoundscapeSystem";
import { UISoundSystem } from "@game/audio/UISoundSystem";
import { WeaponSoundSystem } from "@game/audio/WeaponSoundSystem";
import type { GameEventMap } from "./GameEvents";
import { GameTokens } from "./ServiceTokens";
import { DebugMenu } from "@game/ui/overlay/debug/DebugMenu";
import { installIceConsole } from "@game/debug/IceConsole";
import { installNpcConsole } from "@game/debug/NpcConsole";
import { installPlayerModelConsole } from "@game/debug/PlayerModelConsole";
import { AiTraceModule } from "@game/ui/overlay/debug/modules/AiTraceModule";
import { AiViewModule } from "@game/ui/overlay/debug/modules/AiViewModule";
import { NpcsModule } from "@game/ui/overlay/debug/modules/NpcsModule";
import { PlayerModule } from "@game/ui/overlay/debug/modules/PlayerModule";
import { SceneModule } from "@game/ui/overlay/debug/modules/SceneModule";
import { StatsModule } from "@game/ui/overlay/debug/modules/StatsModule";
import { WeaponsModule } from "@game/ui/overlay/debug/modules/WeaponsModule";
import { Controls } from "@game/gameplay/player/Controls";
import { Player } from "@game/gameplay/player/Player";
import { PlayerModelSystem } from "@game/gameplay/player/PlayerModelSystem";
import { resolvePlayerModel } from "@game/config/playermodel.config";
import { DeathSequence } from "@game/gameplay/player/DeathSequence";
import { DeathScreen } from "@game/ui/overlay/DeathScreen";
import { TransitionOverlay } from "@game/ui/overlay/TransitionOverlay";
import { WeaponEffects } from "@game/gameplay/weapons/effects/WeaponEffects";
import { NpcBloodEffects } from "@game/gameplay/effects/NpcBloodEffects";
import { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import { RocketSystem } from "@game/gameplay/weapons/rocket/RocketSystem";
import { BoltSystem } from "@game/gameplay/weapons/bolt/BoltSystem";
import { EnergyBallSystem } from "@game/gameplay/weapons/energyball/EnergyBallSystem";
import { IceGunSystem } from "@game/gameplay/weapons/ice/IceGunSystem";
import { PortalGunSystem } from "@game/gameplay/weapons/portal/PortalGunSystem";
import { computePortalNavLinks } from "@game/gameplay/weapons/portal/PortalNavLinks";
import { PortalConfig } from "@game/config/portal.config";
import { GrabSystem, InteractSystem, type Charger, type SlidingDoor } from "@game/gameplay/interactions";
import type { TacticalMap } from "@game/npc/ai/TacticalMap";
import type { BuildingRegistry } from "@game/levels/buildings/BuildingRegistry";
import type { NavSpace } from "@engine/ai/nav/NavSpace";
import type { PathRequestQueue } from "@engine/ai/nav/PathRequestQueue";
import type { SquadDirector } from "@game/npc/ai/SquadDirector";
import type {
  DynamicBoxDefinition,
  LevelDefinition,
  NPCDefinition,
  TriggerAction,
} from "@game/levels/LevelDefinition";
import { LevelLoader, type NpcPortalServices } from "@game/levels/LevelLoader";
import { getLevel, LevelRegistry, type LevelId } from "@game/levels/LevelRegistry";
import { TriggerSystem } from "@game/levels/TriggerSystem";
import { CheckpointSystem, type CheckpointSnapshot } from "@game/levels/CheckpointSystem";
import { HazardVolumeSystem } from "@game/levels/HazardVolumeSystem";
import { ExplosiveBarrelSystem } from "@game/gameplay/hazards/ExplosiveBarrelSystem";
import { PropImpactSystem } from "@game/gameplay/combat/PropImpactSystem";
import type { ActorSnapshot, AiFrameContext, INpc, NpcFreezeHandle, NpcPortalHandle } from "@game/npc/core/INpc";
import { ActorSpatialIndex } from "@game/npc/core/ActorSpatialIndex";
import { DialogueSystem } from "@game/narrative/DialogueSystem";
import { LevelEvents } from "@game/narrative/LevelEvents";
import { WeaponPickup } from "@game/gameplay/weapons/pickup/WeaponPickup";
import { ItemPickup } from "@game/gameplay/items/ItemPickup";
import { AmmoPickup } from "@game/gameplay/items/AmmoPickup";
import type { WeaponId } from "@game/gameplay/weapons/core/WeaponDefinition";
import { WEAPON_ORDER, WeaponDefinitions } from "@game/config/weapons.config";
import { AMMO_ORDER } from "@game/config/ammo.config";
import { HUD } from "@game/ui/hud/HUD";
import { ScopeOverlay } from "@game/ui/overlay/ScopeOverlay";
import { Subtitles } from "@game/ui/subtitles/Subtitles";
import { MainMenu } from "@game/ui/menu/MainMenu";
import type { CustomMapEntry, GameMenuState } from "@game/ui/menu/MainMenuState";
import { LevelEditor } from "@game/editor/LevelEditor";
import {
  getEditorMode,
  loadDraft,
  pickJsonFile,
  saveDraft,
  setEditorMode,
} from "@game/editor/persistence";
import {
  clearRespawnRequest,
  getRespawnRequest,
  setRespawnRequest,
} from "@game/gameplay/player/respawnRequest";
import { toLevelDefinition } from "@game/editor/codegen/toLevelDefinition";
import { fromLevelDefinition } from "@game/editor/codegen/fromLevelDefinition";
import {
  deleteLibraryMap,
  getLibraryMap,
  saveLibraryMap,
} from "@game/editor/mapLibrary";
import type { EditorDocument } from "@game/editor/EditorDocument";
import type { PublishMeta } from "@game/workshop/WorkshopTypes";
import { WorkshopService } from "@game/workshop/WorkshopService";
import { WorkshopStore } from "@game/workshop/WorkshopStore";
import { CloudflareWorkshopBackend } from "@game/workshop/CloudflareWorkshopBackend";
import { createBoxMesh } from "@engine/render/PrimitiveFactory";
import { tupleToVector3, type VectorTuple } from "@shared/math/VectorTuple";
import type { SurfaceType } from "@shared/types/Surface";

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

/** Dirección reutilizable para el raycast de superficie bajo el jugador. */
const DOWN_DIRECTION = new Vector3(0, -1, 0);

export class Game {
  private readonly root: HTMLElement;
  private readonly bootIntoLevel?: LevelId;

  private gameState: GameMenuState = "mainMenu";
  private currentLevel: LevelDefinition | null = null;
  private player: Player | null = null;
  private playerModel: PlayerModelSystem | null = null;
  private uninstallNpcConsole: (() => void) | null = null;
  private uninstallIceConsole: (() => void) | null = null;
  private uninstallPlayerModelConsole: (() => void) | null = null;
  private npcs: INpc[] = [];
  private doors: SlidingDoor[] = [];
  private weaponPickups: WeaponPickup[] = [];
  private itemPickups: ItemPickup[] = [];
  private ammoPickups: AmmoPickup[] = [];
  private chargers: Charger[] = [];
  private tacticalMap: TacticalMap | null = null;
  private squadDirector: SquadDirector | null = null;
  private buildingRegistry: BuildingRegistry | null = null;
  private navSpace: NavSpace | null = null;
  private pathQueue: PathRequestQueue | null = null;
  private pendingExitTimeoutId: number | null = null;
  private playtestMode = false;
  /** Cargando el siguiente nivel encadenado: congela `tickPlaying` mientras dura. */
  private transitioning = false;
  private readonly crashingGunships = new Map<string, { startedAt: number | null }>();
  private readonly collapsingStriders = new Map<string, { startedAt: number | null }>();
  /** Último checkpoint cruzado en el nivel actual (snapshot para respawn). null = inicio del nivel. */
  private lastCheckpoint: CheckpointSnapshot | null = null;
  private readonly deathSequence = new DeathSequence();
  private deathScreen: DeathScreen | null = null;
  private transitionOverlay: TransitionOverlay | null = null;
  /** True durante la caída de cámara post-muerte (antes de mostrar el prompt). */
  private dying = false;
  private actionSpawnSerial = 0;
  private readonly npcContextRadius = 90;

  constructor(private readonly engine: Engine, options: GameOptions = {}) {
    this.root = engine.root;
    this.bootIntoLevel = options.bootIntoLevel;

    this.registerEventBus();
    this.registerWorkshop();
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
    footsteps.setSurfacePools(SurfaceFootsteps);

    // El modo del editor es de un solo uso: se consume y se borra en el boot,
    // asi un reload/reinicio posterior vuelve al menu (no al ultimo mapa).
    const editorMode = getEditorMode();
    if (editorMode) setEditorMode(null);
    if (editorMode === "playtest") {
      const draft = loadDraft();
      if (draft) {
        try {
          await this.startPlaytest(toLevelDefinition(draft));
          return;
        } catch (error) {
          console.warn("[Game] No se pudo probar el draft del editor:", error);
        }
      }
    } else if (editorMode === "edit") {
      this.enterEditor();
      return;
    }

    // Respawn estilo HL: el reload tras "Reintentar" deja un request en
    // sessionStorage. Recargamos el nivel reapareciendo en el checkpoint.
    const respawn = getRespawnRequest();
    if (respawn && respawn.levelId in LevelRegistry) {
      clearRespawnRequest();
      try {
        await this.startLevel(getLevel(respawn.levelId), respawn.snapshot ?? undefined);
        return;
      } catch (error) {
        console.warn("[Game] No se pudo respawnear; volviendo al menú:", error);
      }
    } else if (respawn) {
      clearRespawnRequest();
    }

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
    this.crashingGunships.clear();
    this.collapsingStriders.clear();
    this.uninstallNpcConsole?.();
    this.uninstallNpcConsole = null;
    this.uninstallIceConsole?.();
    this.uninstallIceConsole = null;
    this.uninstallPlayerModelConsole?.();
    this.uninstallPlayerModelConsole = null;

    const s = this.engine.services;
    s.resolve(GameTokens.Dialogue).dispose();
    s.resolve(GameTokens.WeaponEffects).dispose();
    s.resolve(GameTokens.NpcBloodEffects).dispose();
    s.resolve(GameTokens.Grenades).dispose();
    s.resolve(GameTokens.Rockets).dispose();
    s.resolve(GameTokens.Bolts).dispose();
    s.resolve(GameTokens.EnergyBalls).dispose();
    s.resolve(GameTokens.IceGun).dispose();
    s.resolve(GameTokens.Portals).dispose();
    this.player?.dispose();
    this.deathScreen?.dispose();
    this.transitionOverlay?.dispose();
    s.resolve(GameTokens.HUD).dispose();
    s.resolve(GameTokens.ScopeOverlay).dispose();
    s.resolve(GameTokens.Subtitles).dispose();
    s.resolve(GameTokens.MainMenu).dispose();
    s.resolve(GameTokens.DebugMenu).dispose();
    s.resolve(GameTokens.LevelEditor).dispose();
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
    const audio = s.resolve(EngineTokens.Audio);
    const sound = s.resolve(EngineTokens.Sound);
    const positionalSound = s.resolve(EngineTokens.PositionalSound);
    const ambience = new BackgroundAmbienceSystem(sound);

    s.register(GameTokens.BackgroundAmbience, ambience);
    s.register(GameTokens.Soundscapes, new SoundscapeSystem(audio, ambience));
    s.register(GameTokens.Music, new MusicManager(sound));
    s.register(GameTokens.Footsteps, new FootstepSoundSystem(sound));
    s.register(GameTokens.WeaponSounds, new WeaponSoundSystem(eventBus, sound));
    s.register(
      GameTokens.EnemySounds,
      new EnemySoundSystem(eventBus, sound, positionalSound),
    );
    s.register(
      GameTokens.DialogueSounds,
      new DialogueAudioSystem(eventBus, sound),
    );
    s.register(GameTokens.HevSuitSounds, new HevSuitSoundSystem(eventBus, sound));
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
    const weaponEffects = new WeaponEffects(scene.scene, eventBus, raycast);
    s.register(GameTokens.WeaponEffects, weaponEffects);
    const vfx = s.resolve(EngineTokens.Vfx);
    s.register(
      GameTokens.NpcBloodEffects,
      new NpcBloodEffects(scene.scene, eventBus, raycast, vfx),
    );
    // Los portales se registran antes que los proyectiles: estos reciben el
    // raycast portal-aware para atravesar el par linked.
    const portals = new PortalGunSystem(
      scene.scene,
      physics,
      raycast,
      eventBus,
      s.resolve(EngineTokens.Renderer),
      s.resolve(EngineTokens.Camera),
    );
    s.register(GameTokens.Portals, portals);
    const grenades = new GrenadeSystem(
      physics,
      scene.scene,
      assets,
      raycast,
      eventBus,
      positionalSounds,
      vfx,
      // Las granadas impact no detonan contra la boca de un portal linked.
      portals.pair,
    );
    s.register(GameTokens.Grenades, grenades);
    s.register(
      GameTokens.Rockets,
      new RocketSystem(
        scene.scene,
        assets,
        raycast,
        grenades,
        vfx,
        positionalSounds,
        portals.throughRaycast,
      ),
    );
    s.register(
      GameTokens.Bolts,
      new BoltSystem(scene.scene, raycast, eventBus, portals.throughRaycast),
    );
    s.register(
      GameTokens.EnergyBalls,
      new EnergyBallSystem(
        scene.scene,
        raycast,
        eventBus,
        grenades,
        vfx,
        positionalSounds,
        portals.throughRaycast,
      ),
    );
    s.register(
      GameTokens.IceGun,
      new IceGunSystem(scene.scene, physics, raycast, eventBus, vfx),
    );
    s.register(
      GameTokens.ExplosiveBarrels,
      new ExplosiveBarrelSystem(physics, scene.scene, grenades),
    );
    const propImpacts = s.register(
      GameTokens.PropImpacts,
      new PropImpactSystem(physics, raycast, eventBus),
    );
    s.register(GameTokens.InteractSystem, new InteractSystem(eventBus));
    s.register(
      GameTokens.GrabSystem,
      new GrabSystem(eventBus, physics, raycast, portals.pair, propImpacts),
    );
    s.register(GameTokens.TriggerSystem, new TriggerSystem(eventBus));
    s.register(GameTokens.CheckpointSystem, new CheckpointSystem(eventBus));
    s.register(GameTokens.HazardVolumes, new HazardVolumeSystem(eventBus, vfx));

    eventBus.on("npc.weapon.dropped", (payload) => {
      void this.handleWeaponDrop(payload.npcId, payload.weaponId, payload.position);
    });
    eventBus.on("npc.killed", ({ id, characterId }) => {
      if (characterId === "gunship") {
        this.crashingGunships.set(id, { startedAt: null });
      } else if (characterId === "strider") {
        this.collapsingStriders.set(id, { startedAt: null });
      }
    });
    const striderCannonColor = 0x53c8ff;
    eventBus.on("strider.cannon.impact", ({ point, origin, damage, radius, impulse, sourceId, sourceFaction }) => {
      weaponEffects.beam(origin, point, striderCannonColor);
      grenades.detonate(point, {
        damage,
        radius,
        impulse,
        ownerKind: "npc",
        sourceId,
        sourceFaction,
        weaponName: "Strider Cannon",
        color: new Color(striderCannonColor),
      });
    });
    eventBus.on("level.action", ({ action, position }) => {
      void this.handleLevelAction(action, position);
    });
    eventBus.on("trigger.action", ({ action, position }) => {
      void this.runTriggerAction(action, position);
    });
    eventBus.on("checkpoint.reached", ({ position }) => {
      this.captureCheckpoint(position);
    });
    eventBus.on("player.dead", () => {
      this.beginDeath();
    });
    eventBus.on("player.hazard", ({ amount, kind }) => {
      this.player?.health.takeDamage(amount, kind);
    });
    // Links warp del NavSpace: cada colocación/limpieza del par re-deriva los
    // edges dinámicos para que los NPCs planeen rutas a través de los portales.
    const refreshPortalNavLinks = (): void => {
      if (!this.navSpace || !PortalConfig.npcTraversal.enabled) {
        return;
      }
      this.navSpace.setDynamicLinks(
        computePortalNavLinks(portals.pair, this.navSpace),
      );
    };
    eventBus.on("portal.placed", refreshPortalNavLinks);
    eventBus.on("portal.cleared", refreshPortalNavLinks);
  }

  /**
   * Arranca la secuencia de muerte estilo HL: la cámara cae al piso (con el
   * arma) y el tinte rojo sube mientras el mundo sigue simulando. Mantiene
   * `gameState` en "playing" para que `tickPlaying` anime la caída; al terminar
   * pasa a "gameOver" y muestra el prompt del traje H.E.V.
   */
  private beginDeath(): void {
    if (this.gameState !== "playing" || this.dying) {
      return;
    }
    const camera = this.engine.services.resolve(EngineTokens.Camera);
    this.dying = true;
    this.deathSequence.start(camera.camera, camera.getYaw(), camera.getPitch());
    this.deathScreen?.begin();
    // Reusar el HUD real (salud/traje en 0) en vez de vitales aparte.
    this.engine.services.resolve(GameTokens.HUD).setDeathMode(true);
  }

  /** Captura el estado del jugador en un checkpoint para un eventual respawn. */
  private captureCheckpoint(position: Vector3): void {
    if (!this.player || !this.player.isAlive()) {
      return;
    }
    const loadout = this.player.weapons.captureLoadout();
    this.lastCheckpoint = {
      position: [position.x, position.y, position.z],
      health: this.player.health.current,
      armor: this.player.health.armor,
      weapons: loadout.entries,
      ammo: loadout.ammo,
      activeWeaponId: loadout.activeId,
    };
    this.engine.services
      .resolve(GameTokens.EventBus)
      .emit("subtitle.show", Dialogue.checkpointReached);
  }

  /**
   * Respawn estilo HL: persiste el snapshot del último checkpoint y recarga la
   * página para teardown limpio del nivel (igual que "Salir al menú"). El boot
   * detecta el request y recarga el nivel reapareciendo en el checkpoint. Solo
   * para niveles resolubles por id (campaña + carpeta custom).
   */
  private requestRespawn(): void {
    if (!this.currentLevel || !(this.currentLevel.id in LevelRegistry)) {
      return;
    }
    setRespawnRequest({
      levelId: this.currentLevel.id,
      snapshot: this.lastCheckpoint,
    });
    this.deathScreen?.hide();
    this.engine.services
      .resolve(GameTokens.MainMenu)
      .showLoading(MenuStrings.loadingFallback);
    this.pendingExitTimeoutId = window.setTimeout(() => {
      this.pendingExitTimeoutId = null;
      window.location.reload();
    }, 250);
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

  /** Ejecuta una acción disparada por un trigger (ya pasó su `delay`). */
  private async runTriggerAction(
    action: TriggerAction,
    position: Vector3,
  ): Promise<void> {
    if (!this.currentLevel) {
      return;
    }
    switch (action.kind) {
      case "dialogue":
        this.engine.services.resolve(GameTokens.EventBus).emit("dialogue.show", {
          speaker: action.speaker,
          text: action.text,
          duration: action.duration,
        });
        return;
      case "spawnNpcs": {
        this.actionSpawnSerial += 1;
        await this.spawnNpcs(action.npcs, `trigger-${this.actionSpawnSerial}`);
        return;
      }
      case "door":
        this.setDoorOpen(action.doorId, action.open);
        return;
      case "levelAction":
        await this.handleLevelAction(action.action, position);
        return;
      case "objective":
        this.engine.services.resolve(GameTokens.EventBus).emit("objective.updated", {
          text: action.text,
          completed: action.completed,
          marker: action.marker ? tupleToVector3(action.marker) : null,
        });
        return;
      case "soundscape":
        this.engine.services
          .resolve(GameTokens.Soundscapes)
          .activate(action.soundscape, this.currentLevel.audio.ambiences);
        return;
      case "endLevel":
        void this.goToNextLevel(action.landmark, position);
        return;
    }
  }

  /**
   * Transición estilo Half-Life 2 al `nextLevel`: carga in-place (sin recargar
   * la página) con un overlay translúcido sobre el frame congelado, conservando
   * loadout, vida y orientación. El spawn es relativo al landmark (ver
   * `computeTransitionSpawn`), así parece un mundo continuo. Sin `nextLevel`
   * resoluble → fin de campaña (menú, vía reload). En playtest no navega.
   */
  private async goToNextLevel(
    landmark: VectorTuple | undefined,
    triggerPos: Vector3,
  ): Promise<void> {
    if (this.transitioning || !this.currentLevel || !this.player) {
      return;
    }
    if (this.playtestMode) {
      this.engine.services.resolve(GameTokens.EventBus).emit("subtitle.show", {
        text: "Salida de nivel alcanzada (playtest).",
        duration: 3,
      });
      return;
    }
    const nextId = this.currentLevel.nextLevel;
    if (!nextId || !(nextId in LevelRegistry)) {
      this.exitToMainMenu();
      return;
    }

    this.transitioning = true;
    const next = getLevel(nextId);
    const spawn = this.computeTransitionSpawn(landmark, triggerPos, next);
    this.transitionOverlay?.show(next.title);
    // Dejar que el overlay pinte sobre el frame congelado antes del trabajo síncrono.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    try {
      await this.loadLevelDefinition(next, spawn ?? undefined);
      this.activateLevelSoundscape(next);
      this.transitionOverlay?.hide();
      this.transitioning = false;
    } catch (error) {
      // Carga a medio armar: caer al menú (reload) es la salida segura.
      console.error("[Game] Falló la transición de nivel; volviendo al menú:", error);
      this.transitionOverlay?.hide();
      this.transitioning = false;
      this.exitToMainMenu();
    }
  }

  /**
   * Calcula el spawn del nivel siguiente conservando el loadout/vitales y la
   * posición RELATIVA al landmark (estilo `info_landmark` de HL2): el offset del
   * jugador respecto del landmark de salida se aplica al `entryLandmark` del
   * destino. Sin `entryLandmark`, cae al `playerStart`. El yaw también cruza.
   */
  private computeTransitionSpawn(
    landmark: VectorTuple | undefined,
    triggerPos: Vector3,
    next: LevelDefinition,
  ): CheckpointSnapshot | null {
    if (!this.player) {
      return null;
    }
    const camera = this.engine.services.resolve(EngineTokens.Camera);
    const loadout = this.player.weapons.captureLoadout();

    let position: VectorTuple;
    if (next.entryLandmark) {
      const ref = landmark ? tupleToVector3(landmark) : triggerPos;
      const offset = this.player.getPosition().clone().sub(ref);
      const dest = tupleToVector3(next.entryLandmark).add(offset);
      position = [dest.x, dest.y, dest.z];
    } else {
      position = [next.playerStart[0], next.playerStart[1], next.playerStart[2]];
    }

    return {
      position,
      yaw: camera.getYaw(),
      health: this.player.health.current,
      armor: this.player.health.armor,
      weapons: loadout.entries,
      ammo: loadout.ammo,
      activeWeaponId: loadout.activeId,
    };
  }

  private setDoorOpen(doorId: string, open: boolean): void {
    const door = this.doors.find((d) => d.id === doorId);
    if (!door) {
      console.warn(`[Game] Trigger: puerta '${doorId}' no existe`);
      return;
    }
    door.setOpen(open);
    this.engine.services
      .resolve(GameTokens.EventBus)
      .emit("door.opened", { id: doorId, open });
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
    const enemySounds = services.resolve(GameTokens.EnemySounds);
    const spawnValidator = new SpawnValidator(new Raycast(physics));

    const npcServices = this.buildNpcRuntimeServices(new Raycast(physics));
    for (const definition of definitions) {
      const requested = tupleToVector3(definition.position);
      const preset =
        CharacterPresets[definition.characterId] ??
        CharacterPresets.placeholderHumanoid;
      const halfExtent = preset.collider.height / 2;
      // Los voladores conservan su altura de diseño (no se pegan al suelo).
      const validation = isFlyingCharacter(preset)
        ? { position: requested, valid: true, relocated: false }
        : spawnValidator.validate(requested, halfExtent);
      const npc = await characters.createNPC(
        definition.characterId,
        `${idPrefix}-${definition.id}`,
        validation.position,
        definition.patrol?.map(tupleToVector3) ?? [],
        npcServices,
      );
      scene.scene.add(npc.mesh);
      enemySounds.registerActor(npc.id, npc.mesh, definition.characterId);
      this.npcs.push(npc);
    }
  }

  /**
   * Servicios de runtime que la factory necesita para construir NPCs v2.
   * `undefined` si el nivel todavia no cargo (la factory cae al path legacy).
   */
  private buildNpcRuntimeServices(raycast: Raycast): NpcRuntimeServices | undefined {
    if (
      !this.navSpace ||
      !this.pathQueue ||
      !this.buildingRegistry ||
      !this.tacticalMap ||
      !this.squadDirector
    ) {
      return undefined;
    }
    return {
      navSpace: this.navSpace,
      pathQueue: this.pathQueue,
      buildingRegistry: this.buildingRegistry,
      raycast,
      ...this.buildNpcPortalServices(),
      tacticalMap: this.tacticalMap,
      squadDirector: this.squadDirector,
    };
  }

  /**
   * Wiring de portales que TODO camino de spawn de NPCs debe proveer (LOS y
   * disparo portal-aware, cruce de flyers). Centralizado: cuando cada caller
   * lo armaba a mano, LevelLoader lo omitió y los NPCs del nivel no veían por
   * los portales.
   */
  private buildNpcPortalServices(): NpcPortalServices {
    const portals = this.engine.services.resolve(GameTokens.Portals);
    const eventBus = this.engine.services.resolve(GameTokens.EventBus);
    return {
      losRaycast: portals.throughRaycast,
      portals: portals.pair,
      onFlyerPortalTeleport: (npcId, exitPosition) => {
        eventBus.emit("portal.teleported", {
          entityKind: "npc",
          entityId: npcId,
          exitPosition,
        });
      },
    };
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

  /**
   * Spawn debug: lanza un raycast desde la cámara y crea un Combine en el
   * primer impacto válido. Si el suelo está demasiado lejos o el rayo no
   * pega nada, no hace nada (mensaje en la consola).
   */
  private async spawnDebugCombineAtAim(): Promise<void> {
    if (!this.currentLevel) return;
    const services = this.engine.services;
    const camera = services.resolve(EngineTokens.Camera);
    const physics = services.resolve(EngineTokens.Physics);
    const scene = services.resolve(EngineTokens.Scene);
    const characters = services.resolve(GameTokens.Characters);
    const eventBus = services.resolve(GameTokens.EventBus);

    const raycast = new Raycast(physics);
    const origin = camera.camera.position;
    const direction = camera.getForwardDirection();
    const hit = raycast.cast(origin, direction, 100);
    if (!hit) {
      eventBus.emit("subtitle.show", {
        text: "No hay superficie para spawnear Combine.",
        duration: 1.5,
      });
      return;
    }

    this.actionSpawnSerial += 1;
    const instanceId = `action-combine-${this.actionSpawnSerial}`;
    const preset = CharacterPresets.combine ?? CharacterPresets.placeholderHumanoid;
    const halfExtent = preset.collider.height / 2;
    const validator = new SpawnValidator(raycast);
    const validation = validator.validate(hit.point, halfExtent);

    try {
      const npc = await characters.createNPC(
        "combine",
        instanceId,
        validation.position,
        [],
        this.buildNpcRuntimeServices(raycast),
      );
      scene.scene.add(npc.mesh);
      services.resolve(GameTokens.EnemySounds).registerActor(npc.id, npc.mesh, "combine");
      this.npcs.push(npc);
      eventBus.emit("subtitle.show", {
        text: "Combine spawneado.",
        duration: 1.2,
      });
    } catch (error) {
      console.warn("[Game] No se pudo spawnear combine debug:", error);
    }
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

    for (let i = 0; i < AMMO_ORDER.length; i += 1) {
      const column = i % 6;
      const position = origin
        .clone()
        .add(new Vector3((column - 2.5) * 1.15, 0.2, 5.4));
      const pickup = await AmmoPickup.create(scene.scene, physics, assets, {
        id: `action-ammo-${this.actionSpawnSerial}-${i}-${AMMO_ORDER[i]}`,
        ammoId: AMMO_ORDER[i],
        position,
      });
      this.ammoPickups.push(pickup);
    }
  }

  private registerWorkshop(): void {
    const s = this.engine.services;
    const eventBus = s.resolve(GameTokens.EventBus);
    s.register(
      GameTokens.Workshop,
      new WorkshopService(new CloudflareWorkshopBackend(), new WorkshopStore(), eventBus),
    );
  }

  private registerUi(): void {
    const s = this.engine.services;
    const eventBus = s.resolve(GameTokens.EventBus);
    const audio = s.resolve(EngineTokens.Audio);
    const controls = s.resolve(GameTokens.Controls);
    const workshop = s.resolve(GameTokens.Workshop);
    const input = s.resolve(EngineTokens.Input);
    const scene = s.resolve(EngineTokens.Scene);
    const raycast = s.resolve(EngineTokens.Raycast);

    s.register(GameTokens.HUD, new HUD(this.root, eventBus));
    s.register(GameTokens.ScopeOverlay, new ScopeOverlay(this.root, eventBus));

    s.register(
      GameTokens.LevelEditor,
      new LevelEditor(
        this.root,
        scene.scene,
        s.resolve(EngineTokens.Camera),
        s.resolve(EngineTokens.Renderer).canvas,
        input,
        s.resolve(EngineTokens.Environment),
        s.resolve(EngineTokens.Lighting),
        {
          onExit: () => this.exitEditor(),
          onPublish: (doc, meta) => this.publishFromEditor(doc, meta),
          canPublish: () =>
            this.engine.services.resolve(GameTokens.Workshop).capabilities.publish,
        },
      ),
    );

    this.uninstallNpcConsole = installNpcConsole(() => this.npcs);
    this.uninstallIceConsole = installIceConsole(() =>
      s.resolve(GameTokens.IceGun),
    );
    this.uninstallPlayerModelConsole = installPlayerModelConsole(
      () => this.playerModel,
    );

    const debugMenu = new DebugMenu(this.root, input, controls, eventBus);
    debugMenu.register(new StatsModule());
    debugMenu.register(new PlayerModule(eventBus));
    debugMenu.register(new WeaponsModule());
    debugMenu.register(new NpcsModule());
    debugMenu.register(new AiViewModule(scene.scene, raycast));
    debugMenu.register(new AiTraceModule(eventBus));
    debugMenu.register(new SceneModule(scene.scene));
    s.register(GameTokens.DebugMenu, debugMenu);

    s.register(
      GameTokens.MainMenu,
      new MainMenu(this.root, {
        onStartChapter: (chapterId) => {
          void this.startNewGame(chapterId as LevelId);
        },
        onStartCustomMap: (entry) => {
          void this.startCustomMap(entry);
        },
        onEditCustomMap: (entry) => {
          void this.editCustomMap(entry);
        },
        onDeleteLibraryMap: (id) => this.deleteCustomMap(id),
        onImportCustomMap: () => {
          void this.importCustomMap();
        },
        onResume: () => this.setGameState("playing"),
        onExitToMain: () => this.exitToMainMenu(),
        onOpenEditor: () => this.enterEditor(),
        onSound: (cue) => {
          audio.unlock();
          eventBus.emit("ui.sound", { cue });
        },
        onToggleDebug: (enabled) => debugMenu.setVisible(enabled),
        onVolumeChange: (bus, value) => audio.setVolume(bus, value),
        onGetVolume: (bus) => audio.getVolume(bus),
        controls,
        workshop,
      }),
    );

    this.deathScreen = new DeathScreen(this.root, {
      onRespawn: () => this.requestRespawn(),
      onExit: () => this.exitToMainMenu(),
    });
    this.transitionOverlay = new TransitionOverlay(this.root);
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

    if (input.wasKeyPressed("F4")) {
      if (this.playtestMode) this.returnToEditorFromPlaytest();
      else this.toggleEditor();
    }

    if (this.gameState === "editor") {
      s.resolve(GameTokens.LevelEditor).update(time);
      this.engine.renderFrame();
      input.endFrame();
      return;
    }

    if (controls.wasPressed("pause") && this.gameState === "playing" && !this.dying) {
      this.setGameState("paused");
    }

    if (this.gameState !== "playing" || !this.player || this.transitioning) {
      // Durante la transición de nivel NO renderizamos: el canvas conserva el
      // último frame (congelado) bajo el overlay translúcido mientras se arma
      // el nivel nuevo, sin mostrar la escena a medio desmontar.
      if (!this.transitioning) {
        this.engine.renderFrame();
      }
      input.endFrame();
      return;
    }

    this.tickPlaying(time);

    s.resolve(GameTokens.Portals).updateRender(
      this.player ? [this.player.weapons.getViewModelRoot()] : [],
      this.playerModel?.getPortalRevealObjects() ?? [],
    );
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
      navSpace: this.navSpace,
      rendererInfo: renderer.renderer.info,
      physicsBodies: physics.getBodyCount(),
      playerPosition: this.player?.getPosition() ?? null,
    });
  }

  /**
   * Superficie física bajo el jugador (para elegir el pool de pasos). Rayo
   * corto hacia abajo desde los pies, excluyendo el propio collider `player`.
   */
  private resolvePlayerSurface(raycast: Raycast, player: Player): SurfaceType | null {
    const origin = player.getPosition().clone();
    origin.y += 0.2;
    const hit = raycast.cast(origin, DOWN_DIRECTION, 4, undefined, "player");
    return hit?.metadata?.surface ?? null;
  }

  /** Tick completo cuando el juego estÃ¡ activo (no en menÃº/pausa). */
  private tickPlaying(time: Time): void {
    const player = this.player!;
    const s = this.engine.services;
    const input = s.resolve(EngineTokens.Input);
    const controls = s.resolve(GameTokens.Controls);
    const camera = s.resolve(EngineTokens.Camera);
    const physics = s.resolve(EngineTokens.Physics);
    const raycast = s.resolve(EngineTokens.Raycast);
    const gizmos = s.resolve(EngineTokens.Gizmos);
    const interactSystem = s.resolve(GameTokens.InteractSystem);
    const triggerSystem = s.resolve(GameTokens.TriggerSystem);
    const checkpointSystem = s.resolve(GameTokens.CheckpointSystem);
    const hazardVolumes = s.resolve(GameTokens.HazardVolumes);
    const weaponEffects = s.resolve(GameTokens.WeaponEffects);
    const npcBloodEffects = s.resolve(GameTokens.NpcBloodEffects);
    const subtitles = s.resolve(GameTokens.Subtitles);
    const footsteps = s.resolve(GameTokens.Footsteps);
    const grenades = s.resolve(GameTokens.Grenades);
    const rockets = s.resolve(GameTokens.Rockets);
    const bolts = s.resolve(GameTokens.Bolts);
    const energyBalls = s.resolve(GameTokens.EnergyBalls);
    const iceGun = s.resolve(GameTokens.IceGun);
    const portals = s.resolve(GameTokens.Portals);
    const explosiveBarrels = s.resolve(GameTokens.ExplosiveBarrels);
    const vfx = s.resolve(EngineTokens.Vfx);

    const grabSystem = s.resolve(GameTokens.GrabSystem);
    if (this.dying) {
      grabSystem.clear();
      this.updateDeath(time.delta);
    } else if (input.isPointerLocked()) {
      camera.updateLook(input);
      camera.updateReorient(time.delta);
      // Antes de player.update: el carry decide si este frame LMB empuja el
      // prop en vez de disparar el arma equipada.
      grabSystem.update(
        time.delta,
        time.elapsed,
        camera.camera.position,
        camera.getForwardDirection(),
        camera.camera.quaternion,
        player.getPosition(),
        controls,
        input,
        player.weapons,
        interactSystem.getFocused() !== null,
      );
      player.update(time.delta, input, controls, camera, time.elapsed);
    }
    this.playerModel?.update(time.delta, time.elapsed, player, camera);

    if (controls.wasPressed("spawnDebugCombine")) {
      void this.spawnDebugCombineAtAim();
    }

    const stepped = footsteps.update(
      time.delta,
      player.getMoveIntensity(),
      () => this.resolvePlayerSurface(raycast, player),
    );
    // Ruido de sigilo: cada paso audible avisa a los NPCs cercanos. Agacharse
    // es silencioso; correr hace mucho más ruido que caminar.
    if (stepped && !player.isCrouched()) {
      const eventBus = s.resolve(GameTokens.EventBus);
      eventBus.emit("world.noise", {
        kind: "movement",
        position: player.getPosition().clone(),
        radius: player.isSprinting() ? 12 : 4,
        sourceId: "player",
        sourceFaction: "player",
      });
    }

    let playerPosition = player.getPosition();
    this.weaponPickups.forEach((pickup) =>
      pickup.update(time.delta, playerPosition, player.weapons),
    );
    this.itemPickups.forEach((pickup) =>
      pickup.update(time.delta, playerPosition, player.health),
    );
    this.ammoPickups.forEach((pickup) =>
      pickup.update(time.delta, playerPosition, player.weapons),
    );
    if (this.tacticalMap && this.navSpace && this.squadDirector) {
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
      const portalGhosts: ActorSnapshot[] = portals
        .projectPointThroughPortals(playerPosition)
        .map((position) => ({
          ...playerSnapshot,
          position,
          navPosition: playerSnapshot.position,
        }));
      const ctx: AiFrameContext = {
        delta: time.delta,
        elapsed: time.elapsed,
        aiLod: "near",
        player: playerSnapshot,
        npcs: [],
        portalGhosts: portalGhosts.length > 0 ? portalGhosts : undefined,
        tacticalMap: this.tacticalMap,
        squadDirector: this.squadDirector,
        eventBus: s.resolve(GameTokens.EventBus),
      };
      this.pathQueue?.process();
      this.npcs.forEach((npc) => {
        ctx.aiLod = this.computeNpcAiLod(npc.position, playerPosition);
        ctx.npcs = npcIndex.query(npc.position, this.npcContextRadius, npc.id);
        npc.update(ctx);
      });
      this.squadDirector.tickAssignments(time.elapsed, null);
    }
    this.doors.forEach((door) => door.update(time.delta));
    physics.step(time.delta);
    this.npcs.forEach((npc) => npc.syncFromPhysics());
    s.resolve(GameTokens.PropImpacts).update(time.delta, time.elapsed);
    this.updateGunshipCrashes(time.elapsed, raycast, grenades);
    this.updateStriderCollapses(time.elapsed, raycast, grenades);
    grenades.update(time.delta, time.elapsed);
    rockets.update(time.delta, time.elapsed);
    bolts.update(time.delta, time.elapsed);
    energyBalls.update(time.delta, time.elapsed, this.npcs);
    iceGun.update(
      time.delta,
      time.elapsed,
      this.npcs
        .map((npc) => npc.getFreezeHandle())
        .filter((handle): handle is NpcFreezeHandle => handle !== null),
    );
    portals.update(time.delta, time.elapsed, this.dying ? undefined : player, camera);
    if (PortalConfig.npcTraversal.enabled) {
      portals.updateNpcTraversal(
        time.elapsed,
        this.npcs
          .map((npc) => npc.getPortalTraversalHandle())
          .filter((handle): handle is NpcPortalHandle => handle !== null),
      );
    }
    explosiveBarrels.update();

    playerPosition = player.getPosition();
    // Mientras la cámara cae (muerte) no la re-anclamos a los ojos del jugador.
    if (!this.dying) {
      camera.syncToPosition(player.getEyePosition());
    }
    // Update the viewmodel after the camera follows the resolved physics pose.
    player.tickRender(time.delta, camera);
    if (!this.dying) {
      interactSystem.update(
        time.delta,
        camera.camera.position,
        camera.getForwardDirection(),
        controls,
      );
    }
    triggerSystem.update(playerPosition, time.delta);
    checkpointSystem.update(playerPosition);
    hazardVolumes.update(playerPosition, time.delta);
    s.resolve(GameTokens.HUD).updateObjective(camera.camera);
    subtitles.update(time.delta);
    weaponEffects.update(time.delta);
    npcBloodEffects.update(time.delta);
    vfx.update(time.delta);
    gizmos.update(time.delta);
  }

  /**
   * Anima la caída de la cámara durante la muerte y, al completarse, pasa a
   * "gameOver" mostrando el prompt del traje H.E.V. Mantiene `this.dying` en
   * true (tickPlaying no vuelve a correr en "gameOver", así la cámara queda
   * congelada en el piso).
   */
  private updateDeath(delta: number): void {
    const camera = this.engine.services.resolve(EngineTokens.Camera);
    this.deathSequence.update(delta, camera.camera);
    this.deathScreen?.setIntensity(this.deathSequence.progress);
    if (this.deathSequence.isComplete() && this.gameState === "playing") {
      this.setGameState("gameOver");
      const canRespawn =
        this.currentLevel !== null && this.currentLevel.id in LevelRegistry;
      this.deathScreen?.showPrompt(canRespawn);
    }
  }

  private computeNpcAiLod(position: Vector3, playerPosition: Vector3): AiFrameContext["aiLod"] {
    const distanceSq = position.distanceToSquared(playerPosition);
    if (distanceSq < 55 * 55) {
      return "near";
    }
    if (distanceSq < 115 * 115) {
      return "mid";
    }
    return "far";
  }

  private updateGunshipCrashes(elapsed: number, raycast: Raycast, grenades: GrenadeSystem): void {
    if (this.crashingGunships.size === 0) return;
    const down = new Vector3(0, -1, 0);
    for (const [id, crash] of [...this.crashingGunships]) {
      const npc = this.npcs.find((candidate) => candidate.id === id);
      if (!npc) {
        this.crashingGunships.delete(id);
        continue;
      }
      if (crash.startedAt === null) crash.startedAt = elapsed;

      const probe = npc.position.clone();
      probe.y -= Math.max(npc.radius * 1.6, 1.4);
      const hit = raycast.cast(probe, down, 1.3);
      const hitKind = hit?.metadata?.kind;
      const touchedGround =
        !!hit && hit.metadata?.id !== id && (hitKind === "static" || hitKind === "door" || hitKind === "dynamic");
      const timedOut = elapsed - crash.startedAt >= 3.5;
      if (!touchedGround && !timedOut) continue;

      const point = hit?.point.clone() ?? npc.position.clone().add(new Vector3(0, -npc.radius, 0));
      point.y += 0.25;
      grenades.detonate(point, {
        damage: 140,
        radius: 6,
        impulse: 22,
        ownerKind: "npc",
        sourceId: id,
        sourceFaction: "combine",
        weaponName: "gunshipCrash",
      });
      this.crashingGunships.delete(id);
    }
  }

  private updateStriderCollapses(elapsed: number, raycast: Raycast, grenades: GrenadeSystem): void {
    if (this.collapsingStriders.size === 0) return;
    const down = new Vector3(0, -1, 0);
    for (const [id, collapse] of [...this.collapsingStriders]) {
      const npc = this.npcs.find((candidate) => candidate.id === id);
      if (!npc) {
        this.collapsingStriders.delete(id);
        continue;
      }
      if (collapse.startedAt === null) collapse.startedAt = elapsed;

      const probe = npc.position.clone();
      probe.y -= Math.max(npc.radius * 2.4, 2.5);
      const hit = raycast.cast(probe, down, 2.2);
      const hitKind = hit?.metadata?.kind;
      const touchedGround =
        !!hit && hit.metadata?.id !== id && (hitKind === "static" || hitKind === "door" || hitKind === "dynamic");
      const timedOut = elapsed - collapse.startedAt >= 3.2;
      if (!touchedGround && !timedOut) continue;

      const point = hit?.point.clone() ?? npc.position.clone().add(new Vector3(0, -npc.radius * 2, 0));
      point.y += 0.35;
      grenades.detonate(point, {
        damage: 220,
        radius: 7,
        impulse: 28,
        ownerKind: "npc",
        sourceId: id,
        sourceFaction: "combine",
        weaponName: "Strider Collapse",
      });
      this.collapsingStriders.delete(id);
    }
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
      !debugRelease &&
      !this.dying
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
    // El HUD queda visible en "gameOver" para mostrar los vitales reales bajo
    // el terminal H.E.V.; el DeathScreen ya oscurece el resto.
    hud.setVisible(state === "playing" || state === "gameOver");

    if (state === "playing") {
      hud.setDeathMode(false);
      mainMenu.setStatus(MenuStrings.ready);
      this.enterCapture();
    } else {
      // El Game Over se entra programáticamente con el puntero aún capturado
      // (la pausa, en cambio, llega tras soltarlo con Esc). Liberarlo siempre
      // para que el menú sea clickeable.
      input.exitPointerLock();
      input.unlockKeyboard();
    }
  }

  /**
   * Entrar al editor de niveles. Solo desde el menu principal: ahi la escena
   * esta vacia (sin nivel cargado), asi que el editor agrega su propio grid +
   * preview sin chocar con geometria de gameplay.
   */
  private enterEditor(): void {
    if (this.gameState !== "mainMenu") return;
    this.engine.services.resolve(GameTokens.LevelEditor).enter();
    this.setGameState("editor");
  }

  /**
   * Abre un mapa custom en el editor recargando en modo `edit` con el documento
   * como draft. Los de carpeta `.ts` se abren como copia (al guardar van a la
   * biblioteca local, no se reescribe el archivo del repo).
   */
  private async editCustomMap(entry: CustomMapEntry): Promise<void> {
    let doc: EditorDocument | null;
    if (entry.source === "folder") {
      doc = fromLevelDefinition(getLevel(entry.id));
    } else if (entry.source === "workshop") {
      doc = await this.engine.services.resolve(GameTokens.Workshop).getDocument(entry.id);
    } else {
      doc = getLibraryMap(entry.id);
    }
    if (!doc) {
      console.warn(`[Game] No se pudo abrir el mapa custom "${entry.id}" en el editor.`);
      return;
    }
    saveDraft(doc);
    setEditorMode("edit");
    window.location.reload();
  }

  private deleteCustomMap(id: string): void {
    if (!window.confirm(`¿Borrar el mapa "${id}"? Esta accion no se puede deshacer.`)) {
      return;
    }
    deleteLibraryMap(id);
    this.engine.services.resolve(GameTokens.MainMenu).refreshCustomMaps();
  }

  private async importCustomMap(): Promise<void> {
    try {
      const doc = await pickJsonFile();
      saveLibraryMap(doc);
      this.engine.services.resolve(GameTokens.MainMenu).refreshCustomMaps();
    } catch (error) {
      console.warn("[Game] Import de mapa custom cancelado o invalido:", error);
    }
  }

  private async publishFromEditor(doc: EditorDocument, meta: PublishMeta): Promise<string> {
    const workshop = this.engine.services.resolve(GameTokens.Workshop);
    if (!workshop.capabilities.publish) {
      throw new Error("Workshop no configurado (VITE_WORKSHOP_API).");
    }
    if (!workshop.currentUser()) {
      await workshop.signIn();
    }
    const listing = await workshop.publish(doc, meta);
    return `Publicado en el Workshop: "${listing.title}".`;
  }

  private exitEditor(): void {
    setEditorMode(null);
    this.engine.services.resolve(GameTokens.LevelEditor).exit();
    this.setGameState("mainMenu");
  }

  /** Desde un playtest: vuelve al editor recargando con el draft preservado. */
  private returnToEditorFromPlaytest(): void {
    setEditorMode("edit");
    window.location.reload();
  }

  private toggleEditor(): void {
    if (this.gameState === "editor") {
      this.exitEditor();
    } else if (this.gameState === "mainMenu") {
      this.enterEditor();
    }
  }

  private async startNewGame(levelId: LevelId): Promise<void> {
    await this.startLevel(getLevel(levelId));
  }

  /** Lanza un mapa custom (carpeta `maps/custom/` o biblioteca local). */
  private async startCustomMap(entry: CustomMapEntry): Promise<void> {
    if (entry.source === "folder") {
      await this.startLevel(getLevel(entry.id));
      return;
    }
    const doc =
      entry.source === "workshop"
        ? await this.engine.services.resolve(GameTokens.Workshop).getDocument(entry.id)
        : getLibraryMap(entry.id);
    if (!doc) {
      console.warn(`[Game] Mapa custom "${entry.id}" no encontrado.`);
      return;
    }
    let level: LevelDefinition;
    try {
      level = toLevelDefinition(doc);
    } catch (error) {
      console.warn(`[Game] Mapa custom "${entry.id}" invalido:`, error);
      return;
    }
    await this.startLevel(level);
  }

  /** Arranca cualquier `LevelDefinition` como partida normal (campaña o custom). */
  private async startLevel(
    level: LevelDefinition,
    spawn?: CheckpointSnapshot,
  ): Promise<void> {
    const s = this.engine.services;
    const mainMenu = s.resolve(GameTokens.MainMenu);
    const audio = s.resolve(EngineTokens.Audio);

    audio.unlock();
    mainMenu.showLoading(MenuStrings.loadingLevel(level.title));

    // Permitir que el navegador pinte la pantalla de carga antes del trabajo sÃ­ncrono.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );

    await this.loadLevelDefinition(level, spawn);

    if (this.currentLevel) {
      this.activateLevelSoundscape(this.currentLevel);
    }

    this.setGameState("playing");
  }

  /** Carga y juega una definicion arbitraria (el draft del editor) para probarla. */
  private async startPlaytest(level: LevelDefinition): Promise<void> {
    const s = this.engine.services;
    const mainMenu = s.resolve(GameTokens.MainMenu);
    const audio = s.resolve(EngineTokens.Audio);

    audio.unlock();
    mainMenu.showLoading(MenuStrings.loadingLevel(level.title));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    await this.loadLevelDefinition(level);

    if (this.currentLevel) {
      this.activateLevelSoundscape(this.currentLevel);
    }

    this.playtestMode = true;
    this.setGameState("playing");
    s.resolve(GameTokens.EventBus).emit("subtitle.show", {
      text: "Playtest — F4 para volver al editor",
      duration: 3,
    });
  }

  private activateLevelSoundscape(level: LevelDefinition): void {
    const soundscapes = this.engine.services.resolve(GameTokens.Soundscapes);
    const music = this.engine.services.resolve(GameTokens.Music);

    soundscapes.activate(level.audio.soundscape, level.audio.ambiences);
    if (level.audio.music) {
      music.fadeToMusic(level.audio.music);
    } else {
      music.stopMusic();
    }
  }

  private async loadLevelDefinition(
    level: LevelDefinition,
    spawn?: CheckpointSnapshot,
  ): Promise<void> {
    const services = this.engine.services;
    const physics = services.resolve(EngineTokens.Physics);
    const sceneManager = services.resolve(EngineTokens.Scene);
    const resources = services.resolve(EngineTokens.Resources);
    const assets = services.resolve(EngineTokens.Assets);
    const raycast = services.resolve(EngineTokens.Raycast);
    const camera = services.resolve(EngineTokens.Camera);
    const lighting = services.resolve(EngineTokens.Lighting);
    const environment = services.resolve(EngineTokens.Environment);
    const vfx = services.resolve(EngineTokens.Vfx);
    const eventBus = services.resolve(GameTokens.EventBus);
    const interactSystem = services.resolve(GameTokens.InteractSystem);
    const triggerSystem = services.resolve(GameTokens.TriggerSystem);
    const checkpointSystem = services.resolve(GameTokens.CheckpointSystem);
    const hazardVolumes = services.resolve(GameTokens.HazardVolumes);
    const explosiveBarrels = services.resolve(GameTokens.ExplosiveBarrels);
    const characters = services.resolve(GameTokens.Characters);
    const footsteps = services.resolve(GameTokens.Footsteps);

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
      checkpointSystem,
      hazardVolumes,
      explosiveBarrels,
      characters,
      assets,
      this.buildNpcPortalServices(),
    );

    // Teardown completo del nivel anterior para cargar in-place (transición
    // estilo HL2, sin recargar la página). Orden: disponer entidades y limpiar
    // sistemas SOBRE el mundo de física aún válido → reset de física (borra
    // todos los bodies) → limpiar la escena (preservando las luces) → cargar.
    // En el primer load (menú/boot) todo está vacío, así que es no-op.
    this.npcs.forEach((npc) => npc.dispose());
    this.crashingGunships.clear();
    this.collapsingStriders.clear();
    this.weaponPickups.forEach((pickup) => pickup.dispose());
    this.itemPickups.forEach((pickup) => pickup.dispose());
    this.ammoPickups.forEach((pickup) => pickup.dispose());
    this.player?.dispose();
    this.playerModel?.dispose();
    this.playerModel = null;
    services.resolve(GameTokens.WeaponEffects).clear();
    services.resolve(GameTokens.NpcBloodEffects).clear();
    services.resolve(GameTokens.Grenades).clear();
    services.resolve(GameTokens.Rockets).clear();
    services.resolve(GameTokens.Bolts).clear();
    services.resolve(GameTokens.EnergyBalls).clear();
    services.resolve(GameTokens.IceGun).clear();
    services.resolve(GameTokens.Portals).clear();
    explosiveBarrels.clear();
    vfx.clear();
    services.resolve(EngineTokens.PositionalSound).clear();
    services.resolve(GameTokens.EnemySounds).clearActors();
    interactSystem.clear();
    triggerSystem.clear();
    checkpointSystem.clear();
    hazardVolumes.clear();
    services.resolve(GameTokens.GrabSystem).clear();
    services.resolve(GameTokens.PropImpacts).clear();
    physics.reset();
    sceneManager.clearLevel([...lighting.getLights(), ...vfx.getPersistentObjects()]);

    const loaded = await loader.load(level);
    const enemySounds = services.resolve(GameTokens.EnemySounds);
    loaded.npcs.forEach((npc, index) => {
      const definition = level.npcs[index];
      if (definition) {
        enemySounds.registerActor(npc.id, npc.mesh, definition.characterId);
      }
    });
    this.npcs = loaded.npcs;
    this.doors = loaded.doors;
    this.weaponPickups = loaded.weaponPickups;
    this.itemPickups = loaded.itemPickups;
    this.ammoPickups = loaded.ammoPickups;
    this.chargers = loaded.chargers;
    this.tacticalMap = loaded.tacticalMap;
    this.squadDirector = loaded.squadDirector;
    this.buildingRegistry = loaded.buildingRegistry;
    this.navSpace = loaded.navSpace;
    this.pathQueue = loaded.pathQueue;

    this.player = new Player(
      spawn ? new Vector3(...spawn.position) : new Vector3(...level.playerStart),
      physics,
      raycast,
      assets,
      sceneManager.scene,
      eventBus,
      services.resolve(GameTokens.Grenades),
      services.resolve(GameTokens.Rockets),
      services.resolve(GameTokens.Bolts),
      services.resolve(GameTokens.EnergyBalls),
      services.resolve(GameTokens.IceGun),
      services.resolve(GameTokens.Portals),
      services.resolve(GameTokens.PropImpacts),
    );
    if (spawn) {
      this.player.health.restore(spawn.health, spawn.armor);
      this.player.weapons.restoreLoadout(
        spawn.weapons,
        spawn.activeWeaponId,
        spawn.ammo,
      );
    }
    this.playerModel = new PlayerModelSystem(sceneManager.scene, assets, physics);
    await this.playerModel.load(resolvePlayerModel(level.playerModel));
    this.chargers.forEach((charger) => charger.bind(this.player!.health));

    // Reaparecer en este checkpoint si el jugador muere antes de cruzar otro.
    this.lastCheckpoint = spawn ?? null;
    this.dying = false;
    this.deathSequence.reset();
    this.deathScreen?.hide();
    services.resolve(GameTokens.HUD).setDeathMode(false);

    camera.syncToPosition(this.player.getEyePosition());
    if (spawn?.yaw !== undefined) {
      camera.setYaw(spawn.yaw);
    }
    levelEvents.announceLevel(level.title);

    // Objetivo inicial del nivel (vacío lo oculta y limpia la brújula).
    eventBus.emit("objective.updated", {
      text: level.objective?.text ?? "",
      marker: level.objective?.marker ? tupleToVector3(level.objective.marker) : null,
    });
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
    const soundscapes = s.resolve(GameTokens.Soundscapes);
    const music = s.resolve(GameTokens.Music);

    // Limpiar el modo del editor: si veníamos de un playtest, el flag seguiría
    // en sessionStorage y el reload volvería a bootear directo al nivel.
    setEditorMode(null);
    this.playtestMode = false;
    this.dying = false;
    this.deathScreen?.hide();

    soundscapes.clear();
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
