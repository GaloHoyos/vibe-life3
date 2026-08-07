import { createRequire } from "node:module";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { NodeIO, type Node } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  EXTTextureWebP,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";

import { MANIFEST_PATH, MODELS_ROOT, REPORT_PATH, TEXTURES_ROOT } from "./paths.js";
import {
  MAX_COLLIDER_VERTICES,
  PROP_PACK_SPECS,
  type PropAssetManifest,
  type PropPackSpec,
} from "./types.js";

interface KhronosValidationReport {
  readonly issues: {
    readonly numErrors: number;
    readonly numWarnings: number;
    readonly numInfos: number;
    readonly numHints: number;
    readonly messages: readonly {
      readonly code: string;
      readonly message: string;
      readonly severity: number;
    }[];
  };
}

interface KhronosValidator {
  validateBytes(
    data: Uint8Array,
    options: {
      readonly uri: string;
      readonly format: "glb";
      readonly maxIssues: number;
      readonly writeTimestamp: false;
    },
  ): Promise<KhronosValidationReport>;
}

interface PackValidationResult {
  readonly id: string;
  readonly bytes: number;
  readonly budgetBytes: number;
  readonly props: readonly {
    readonly id: string;
    readonly lod0Triangles: number;
    readonly lod1Triangles: number;
    readonly colliderVertices: number;
    readonly chunks: number;
  }[];
  readonly khronos: {
    readonly errors: number;
    readonly warnings: number;
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function collectNodes(node: Node, target: Map<string, Node[]>): void {
  const name = node.getName();
  const bucket = target.get(name);
  if (bucket) bucket.push(node);
  else target.set(name, [node]);
  for (const child of node.listChildren()) collectNodes(child, target);
}

function countTriangles(node: Node): number {
  let triangles = 0;
  const mesh = node.getMesh();
  if (mesh !== null) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const positions = primitive.getAttribute("POSITION");
      triangles += Math.floor((indices?.getCount() ?? positions?.getCount() ?? 0) / 3);
    }
  }
  for (const child of node.listChildren()) triangles += countTriangles(child);
  return triangles;
}

function countDraws(node: Node): number {
  let draws = node.getMesh()?.listPrimitives().length ?? 0;
  for (const child of node.listChildren()) draws += countDraws(child);
  return draws;
}

function transformPoint(
  point: readonly number[],
  matrix: ArrayLike<number>,
): [number, number, number] {
  return [
    matrix[0]! * point[0]! + matrix[4]! * point[1]! + matrix[8]! * point[2]! + matrix[12]!,
    matrix[1]! * point[0]! + matrix[5]! * point[1]! + matrix[9]! * point[2]! + matrix[13]!,
    matrix[2]! * point[0]! + matrix[6]! * point[1]! + matrix[10]! * point[2]! + matrix[14]!,
  ];
}

/**
 * Posiciones en espacio de la escena. Hay que pasar por la matriz del nodo:
 * `meshopt` cuantiza POSITION a enteros normalizados y deja la desnormalización
 * en el TRS del nodo, así que leer el accessor crudo da extensiones inventadas.
 */
function positionsOf(node: Node): [number, number, number][] {
  const points: [number, number, number][] = [];
  const mesh = node.getMesh();
  if (mesh === null) return points;
  const matrix = node.getWorldMatrix();
  for (const primitive of mesh.listPrimitives()) {
    const positions = primitive.getAttribute("POSITION");
    if (positions === null) continue;
    for (let index = 0; index < positions.getCount(); index += 1) {
      points.push(transformPoint(positions.getElement(index, []), matrix));
    }
  }
  return points;
}

function boxOf(node: Node): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const visit = (current: Node): void => {
    for (const point of positionsOf(current)) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis]!, point[axis]!);
        max[axis] = Math.max(max[axis]!, point[axis]!);
      }
    }
    for (const child of current.listChildren()) visit(child);
  };
  visit(node);
  return { min, max };
}

function extentsOf(node: Node): [number, number, number] {
  const { min, max } = boxOf(node);
  return [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!];
}

/** Cuánto se corre el centro del AABB respecto del origen, por eje. */
function centerOffsetOf(node: Node): [number, number, number] {
  const { min, max } = boxOf(node);
  return [
    (min[0]! + max[0]!) / 2,
    (min[1]! + max[1]!) / 2,
    (min[2]! + max[2]!) / 2,
  ];
}

function findChild(parent: Node, name: string): Node | undefined {
  return parent.listChildren().find((child) => child.getName() === name);
}

