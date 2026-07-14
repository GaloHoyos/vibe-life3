import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exportTileCache, init as initRecast } from "recast-navigation";
import { generateTileCache } from "recast-navigation/generators";
import { buildNavigationGeometry } from "../src/engine/ai/navigation/NavigationGeometry";
import {
  navigationBuildConfig,
  navigationGeometryHash,
} from "../src/engine/ai/navigation/NavigationBuildConfig";
import { NavigationProfiles } from "../src/game/npc/navigation/NavAgentProfiles";
import type { LevelDefinition } from "../src/game/levels/LevelDefinition";
import { generateHeightField } from "../src/shared/math/HeightField";
import { tupleToVector3 } from "../src/shared/math/VectorTuple";

const root = process.cwd();
const requested = new Set(process.argv.slice(2));
const profiles = [
  NavigationProfiles.humanoid,
  NavigationProfiles.humanoidLimited,
  NavigationProfiles.headcrab,
  NavigationProfiles.strider,
];

await initRecast();
const levels = await discoverLevels(resolve(root, "src/game/levels/maps"));
const selected = requested.size > 0 ? levels.filter((level) => requested.has(level.id)) : levels;
if (requested.size > 0 && selected.length !== requested.size) {
  const found = new Set(selected.map((level) => level.id));
  const missing = [...requested].filter((id) => !found.has(id));
  throw new Error(`Mapas no encontrados: ${missing.join(", ")}`);
}
const output = resolve(root, "public/navigation");
await mkdir(output, { recursive: true });

for (const level of selected) {
  const boxes = [...level.staticBoxes, ...(level.buildings ?? []).flatMap((building) => building.boxes)];
  const terrain = level.terrain
    ? {
        field: generateHeightField({
          widthSamples: level.terrain.widthSamples,
          depthSamples: level.terrain.depthSamples,
          size: level.terrain.size,
          source: level.terrain.source,
        }),
        position: tupleToVector3(level.terrain.position),
        size: level.terrain.size,
      }
    : undefined;
  const geometry = buildNavigationGeometry(boxes, terrain);
  const hash = navigationGeometryHash(geometry.positions, geometry.indices, profiles);
  for (const profile of profiles) {
    const generated = generateTileCache(
      geometry.positions,
      geometry.indices,
      navigationBuildConfig(profile),
    );
    if (!generated.success) throw new Error(`${level.id}/${profile.id}: ${generated.error}`);
    const bytes = exportTileCache(generated.navMesh, generated.tileCache);
    const filename = `${level.id}.${hash}.${profile.id}.navbin`;
    await writeFile(resolve(output, filename), bytes);
    generated.tileCache.destroy();
    generated.navMesh.destroy();
    console.info(`[nav:bake] ${filename} (${bytes.byteLength} bytes)`);
  }
}

async function discoverLevels(directory: string): Promise<LevelDefinition[]> {
  const files = await readdir(directory, { recursive: true });
  const levels: LevelDefinition[] = [];
  for (const file of files) {
    if (!file.endsWith(".ts")) continue;
    const module = await import(pathToFileURL(resolve(directory, file)).href) as Record<string, unknown>;
    for (const value of Object.values(module)) {
      if (isLevelDefinition(value) && !levels.some((level) => level.id === value.id)) levels.push(value);
    }
  }
  return levels;
}

function isLevelDefinition(value: unknown): value is LevelDefinition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LevelDefinition>;
  return typeof candidate.id === "string" && Array.isArray(candidate.staticBoxes);
}
