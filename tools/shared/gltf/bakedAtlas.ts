import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import type { AtlasSpec, GeneratedTextureSet, MaterialFamily } from "./types.js";

/**
 * Atlas PBR horneados con los nodos procedurales de Blender.
 *
 * El generador de `textures.ts` sigue existiendo y funcionando; éste produce
 * materiales con ESTRUCTURA —veta, árido, trama, corrugado— que es lo que un
 * fBm a mano no puede dar. Blender hace falta sólo para regenerar el aspecto:
 * los atlas resultantes se commitean, así que `npm run build` no lo necesita.
 */

// `fileURLToPath` y no `URL.pathname`: la ruta del proyecto tiene un espacio y
// `pathname` lo devuelve como `%20`, así que Blender abría un archivo que no
// existe y salía sin escribir nada.
const BAKE_SCRIPT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../prop-assets/bake-atlas.py",
);

/** Rutas donde suele estar Blender. `BLENDER` en el entorno las saltea. */
const BLENDER_CANDIDATES = [
  "D:/SteamLibrary/steamapps/common/Blender/blender.exe",
  "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe",
  "C:/Program Files/Blender Foundation/Blender/blender.exe",
  "/usr/bin/blender",
  "/Applications/Blender.app/Contents/MacOS/Blender",
];

export function findBlender(): string | null {
  const fromEnv = process.env["BLENDER"];
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return BLENDER_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null;
}

/** Qué asoma bajo el rayón cuando la familia no lo declara. */
const EXPOSED_BY_FAMILY: Record<MaterialFamily, readonly [number, number, number]> = {
  rawWood: [214, 190, 150],
  paintedWood: [186, 156, 116],
  paintedSteel: [150, 152, 154],
  bareSteel: [186, 188, 190],
  rustedSteel: [138, 92, 62],
  concrete: [178, 174, 166],
  plaster: [226, 224, 218],
  fabric: [188, 180, 162],
  cardboard: [196, 168, 128],
  rubber: [92, 90, 90],
  plastic: [212, 210, 206],
  porcelain: [244, 244, 242],
};

/**
 * Escala del patrón de rayones, en celdas por casilla. Alto = rayones cortos y
 * densos; bajo = trazos largos. Los de antes eran de una sola escala absoluta y
 * cruzaban el 91% del material.
 */
const SCRATCH_SCALE: Record<MaterialFamily, number> = {
  rawWood: 70,
  paintedWood: 80,
  paintedSteel: 95,
  bareSteel: 130,
  rustedSteel: 85,
  concrete: 45,
  plaster: 40,
  fabric: 150,
  cardboard: 60,
  rubber: 120,
  plastic: 110,
  porcelain: 160,
};

/**
 * Cuánta mugre junta cada familia, 0..1. No es una preferencia estética: un
 * azulejo se limpia y un hormigón poroso no, así que la porcelana y el plástico
 * quedan casi limpios y el hormigón, el óxido y el cartón se ensucian de verdad.
 */
const GRIME_BY_FAMILY: Record<MaterialFamily, number> = {
  rawWood: 0.62,
  paintedWood: 0.5,
  paintedSteel: 0.58,
  bareSteel: 0.46,
  // El óxido ya ES del color de la mugre: cargarle más sólo tapa la picadura y
  // lo deja como un marrón parejo.
  rustedSteel: 0.55,
  concrete: 0.92,
  plaster: 0.7,
  fabric: 0.78,
  cardboard: 0.66,
  rubber: 0.4,
  plastic: 0.34,
  porcelain: 0.26,
};

/** Mugre por defecto: hollín cálido, que es lo que deja el uso. */
const DEFAULT_GRIME_COLOR: readonly [number, number, number] = [58, 50, 40];

interface BakeTile {
  readonly index: number;
  readonly family: MaterialFamily;
  readonly seed: number;
  readonly color: readonly [number, number, number];
  readonly roughness: number;
  readonly metallic: number;
  readonly wear: number;
  readonly bump: number;
  readonly scratchScale: number;
  readonly scratchWidth: number;
  readonly exposedColor: readonly [number, number, number];
  readonly grime: number;
  readonly grimeColor: readonly [number, number, number];
}