async function validatePack(
  spec: PropPackSpec,
  validator: KhronosValidator,
  io: NodeIO,
): Promise<PackValidationResult> {
  const modelPath = resolve(MODELS_ROOT, `${spec.id}.glb`);
  const bytes = await readFile(modelPath);
  const fileStats = await stat(modelPath);
  assert(
    fileStats.size <= spec.maxGlbBytes,
    `${spec.id}: ${(fileStats.size / 1024).toFixed(1)} KiB supera el presupuesto de ${(
      spec.maxGlbBytes / 1024
    ).toFixed(0)} KiB.`,
  );

  const report = await validator.validateBytes(new Uint8Array(bytes), {
    uri: `${spec.id}.glb`,
    format: "glb",
    maxIssues: 100,
    writeTimestamp: false,
  });
  if (report.issues.numErrors > 0) {
    const detail = report.issues.messages
      .filter((message) => message.severity === 0)
      .map((message) => `${message.code}: ${message.message}`)
      .join("; ");
    throw new Error(`${spec.id}: el validador de Khronos reportó errores — ${detail}`);
  }

  const document = await io.read(modelPath);
  const nodes = new Map<string, Node[]>();
  for (const scene of document.getRoot().listScenes()) {
    for (const child of scene.listChildren()) collectNodes(child, nodes);
  }

  const props = spec.props.map((prop) => {
    const root = nodes.get(`prop_${prop.id}`)?.[0];
    assert(root !== undefined, `${spec.id}: falta el nodo prop_${prop.id}.`);

    const lod0 = findChild(root, "visual_lod0");
    const lod1 = findChild(root, "visual_lod1");
    assert(lod0 !== undefined && lod1 !== undefined, `${prop.id}: faltan nodos de LOD.`);
    assert(
      lod0.listChildren().length === prop.variants,
      `${prop.id}: declara ${prop.variants} variantes y el GLB trae ${lod0.listChildren().length}.`,
    );

    const lod0Triangles = countTriangles(lod0);
    const lod1Triangles = countTriangles(lod1);
    assert(
      lod0Triangles <= spec.maxTrianglesLod0 * prop.variants,
      `${prop.id}: LOD0 con ${lod0Triangles} triángulos supera el presupuesto.`,
    );
    // Un LOD1 que no simplifica nada es peso muerto: el nivel de detalle existe
    // para que un prop lejano cueste menos, no para duplicar la malla.
    assert(
      lod1Triangles < lod0Triangles,
      `${prop.id}: el LOD1 (${lod1Triangles}) no simplifica al LOD0 (${lod0Triangles}).`,
    );
    const draws = countDraws(lod0) / prop.variants;
    assert(
      draws <= spec.maxDrawsPerLod,
      `${prop.id}: ${draws} draws por variante supera ${spec.maxDrawsPerLod}.`,
    );

    // Las extensiones reales tienen que coincidir con las que declara la config
    // del juego, o el placeholder y el collider de reserva mienten.
    const extents = extentsOf(lod0.listChildren()[0]!);
    for (let axis = 0; axis < 3; axis += 1) {
      const declared = prop.bounds[axis]!;
      const actual = extents[axis]!;
      // Tolerancia estrecha a propósito: `PropSystem` apoya el prop en
      // `base + bounds.y/2`, así que cualquier diferencia acá es un prop
      // flotando o hundido esa misma cantidad.
      assert(
        Math.abs(actual - declared) <= 0.01,
        `${prop.id}: el eje ${axis} mide ${actual.toFixed(3)} y la config declara ${declared}.`,
      );
    }

    // Cada variante y cada LOD tienen que estar centrados en el origen: es la
    // convención `aabb-center` del manifiesto, y `PropSystem` apoya el prop
    // dando por hecho que se cumple. Un detalle asimétrico que corra el centro
    // deja el prop flotando o hundido, sin que nada más falle.
    // El LOD0 manda: fija el marco y de él salen `bounds` y el casco. Todas sus
    // variantes tienen que estar centradas en el origen y medir lo mismo, porque
    // comparten un único collider y un único `bounds`.
    for (const variantNode of lod0.listChildren()) {
      const center = centerOffsetOf(variantNode);
      const variantExtents = extentsOf(variantNode);
      for (let axis = 0; axis < 3; axis += 1) {
        assert(
          Math.abs(center[axis]!) <= 0.005,
          `${prop.id}/${variantNode.getName()}: el centro está a ` +
            `${center[axis]!.toFixed(3)} m del origen en el eje ${axis}; debe estar centrado.`,
        );
        assert(
          Math.abs(variantExtents[axis]! - extents[axis]!) <= 0.01,
          `${prop.id}/${variantNode.getName()}: mide distinto que la variante 0 en el eje ` +
            `${axis}; todas comparten collider y bounds, así que el envolvente no puede cambiar.`,
        );
      }
    }

    // El LOD1 tira detalle, así que su AABB propio es más chico y puede quedar
    // descentrado: lo que importa es que no se salga del volumen del LOD0, que
    // es lo que delataría geometría desplazada en vez de simplificada.
    const lod0Box = boxOf(lod0);
    const lod1Box = boxOf(lod1);
    for (let axis = 0; axis < 3; axis += 1) {
      assert(
        lod1Box.min[axis]! >= lod0Box.min[axis]! - 0.01 &&
          lod1Box.max[axis]! <= lod0Box.max[axis]! + 0.01,
        `${prop.id}: el LOD1 se sale del volumen del LOD0 en el eje ${axis}; ` +
          `su geometría está desplazada, no simplificada.`,
      );
    }

    const collider = findChild(root, "collider_0");
    assert(collider !== undefined, `${prop.id}: falta collider_0.`);
    const colliderVertices = positionsOf(collider).length;
    assert(
      colliderVertices > 0 && colliderVertices <= MAX_COLLIDER_VERTICES,
      `${prop.id}: el casco tiene ${colliderVertices} vértices (máximo ${MAX_COLLIDER_VERTICES}).`,
    );
    const colliderExtents = extentsOf(collider);
    for (let axis = 0; axis < 3; axis += 1) {
      assert(
        colliderExtents[axis]! > 0,
        `${prop.id}: el casco es degenerado en el eje ${axis}; los objetos lo atravesarían.`,
      );
    }

    const chunksRoot = findChild(root, "chunks");
    const chunks = chunksRoot?.listChildren().length ?? 0;
    if (prop.chunks > 0) {
      assert(chunksRoot !== undefined, `${prop.id}: declara gibs pero no trae nodo chunks.`);
      assert(
        chunks > 1 && chunks <= prop.chunks,
        `${prop.id}: ${chunks} fragmentos fuera del rango declarado (2..${prop.chunks}).`,
      );
      let massTotal = 0;
      for (const chunk of chunksRoot!.listChildren()) {
        const extras = chunk.getExtras() as { massFraction?: number; sector?: number[] };
        assert(
          typeof extras.massFraction === "number" && extras.massFraction > 0,
          `${prop.id}/${chunk.getName()}: sin massFraction.`,
        );
        assert(
          Array.isArray(extras.sector) && extras.sector.length === 3,
          `${prop.id}/${chunk.getName()}: sin sector.`,
        );
        massTotal += extras.massFraction;
      }
      assert(
        Math.abs(massTotal - 1) < 0.02,
        `${prop.id}: las fracciones de masa suman ${massTotal.toFixed(3)}, no 1.`,
      );
    } else {
      assert(chunksRoot === undefined, `${prop.id}: es indestructible pero trae fragmentos.`);
    }

    return {
      id: prop.id,
      lod0Triangles,
      lod1Triangles,
      colliderVertices,
      chunks,
    };
  });

  for (const suffix of ["albedo", "normal", "pbr"]) {
    const texturePath = resolve(TEXTURES_ROOT, `${spec.id}-${suffix}.webp`);
    const metadata = await sharp(texturePath).metadata();
    assert(metadata.format === "webp", `${spec.id}-${suffix}: no es webp.`);
    assert(
      metadata.width === spec.atlasSize && metadata.height === spec.atlasSize,
      `${spec.id}-${suffix}: mide ${metadata.width}x${metadata.height}, se esperaba ${spec.atlasSize}².`,
    );
  }

  return {
    id: spec.id,
    bytes: fileStats.size,
    budgetBytes: spec.maxGlbBytes,
    props,
    khronos: {
      errors: report.issues.numErrors,
      warnings: report.issues.numWarnings,
    },
  };
}

