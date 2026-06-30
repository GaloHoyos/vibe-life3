import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: "node",
            environment: "node",
            setupFiles: ["./tests/setup/vitest.node.setup.ts"],
            include: ["tests/**/*.test.ts"],
            exclude: [
              "tests/unit/game/ui/**/*.test.ts",
              "tests/integration/game/editor/**/*.test.ts",
            ],
          },
        },
        {
          extends: true,
          test: {
            name: "dom",
            environment: "happy-dom",
            setupFiles: ["./tests/setup/vitest.dom.setup.ts"],
            include: [
              "tests/unit/game/ui/**/*.test.ts",
              "tests/integration/game/editor/**/*.test.ts",
            ],
          },
        },
      ],
      coverage: {
        provider: "v8",
        reporter: ["text", "html", "json-summary"],
        reportsDirectory: "coverage",
        include: ["src/**/*.ts"],
        exclude: [
          "tests/**",
          "src/main.ts",
          "src/vite-env.d.ts",
          "src/**/*.d.ts",
          "src/**/*.css",
          "src/**/ServiceTokens.ts",
          "src/game/GameEvents.ts",
          "src/game/levels/LevelDefinition.ts",
          "src/game/gameplay/weapons/core/WeaponDefinition.ts",
          "src/game/npc/core/INpc.ts",
          "src/game/npc/presets/NpcPreset.ts",
          "src/game/workshop/WorkshopBackend.ts",
          "src/game/workshop/WorkshopTypes.ts",
          "src/engine/characters/CharacterDefinition.ts",
          "src/engine/animation/AnimationInput.ts",
          "src/shared/types/**",
        ],
      },
    },
  }),
);
