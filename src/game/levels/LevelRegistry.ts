import type { LevelDefinition } from "./LevelDefinition";

/**
 * Auto-discovery de niveles estilo Source: cualquier `*.ts` bajo `maps/` que
 * exporte un `LevelDefinition` se registra solo, sin tocar este archivo ni un
 * union de ids. La clave del registro es el `id` del propio nivel.
 *
 * La carpeta define la categoria: `maps/campaign/` son los niveles oficiales
 * (selector "Nueva Partida"); `maps/custom/` son mapas externos / de comunidad
 * (seccion "Mapas Personalizados"). Para agregar un nivel: dejar el archivo en
 * la carpeta correcta exportando un `LevelDefinition`. Nada mas.
 */
const campaignModules = import.meta.glob<Record<string, unknown>>(
  "./maps/campaign/*.ts",
  { eager: true },
);
const customModules = import.meta.glob<Record<string, unknown>>(
  "./maps/custom/*.ts",
  { eager: true },
);

/** El id de un nivel es libre: lo define cada `LevelDefinition` en `maps/`. */
export type LevelId = string;

export type LevelCategory = "campaign" | "custom";

interface CatalogEntry {
  def: LevelDefinition;
  category: LevelCategory;
}

function isLevelDefinition(value: unknown): value is LevelDefinition {
  if (!value || typeof value !== "object") return false;
  const def = value as Partial<LevelDefinition>;
  return (
    typeof def.id === "string" &&
    typeof def.title === "string" &&
    Array.isArray(def.playerStart) &&
    Array.isArray(def.staticBoxes)
  );
}

function collect(
  catalog: Record<string, CatalogEntry>,
  modules: Record<string, Record<string, unknown>>,
  category: LevelCategory,
): void {
  for (const [path, module] of Object.entries(modules)) {
    for (const exported of Object.values(module)) {
      if (!isLevelDefinition(exported)) continue;
      if (catalog[exported.id]) {
        throw new Error(`LevelRegistry: id duplicado "${exported.id}" en ${path}.`);
      }
      catalog[exported.id] = { def: exported, category };
    }
  }
}

function buildCatalog(): Record<string, CatalogEntry> {
  const catalog: Record<string, CatalogEntry> = {};
  collect(catalog, campaignModules, "campaign");
  collect(catalog, customModules, "custom");
  return catalog;
}

const catalog = buildCatalog();

/** Registro central de niveles, derivado de los archivos en `maps/`. */
export const LevelRegistry: Record<string, LevelDefinition> = Object.fromEntries(
  Object.entries(catalog).map(([id, entry]) => [id, entry.def]),
);

export function getLevel(id: LevelId): LevelDefinition {
  const entry = catalog[id];
  if (!entry) {
    throw new Error(`LevelRegistry: nivel "${id}" no registrado.`);
  }
  return entry.def;
}

/** Todos los niveles registrados (campaña + carpeta custom). Lo usa el editor. */
export function getAllLevels(): LevelDefinition[] {
  return Object.values(catalog).map((entry) => entry.def);
}

function levelsByCategory(category: LevelCategory): LevelDefinition[] {
  return Object.values(catalog)
    .filter((entry) => entry.category === category)
    .map((entry) => entry.def);
}

/** Niveles oficiales de campaña. Lo usa el selector "Nueva Partida". */
export function getCampaignLevels(): LevelDefinition[] {
  return levelsByCategory("campaign");
}

/** Mapas custom servidos desde `maps/custom/` (build-time, .ts). */
export function getCustomFolderLevels(): LevelDefinition[] {
  return levelsByCategory("custom");
}
