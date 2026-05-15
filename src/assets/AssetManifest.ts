const zombieUrl = new URL('../models/characters/zombie/zombie.glb', import.meta.url).href;
const crowbarUrl = new URL('../models/weapons/crowbar.glb', import.meta.url).href;
const pistolUrl = new URL('../models/weapons/pistol.glb', import.meta.url).href;
const smgUrl = new URL('../models/weapons/smg.glb', import.meta.url).href;
const ar3Url = new URL('../models/weapons/ar3.glb', import.meta.url).href;
const gravityGunUrl = new URL('../models/weapons/gravitygun.glb', import.meta.url).href;

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
    crowbar: {
      id: 'crowbar',
      path: crowbarUrl,
      type: 'weapon',
      debug: false,
    },
    pistol: {
      id: 'pistol',
      path: pistolUrl,
      type: 'weapon',
      debug: false,
    },
    smg: {
      id: 'smg',
      path: smgUrl,
      type: 'weapon',
      debug: false,
    },
    ar3: {
      id: 'ar3',
      path: ar3Url,
      type: 'weapon',
      debug: false,
    },
    gravityGun: {
      id: 'gravityGun',
      path: gravityGunUrl,
      type: 'weapon',
      debug: false,
    },
  },
} as const satisfies {
  models: Record<string, ModelAssetConfig>;
};
