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
    position: new Vector3(0, 2.5, WALL_Z - 0.5),
    size: new Vector3(16, 5, 1),
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
    cooldownSeconds: PortalConfig.traversal.cooldownSeconds,
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
