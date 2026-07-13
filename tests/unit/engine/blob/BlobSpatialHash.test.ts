import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { BlobSpatialHash, type SpatialHashItem } from "@engine/blob/BlobSpatialHash";

describe("BlobSpatialHash", () => {
  it("reports local pairs once and ignores inactive entries", () => {
    const items: SpatialHashItem[] = [
      { index: 0, position: new Vector3(0, 0, 0), active: true },
      { index: 1, position: new Vector3(0.4, 0, 0), active: true },
      { index: 2, position: new Vector3(8, 0, 0), active: true },
      { index: 3, position: new Vector3(0.2, 0, 0), active: false },
    ];
    const hash = new BlobSpatialHash<SpatialHashItem>(0.5);
    hash.rebuild(items);
    const pairs: string[] = [];
    hash.forEachPair(0.6, (a, b) => pairs.push(`${a.index}-${b.index}`));

    expect(pairs).toEqual(["0-1"]);
    expect(hash.lastCandidateChecks).toBe(1);
  });

  it("queries only occupants inside a local sphere", () => {
    const items: SpatialHashItem[] = Array.from({ length: 100 }, (_, index) => ({
      index,
      position: new Vector3(index, 0, 0),
      active: true,
    }));
    const hash = new BlobSpatialHash<SpatialHashItem>(1);
    hash.rebuild(items);
    const found: number[] = [];
    hash.forEachNear(new Vector3(50, 0, 0), 1.1, (item) => found.push(item.index));
    expect(found.sort((a, b) => a - b)).toEqual([49, 50, 51]);
  });
});
