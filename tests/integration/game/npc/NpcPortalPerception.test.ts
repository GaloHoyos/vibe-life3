import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Euler, Group, Quaternion, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import { CharacterMotor } from "@engine/physics/character/CharacterMotor";
import { DynamicFlyerMotor } from "@engine/physics/character/DynamicFlyerMotor";
import { EventBus } from "@engine/core/EventBus";
import { NavigationRequestQueue } from "@engine/ai/navigation/NavigationRequestQueue";
import type { NavigationService } from "@engine/ai/navigation/NavigationService";
import { PortalPairState, type PortalFrame } from "@engine/portals/PortalFrame";
import { PortalRaycast } from "@engine/portals/PortalRaycast";
import {
  portalNormal,
  transformPointThroughPortal,
} from "@engine/portals/PortalMath";
import type { GameEventMap } from "@game/GameEvents";
import { BuildingRegistry } from "@game/levels/buildings/BuildingRegistry";
import { Npc } from "@game/npc/Npc";
import type { ActorSnapshot, AiFrameContext } from "@game/npc/core/INpc";
import type { NpcCombatHandle } from "@game/npc/brain/NpcBrainContext";
import { buildZombiePreset } from "@game/npc/presets/zombiePreset";
import { buildManhackPreset } from "@game/npc/presets/manhackPreset";
import type { TacticalMap } from "@game/npc/ai/TacticalMap";
import type { SquadDirector } from "@game/npc/ai/SquadDirector";

beforeAll(async () => {
  await RAPIER.init();
});

/**
 * Réplica headless del escenario reportado: par de portales sobre la MISMA
 * pared fina, player escondido detrás (visible SOLO a través del par), NPC
 * real (runtime `Npc` completo) del lado de adelante. Sin el pipeline de
 * ghosts + LOS portal-aware el NPC "pierde" al player (searchLastKnown).
 */

const DT = 1 / 60;
/** Cara frontal de la pared (lado del NPC). */
const WALL_Z = -3;
const WALL_THICKNESS = 0.2;
/** Player escondido derecho detrás del par (visible SOLO por el portal). */
const PLAYER_POS = new Vector3(0, 0.9, -5);

/** Portal A sobre la cara frontal, mirando +Z (hacia el NPC). */
function portalA(): PortalFrame {
  return {
    position: new Vector3(0, 1.6, WALL_Z),
    quaternion: new Quaternion(),
    halfWidth: 0.65,
    halfHeight: 1.1,
  };
}

/** Portal B sobre la cara trasera, mirando -Z (hacia el player escondido). */
function portalB(): PortalFrame {
  return {
    position: new Vector3(0, 1.6, WALL_Z - WALL_THICKNESS),
    quaternion: new Quaternion().setFromEuler(new Euler(0, Math.PI, 0)),
    halfWidth: 0.65,
    halfHeight: 1.1,
  };
}

interface World {
  physics: PhysicsWorld;
  raycast: Raycast;
  pair: PortalPairState;
  losRaycast: PortalRaycast;
  eventBus: EventBus<GameEventMap>;
  navigation: NavigationService;
  navigationRequests: NavigationRequestQueue;
}

/**
 * Navegación mínima sin navmesh: paths en línea recta (lo que el dominio aéreo
 * real devuelve con LOS despejado) y sin proyección (nadie deambula).
 */
function stubNavigation(): NavigationService {
  return {
    createAgent: () => null,
    releaseAgentReservations: () => {},
    projectPoint: () => null,
    requestPath: (_profile: unknown, from: Vector3, to: Vector3) => ({
      points: [to.clone()],
      actions: [],
      length: from.distanceTo(to),
      partial: false,
    }),
  } as unknown as NavigationService;
}

async function makeWorld(): Promise<World> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(40, 1, 40),
  });
  physics.createStaticBox({
    id: "wall",
    position: new Vector3(0, 2.5, WALL_Z - WALL_THICKNESS / 2),
    size: new Vector3(24, 5, WALL_THICKNESS),
  });
  // Cuerpo del player para que el LOS tenga algo que pegar del otro lado.
  physics.createStaticBox({
    id: "player",
    position: PLAYER_POS.clone(),
    size: new Vector3(0.7, 1.8, 0.7),
  });
  physics.updateQueryPipeline();

  const raycast = new Raycast(physics);
  const pair = new PortalPairState();
  pair.set("a", portalA());
  pair.set("b", portalB());
  const navigation = stubNavigation();
  return {
    physics,
    raycast,
    pair,
    losRaycast: new PortalRaycast(raycast, pair),
    eventBus: new EventBus<GameEventMap>(),
    navigation,
    navigationRequests: new NavigationRequestQueue(navigation),
  };
}

