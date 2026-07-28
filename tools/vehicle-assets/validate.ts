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

import {
  AUDIO_ROOT,
  MANIFEST_PATH,
  MODELS_ROOT,
  OUTPUT_ROOT,
  TEXTURES_ROOT,
} from "./paths.js";
import {
  VEHICLE_SPECS,
  type LodStats,
  type VehicleAssetManifest,
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

interface AssetValidationResult {
  readonly id: string;
  readonly bytes: number;
  readonly budgetBytes: number;
  readonly lods: readonly LodStats[];
  readonly khronos: {
    readonly errors: number;
    readonly warnings: number;
    readonly infos: number;
    readonly hints: number;
  };
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function countNode(node: Node): LodStats {
  let triangles = 0;
  let draws = 0;
  const mesh = node.getMesh();
  if (mesh !== null) {
    for (const primitive of mesh.listPrimitives()) {
      const indices = primitive.getIndices();
      const positions = primitive.getAttribute("POSITION");
      triangles += Math.floor(
        (indices?.getCount() ?? positions?.getCount() ?? 0) / 3,
      );
      draws += 1;
    }
  }
  for (const child of node.listChildren()) {
    const childStats = countNode(child);
    triangles += childStats.triangles;
    draws += childStats.draws;
  }
  return { triangles, draws };
}

function collectNodes(node: Node, target: Map<string, Node>): void {
  target.set(node.getName(), node);
  for (const child of node.listChildren()) {
    collectNodes(child, target);
  }
}

function validateWav(bytes: Uint8Array, fileName: string): void {
  assert(bytes.byteLength >= 44, `${fileName}: WAV truncado.`);
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));
  assert(ascii(0, 4) === "RIFF", `${fileName}: encabezado RIFF inválido.`);
  assert(ascii(8, 4) === "WAVE", `${fileName}: encabezado WAVE inválido.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(view.getUint16(20, true) === 1, `${fileName}: debe ser PCM.`);
  assert(view.getUint16(22, true) === 1, `${fileName}: debe ser mono.`);
  assert(
    view.getUint32(24, true) === 22_050,
    `${fileName}: sample rate inesperado.`,
  );
  assert(view.getUint16(34, true) === 16, `${fileName}: debe ser PCM16.`);
}

async function main(): Promise<void> {
  await MeshoptDecoder.ready;
  const require = createRequire(import.meta.url);
  const validator = require("gltf-validator") as KhronosValidator;
  const manifest = JSON.parse(
    await readFile(MANIFEST_PATH, "utf8"),
  ) as VehicleAssetManifest;
  assert(manifest.schemaVersion === 1, "Versión de manifiesto inválida.");
  const io = new NodeIO()
    .registerExtensions([
      EXTMeshoptCompression,
      EXTTextureWebP,
      KHRMeshQuantization,
    ])
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const results: AssetValidationResult[] = [];

  for (const spec of VEHICLE_SPECS) {
    const modelPath = resolve(MODELS_ROOT, `${spec.id}.glb`);
    const bytes = new Uint8Array(await readFile(modelPath));
    const fileStats = await stat(modelPath);
    assert(
      fileStats.size <= spec.maxGlbBytes,
      `${spec.id}: GLB excede ${(spec.maxGlbBytes / 1024 / 1024).toFixed(0)} MiB.`,
    );
    const report = await validator.validateBytes(bytes, {
      uri: `${spec.id}.glb`,
      format: "glb",
      maxIssues: 100,
      writeTimestamp: false,
    });
    if (report.issues.numErrors > 0) {
      const messages = report.issues.messages
        .filter((message) => message.severity === 0)
        .map((message) => `${message.code}: ${message.message}`)
        .join("\n");
      throw new Error(`${spec.id}: Khronos encontró errores.\n${messages}`);
    }

    const document = await io.read(modelPath);
    const nodes = new Map<string, Node>();
    for (const scene of document.getRoot().listScenes()) {
      for (const child of scene.listChildren()) {
        collectNodes(child, nodes);
      }
    }
    for (const requiredName of spec.requiredNodes) {
      assert(nodes.has(requiredName), `${spec.id}: falta nodo ${requiredName}.`);
    }
    const lods = ([0, 1, 2] as const).map((lod) => {
      const root = nodes.get(`visual_lod${lod}`);
      assert(root !== undefined, `${spec.id}: falta visual_lod${lod}.`);
      return countNode(root);
    });
    assert(
      lods[0]!.triangles <= spec.maxTrianglesLod0,
      `${spec.id}: LOD0 excede el presupuesto de triángulos.`,
    );
    for (let lod = 0; lod < lods.length; lod += 1) {
      assert(
        lods[lod]!.draws <= spec.maxDrawsPerLod,
        `${spec.id}: LOD${lod} excede el presupuesto de draws.`,
      );
    }
    results.push({
      id: spec.id,
      bytes: fileStats.size,
      budgetBytes: spec.maxGlbBytes,
      lods,
      khronos: {
        errors: report.issues.numErrors,
        warnings: report.issues.numWarnings,
        infos: report.issues.numInfos,
        hints: report.issues.numHints,
      },
    });
  }

  for (const spec of VEHICLE_SPECS) {
    for (const suffix of ["albedo", "normal", "pbr"] as const) {
      const texturePath = resolve(TEXTURES_ROOT, `${spec.id}-${suffix}.webp`);
      const metadata = await sharp(texturePath).metadata();
      assert(metadata.format === "webp", `${texturePath}: no es WebP.`);
      assert(
        metadata.width === 1024 && metadata.height === 1024,
        `${texturePath}: el atlas debe medir 1024×1024.`,
      );
    }
  }

  let audioBytes = 0;
  for (const audio of manifest.audio.files) {
    const audioPath = resolve(OUTPUT_ROOT, audio.path);
    const bytes = new Uint8Array(await readFile(audioPath));
    validateWav(bytes, audio.path);
    audioBytes += bytes.byteLength;
  }
  assert(
    audioBytes <= 12 * 1024 * 1024,
    "El audio vehicular excede el presupuesto conjunto de 12 MiB.",
  );
  assert(
    audioBytes === manifest.audio.totalBytes,
    "El tamaño de audio no coincide con el manifiesto.",
  );

  const reportPath = resolve(OUTPUT_ROOT, "validation-report.json");
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        validator: "Khronos glTF Validator",
        deterministic: true,
        vehicles: results,
        audio: {
          bytes: audioBytes,
          budgetBytes: 12 * 1024 * 1024,
          files: manifest.audio.files.length,
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  for (const result of results) {
    const lodSummary = result.lods
      .map((lod, index) => `L${index} ${lod.triangles}t/${lod.draws}d`)
      .join(", ");
    process.stdout.write(
      `✓ ${result.id}: ${(result.bytes / 1024).toFixed(1)} KiB ` +
        `(${lodSummary}); Khronos ${result.khronos.errors} errores, ` +
        `${result.khronos.warnings} advertencias\n`,
    );
  }
  process.stdout.write(
    `✓ audio: ${(audioBytes / 1024 / 1024).toFixed(2)} MiB / 12 MiB\n`,
  );
  process.stdout.write(`✓ reporte: ${reportPath}\n`);
}

await main();
