import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import {
  CharacterController,
  type MovementInput,
} from "@engine/physics/character/CharacterController";
import type { CameraSystem } from "@engine/render/CameraSystem";
import { Scene } from "three";
import { PortalPairState, type PortalSlot } from "@engine/portals/PortalFrame";
import {
  PortalPlayerTransitSystem,
  type PortalTransitCamera,
} from "@engine/portals/PortalPlayerTransitSystem";
import { PortalTravellerSystem } from "@engine/portals/PortalTravellerSystem";
import { computePortalPlacement } from "@game/gameplay/weapons/portal/PortalPlacement";
import { PortalConfig } from "@game/config/portal.config";
import { PlayerConfig } from "@game/config/gameplay.config";

beforeAll(async () => {
  await RAPIER.init();
});

/**
 * Réplica headless del loop del juego: pared + piso reales, colocación real
 * (computePortalPlacement) y CharacterController real caminando hacia el
 * portal. Orden por frame idéntico a Game: controller.update → physics.step →
 * transit.update.
 */

const DT = 1 / 60;
/** Pared con cara frontal en z = -3 (normal +Z hacia el jugador). */
const WALL_Z = -3;
/** Altura de ojos a la que se apunta el disparo de portal. */
const AIM_Y = 1.65;

interface World {
  physics: PhysicsWorld;
  raycast: Raycast;
  pair: PortalPairState;
  transit: PortalPlayerTransitSystem;
  /** Parches de apertura reales, como en el juego (fidelidad física total). */
  traveller: PortalTravellerSystem;
  teleports: Vector3[];
}

async function makeWorld(
  cooldownSeconds: number = PortalConfig.traversal.playerCooldownSeconds,
  wallThickness = 1,
): Promise<World> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(40, 1, 40),
  });
  physics.createStaticBox({
    id: "wall",
    position: new Vector3(0, 2.5, WALL_Z - wallThickness / 2),
    size: new Vector3(16, 5, wallThickness),
  });
  physics.updateQueryPipeline();

  const raycast = new Raycast(physics);
  const pair = new PortalPairState();
  const teleports: Vector3[] = [];
  const transit = new PortalPlayerTransitSystem(raycast, pair, {
    tuning: {
      radius: PlayerConfig.collider.radius,
      radiusForgiveness: PortalConfig.traversal.playerRadiusForgiveness,
      passThroughProximity: PortalConfig.traversal.passThroughProximity,
      funnelDepth: PortalConfig.traversal.playerFunnelDepth,
      funnelStrength: PortalConfig.traversal.playerFunnelStrength,
    },
    capsuleHalfExtent:
      PlayerConfig.collider.standingHalfHeight + PlayerConfig.collider.radius,
    triggerOffset: PortalConfig.traversal.playerTriggerOffset,
    crossingMargin: PortalConfig.traversal.crossingMargin,
    cooldownSeconds,
    minExitSpeed: PortalConfig.traversal.minExitSpeed,
    exitGroundSnap: PortalConfig.traversal.exitGroundSnap,
    raycastExcludeId: "player",
    onTeleported: (exitPosition) => {
      teleports.push(exitPosition.clone());
    },
  });
  const traveller = new PortalTravellerSystem(physics, new Scene(), pair, {
    apertureRadius: PortalConfig.dynamicClone.apertureRadius,
    apertureThickness: PortalConfig.dynamicClone.apertureThickness,
    suppressMinIntoSpeed: PortalConfig.dynamicClone.suppressMinIntoSpeed,
    suppressLookaheadSeconds: PortalConfig.dynamicClone.suppressLookaheadSeconds,
    cloneEnabled: PortalConfig.dynamicClone.enabled,
    crossingMargin: PortalConfig.traversal.crossingMargin,
    dynamicTriggerOffset: PortalConfig.traversal.dynamicTriggerOffset,
    cooldownSeconds: PortalConfig.traversal.cooldownSeconds,
    minExitSpeed: PortalConfig.traversal.minExitSpeed,
    dynamicExitClearance: PortalConfig.traversal.dynamicExitClearance,
    dynamicQueryRadius: PortalConfig.traversal.dynamicQueryRadius,
  });
  return { physics, raycast, pair, transit, traveller, teleports };
}