async function main(): Promise<void> {
  await MeshoptDecoder.ready;
  const require = createRequire(import.meta.url);
  const validator = require("gltf-validator") as KhronosValidator;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as PropAssetManifest;
  assert(manifest.schemaVersion === 1, "manifest: schemaVersion inesperada.");
  assert(
    manifest.packs.length === PROP_PACK_SPECS.length,
    `manifest: declara ${manifest.packs.length} packs y hay ${PROP_PACK_SPECS.length}.`,
  );

  const results: PackValidationResult[] = [];
  for (const spec of PROP_PACK_SPECS) {
    const result = await validatePack(spec, validator, io);
    results.push(result);
    const detail = result.props
      .map((prop) => `${prop.id} ${prop.lod0Triangles}t/${prop.chunks}f`)
      .join(", ");
    process.stdout.write(
      `✓ ${spec.id}: ${(result.bytes / 1024).toFixed(1)} KiB; ` +
        `Khronos ${result.khronos.errors} errores, ${result.khronos.warnings} advertencias\n` +
        `  ${detail}\n`,
    );
  }

  await writeFile(REPORT_PATH, `${JSON.stringify({ packs: results }, null, 2)}\n`, "utf8");
  process.stdout.write(`✓ reporte: ${REPORT_PATH}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