/**
 * Compone las cuatro casillas en un atlas y devuelve los tres mapas ya
 * codificados, con el mismo contrato que `createPbrAtlases`.
 *
 * El `pbr` es ORM: oclusión en R, rugosidad en G, metalicidad en B. La oclusión
 * queda en 255 a propósito — acá viene por vértice desde `bakeVertexOcclusion`,
 * y multiplicarla dos veces oscurecería los rincones el doble.
 */
export async function bakeAtlasesWithBlender(
  spec: AtlasSpec,
  options: { readonly atlasSize: number },
): Promise<GeneratedTextureSet | null> {
  const blender = findBlender();
  if (!blender) return null;

  const tileSize = options.atlasSize / 2;
  const tiles: BakeTile[] = spec.finishes.map((finish, index) => {
    const family = finish.family ?? "paintedSteel";
    return {
      index,
      family,
      seed: (spec.seed % 1000) + index * 13,
      color: finish.color,
      roughness: finish.roughness,
      metallic: finish.metallic,
      wear: finish.wear,
      // El relieve sigue al grano: una fundición marca más que una chapa.
      bump: 0.25 + finish.grain * 0.12,
      scratchScale: SCRATCH_SCALE[family],
      // Ancho del trazo. Angosto y denso lee como uso; ancho lee como daño.
      scratchWidth: 0.012 + finish.wear * 0.022,
      exposedColor: finish.exposedColor ?? EXPOSED_BY_FAMILY[family],
      // El desgaste modula la mugre pero no la manda: un prop nuevo igual junta
      // algo de polvo, y uno hecho pedazos no se ensucia por encima de su familia.
      grime: GRIME_BY_FAMILY[family] * (0.55 + finish.wear * 0.6),
      grimeColor: spec.grimeColor ?? DEFAULT_GRIME_COLOR,
    };
  });

  const workDir = mkdtempSync(resolve(tmpdir(), "vibe-bake-"));
  try {
    const specPath = resolve(workDir, "spec.json");
    writeFileSync(specPath, JSON.stringify({ tileSize, tiles }), "utf8");
    execFileSync(
      blender,
      ["--background", "--python", BAKE_SCRIPT, "--", specPath, workDir],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60_000 },
    );

    const albedo = await compose(workDir, "albedo", tileSize, options.atlasSize);
    const normal = await compose(workDir, "normal", tileSize, options.atlasSize);
    const orm = await composeOrm(workDir, tiles, tileSize, options.atlasSize);
    return {
      albedo: await encode(albedo, options.atlasSize, 88),
      normal: await encode(normal, options.atlasSize, 92),
      pbr: await encode(orm, options.atlasSize, 90),
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/** Pega las cuatro casillas en la grilla 2×2 del atlas. */
async function compose(
  dir: string,
  suffix: string,
  tileSize: number,
  atlasSize: number,
): Promise<Buffer> {
  const composites = [0, 1, 2, 3].map((index) => ({
    input: readFileSync(resolve(dir, `${index}_${suffix}.png`)),
    left: (index % 2) * tileSize,
    top: index >= 2 ? tileSize : 0,
  }));
  return sharp({
    create: {
      width: atlasSize,
      height: atlasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 255 },
    },
  })
    .composite(composites)
    .raw()
    .toBuffer();
}

async function composeOrm(
  dir: string,
  tiles: readonly BakeTile[],
  tileSize: number,
  atlasSize: number,
): Promise<Buffer> {
  const rough = await compose(dir, "rough", tileSize, atlasSize);
  const out = Buffer.alloc(atlasSize * atlasSize * 4);
  for (let y = 0; y < atlasSize; y += 1) {
    for (let x = 0; x < atlasSize; x += 1) {
      const tile = (y >= tileSize ? 2 : 0) + (x >= tileSize ? 1 : 0);
      const pixel = (y * atlasSize + x) * 4;
      out[pixel] = 255;
      out[pixel + 1] = rough[pixel]!;
      out[pixel + 2] = Math.round(tiles[tile]!.metallic * 255);
      out[pixel + 3] = 255;
    }
  }
  return out;
}

function encode(raw: Buffer, atlasSize: number, quality: number): Promise<Uint8Array> {
  return sharp(raw, { raw: { width: atlasSize, height: atlasSize, channels: 4 } })
    .webp({ quality, effort: 6, smartSubsample: false })
    .toBuffer()
    .then((buffer) => new Uint8Array(buffer));
}
