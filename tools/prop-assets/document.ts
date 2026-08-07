import {
  Accessor,
  Document,
  type Material,
  type Node,
} from "@gltf-transform/core";

import {
  countNode,
  createGlassMaterial,
  createVisualNode,
  createWeatheredMaterial,
} from "../shared/gltf/build.js";
import type { BuildContext, GeneratedTextureSet, LodStats } from "../shared/gltf/types.js";
import {
  PROP_BUILDERS,
  boundsOf,
  colliderPoints,
  deriveChunks,
  mergeRaw,
  type PropLod,
} from "./models.js";
import { MAX_COLLIDER_VERTICES, type GeneratedPropStats, type PropPackSpec } from "./types.js";

export interface BuiltPropPack {
  readonly document: Document;
  readonly props: readonly GeneratedPropStats[];
  readonly nodeNames: readonly string[];
}

/** Arquetipos que ruedan: su casco es un prisma, no una caja. */
const CYLINDRICAL = new Set(["metalBarrel", "plasticDrum", "glassBottle", "trafficCone"]);

/**
 * Casco de colisión como malla propia, sin material ni UVs. Va horneado en el
 * GLB y no en la config porque el casco tiene que calzar con la malla, y la
 * malla sale de una semilla: describir los puntos a mano garantiza que se
 * desincronicen la primera vez que cambie una proporción.
 */
function createColliderMesh(
  context: BuildContext,
  name: string,
  points: Float32Array<ArrayBuffer>,
): Node {
  const document = context.document;
  const indices = new Uint16Array((points.length / 3) * 3);
  // El casco lo recalcula Rapier a partir de las posiciones; los índices sólo
  // existen para que el GLB sea válido, así que alcanza con un abanico.
  const vertexCount = points.length / 3;
  let cursor = 0;
  for (let index = 2; index < vertexCount; index += 1) {
    indices[cursor] = 0;
    indices[cursor + 1] = index - 1;
    indices[cursor + 2] = index;
    cursor += 3;
  }
  const primitive = document
    .createPrimitive()
    .setAttribute(
      "POSITION",
      document
        .createAccessor(`${name}_position`, context.buffer)
        .setType(Accessor.Type.VEC3)
        .setArray(points),
    )
    .setIndices(
      document
        .createAccessor(`${name}_index`, context.buffer)
        .setType(Accessor.Type.SCALAR)
        .setArray(indices.subarray(0, cursor)),
    );
  const mesh = document.createMesh(name).addPrimitive(primitive);
  const node = document.createNode(name).setMesh(mesh);
  context.nodeNames.push(name);
  return node;
}

export function createPropPackDocument(
  spec: PropPackSpec,
  textures: GeneratedTextureSet,
): BuiltPropPack {
  const document = new Document();
  const buffer = document.createBuffer(`${spec.id}_buffer`);
  const material = createWeatheredMaterial(document, spec.id, textures);
  const glassMaterial = createGlassMaterial(document, spec.id);
  const scene = document.createScene(spec.id);
  const context: BuildContext = {
    document,
    buffer,
    material,
    sceneRoot: document.createNode(`${spec.id}_pack`),
    nodeNames: [`${spec.id}_pack`],
  };
  scene.addChild(context.sceneRoot);

  const stats: GeneratedPropStats[] = [];

  for (const prop of spec.props) {
    const build = PROP_BUILDERS[prop.id];
    const propRoot = document.createNode(`prop_${prop.id}`).setExtras({
      kind: "prop-asset",
      archetype: prop.id,
      units: "meters",
      up: "+Y",
      origin: "aabb-center",
      variants: prop.variants,
      originalAsset: true,
    });
    context.nodeNames.push(`prop_${prop.id}`);
    context.sceneRoot.addChild(propRoot);

    const lods: LodStats[] = [];
    for (const lod of [0, 1] as PropLod[]) {
      const lodRoot = document.createNode(`visual_lod${lod}`);
      context.nodeNames.push(`visual_lod${lod}`);
      propRoot.addChild(lodRoot);
      for (let variant = 0; variant < prop.variants; variant += 1) {
        const geometry = build(variant, lod);
        const variantRoot = document.createNode(`variant_${variant}`);
        context.nodeNames.push(`variant_${variant}`);
        lodRoot.addChild(variantRoot);
        createVisualNode(
          context,
          variantRoot,
          `${prop.id}_lod${lod}_v${variant}`,
          geometry.parts,
          { occlusionStrength: 0.7 },
        );
        if (geometry.glass && geometry.glass.length > 0) {
          createVisualNode(
            context,
            variantRoot,
            `${prop.id}_lod${lod}_v${variant}_glass`,
            geometry.glass,
            { material: glassMaterial, bakeOcclusion: false },
          );
        }
      }
      lods.push(countNode(lodRoot));
    }

    // El casco y los fragmentos salen de la variante 0: todas comparten
    // proporciones dentro del jitter, y un casco por variante multiplicaría el
    // costo físico sin que nadie note la diferencia de dos centímetros.
    const base = build(0, 0);
    const solidParts = [...base.parts, ...(base.glass ?? [])];
    const bounds = boundsOf(solidParts);
    const points = colliderPoints(bounds, CYLINDRICAL.has(prop.id));
    if (points.length / 3 > MAX_COLLIDER_VERTICES) {
      throw new Error(`El casco de ${prop.id} supera ${MAX_COLLIDER_VERTICES} vértices.`);
    }
    propRoot.addChild(createColliderMesh(context, `collider_0`, points));

    let chunkNodes = 0;
    if (prop.chunks > 0) {
      const chunksRoot = document.createNode("chunks");
      context.nodeNames.push("chunks");
      propRoot.addChild(chunksRoot);
      const chunks = deriveChunks(solidParts, prop.chunks);
      chunks.forEach((chunk, index) => {
        const chunkBounds = boundsOf(chunk.parts);
        createVisualNode(context, chunksRoot, `chunk_${index}`, chunk.parts, {
          bakeOcclusion: false,
          extras: {
            sector: chunk.sector,
            massFraction: chunk.massFraction,
            size: [
              chunkBounds.max.x - chunkBounds.min.x,
              chunkBounds.max.y - chunkBounds.min.y,
              chunkBounds.max.z - chunkBounds.min.z,
            ],
          },
        });
        chunkNodes += 1;
      });
    }

    stats.push({
      id: prop.id,
      pack: spec.id,
      lods: [lods[0]!, lods[1]!],
      colliderNodes: 1,
      colliderVertices: points.length / 3,
      chunkNodes,
      variants: prop.variants,
    });

    for (const part of solidParts) part.geometry.dispose();
  }

  cleanupUnusedMaterial(glassMaterial);
  return { document, props: stats, nodeNames: context.nodeNames };
}

/** Un pack sin vidrio no debe arrastrar un material que nadie usa. */
function cleanupUnusedMaterial(material: Material): void {
  if (material.listParents().every((parent) => parent.propertyType === "Root")) {
    material.dispose();
  }
}

export { mergeRaw };