/** Dispara la colocación real contra la pared apuntando a (x, AIM_Y). */
function placePortal(world: World, slot: PortalSlot, aimX: number): Vector3 {
  const sibling = world.pair.get(slot === "a" ? "b" : "a");
  const placement = computePortalPlacement(
    world.raycast,
    new Vector3(aimX, AIM_Y, 0),
    new Vector3(0, 0, -1),
    {
      range: PortalConfig.placement.range,
      halfWidth: PortalConfig.ellipse.halfWidth,
      halfHeight: PortalConfig.ellipse.halfHeight,
      planarForward: new Vector3(0, 0, -1),
      excludeId: "player",
      sibling: sibling ?? undefined,
    },
  );
  expect(placement).not.toBeNull();
  world.pair.set(slot, placement!.frame);
  world.transit.setPortal(slot, placement!.frame, placement!.backingColliders);
  world.traveller.setPortal(slot, placement!.frame, placement!.backingColliders);
  return placement!.frame.position.clone();
}

function makeController(world: World, spawn: Vector3): CharacterController {
  return new CharacterController(world.physics, {
    position: spawn,
    radius: PlayerConfig.collider.radius,
    standingHalfHeight: PlayerConfig.collider.standingHalfHeight,
    crouchHalfHeight: PlayerConfig.collider.crouchHalfHeight,
    standingEyeHeight: PlayerConfig.collider.standingEyeHeight,
    crouchEyeHeight: PlayerConfig.collider.crouchEyeHeight,
    ...PlayerConfig.movement,
  });
}

const FORWARD: MovementInput = {
  forward: true,
  back: false,
  left: false,
  right: false,
  jumpPressed: false,
  sprintDown: false,
  crouchDown: false,
};

/** Cámara fija mirando -Z (hacia la pared); el transit sólo la reorienta. */
const transitCamera: PortalTransitCamera = {
  getForwardDirection: () => new Vector3(0, 0, -1),
  getOrientation: (out: Quaternion) => out.identity(),
  setLook: () => {},
  syncToPosition: () => {},
};

const controllerCamera = {
  getPlanarForward: () => new Vector3(0, 0, -1),
  getPlanarRight: () => new Vector3(1, 0, 0),
} as unknown as CameraSystem;

/**
 * Camina hacia adelante (-Z) hasta `seconds`; corta en el primer teleport.
 * Devuelve la posición final del centro de la cápsula.
 */
function walkForward(
  world: World,
  controller: CharacterController,
  seconds: number,
  move: MovementInput = FORWARD,
): Vector3 {
  const frames = Math.round(seconds / DT);
  for (let i = 0; i < frames; i += 1) {
    controller.update(DT, move, controllerCamera);
    world.physics.step(DT);
    world.transit.update(i * DT, controller, transitCamera);
    world.traveller.update(i * DT, DT);
    if (world.teleports.length > 0) {
      break;
    }
  }
  return controller.getPosition();
}

describe("PortalPlayerTransitSystem — pared, par separado (control)", () => {
  it("el jugador entra caminando por el centro y sale por el par", async () => {
    const world = await makeWorld();
    const enterAt = placePortal(world, "a", -4);
    const exitAt = placePortal(world, "b", 4);
    const controller = makeController(
      world,
      new Vector3(enterAt.x, 0.9, WALL_Z + 2),
    );

    const end = walkForward(world, controller, 3);

    expect(world.teleports.length).toBe(1);
    // Salió del lado frontal del portal de salida, cerca de su boca.
    expect(end.z).toBeGreaterThan(WALL_Z - 0.6);
    expect(Math.abs(end.x - exitAt.x)).toBeLessThan(1.2);
  });
});

