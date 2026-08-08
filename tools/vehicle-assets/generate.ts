import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { NodeIO } from "@gltf-transform/core";
import {
  EXTMeshoptCompression,
  EXTTextureWebP,
  KHRMeshQuantization,
} from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";

import { createAudioAssets, createAudioStats } from "./audio.js";
import {
  createVehicleDocument,
  toGeneratedVehicleStats,
} from "./models.js";
import {
  AUDIO_ROOT,
  MANIFEST_PATH,
  MODELS_ROOT,
  OUTPUT_ROOT,
  TEXTURES_ROOT,
} from "./paths.js";
import { createPbrAtlases } from "../shared/gltf/textures.js";
import {
  VEHICLE_SPECS,
  type VehicleAssetManifest,
} from "./types.js";

async function ensureOutputDirectories(): Promise<void> {
  await Promise.all([
    mkdir(OUTPUT_ROOT, { recursive: true }),
    mkdir(MODELS_ROOT, { recursive: true }),
    mkdir(TEXTURES_ROOT, { recursive: true }),
    mkdir(AUDIO_ROOT, { recursive: true }),
  ]);
}

async function main(): Promise<void> {
  await ensureOutputDirectories();
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions([
      EXTMeshoptCompression,
      EXTTextureWebP,
      KHRMeshQuantization,
    ])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const vehicleStats = [];

  for (const spec of VEHICLE_SPECS) {
    const textures = await createPbrAtlases(spec);
    await Promise.all([
      writeFile(
        resolve(TEXTURES_ROOT, `${spec.id}-albedo.webp`),
        textures.albedo,
      ),
      writeFile(
        resolve(TEXTURES_ROOT, `${spec.id}-normal.webp`),
        textures.normal,
      ),
      writeFile(resolve(TEXTURES_ROOT, `${spec.id}-pbr.webp`), textures.pbr),
    ]);

    const built = createVehicleDocument(spec, textures);
    await built.document.transform(
      meshopt({
        encoder: MeshoptEncoder,
        level: "high",
        quantizePosition: 14,
        quantizeNormal: 10,
        quantizeTexcoord: 12,
      }),
    );
    const modelPath = resolve(MODELS_ROOT, `${spec.id}.glb`);
    await io.write(modelPath, built.document);
    const modelStats = await stat(modelPath);
    vehicleStats.push(
      toGeneratedVehicleStats(spec, built, modelStats.size),
    );
    process.stdout.write(
      `${spec.id}: ${(modelStats.size / 1024).toFixed(1)} KiB, ` +
        `LOD0 ${built.lods[0].triangles} tris/${built.lods[0].draws} draws\n`,
    );
  }

  const audioAssets = createAudioAssets();
  await Promise.all(
    audioAssets.map((asset) =>
      writeFile(resolve(AUDIO_ROOT, asset.fileName), asset.bytes),
    ),
  );
  const manifest: VehicleAssetManifest = {
    schemaVersion: 1,
    generator: "vibe-life3-procedural-vehicles",
    coordinateSystem: {
      units: "meters",
      up: "+Y",
      physicalForward: "+Z",
      cameraLook: "-Z rotated toward +Z",
    },
    generatedAt: "deterministic",
    vehicles: vehicleStats,
    audio: createAudioStats(audioAssets),
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(
    `audio: ${(manifest.audio.totalBytes / 1024 / 1024).toFixed(2)} MiB en ` +
      `${manifest.audio.files.length} capas\n`,
  );
  process.stdout.write(`manifest: ${MANIFEST_PATH}\n`);
}

await main();
