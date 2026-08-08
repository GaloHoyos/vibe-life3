import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOOL_ROOT = fileURLToPath(new URL(".", import.meta.url));

export const PROJECT_ROOT = resolve(TOOL_ROOT, "../..");
export const OUTPUT_ROOT = resolve(PROJECT_ROOT, "src/game/assets/props");
export const MODELS_ROOT = resolve(OUTPUT_ROOT, "models");
export const TEXTURES_ROOT = resolve(OUTPUT_ROOT, "textures");
export const MANIFEST_PATH = resolve(OUTPUT_ROOT, "manifest.json");
export const REPORT_PATH = resolve(OUTPUT_ROOT, "validation-report.json");