describe("PortalPlayerTransitSystem — re-entrada rápida (out of bounds)", () => {
  /**
   * Oscilación continua: la cámara del harness nunca gira, así que tras cada
   * teleport el jugador emerge del portal de salida (misma pared) y el input
   * lo vuelve a empujar adentro — la re-entrada más rápida posible, como
   * entrar y salir repetidas veces en el juego.
   */
  function oscillate(
    world: World,
    controller: CharacterController,
    seconds: number,
  ): { minZ: number; minY: number; final: Vector3 } {
    const frames = Math.round(seconds / DT);
    let minZ = Infinity;
    let minY = Infinity;
    for (let i = 0; i < frames; i += 1) {
      controller.update(DT, FORWARD, controllerCamera);
      world.physics.step(DT);
      world.transit.update(i * DT, controller, transitCamera);
      world.traveller.update(i * DT, DT);
      const p = controller.getPosition();
      minZ = Math.min(minZ, p.z);
      minY = Math.min(minY, p.y);
    }
    return { minZ, minY, final: controller.getPosition() };
  }

  it("con cooldown 0 (config del juego) oscila teleportando sin escapar", async () => {
    const world = await makeWorld();
    const enterAt = placePortal(world, "a", -4);
    placePortal(world, "b", 4);
    const controller = makeController(
      world,
      new Vector3(enterAt.x, 0.9, WALL_Z + 2),
    );

    const { minZ, minY } = oscillate(world, controller, 8);

    expect(world.teleports.length).toBeGreaterThanOrEqual(2);
    // Jamás caminó dentro/detrás de la pared (cara trasera en z = -4).
    expect(minZ).toBeGreaterThan(WALL_Z - 0.6);
    expect(minY).toBeGreaterThan(0.3);
  });

  it("un cruce durante el cooldown NUNCA deja la cápsula del lado sólido", async () => {
    // Cooldown alto a propósito: toda re-entrada cae dentro de la ventana.
    const world = await makeWorld(1.0);
    const enterAt = placePortal(world, "a", -4);
    placePortal(world, "b", 4);
    const controller = makeController(
      world,
      new Vector3(enterAt.x, 0.9, WALL_Z + 2),
    );

    const { minZ, minY } = oscillate(world, controller, 8);

    expect(world.teleports.length).toBeGreaterThanOrEqual(2);
    expect(minZ).toBeGreaterThan(WALL_Z - 0.6);
    expect(minY).toBeGreaterThan(0.3);
  });
});

describe("PortalPlayerTransitSystem — entrada por detrás (pared de casa)", () => {
  const BACK: MovementInput = { ...FORWARD, forward: false, back: true };
  /** Pared fina como las de BuildingBuilder; cara trasera en z = -3.2. */
  const THIN = 0.2;

  it("la pared finita sigue sólida al acercarse por la cara trasera del portal", async () => {
    const world = await makeWorld(
      PortalConfig.traversal.playerCooldownSeconds,
      THIN,
    );
    const enterAt = placePortal(world, "a", -4);
    placePortal(world, "b", 4);
    // Del otro lado de la pared, caminando +Z contra la espalda del portal.
    const controller = makeController(
      world,
      new Vector3(enterAt.x, 0.9, WALL_Z - 2),
    );

    const end = walkForward(world, controller, 3, BACK);

    expect(world.teleports.length).toBe(0);
    // Bloqueado por la cara trasera: la cápsula (radio 0.35) nunca la penetra.
    expect(end.z).toBeLessThan(WALL_Z - THIN - 0.25);
  });

  it("en la misma pared finita la entrada por el FRENTE sigue funcionando", async () => {
    const world = await makeWorld(
      PortalConfig.traversal.playerCooldownSeconds,
      THIN,
    );
    const enterAt = placePortal(world, "a", -4);
    const exitAt = placePortal(world, "b", 4);
    const controller = makeController(
      world,
      new Vector3(enterAt.x, 0.9, WALL_Z + 2),
    );

    const end = walkForward(world, controller, 3);

    expect(world.teleports.length).toBe(1);
    expect(Math.abs(end.x - exitAt.x)).toBeLessThan(1.2);
  });
});