function fakeCombat(): NpcCombatHandle & { aimedAt: Vector3[] } {
  const aimedAt: Vector3[] = [];
  return {
    aimedAt,
    tick: () => {},
    aim: (target: Vector3) => {
      aimedAt.push(target.clone());
    },
    tryFire: () => true,
    reload: () => {},
    isReloading: () => false,
    magazineEmpty: () => false,
    effectiveRange: () => 20,
  };
}

/** Ghosts como los produce Game.projectPointThroughPortals + navPosition. */
function buildGhosts(world: World, playerSnapshot: ActorSnapshot): ActorSnapshot[] {
  const ghosts: ActorSnapshot[] = [];
  for (const slot of ["a", "b"] as const) {
    const entry = world.pair.get(slot);
    const exit = world.pair.exitFor(slot);
    if (!entry || !exit) continue;
    ghosts.push({
      ...playerSnapshot,
      position: transformPointThroughPortal(
        playerSnapshot.position,
        entry,
        exit,
        new Vector3(),
      ),
      navPosition: playerSnapshot.position,
      portalView: {
        position: exit.position.clone(),
        normal: portalNormal(exit, new Vector3()),
      },
    });
  }
  return ghosts;
}

function makeContext(world: World, delta: number, elapsed: number): AiFrameContext {
  const playerSnapshot: ActorSnapshot = {
    id: "player",
    position: PLAYER_POS.clone(),
    faction: "player",
    entity: { applyDamage: () => {}, isAlive: () => true },
    isAlive: true,
    radius: 0.35,
  };
  return {
    delta,
    elapsed,
    aiLod: "near",
    player: playerSnapshot,
    npcs: [],
    portalGhosts: buildGhosts(world, playerSnapshot),
    tacticalMap: null as unknown as TacticalMap,
    squadDirector: null as unknown as SquadDirector,
    eventBus: world.eventBus,
  };
}

function makeZombie(world: World): { npc: Npc; combat: ReturnType<typeof fakeCombat> } {
  const preset = buildZombiePreset();
  const combat = fakeCombat();
  // `shouldCollideWith` compara damageables: sin uno propio (la factory siempre
  // lo setea) el motor ignora el mundo entero y cae por el piso.
  const damageable = { applyDamage: () => {}, isAlive: () => true };
  const motor = new CharacterMotor(world.physics, {
    id: "zombie-1",
    position: new Vector3(0, 0.9, 2),
    height: 1.8,
    radius: preset.radius,
    mass: 80,
    maxSpeed: preset.movement.walkSpeed,
    acceleration: preset.movement.acceleration,
    turnSpeed: preset.movement.turnSpeed,
    rotationSmoothing: 0.15,
    faceTargetDeadzone: 0.08,
    turnBeforeMoveAngle: 0.65,
    minMoveFacingDot: 0.35,
    gravity: 28,
    stepOffset: preset.movement.stepOffset,
    snapToGround: preset.movement.snapToGround,
    metadata: { id: "zombie-1", kind: "npc", faction: "zombies", damageable },
  });
  const npc = new Npc({
    id: "zombie-1",
    characterId: "zombie",
    faction: "zombies",
    position: new Vector3(0, 0.9, 2),
    visualRoot: new Group(),
    height: 1.8,
    motor,
    combat,
    preset,
    navigation: world.navigation,
    buildingRegistry: new BuildingRegistry([]),
    navigationRequests: world.navigationRequests,
    raycast: world.raycast,
    losRaycast: world.losRaycast,
    eventBus: world.eventBus,
  });
  return { npc, combat };
}

function makeManhack(world: World, exits: Vector3[]): Npc {
  const preset = buildManhackPreset();
  const motor = new DynamicFlyerMotor(world.physics, {
    id: "manhack-1",
    position: new Vector3(0, 1.4, 2),
    height: 0.6,
    radius: preset.radius,
    maxSpeed: preset.movement.walkSpeed,
    acceleration: preset.movement.acceleration,
    turnSpeed: preset.movement.turnSpeed,
    metadata: {
      id: "manhack-1",
      kind: "npc",
      faction: "combine",
      selfPortalTraversal: true,
    },
    portals: world.pair,
    onPortalTeleport: (exit) => exits.push(exit.clone()),
  });
  return new Npc({
    id: "manhack-1",
    characterId: "manhack",
    faction: "combine",
    position: new Vector3(0, 1.4, 2),
    visualRoot: new Group(),
    height: 0.6,
    motor,
    combat: fakeCombat(),
    preset,
    navigation: world.navigation,
    buildingRegistry: new BuildingRegistry([]),
    navigationRequests: world.navigationRequests,
    raycast: world.raycast,
    losRaycast: world.losRaycast,
    eventBus: world.eventBus,
  });
}

