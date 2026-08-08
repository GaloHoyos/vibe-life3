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

import { bakeAtlasesWithBlender, findBlender } from "../shared/gltf/bakedAtlas.js";
import { createPbrAtlases } from "../shared/gltf/textures.js";
import { createPropPackDocument } from "./document.js";
import { MANIFEST_PATH, MODELS_ROOT, OUTPUT_ROOT, TEXTURES_ROOT } from "./paths.js";
import {
  PROP_PACK_SPECS,
  type GeneratedPackStats,
  type PropAssetManifest,
} from "./types.js";

async function ensureOutputDirectories(): Promise<void> {
  await Promise.all([
    mkdir(OUTPUT_ROOT, { recursive: true }),
    mkdir(MODELS_ROOT, { recursive: true }),
    mkdir(TEXTURES_ROOT, { recursive: true }),
  ]);
}

async function main(): Promise<void> {
  await ensureOutputDirectories();
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions([EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization])
    .registerDependencies({ "meshopt.encoder": MeshoptEncoder });
  const packStats: GeneratedPackStats[] = [];

  const blender = findBlender();
  if (!blender) {
    console.warn(
      "[props] Blender no encontrado: los atlas salen del generador procedural de TS.\n" +
        "        Para el acabado bueno, instalá Blender o apuntá BLENDER al ejecutable.",
    );
  }

  for (const spec of PROP_PACK_SPECS) {
    const baked = await bakeAtlasesWithBlender(spec, { atlasSize: spec.atlasSize });
    const textures = baked ?? (await createPbrAtlases(spec, { atlasSize: spec.atlasSize }));
    await Promise.all([
      writeFile(resolve(TEXTURES_ROOT, `${spec.id}-albedo.webp`), textures.albedo),
      writeFile(resolve(TEXTURES_ROOT, `${spec.id}-normal.webp`), textures.normal),
      writeFile(resolve(TEXTURES_ROOT, `${spec.id}-pbr.webp`), textures.pbr),
    ]);

    const built = createPropPackDocument(spec, textures);
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
    packStats.push({
      id: spec.id,
      glbBytes: modelStats.size,
      props: built.props,
      nodeNames: built.nodeNames,
    });
    const triangles = built.props.reduce((sum, prop) => sum + prop.lods[0].triangles, 0);
    process.stdout.write(
      `${spec.id}: ${(modelStats.size / 1024).toFixed(1)} KiB, ` +
        `${built.props.length} props, ${triangles} tris LOD0\n`,
    );
  }

  const manifest: PropAssetManifest = {
    schemaVersion: 1,
    generator: "vibe-life3-procedural-props",
    coordinateSystem: { units: "meters", up: "+Y", origin: "aabb-center" },
    generatedAt: "deterministic",
    packs: packStats,
  };
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  process.stdout.write(`manifest: ${MANIFEST_PATH}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