describe("PortalPlayerTransitSystem — portales adyacentes (screenshot bug)", () => {
  /** Coloca el par borde con borde como en la screenshot y devuelve centros. */
  async function adjacentWorld(): Promise<{
    world: World;
    left: Vector3;
    right: Vector3;
  }> {
    const world = await makeWorld();
    const left = placePortal(world, "a", -0.675);
    const right = placePortal(world, "b", 0.675);
    // Sanity: quedaron uno al lado del otro, sin bump grande.
    expect(Math.abs(right.x - left.x)).toBeLessThan(2.2);
    return { world, left, right };
  }

  it("entra por el CENTRO del portal derecho", async () => {
    const { world, left, right } = await adjacentWorld();
    const controller = makeController(
      world,
      new Vector3(right.x, 0.9, WALL_Z + 2),
    );

    const end = walkForward(world, controller, 3);

    expect(
      world.teleports.length,
      `sin teleport; pos final (${end.x.toFixed(2)}, ${end.y.toFixed(2)}, ${end.z.toFixed(2)})`,
    ).toBe(1);
    expect(Math.abs(end.x - left.x)).toBeLessThan(1.2);
  });

  it("entra por el CENTRO del portal izquierdo", async () => {
    const { world, left, right } = await adjacentWorld();
    const controller = makeController(
      world,
      new Vector3(left.x, 0.9, WALL_Z + 2),
    );

    const end = walkForward(world, controller, 3);

    expect(
      world.teleports.length,
      `sin teleport; pos final (${end.x.toFixed(2)}, ${end.y.toFixed(2)}, ${end.z.toFixed(2)})`,
    ).toBe(1);
    expect(Math.abs(end.x - right.x)).toBeLessThan(1.2);
  });

  it("entra por el borde del portal derecho pegado a la costura", async () => {
    const { world, right } = await adjacentWorld();
    // Apunta 0.35 m hacia la costura desde el centro del derecho.
    const controller = makeController(
      world,
      new Vector3(right.x - 0.35, 0.9, WALL_Z + 2),
    );

    const end = walkForward(world, controller, 4);

    expect(
      world.teleports.length,
      `sin teleport; pos final (${end.x.toFixed(2)}, ${end.y.toFixed(2)}, ${end.z.toFixed(2)})`,
    ).toBe(1);
  });

  it("entra EN SPRINT por el centro del portal derecho", async () => {
    const { world, left, right } = await adjacentWorld();
    const controller = makeController(
      world,
      new Vector3(right.x, 0.9, WALL_Z + 4),
    );

    const end = walkForward(world, controller, 3, {
      ...FORWARD,
      sprintDown: true,
    });

    expect(
      world.teleports.length,
      `sin teleport; pos final (${end.x.toFixed(2)}, ${end.y.toFixed(2)}, ${end.z.toFixed(2)})`,
    ).toBe(1);
    expect(Math.abs(end.x - left.x)).toBeLessThan(1.2);
  });

  it("entra en DIAGONAL (adelante + strafe hacia la costura)", async () => {
    const { world, right } = await adjacentWorld();
    // Arranca a la derecha del portal derecho y camina adelante+izquierda:
    // cruza el plano en ángulo, pasando cerca de la costura.
    const controller = makeController(
      world,
      new Vector3(right.x + 1.2, 0.9, WALL_Z + 1.8),
    );

    const end = walkForward(world, controller, 4, {
      ...FORWARD,
      left: true,
    });

    expect(
      world.teleports.length,
      `sin teleport; pos final (${end.x.toFixed(2)}, ${end.y.toFixed(2)}, ${end.z.toFixed(2)})`,
    ).toBe(1);
  });

  it("apuntando a la costura exacta no atraviesa la pared sólida", async () => {
    const { world, left, right } = await adjacentWorld();
    const seamX = (left.x + right.x) / 2;
    const controller = makeController(
      world,
      new Vector3(seamX, 0.9, WALL_Z + 2),
    );

    const end = walkForward(world, controller, 4);

    if (world.teleports.length === 0) {
      // Sin teleport es aceptable, pero la cápsula no puede haber terminado
      // dentro/detrás de la pared.
      expect(end.z).toBeGreaterThan(WALL_Z - 0.05);
    }
  });
});

