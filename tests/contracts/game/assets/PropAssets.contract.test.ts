import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PROP_ARCHETYPE_IDS, PropArchetypes } from "@game/config/props.config";

/**
 * La tabla de props del juego y los GLB generados describen los mismos objetos
 * desde dos lados. TypeScript no ve esa relación: un arquetipo puede apuntar a
 * un nodo que el generador ya no emite, o declarar más fragmentos de los que el
 * asset trae, y el juego se rompe recién en runtime.
 */
interface PropManifest {
  schemaVersion: number;
  packs: {
    id: string;
    glbBytes: number;
    props: {
      id: string;
      pack: string;
      bounds: [number, number, number];
      variants: number;
      chunkNodes: number;
      colliderVertices: number;
      lods: { triangles: number; draws: number }[];
    }[];
  }[];
}

const manifest = JSON.parse(
  readFileSync(resolve(process.cwd(), "src/game/assets/props/manifest.json"), "utf8"),
) as PropManifest;

const generated = new Map(
  manifest.packs.flatMap((pack) => pack.props.map((prop) => [prop.id, prop] as const)),
);

describe("assets de props contra props.config", () => {
  it("el manifiesto es de la version esperada", () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.packs).toHaveLength(3);
  });

  it("cada arquetipo tiene su asset generado, en el pack que declara", () => {
    for (const id of PROP_ARCHETYPE_IDS) {
      const archetype = PropArchetypes[id];
      const asset = generated.get(id);
      expect(asset, `${id} no existe en el manifiesto`).toBeDefined();
      expect(asset!.pack).toBe(archetype.asset.pack);
      expect(archetype.asset.node).toBe(`prop_${id}`);
    }
  });

  it("no hay assets generados que la config no conozca", () => {
    for (const id of generated.keys()) {
      expect(PROP_ARCHETYPE_IDS, `${id} sobra en el manifiesto`).toContain(id);
    }
  });

  it("las variantes declaradas existen en el GLB", () => {
    for (const id of PROP_ARCHETYPE_IDS) {
      expect(generated.get(id)!.variants, id).toBe(PropArchetypes[id].asset.variants);
    }
  });

  it("ningun arquetipo pide mas fragmentos de los que su asset trae", () => {
    for (const id of PROP_ARCHETYPE_IDS) {
      const gibs = PropArchetypes[id].gibs;
      const asset = generated.get(id)!;
      if (!gibs) {
        expect(asset.chunkNodes, `${id} no rompe pero trae fragmentos`).toBe(0);
        continue;
      }
      expect(asset.chunkNodes, `${id} declara gibs pero el asset no trae`).toBeGreaterThan(0);
      expect(gibs.maxChunks, `${id}: maxChunks supera los fragmentos del asset`).toBeLessThanOrEqual(
        asset.chunkNodes,
      );
      expect(gibs.minChunks).toBeLessThanOrEqual(gibs.maxChunks);
    }
  });

  it("los bounds de la config son los del asset, al milimetro", () => {
    for (const id of PROP_ARCHETYPE_IDS) {
      const declared = PropArchetypes[id].bounds;
      const actual = generated.get(id)!.bounds;
      for (let axis = 0; axis < 3; axis += 1) {
        // `PropSystem` apoya el prop en `base + bounds.y/2` y le pega el casco
        // del asset: si estos dos números no coinciden, el prop flota o se hunde
        // exactamente esa diferencia. Es el bug que dejaba los props en el aire.
        expect(
          Math.abs(declared[axis]! - actual[axis]!),
          `${id} eje ${axis}: config ${declared[axis]} vs asset ${actual[axis]}`,
        ).toBeLessThanOrEqual(0.002);
      }
    }
  });

  it("todo prop trae un casco de colision usable", () => {
    for (const id of PROP_ARCHETYPE_IDS) {
      const asset = generated.get(id)!;
      // Menos de 4 puntos no forma volumen; mas de 48 es un collider que Rapier
      // mastica cada frame.
      expect(asset.colliderVertices, id).toBeGreaterThanOrEqual(4);
      expect(asset.colliderVertices, id).toBeLessThanOrEqual(48);
    }
  });

  it("el LOD1 simplifica al LOD0 en todos los props", () => {
    for (const id of PROP_ARCHETYPE_IDS) {
      const [lod0, lod1] = generated.get(id)!.lods;
      expect(lod1!.triangles, id).toBeLessThan(lod0!.triangles);
    }
  });

  it("los packs entran en el presupuesto de peso", () => {
    for (const pack of manifest.packs) {
      expect(pack.glbBytes, pack.id).toBeLessThanOrEqual(700 * 1024);
    }
  });
});
