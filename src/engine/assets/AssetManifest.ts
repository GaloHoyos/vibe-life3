const zombieUrl = new URL('../../models/characters/zombie/zombie.glb', import.meta.url).href;
const headcrabUrl = new URL('../../models/characters/headcrab/headcrab.glb', import.meta.url).href;
const alyxUrl = new URL('../../models/characters/alyx/alyx.glb', import.meta.url).href;
const gordonUrl = new URL('../../models/characters/gordon/gordon.glb', import.meta.url).href;
const postHumanGordonUrl = new URL('../../models/characters/post-human-gordon/post-human-gordon.glb', import.meta.url).href;
const combineUrl = new URL('../../models/characters/combine-soldier/combine-soldier.glb', import.meta.url).href;
const combineShotgunnerUrl = new URL('../../models/characters/combine-shotgunner/combine-shotgunner.glb', import.meta.url).href;
const combineEliteUrl = new URL('../../models/characters/combine-elite/combine-elite.glb', import.meta.url).href;
const crowbarUrl = new URL('../../models/weapons/crowbar.glb', import.meta.url).href;
const pistolUrl = new URL('../../models/weapons/pistol.glb', import.meta.url).href;
const smgUrl = new URL('../../models/weapons/smg.glb', import.meta.url).href;
const ar3Url = new URL('../../models/weapons/ar3.glb', import.meta.url).href;
const gravityGunUrl = new URL('../../models/weapons/gravitygun.glb', import.meta.url).href;
const portalGunUrl = new URL('../../models/weapons/portalgun.glb', import.meta.url).href;
const shotgunUrl = new URL('../../models/weapons/shotgun.glb', import.meta.url).href;
const grenadeUrl = new URL('../../models/weapons/grenade.glb', import.meta.url).href;
const grenadePrimedUrl = new URL('../../models/weapons/grenade-primed.glb', import.meta.url).href;
const rpgUrl = new URL('../../models/weapons/rpg.glb', import.meta.url).href;
const rpgRocketUrl = new URL('../../models/weapons/rpg-rocket.glb', import.meta.url).href;
const revolverUrl = new URL('../../models/weapons/revolver.glb', import.meta.url).href;
const crossbowUrl = new URL('../../models/weapons/crossbow.glb', import.meta.url).href;
const medkitUrl = new URL('../../models/items/medkit.glb', import.meta.url).href;
const hevBatteryUrl = new URL('../../models/items/hev-battery.glb', import.meta.url).href;
const healthChargerUrl = new URL('../../models/items/health-charger.glb', import.meta.url).href;
const hevChargerUrl = new URL('../../models/items/hev-charger.glb', import.meta.url).href;
const pistolAmmoUrl = new URL('../../models/items/pistol-ammo.glb', import.meta.url).href;
const smgAmmoUrl = new URL('../../models/items/smg-ammo.glb', import.meta.url).href;
const ar3AmmoUrl = new URL('../../models/items/ar3-ammo.glb', import.meta.url).href;
const shotgunAmmoUrl = new URL('../../models/items/shotgun-ammo.glb', import.meta.url).href;
const revolverAmmoUrl = new URL('../../models/items/revolver-ammo.glb', import.meta.url).href;
const crossbowAmmoUrl = new URL('../../models/items/crossbow-ammo.glb', import.meta.url).href;
const ar3AltFireUrl = new URL('../../models/items/ar3-alt-fire.glb', import.meta.url).href;

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
    headcrab: {
      id: 'headcrab',
      path: headcrabUrl,
      type: 'character',
      debug: false,
    },
    alyx: {
      id: 'alyx',
      path: alyxUrl,
      type: 'character',
      debug: false,
    },
    gordon: {
      id: 'gordon',
      path: gordonUrl,
      type: 'character',
      debug: false,
    },
    postHumanGordon: {
      id: 'postHumanGordon',
      path: postHumanGordonUrl,
      type: 'character',
      debug: false,
    },
    combine: {
      id: 'combine',
      path: combineUrl,
      type: 'character',
      debug: false,
    },
    combineShotgunner: {
      id: 'combineShotgunner',
      path: combineShotgunnerUrl,
      type: 'character',
      debug: false,
    },
    combineElite: {
      id: 'combineElite',
      path: combineEliteUrl,
      type: 'character',
      debug: false,
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
    portalGun: {
      id: 'portalGun',
      path: portalGunUrl,
      type: 'weapon',
      debug: false,
    },
    shotgun: {
      id: 'shotgun',
      path: shotgunUrl,
      type: 'weapon',
      debug: false,
    },
    grenade: {
      id: 'grenade',
      path: grenadeUrl,
      type: 'weapon',
      debug: false,
    },
    grenadePrimed: {
      id: 'grenadePrimed',
      path: grenadePrimedUrl,
      type: 'prop',
      debug: false,
    },
    rpg: {
      id: 'rpg',
      path: rpgUrl,
      type: 'weapon',
      debug: false,
    },
    rpgRocket: {
      id: 'rpgRocket',
      path: rpgRocketUrl,
      type: 'prop',
      debug: false,
    },
    revolver: {
      id: 'revolver',
      path: revolverUrl,
      type: 'weapon',
      debug: false,
    },
    crossbow: {
      id: 'crossbow',
      path: crossbowUrl,
      type: 'weapon',
      debug: false,
    },
    medkit: {
      id: 'medkit',
      path: medkitUrl,
      type: 'prop',
      debug: false,
    },
    hevBattery: {
      id: 'hevBattery',
      path: hevBatteryUrl,
      type: 'prop',
      debug: false,
    },
    healthCharger: {
      id: 'healthCharger',
      path: healthChargerUrl,
      type: 'prop',
      debug: false,
    },
    hevCharger: {
      id: 'hevCharger',
      path: hevChargerUrl,
      type: 'prop',
      debug: false,
    },
    pistolAmmo: {
      id: 'pistolAmmo',
      path: pistolAmmoUrl,
      type: 'prop',
      debug: false,
    },
    smgAmmo: {
      id: 'smgAmmo',
      path: smgAmmoUrl,
      type: 'prop',
      debug: false,
    },
    ar3Ammo: {
      id: 'ar3Ammo',
      path: ar3AmmoUrl,
      type: 'prop',
      debug: false,
    },
    shotgunAmmo: {
      id: 'shotgunAmmo',
      path: shotgunAmmoUrl,
      type: 'prop',
      debug: false,
    },
    revolverAmmo: {
      id: 'revolverAmmo',
      path: revolverAmmoUrl,
      type: 'prop',
      debug: false,
    },
    crossbowAmmo: {
      id: 'crossbowAmmo',
      path: crossbowAmmoUrl,
      type: 'prop',
      debug: false,
    },
    ar3AltFire: {
      id: 'ar3AltFire',
      path: ar3AltFireUrl,
      type: 'prop',
      debug: false,
    },
  },
} as const satisfies {
  models: Record<string, ModelAssetConfig>;
};
