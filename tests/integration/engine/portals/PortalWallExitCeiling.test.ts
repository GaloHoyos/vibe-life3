import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Quaternion, Scene, Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import {
  CharacterController,
  type MovementInput,
} from "@engine/physics/character/CharacterController";
import type { CameraSystem } from "@engine/render/CameraSystem";
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
 * Regresión: portal de piso + portal de pared con un TECHO justo encima de la
 * pared. Al caer por el piso en diagonal, la cápsula sale por la pared cerca
 * del borde superior del óvalo. El `liftOntoGround` de la salida por pared
 * casteaba hacia abajo DESDE LA CABEZA para apoyar los pies; con un techo
 * encima el origen del rayo arrancaba dentro del techo y un raycast sólido
 * devuelve toi=0 en el origen, "levantando" al jugador ARRIBA del techo (lo
 * teleportaba a través del techo con el momentum intacto).
 */

const DT = 1 / 60;
const WALL_Z = -3;
/** Cara inferior del techo, apenas encima del borde superior del portal. */
const CEILING_Y = 3;
const HALF_EXTENT =
  PlayerConfig.collider.standingHalfHeight + PlayerConfig.collider.radius;

interface World {
  physics: PhysicsWorld;
  raycast: Raycast;
  pair: PortalPairState;
  transit: PortalPlayerTransitSystem;
  traveller: PortalTravellerSystem;
  teleports: Vector3[];
}

async function makeWorld(): Promise<World> {
  const physics = new PhysicsWorld();
  await physics.init();
  physics.createStaticBox({
    id: "floor",
    position: new Vector3(0, -0.5, 0),
    size: new Vector3(80, 1, 80),
  });
  physics.createStaticBox({
    id: "wall",
    position: new Vector3(0, 2.5, WALL_Z - 0.5),
    size: new Vector3(16, 5, 1),
  });
  physics.createStaticBox({
    id: "ceiling",
    position: new Vector3(0, CEILING_Y + 0.5, 0),
    size: new Vector3(80, 1, 80),
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
    capsuleHalfExtent: HALF_EXTENT,
    triggerOffset: PortalConfig.traversal.playerTriggerOffset,
    crossingMargin: PortalConfig.traversal.crossingMargin,
    cooldownSeconds: PortalConfig.traversal.playerCooldownSeconds,
    minExitSpeed: PortalConfig.traversal.minExitSpeed,
    exitGroundSnap: PortalConfig.traversal.exitGroundSnap,
    raycastExcludeId: "player",
    onTeleported: (exitPosition) => teleports.push(exitPosition.clone()),
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

function place(
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

const NO_INPUT: MovementInput = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jumpPressed: false,
  sprintDown: false,
  crouchDown: false,
};

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

describe("PortalPlayerTransitSystem — salida por pared con techo encima", () => {
  it("no levanta al jugador a través del techo al salir por la pared", async () => {
    const world = await makeWorld();
    // Piso (normal +Y) en el origen; pared (normal +Z) con el techo encima.
    place(world, "a", new Vector3(0, 1.2, 0), new Vector3(0, -1, 0));
    const wallCenter = place(world, "b", new Vector3(0, 1.65, 0), new Vector3(0, 0, -1));
    const portalTop = wallCenter.y + PortalConfig.ellipse.halfHeight;

    const controller = new CharacterController(world.physics, {
      position: new Vector3(0, 1.0, 0),
      radius: PlayerConfig.collider.radius,
      standingHalfHeight: PlayerConfig.collider.standingHalfHeight,
      crouchHalfHeight: PlayerConfig.collider.crouchHalfHeight,
      standingEyeHeight: PlayerConfig.collider.standingEyeHeight,
      crouchEyeHeight: PlayerConfig.collider.crouchEyeHeight,
      ...PlayerConfig.movement,
    });
    // Cruza el portal de piso cayendo en diagonal (hacia -Z, la pared): el
    // mapeo saca al jugador por la pared cerca del borde superior del óvalo.
    controller.teleport(new Vector3(0, 1.0, 0), new Vector3(0, -16, -8));

    let maxCenterY = -Infinity;
    const frames = Math.round(2 / DT);
    for (let i = 0; i < frames; i += 1) {
      controller.update(DT, NO_INPUT, controllerCamera);
      world.physics.step(DT);
      world.transit.update(i * DT, controller, transitCamera);
      world.traveller.update(i * DT, DT);
      maxCenterY = Math.max(maxCenterY, controller.getPosition().y);
    }

    expect(world.teleports.length).toBeGreaterThanOrEqual(1);
    // Cada salida cae DENTRO de la abertura del portal (nunca levantada sobre
    // el techo por el lift).
    for (const exit of world.teleports) {
      expect(exit.y).toBeLessThanOrEqual(portalTop + 0.05);
    }
    // El centro de la cápsula jamás sube por encima del techo.
    expect(maxCenterY).toBeLessThan(CEILING_Y);
  });
});