function simulate(world: World, npc: Npc, seconds: number, trace = false): void {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i += 1) {
    const ctx = makeContext(world, DT, i * DT);
    world.navigationRequests.process();
    npc.update(ctx);
    world.physics.step(DT);
    npc.syncFromPhysics();
    if (trace && i % 6 === 0 && i * DT < 1.0) {
      const debug = npc.getAiDebugSnapshot();
      const tp = debug.threatPosition;
      console.log(
        `t=${(i * DT).toFixed(2)} state=${debug.state} visible=${debug.brain?.threat.visibleNow} pos(${debug.position.x.toFixed(2)}, ${debug.position.y.toFixed(2)}, ${debug.position.z.toFixed(2)}) threatPos=${tp ? `(${tp.x.toFixed(2)}, ${tp.y.toFixed(2)}, ${tp.z.toFixed(2)})` : "null"} goal=${debug.target ? `(${debug.target.x.toFixed(1)}, ${debug.target.z.toFixed(1)})` : "null"}`,
      );
    }
  }
}

describe("NPC ve/persigue al player a través del par de portales", () => {
  it("el zombie ve al ghost, entra en chase y su goal es la posición REAL", async () => {
    const world = await makeWorld();
    const { npc } = makeZombie(world);

    simulate(world, npc, 1.5);

    const debug = npc.getAiDebugSnapshot();
    expect(debug.brain?.threat.visibleNow).toBe(true);
    expect(npc.getState()).toBe("chase");
    // Goal de locomoción = posición real del player (navPosition), no el ghost.
    expect(debug.target).not.toBeNull();
    expect(debug.target!.x).toBeCloseTo(PLAYER_POS.x, 0);
    expect(debug.target!.z).toBeCloseTo(PLAYER_POS.z, 0);
  });

  it("el manhack persigue al ghost y CRUZA el portal", async () => {
    const world = await makeWorld();
    const exits: Vector3[] = [];
    const npc = makeManhack(world, exits);

    simulate(world, npc, 6);

    expect(exits.length).toBeGreaterThanOrEqual(1);
    // Salió por B: del lado de atrás de la pared.
    expect(exits[0].z).toBeLessThan(WALL_Z - WALL_THICKNESS + 0.1);
  });
});

/**
 * Bug reportado: un enemigo del OTRO lado de una pared cuyos portales están del
 * lado del player NO debe verlo. El ghost cae detrás del disco de salida (del
 * lado del enemigo), y sin gate el enemigo tenía un ray directo y despejado
 * hacia él. Un portal sólo se ve de su cara frontal.
 */
