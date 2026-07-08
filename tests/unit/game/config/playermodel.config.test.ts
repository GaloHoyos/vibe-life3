import { describe, expect, it } from "vitest";
import { AssetManifest } from "@engine/assets/AssetManifest";
import {
  DefaultPlayerModelId,
  PLAYER_MODEL_IDS,
  PlayerModels,
  resolvePlayerModel,
} from "@game/config/playermodel.config";

describe("playermodel.config", () => {
  it("gordon es el default y todos los ids están en la tabla", () => {
    expect(DefaultPlayerModelId).toBe("gordon");
    expect(PLAYER_MODEL_IDS).toContain("gordon");
    expect(PLAYER_MODEL_IDS).toContain("postHumanGordon");
    for (const id of PLAYER_MODEL_IDS) {
      expect(PlayerModels[id]).toBeDefined();
    }
  });

  it("cada playermodel referencia un modelo real del AssetManifest", () => {
    for (const id of PLAYER_MODEL_IDS) {
      expect(AssetManifest.models[PlayerModels[id].modelId]).toBeDefined();
    }
  });

  it("resolvePlayerModel valida ids externos (Workshop) con fallback al default", () => {
    expect(resolvePlayerModel("gordon")).toBe("gordon");
    expect(resolvePlayerModel("postHumanGordon")).toBe("postHumanGordon");
    expect(resolvePlayerModel(undefined)).toBe("gordon");
    expect(resolvePlayerModel("combine")).toBe("gordon");
    expect(resolvePlayerModel("__proto__")).toBe("gordon");
  });
});