describe("PortalPlayerTransitSystem — piso + techo (túnel infinito)", () => {
  /** Techo con cara inferior en y = CEILING_Y (normal -Y). */
  const CEILING_Y = 3;

  async function makeVerticalWorld(ceilingY = CEILING_Y): Promise<World> {
    const world = await makeWorld();
    world.physics.createStaticBox({
      id: "ceiling",
      position: new Vector3(0, ceilingY + 0.5, 0),
      size: new Vector3(40, 1, 40),
    });
    world.physics.updateQueryPipeline();
    return world;
  }

  function placeVerticalPortal(
    world: World,
    slot: PortalSlot,
    origin: Vector3,
    direction: Vector3,
  ): Vector3 {
    const sibling = world.pair.get(slot === "a" ? "b" : "a");
    const placement = computePortalPlacement(world.raycast, origin, direction, {
      range: PortalConfig.placement.range,
      halfWidth: PortalConfig.ellipse.halfWidth,
      halfHeight: PortalConfig.ellipse.halfHeight,
      planarForward: new Vector3(0, 0, -1),
      excludeId: "player",
      sibling: sibling ?? undefined,
    });
    expect(placement).not.toBeNull();
    world.pair.set(slot, placement!.frame);
    world.transit.setPortal(slot, placement!.frame, placement!.backingColliders);
    world.traveller.setPortal(slot, placement!.frame, placement!.backingColliders);
    return placement!.frame.position.clone();
  }

  const HALF_EXTENT =
    PlayerConfig.collider.standingHalfHeight + PlayerConfig.collider.radius;

  it("al caer por el piso, la cámara emerge DEBAJO del techo (no lo atraviesa)", async () => {
    const world = await makeVerticalWorld();
    // Portal de piso a los pies (normal +Y) y de techo justo arriba (normal -Y).
    placeVerticalPortal(world, "a", new Vector3(0, 1.2, 0), new Vector3(0, -1, 0));
    placeVerticalPortal(world, "b", new Vector3(0, 1.2, 0), new Vector3(0, 1, 0));
    const controller = makeController(world, new Vector3(0, HALF_EXTENT, 0));

    const frames = Math.round(3 / DT);
    let teleportFrame = -1;
    let maxEyeAfterTeleport = -Infinity;
    let centerAtTeleport = NaN;
    for (let i = 0; i < frames; i += 1) {
      controller.update(DT, { ...FORWARD, forward: false }, controllerCamera);
      world.physics.step(DT);
      world.transit.update(i * DT, controller, transitCamera);
      world.traveller.update(i * DT, DT);
      if (world.teleports.length >= 1 && teleportFrame < 0) {
        teleportFrame = i;
        centerAtTeleport = controller.getPosition().y;
      }
      // Tras emerger del techo, seguí la caída ~0.3 s registrando el ojo: el
      // bug dejaba la cámara SOBRE el plano del techo ~13 frames (veías el
      // vacío alrededor del disco). Con el cruce disparado por la cámara, el
      // ojo emerge ya debajo del techo y nunca lo sobrepasa.
      if (teleportFrame >= 0 && i <= teleportFrame + 18) {
        maxEyeAfterTeleport = Math.max(
          maxEyeAfterTeleport,
          controller.getEyePosition().y,
        );
      }
      // Segunda vuelta del loop infinito: ya validado el patrón, cortar.
      if (world.teleports.length >= 2) {
        break;
      }
    }

    expect(world.teleports.length).toBeGreaterThanOrEqual(1);
    // Emergió DEL TECHO (mapeo correcto), no cayó al piso.
    expect(centerAtTeleport).toBeGreaterThan(CEILING_Y / 2);
    // La cámara nunca asoma por encima del techo mientras baja: no se ve el
    // vacío a través del techo (el fix central de este bug).
    expect(maxEyeAfterTeleport).toBeLessThan(CEILING_Y);
  });

  it("a alta velocidad no traspasa el piso (sala alta, caída larga)", async () => {
    // Sala alta para que la caída acumule velocidad extrema (~90 m/s), donde el
    // centro se hundía >passThroughProximity detrás del plano en el lag
    // ojo→centro y el portal se des-enganchaba dejando caer por el piso.
    const TALL = 30;
    const world = await makeVerticalWorld(TALL);
    placeVerticalPortal(world, "a", new Vector3(0, 1.2, 0), new Vector3(0, -1, 0));
    placeVerticalPortal(
      world,
      "b",
      new Vector3(0, TALL - 0.6, 0),
      new Vector3(0, 1, 0),
    );
    const controller = makeController(world, new Vector3(0, TALL - 3, 0));

    let minCenterY = Infinity;
    const frames = Math.round(20 / DT);
    for (let i = 0; i < frames; i += 1) {
      controller.update(DT, { ...FORWARD, forward: false }, controllerCamera);
      world.physics.step(DT);
      world.transit.update(i * DT, controller, transitCamera);
      world.traveller.update(i * DT, DT);
      minCenterY = Math.min(minCenterY, controller.getPosition().y);
    }

    // Siguió teleportando el loop entero; nunca se coló bajo el piso (y=0).
    expect(world.teleports.length).toBeGreaterThan(5);
    expect(minCenterY).toBeGreaterThan(-HALF_EXTENT);
  });
});
