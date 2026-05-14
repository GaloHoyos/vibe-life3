const zombieUrl = new URL('../models/characters/zombie/zombie.glb', import.meta.url).href;

export type ModelAssetType = 'character' | 'weapon' | 'prop' | 'environment' | 'generated';

export type ModelAssetId = keyof typeof AssetManifest.models;

export interface ModelAssetConfig {
  id: string;
  path: string;
  type: ModelAssetType;
  debug: boolean;
}

export const AssetManifest = {
  models: {
    zombie: {
      id: 'zombie',
      path: zombieUrl,
      type: 'character',
      debug: true,
    },
  },
} as const satisfies {
  models: Record<string, ModelAssetConfig>;
};
