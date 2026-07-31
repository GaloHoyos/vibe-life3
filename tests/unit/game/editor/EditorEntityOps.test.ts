import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import type { EditorEntity } from "@game/editor/EditorDocument";
import {
  editablePayload,
  getPosition,
  getRotation,
  getRotationY,
  getSize,
  rotateEntity,
  setLevelId,
  setPosition,
  setRotation,
  setRotationY,
  setSize,
  translateEntity,
} from "@game/editor/EditorEntityOps";

describe("EditorEntityOps", () => {
  it("moves simple entities and door buttons together", () => {
    const box = staticBox();
    const door = doorEntity();

    translateEntity(box, 1, 2, 3);
    translateEntity(door, 1, 2, 3);

    expect(getPosition(box)).toEqual([2, 4, 6]);
    expect(door.kind === "door" && door.def.position).toEqual([1, 2, 3]);
    expect(door.kind === "door" && door.def.button.position).toEqual([2, 3, 4]);

    setPosition(box, [10, 20, 30]);

    expect(getPosition(box)).toEqual([10, 20, 30]);
  });

  it("moves structured entities without losing their internal shape", () => {
    const building = {
      eid: "building-eid",
      kind: "building",
      spec: { id: "building-1", center: [2, 4], groundY: 1 },
    } as EditorEntity;
    const ramp = {
      eid: "ramp-eid",
      kind: "ramp",
      spec: { id: "ramp-1", start: [0, 0], end: [4, 4], startY: 1, endY: 3 },
    } as EditorEntity;
    const prop = {
      eid: "prop-eid",
      kind: "prop",
      prop: { prop: "sandbagLine", spec: { id: "sandbags", from: [0, 0], to: [4, 0], y: 1 } },
    } as EditorEntity;

    translateEntity(building, 10, 2, 20);
    translateEntity(ramp, 1, 2, 3);
    translateEntity(prop, 2, 1, 3);

    expect(getPosition(building)).toEqual([12, 3, 24]);
    expect(ramp.kind === "ramp" && ramp.spec.start).toEqual([1, 3]);
    expect(ramp.kind === "ramp" && ramp.spec.end).toEqual([5, 7]);
    expect(ramp.kind === "ramp" && ramp.spec.startY).toBe(3);
    expect(ramp.kind === "ramp" && ramp.spec.endY).toBe(5);
    expect(getPosition(prop)).toEqual([4, 2, 3]);
  });

  it("edits size, rotations and level ids by entity kind", () => {
    const box = staticBox();
    const charger = {
      eid: "charger-eid",
      kind: "charger",
      def: { id: "charger-1", kind: "health", position: [0, 0, 0] },
    } as EditorEntity;
    const hazard = {
      eid: "hazard-eid",
      kind: "hazardVolume",
      def: { id: "hazard-1", position: [0, 0, 0], size: [2, 2, 2], kind: "fire", damagePerSecond: 10 },
    } as EditorEntity;

    expect(getSize(box)).toEqual([4, 5, 6]);
    setSize(box, [7, 8, 9]);
    expect(getSize(box)).toEqual([7, 8, 9]);
    expect(getSize(charger)).toBeNull();

    setRotation(box, [0.1, 0.2, 0.3]);
    expect(getRotation(box)).toEqual([0.1, 0.2, 0.3]);
    setRotation(box, [0, 0, 0]);
    expect(getRotation(box)).toEqual([0, 0, 0]);

    setRotationY(charger, Math.PI / 2);
    expect(getRotationY(charger)).toBe(Math.PI / 2);
    expect(getRotation(charger)).toEqual([0, Math.PI / 2, 0]);

    setRotation(hazard, [1, 2, 3]);
    expect(getRotation(hazard)).toEqual([0, 0, 0]);

    setLevelId(box, "box-renamed");
    setLevelId(charger, "charger-renamed");
    expect(box.kind === "staticBox" && box.def.id).toBe("box-renamed");
    expect(charger.kind === "charger" && charger.def.id).toBe("charger-renamed");
    expect(editablePayload(box)).toBe(box.kind === "staticBox" && box.def);
  });

  it("rotates entities by composing quaternion deltas", () => {
    const box = staticBox();
    const delta = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);

    rotateEntity(box, delta);

    const rotation = getRotation(box);
    expect(rotation[1]).toBeCloseTo(Math.PI / 2);
  });

  it("mueve polígonos, carriles y respawn de checkpoint como una unidad", () => {
    const area: EditorEntity = {
      eid: "area",
      kind: "vehicleNavArea",
      def: {
        id: "area",
        polygon: [[-2, 0, -2], [2, 0, -2], [2, 0, 2], [-2, 0, 2]],
        surface: "ground",
      },
    };
    const lane: EditorEntity = {
      eid: "lane",
      kind: "vehicleNavLane",
      def: {
        id: "lane",
        points: [[0, 0, -4], [0, 0, 4]],
        width: 3,
        direction: "both",
      },
    };
    const checkpoint: EditorEntity = {
      eid: "checkpoint",
      kind: "checkpoint",
      def: { id: "checkpoint", position: [0, 1, 0], size: [2, 2, 2], respawn: [0, 0, 1] },
    };

    translateEntity(area, 10, 2, 20);
    translateEntity(lane, 10, 2, 20);
    translateEntity(checkpoint, 10, 2, 20);

    expect(getPosition(area)).toEqual([10, 2, 20]);
    expect(area.kind === "vehicleNavArea" && area.def.polygon[0]).toEqual([8, 2, 18]);
    expect(getPosition(lane)).toEqual([10, 2, 20]);
    expect(lane.kind === "vehicleNavLane" && lane.def.points[1]).toEqual([10, 2, 24]);
    expect(checkpoint.kind === "checkpoint" && checkpoint.def.respawn).toEqual([10, 2, 21]);
  });
});

function staticBox(): EditorEntity {
  return {
    eid: "box-eid",
    kind: "staticBox",
    def: {
      id: "box-1",
      position: [1, 2, 3],
      size: [4, 5, 6],
      material: "concrete",
    },
  };
}

function doorEntity(): EditorEntity {
  return {
    eid: "door-eid",
    kind: "door",
    def: {
      id: "door-1",
      position: [0, 0, 0],
      size: [1, 2, 3],
      openOffset: [0, 3, 0],
      speed: 2,
      material: "door",
      button: {
        id: "door-button",
        label: "Open",
        position: [1, 1, 1],
        size: [0.4, 0.4, 0.2],
      },
    },
  };
}