describe("NPC detrás de la pared NO ve por un portal del lado del player", () => {
  /** Pared que separa sala delantera (z>0, player) de trasera (z<-0.2, enemigo). */
  const DIVIDER_Z = 0;
  const HIDDEN_PLAYER = new Vector3(0, 0.9, 3);

  /** P1 en la cara frontal de la pared, mirando +Z (hacia el player). */
  function p1(): PortalFrame {
    return {
      position: new Vector3(0, 1.6, DIVIDER_Z),
      quaternion: new Quaternion(),
      halfWidth: 0.65,
      halfHeight: 1.1,
    };
  }

  /** P2 en una pared lateral de la sala delantera, mirando -X. Par de P1. */
  function p2(): PortalFrame {
    return {
      position: new Vector3(6, 1.6, 3),
      quaternion: new Quaternion().setFromEuler(new Euler(0, -Math.PI / 2, 0)),
      halfWidth: 0.65,
      halfHeight: 1.1,
    };
  }

  async function makeAsymmetricWorld(): Promise<World> {
    const physics = new PhysicsWorld();
    await physics.init();
    physics.createStaticBox({
      id: "floor",
      position: new Vector3(0, -0.5, 0),
      size: new Vector3(60, 1, 60),
    });
    physics.createStaticBox({
      id: "divider",
      position: new Vector3(0, 2.5, DIVIDER_Z - WALL_THICKNESS / 2),
      size: new Vector3(24, 5, WALL_THICKNESS),
    });
    physics.createStaticBox({
      id: "player",
      position: HIDDEN_PLAYER.clone(),
      size: new Vector3(0.7, 1.8, 0.7),
    });
    physics.updateQueryPipeline();
    const raycast = new Raycast(physics);
    const pair = new PortalPairState();
    pair.set("a", p1());
    pair.set("b", p2());
    const navigation = stubNavigation();
    return {
      physics,
      raycast,
      pair,
      losRaycast: new PortalRaycast(raycast, pair),
      eventBus: new EventBus<GameEventMap>(),
      navigation,
      navigationRequests: new NavigationRequestQueue(navigation),
    };
  }

  function contextFor(world: World, delta: number, elapsed: number): AiFrameContext {
    const playerSnapshot: ActorSnapshot = {
      id: "player",
      position: HIDDEN_PLAYER.clone(),
      faction: "player",
      entity: { applyDamage: () => {}, isAlive: () => true },
      isAlive: true,
      radius: 0.35,
    };
    return {
      delta,
      elapsed,
      aiLod: "near",
      player: playerSnapshot,
      npcs: [],
      portalGhosts: buildGhosts(world, playerSnapshot),
      tacticalMap: null as unknown as TacticalMap,
      squadDirector: null as unknown as SquadDirector,
      eventBus: world.eventBus,
    };
  }

  function zombieAt(world: World, position: Vector3): Npc {
    const preset = buildZombiePreset();
    const damageable = { applyDamage: () => {}, isAlive: () => true };
    const motor = new CharacterMotor(world.physics, {
      id: "zombie-x",
      position: position.clone(),
      height: 1.8,
      radius: preset.radius,
      mass: 80,
      maxSpeed: preset.movement.walkSpeed,
      acceleration: preset.movement.acceleration,
      turnSpeed: preset.movement.turnSpeed,
      rotationSmoothing: 0.15,
      faceTargetDeadzone: 0.08,
      turnBeforeMoveAngle: 0.65,
      minMoveFacingDot: 0.35,
      gravity: 28,
      stepOffset: preset.movement.stepOffset,
      snapToGround: preset.movement.snapToGround,
      metadata: { id: "zombie-x", kind: "npc", faction: "zombies", damageable },
    });
    return new Npc({
      id: "zombie-x",
      characterId: "zombie",
      faction: "zombies",
      position: position.clone(),
      visualRoot: new Group(),
      height: 1.8,
      motor,
      combat: fakeCombat(),
      preset,
      navigation: world.navigation,
      buildingRegistry: new BuildingRegistry([]),
      navigationRequests: world.navigationRequests,
      raycast: world.raycast,
      losRaycast: world.losRaycast,
      eventBus: world.eventBus,
    });
  }

  function run(world: World, npc: Npc, seconds: number): void {
    const frames = Math.round(seconds / DT);
    for (let i = 0; i < frames; i += 1) {
      world.navigationRequests.process();
      npc.update(contextFor(world, DT, i * DT));
      world.physics.step(DT);
      npc.syncFromPhysics();
    }
  }

  it("el enemigo detrás de la pared nunca ve al player (ghost gateado)", async () => {
    const world = await makeAsymmetricWorld();
    // Enemigo en la sala trasera, entre la pared y el ghost que cae en z=-6.
    const behind = zombieAt(world, new Vector3(0, 0.9, -4));

    let everVisible = false;
    const frames = Math.round(2 / DT);
    for (let i = 0; i < frames; i += 1) {
      world.navigationRequests.process();
      behind.update(contextFor(world, DT, i * DT));
      world.physics.step(DT);
      behind.syncFromPhysics();
      if (behind.getAiDebugSnapshot().brain?.threat.visibleNow) everVisible = true;
    }

    expect(everVisible).toBe(false);
    expect(behind.getState()).not.toBe("chase");
  });

  it("control: un enemigo DELANTE del portal sí ve por él", async () => {
    const world = await makeAsymmetricWorld();
    // En la sala delantera, delante de P1: el ghost por P1 es válido para él.
    const front = zombieAt(world, new Vector3(0, 0.9, 6));

    run(world, front, 1.5);

    expect(front.getAiDebugSnapshot().brain?.threat.visibleNow).toBe(true);
  });
});
