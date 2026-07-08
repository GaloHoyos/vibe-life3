import { beforeAll, describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import { Raycast } from "@engine/physics/Raycast";
import {
  isTargetVisible,
  type PerceptionConfig,
} from "@engine/ai/perception/PerceptionSystem";

beforeAll(async () => {
  await RAPIER.init();
});

/** Cono amplio + sin oído: aísla el chequeo de LOS físico de cono/rango. */
const config: PerceptionConfig = {
  visionRange: 32,
  visionConeRadians: Math.PI,
  hearingRadius: 0,
  memoryTime: 8,
  eyeHeight: 0.62,
};

// Combine humanoide: cápsula de 1.75 m centrada en y=0.875 → el ojo
// (centro + eyeHeight) cae en 1.495, DENTRO del cuerpo y sus hitboxes vivos.
const SELF_ID = "combine-1";
const SELF_CENTER = new Vector3(0, 0.875, 0);
const FACING = new Vector3(0, 0, 1);

function spawnSelf(physics: PhysicsWorld): void {
  physics.createKinematicBox({
    id: SELF_ID,
    position: SELF_CENTER.clone(),
    size: new Vector3(0.9, 1.75, 0.9),
    metadata: { kind: "npc", faction: "combine" },
  });
  // Hitbox vivo del torso (PhysicalSkeleton lo registra con id DERIVADO y el
  // ownerId del actor). Queda delante del ojo, en la línea hacia el target.
  physics.createKinematicBox({
    id: `${SELF_ID}-live-part-chest`,
    position: new Vector3(0, 1.4, 0.2),
    size: new Vector3(0.5, 0.6, 0.3),
    metadata: { kind: "ragdoll", faction: "combine", ownerId: SELF_ID },
  });
}

describe("isTargetVisible — self-occlusion del propio cuerpo", () => {
  it("ve al player aunque el ojo arranque dentro de la cápsula y los hitboxes vivos propios", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    spawnSelf(physics);
    physics.createStaticBox({
      id: "player",
      position: new Vector3(0, 1.0, 10),
      size: new Vector3(0.8, 1.8, 0.8),
      metadata: { kind: "player", faction: "player" },
    });
    physics.updateQueryPipeline();

    const raycast = new Raycast(physics);
    const target = { id: "player", position: new Vector3(0, 1.0, 10), isAlive: true };

    // Con selfId, la cápsula (por id) y el hitbox vivo (por ownerId) se excluyen.
    expect(isTargetVisible(config, SELF_CENTER, FACING, target, raycast, SELF_ID)).toBe(true);
    // Control: sin selfId, el cuerpo propio bloquea (regresión que rompía el LOS).
    expect(isTargetVisible(config, SELF_CENTER, FACING, target, raycast)).toBe(false);
  });

  it("una pared opaca entre medio sí bloquea el LOS", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    spawnSelf(physics);
    physics.createStaticBox({
      id: "wall",
      position: new Vector3(0, 1.5, 5),
      size: new Vector3(4, 3, 0.5),
      metadata: { kind: "static" },
    });
    physics.createStaticBox({
      id: "player",
      position: new Vector3(0, 1.0, 10),
      size: new Vector3(0.8, 1.8, 0.8),
      metadata: { kind: "player", faction: "player" },
    });
    physics.updateQueryPipeline();

    const raycast = new Raycast(physics);
    const target = { id: "player", position: new Vector3(0, 1.0, 10), isAlive: true };
    expect(isTargetVisible(config, SELF_CENTER, FACING, target, raycast, SELF_ID)).toBe(false);
  });

  it("pegarle a un hitbox vivo del target cuenta como verlo (ownerId del target)", async () => {
    const physics = new PhysicsWorld();
    await physics.init();
    spawnSelf(physics);
    // El target solo expone su hitbox vivo (id derivado) en la línea de vista.
    physics.createStaticBox({
      id: "enemy-2-live-part-chest",
      position: new Vector3(0, 1.5, 10),
      size: new Vector3(0.6, 0.7, 0.4),
      metadata: { kind: "ragdoll", faction: "combine", ownerId: "enemy-2" },
    });
    physics.updateQueryPipeline();

    const raycast = new Raycast(physics);
    const target = { id: "enemy-2", position: new Vector3(0, 1.0, 10), isAlive: true };
    expect(isTargetVisible(config, SELF_CENTER, FACING, target, raycast, SELF_ID)).toBe(true);
  });
});
