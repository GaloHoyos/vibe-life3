import type { AudioBusName } from "@engine/audio/core/AudioSystem";
import { inferAudioRole } from "@engine/audio/mix/ClipRoles";
import type { AudioRole } from "@engine/audio/mix/MixProfile";

export interface AudioClipDefinition {
  readonly id: string;
  /** URL resuelta por el bundler. */
  readonly path: string;
  /** Path relativo a `engine/assets/sounds`; llave de la tabla de sonoridad. */
  readonly source: string;
  readonly loop: boolean;
  readonly bus: AudioBusName;
  readonly role: AudioRole;
  /**
   * Ajuste artístico en dB sobre el objetivo del rol. Solo para clips que
   * deben salirse de su rol a propósito; el desnivel entre grabaciones lo
   * corrige la normalización, no esto.
   */
  readonly trimDb?: number;
}

interface ClipSpec {
  id: string;
  source: string;
  bus: AudioBusName;
  loop?: boolean;
  role?: AudioRole;
  trimDb?: number;
}

const soundUrls = import.meta.glob("../assets/sounds/**/*.{wav,mp3}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

function soundUrl(source: string): string {
  const url = soundUrls[`../assets/sounds/${source}`];
  if (!url) {
    throw new Error(`Missing sound asset: ${source}`);
  }
  return url;
}

function clip(spec: ClipSpec): AudioClipDefinition {
  return {
    id: spec.id,
    path: soundUrl(spec.source),
    source: spec.source,
    loop: spec.loop ?? false,
    bus: spec.bus,
    role: spec.role ?? inferAudioRole(spec),
    trimDb: spec.trimDb,
  };
}

function hl2Footsteps(surface: string, count: number): ClipSpec[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return {
      id: `footsteps.hl2.${surface}${n}`,
      source: `hl2/footsteps/${surface}${n}.wav`,
      bus: "footsteps" as const,
    };
  });
}

/** `[sufijo del id, nombre del archivo]` dentro de una misma carpeta y bus. */
type ClipEntry = readonly [suffix: string, file: string];

function hl2Clips(
  idPrefix: string,
  dir: string,
  bus: AudioBusName,
  entries: readonly ClipEntry[],
  shared: Omit<ClipSpec, "id" | "source" | "bus"> = {},
): ClipSpec[] {
  return entries.map(([suffix, file]) => ({
    ...shared,
    id: `${idPrefix}.${suffix}`,
    source: `hl2/${dir}/${file}`,
    bus,
  }));
}

/** Variantes numeradas de un mismo sonido: `name1.wav` … `nameN.wav`. */
function numbered(name: string, count: number, first = 1): ClipEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + first;
    return [`${name}${n}`, `${name}${n}.wav`] as const;
  });
}

/** Igual que `numbered`, para los archivos de VO que numeran con dos dígitos. */
function numberedPadded(name: string, count: number): ClipEntry[] {
  return Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return [`${name}${n}`, `${name}${String(n).padStart(2, "0")}.wav`] as const;
  });
}

const legacyClips: ClipSpec[] = [
  // Los pasos en nieve no tienen equivalente en HL2 (no hay nieve en City 17).
  { id: "footsteps.snow1", source: "footsteps/snow/snow1.mp3", bus: "footsteps" },
  { id: "footsteps.snow2", source: "footsteps/snow/snow2.mp3", bus: "footsteps" },
  { id: "footsteps.snow3", source: "footsteps/snow/snow3.mp3", bus: "footsteps" },
  { id: "footsteps.snow4", source: "footsteps/snow/snow4.mp3", bus: "footsteps" },
];

const weaponClips: ClipSpec[] = [
  ...hl2Clips("weapons.pistol.hl2", "weapons/pistol", "weapons", [
    ["shot1", "pistol_fire2.wav"],
    ["shot2", "pistol_fire3.wav"],
    ["reload", "pistol_reload1.wav"],
    ["empty", "pistol_empty.wav"],
  ]),
  ...hl2Clips("weapons.smg.hl2", "weapons/smg1", "weapons", [
    ["shot", "smg1_fire1.wav"],
    ["shotNpc", "npc_smg1_fire1.wav"],
    ["reload", "smg1_reload.wav"],
    ["altFire", "grenade_launcher1.wav"],
    ["switchBurst", "switch_burst.wav"],
    ["switchSingle", "switch_single.wav"],
  ]),
  ...hl2Clips("weapons.ar3.hl2", "weapons/ar2", "weapons", [
    ["shot", "fire1.wav"],
    ["reload", "ar2_reload.wav"],
    ["reloadPush", "ar2_reload_push.wav"],
    ["reloadRotate", "ar2_reload_rotate.wav"],
    ["altFire", "ar2_altfire.wav"],
    ["altFireNpc", "npc_ar2_altfire.wav"],
    ["altEmpty", "ar2_empty.wav"],
  ]),
  ...hl2Clips("weapons.shotgun.hl2", "weapons/shotgun", "weapons", [
    ["shot1", "shotgun_fire6.wav"],
    ["shot2", "shotgun_fire7.wav"],
    ["shotDouble", "shotgun_dbl_fire.wav"],
    ["cock", "shotgun_cock.wav"],
    ["empty", "shotgun_empty.wav"],
    ["reload1", "shotgun_reload1.wav"],
    ["reload2", "shotgun_reload2.wav"],
    ["reload3", "shotgun_reload3.wav"],
  ]),
  ...hl2Clips("weapons.crowbar.hl2", "weapons/crowbar", "weapons", [
    ["swing", "iceaxe_swing1.wav"],
  ]),
  ...hl2Clips(
    "weapons.crowbar.hl2",
    "weapons/crowbar",
    "weapons",
    [
      ["hit1", "crowbar_impact1.wav"],
      ["hit2", "crowbar_impact2.wav"],
    ],
    { role: "impact" },
  ),
  ...hl2Clips(
    "weapons.explosion.hl2",
    "weapons/explosions",
    "weapons",
    [
      ["blast1", "explode3.wav"],
      ["blast2", "explode4.wav"],
      ["blast3", "explode5.wav"],
      ["underwater", "underwater_explode3.wav"],
    ],
    { role: "explosion" },
  ),
  ...hl2Clips(
    "weapons.explosion.hl2",
    "weapons/explosions",
    "weapons",
    numbered("debris", 3),
    { role: "impact" },
  ),
  { id: "weapons.grenade.hl2.throw", source: "hl2/weapons/explosions/throw.wav", bus: "weapons" },
  {
    id: "weapons.grenade.hl2.tick",
    source: "hl2/weapons/explosions/tick1.wav",
    bus: "weapons",
    role: "hevBeep",
  },
  // Retorno de bala: el impacto que el tirador oye rebotar, no el del blanco.
  ...hl2Clips(
    "weapons.fx.hl2",
    "weapons/fx",
    "weapons",
    [...numbered("ric", 5)],
    { role: "impact" },
  ),
  ...hl2Clips(
    "weapons.fx.hl2",
    "weapons/fx",
    "weapons",
    [
      ["nearmiss1", "bulletltor03.wav"],
      ["nearmiss2", "bulletltor05.wav"],
      ["nearmiss3", "bulletltor09.wav"],
      ["nearmiss4", "bulletltor12.wav"],
      ["shell1", "shotgun_shell1.wav"],
      ["shell2", "shotgun_shell2.wav"],
      ["shell3", "shotgun_shell3.wav"],
    ],
    { role: "impact" },
  ),
  { id: "weapons.revolver.hl2.shot1", source: "hl2/weapons/357/357_fire2.wav", bus: "weapons" },
  { id: "weapons.revolver.hl2.shot2", source: "hl2/weapons/357/357_fire3.wav", bus: "weapons" },
  { id: "weapons.revolver.hl2.reload1", source: "hl2/weapons/357/357_reload1.wav", bus: "weapons" },
  { id: "weapons.revolver.hl2.reload2", source: "hl2/weapons/357/357_reload3.wav", bus: "weapons" },
  { id: "weapons.revolver.hl2.reload3", source: "hl2/weapons/357/357_reload4.wav", bus: "weapons" },
  { id: "weapons.revolver.hl2.spin", source: "hl2/weapons/357/357_spin1.wav", bus: "weapons" },
  { id: "weapons.crossbow.hl2.shot", source: "hl2/weapons/crossbow/fire1.wav", bus: "weapons" },
  { id: "weapons.crossbow.hl2.reload", source: "hl2/weapons/crossbow/reload1.wav", bus: "weapons" },
  { id: "weapons.crossbow.hl2.load1", source: "hl2/weapons/crossbow/bolt_load1.wav", bus: "weapons" },
  { id: "weapons.crossbow.hl2.load2", source: "hl2/weapons/crossbow/bolt_load2.wav", bus: "weapons" },
  { id: "weapons.crossbow.hl2.fly", source: "hl2/weapons/crossbow/bolt_fly4.wav", bus: "weapons" },
  { id: "weapons.crossbow.hl2.hitWorld", source: "hl2/weapons/crossbow/hit1.wav", bus: "weapons" },
  { id: "weapons.crossbow.hl2.hitBody1", source: "hl2/weapons/crossbow/hitbod1.wav", bus: "weapons" },
  { id: "weapons.crossbow.hl2.hitBody2", source: "hl2/weapons/crossbow/hitbod2.wav", bus: "weapons" },
  { id: "weapons.crossbow.hl2.skewer", source: "hl2/weapons/crossbow/bolt_skewer1.wav", bus: "weapons" },
  { id: "weapons.rpg.hl2.fire", source: "hl2/weapons/rpg/rocketfire1.wav", bus: "weapons" },
  { id: "weapons.rpg.hl2.rocketLoop", source: "hl2/weapons/rpg/rocket1.wav", bus: "weapons", loop: true },
  { id: "weapons.rpg.hl2.shotdown", source: "hl2/weapons/rpg/shotdown.wav", bus: "weapons" },
  { id: "weapons.rpg.hl2.explosion", source: "hl2/npcs/combine_gunship/gunship_explode2.wav", bus: "weapons" },
  { id: "weapons.ar3.hl2.altFire", source: "hl2/weapons/ar2/ar2_altfire.wav", bus: "weapons" },
  { id: "weapons.ar3.hl2.altEmpty", source: "hl2/weapons/ar2/ar2_empty.wav", bus: "weapons" },
  { id: "weapons.energyball.hl2.bounce1", source: "hl2/weapons/physcannon/energy_bounce1.wav", bus: "weapons" },
  { id: "weapons.energyball.hl2.bounce2", source: "hl2/weapons/physcannon/energy_bounce2.wav", bus: "weapons" },
  { id: "weapons.energyball.hl2.disintegrate1", source: "hl2/weapons/physcannon/energy_disintegrate4.wav", bus: "weapons" },
  { id: "weapons.energyball.hl2.disintegrate2", source: "hl2/weapons/physcannon/energy_disintegrate5.wav", bus: "weapons" },
  { id: "weapons.energyball.hl2.explosion", source: "hl2/weapons/physcannon/energy_sing_explosion2.wav", bus: "weapons" },
  // El zumbido de la bola acompaña, no protagoniza: se queda debajo del resto
  // del combate a propósito.
  { id: "weapons.energyball.hl2.flyby1", source: "hl2/weapons/physcannon/energy_sing_flyby1.wav", bus: "weapons", trimDb: -6 },
  { id: "weapons.energyball.hl2.flyby2", source: "hl2/weapons/physcannon/energy_sing_flyby2.wav", bus: "weapons", trimDb: -6 },
  { id: "weapons.gravityGun.hl2.charge", source: "hl2/weapons/physcannon/physcannon_charge.wav", bus: "weapons" },
  { id: "weapons.gravityGun.hl2.dryfire", source: "hl2/weapons/physcannon/physcannon_dryfire.wav", bus: "weapons" },
  { id: "weapons.gravityGun.hl2.pickup", source: "hl2/weapons/physcannon/physcannon_pickup.wav", bus: "weapons" },
  { id: "weapons.gravityGun.hl2.drop", source: "hl2/weapons/physcannon/physcannon_drop.wav", bus: "weapons" },
  { id: "weapons.gravityGun.hl2.clawsOpen", source: "hl2/weapons/physcannon/physcannon_claws_open.wav", bus: "weapons" },
  { id: "weapons.gravityGun.hl2.clawsClose", source: "hl2/weapons/physcannon/physcannon_claws_close.wav", bus: "weapons" },
  { id: "weapons.gravityGun.hl2.launch1", source: "hl2/weapons/physcannon/superphys_launch1.wav", bus: "weapons" },
  { id: "weapons.gravityGun.hl2.launch2", source: "hl2/weapons/physcannon/superphys_launch2.wav", bus: "weapons" },
  ...hl2Clips(
    "weapons.gravityGun.hl2",
    "weapons/physcannon",
    "weapons",
    [
      ["holdLoop", "hold_loop.wav"],
      ["superHoldLoop", "superphys_hold_loop.wav"],
    ],
    { loop: true },
  ),
  { id: "weapons.gravityGun.hl2.tooHeavy", source: "hl2/weapons/physcannon/physcannon_tooheavy.wav", bus: "weapons" },
  { id: "weapons.gravityGun.hl2.off", source: "hl2/weapons/physcannon/physgun_off.wav", bus: "weapons" },
  ...hl2Clips(
    "weapons.gravityGun.hl2",
    "weapons/physcannon",
    "weapons",
    [
      ["zap1", "superphys_small_zap1.wav"],
      ["zap2", "superphys_small_zap2.wav"],
      ["zap3", "superphys_small_zap3.wav"],
    ],
    { role: "impact" },
  ),
  { id: "weapons.energyball.hl2.loop", source: "hl2/weapons/physcannon/energy_sing_loop4.wav", bus: "weapons", loop: true },
];

/**
 * Impactos del mundo físico, indexados por material. `hard`/`soft` es la
 * energía del choque, `bullet` es el disparo que lo golpea y `break` su
 * destrucción. Los consumen `PropImpactSystem`, el agarre y el fuego.
 */
const physicsClips: ClipSpec[] = [
  ...hl2Clips("physics.hl2.metal", "physics/metal", "world", [
    ["hard1", "metal_box_impact_hard1.wav"],
    ["hard2", "metal_box_impact_hard2.wav"],
    ["hard3", "metal_box_impact_hard3.wav"],
    ["soft1", "metal_box_impact_soft1.wav"],
    ["soft2", "metal_box_impact_soft2.wav"],
    ["soft3", "metal_box_impact_soft3.wav"],
    ["bullet1", "metal_box_impact_bullet1.wav"],
    ["bullet2", "metal_box_impact_bullet2.wav"],
    ["bullet3", "metal_box_impact_bullet3.wav"],
    ["bulletSolid1", "metal_solid_impact_bullet1.wav"],
    ["bulletSolid2", "metal_solid_impact_bullet2.wav"],
    ["barrelHard1", "metal_barrel_impact_hard1.wav"],
    ["barrelHard2", "metal_barrel_impact_hard2.wav"],
    ["barrelSoft1", "metal_barrel_impact_soft1.wav"],
    ["grateHard1", "metal_grate_impact_hard1.wav"],
    ["grateSoft1", "metal_grate_impact_soft1.wav"],
    ["break1", "metal_box_break1.wav"],
    ["break2", "metal_box_break2.wav"],
    ["debris1", "metal_large_debris1.wav"],
    ["debris2", "metal_large_debris2.wav"],
  ]),
  ...hl2Clips("physics.hl2.weapon", "physics/metal", "world", [
    ["hard1", "weapon_impact_hard1.wav"],
    ["soft1", "weapon_impact_soft1.wav"],
    ["soft2", "weapon_impact_soft2.wav"],
    ["drop1", "weapon_footstep1.wav"],
  ]),
  ...hl2Clips("physics.hl2.concrete", "physics/concrete", "world", [
    ["hard1", "concrete_impact_hard1.wav"],
    ["hard2", "concrete_impact_hard2.wav"],
    ["hard3", "concrete_impact_hard3.wav"],
    ["soft1", "concrete_impact_soft1.wav"],
    ["soft2", "concrete_impact_soft2.wav"],
    ["soft3", "concrete_impact_soft3.wav"],
    ["bullet1", "concrete_impact_bullet1.wav"],
    ["bullet2", "concrete_impact_bullet2.wav"],
    ["bullet3", "concrete_impact_bullet3.wav"],
    ["bullet4", "concrete_impact_bullet4.wav"],
    ["break1", "concrete_break2.wav"],
    ["break2", "concrete_break3.wav"],
    ["rock1", "rock_impact_hard1.wav"],
    ["rock2", "rock_impact_hard3.wav"],
  ]),
  ...hl2Clips("physics.hl2.wood", "physics/wood", "world", [
    ["hard1", "wood_box_impact_hard1.wav"],
    ["hard2", "wood_box_impact_hard2.wav"],
    ["hard3", "wood_box_impact_hard3.wav"],
    ["soft1", "wood_box_impact_soft1.wav"],
    ["soft2", "wood_box_impact_soft2.wav"],
    ["soft3", "wood_box_impact_soft3.wav"],
    ["bullet1", "wood_box_impact_bullet1.wav"],
    ["bullet2", "wood_box_impact_bullet2.wav"],
    ["bullet3", "wood_box_impact_bullet3.wav"],
    ["break1", "wood_crate_break1.wav"],
    ["break2", "wood_crate_break2.wav"],
    ["break3", "wood_plank_break1.wav"],
    ["break4", "wood_plank_break2.wav"],
  ]),
  ...hl2Clips("physics.hl2.glass", "physics/glass", "world", [
    ["hard1", "glass_impact_hard1.wav"],
    ["hard2", "glass_impact_hard2.wav"],
    ["soft1", "glass_impact_soft1.wav"],
    ["soft2", "glass_impact_soft2.wav"],
    ["bullet1", "glass_impact_bullet1.wav"],
    ["bullet2", "glass_impact_bullet2.wav"],
    ["bullet3", "glass_impact_bullet3.wav"],
    ["break1", "glass_sheet_break1.wav"],
    ["break2", "glass_sheet_break2.wav"],
    ["break3", "glass_bottle_break1.wav"],
  ]),
  ...hl2Clips("physics.hl2.flesh", "physics/flesh", "world", [
    ["hard1", "flesh_impact_hard1.wav"],
    ["hard2", "flesh_impact_hard2.wav"],
    ["hard3", "flesh_impact_hard3.wav"],
    ["soft1", "flesh_squishy_impact_hard1.wav"],
    ["soft2", "flesh_squishy_impact_hard2.wav"],
    ["bullet1", "flesh_impact_bullet1.wav"],
    ["bullet2", "flesh_impact_bullet2.wav"],
    ["bullet3", "flesh_impact_bullet3.wav"],
    ["bullet4", "flesh_impact_bullet4.wav"],
    ["bullet5", "flesh_impact_bullet5.wav"],
    ["bulletArmored1", "flesh_strider_impact_bullet1.wav"],
    ["bulletArmored2", "flesh_strider_impact_bullet2.wav"],
    ["break1", "flesh_bloody_break.wav"],
  ]),
  ...hl2Clips("physics.hl2.plastic", "physics/plastic", "world", [
    ["hard1", "plastic_box_impact_hard1.wav"],
    ["hard2", "plastic_box_impact_hard2.wav"],
    ["soft1", "plastic_box_impact_soft1.wav"],
    ["soft2", "plastic_box_impact_soft2.wav"],
    ["bullet1", "plastic_box_impact_bullet1.wav"],
    ["bullet2", "plastic_box_impact_bullet2.wav"],
    ["barrelHard1", "plastic_barrel_impact_hard1.wav"],
    ["barrelSoft1", "plastic_barrel_impact_soft1.wav"],
    ["break1", "plastic_barrel_break1.wav"],
  ]),
  ...hl2Clips("physics.hl2.body", "physics/body", "world", [
    ["hard1", "body_medium_impact_hard1.wav"],
    ["hard2", "body_medium_impact_hard2.wav"],
    ["hard3", "body_medium_impact_hard3.wav"],
    ["soft1", "body_medium_impact_soft1.wav"],
    ["soft2", "body_medium_impact_soft2.wav"],
    ["soft3", "body_medium_impact_soft3.wav"],
    ["break1", "body_medium_break2.wav"],
    ["whooshLarge", "whoosh_large1.wav"],
    ["whooshHuge", "whoosh_huge1.wav"],
  ]),
  ...hl2Clips("physics.hl2.surfaces", "physics/surfaces", "world", [
    ["sandBullet1", "sand_impact_bullet1.wav"],
    ["sandBullet2", "sand_impact_bullet2.wav"],
    ["sandBullet3", "sand_impact_bullet3.wav"],
    ["tileBullet1", "tile_impact_bullet1.wav"],
    ["tileBullet2", "tile_impact_bullet2.wav"],
    ["tileBullet3", "tile_impact_bullet3.wav"],
    ["waterBullet1", "underwater_impact_bullet1.wav"],
    ["waterBullet2", "underwater_impact_bullet2.wav"],
    ["plasterBullet1", "ceiling_tile_impact_bullet1.wav"],
    ["plasterHard1", "drywall_impact_hard1.wav"],
    ["plasterSoft1", "drywall_impact_soft1.wav"],
    ["cardboardHard1", "cardboard_box_impact_hard1.wav"],
    ["cardboardSoft1", "cardboard_box_impact_soft1.wav"],
    ["rubberHard1", "rubber_tire_impact_hard1.wav"],
    ["rubberSoft1", "rubber_tire_impact_soft1.wav"],
  ]),
];

/**
 * Capas de vehículo. Cada motor se arma cruzando lazos: ralentí contra
 * aceleración según revoluciones, y una capa de rodadura/agua según velocidad.
 * Es lo que hace que acelerar suene a esfuerzo y no a un pitch subiendo.
 *
 * El planeador y el nadador combine no salen de acá: no hay equivalente en
 * HL2, así que conservan sus capas sintéticas propias.
 */
const vehicleClips: ClipSpec[] = [
  ...hl2Clips(
    "vehicles.buggy.hl2",
    "vehicles/v8",
    "vehicles",
    [
      ["idle", "v8_idle_loop1.wav"],
      ["rev", "v8_firstgear_rev_loop1.wav"],
      ["cruise", "fourth_cruise_loop2.wav"],
      ["coast", "v8_throttle_off_slow_loop2.wav"],
      ["skid", "skid_normalfriction.wav"],
    ],
    { loop: true },
  ),
  ...hl2Clips("vehicles.buggy.hl2", "vehicles/v8", "vehicles", [
    ["start", "v8_start_loop1.wav"],
    ["stop", "v8_stop1.wav"],
    ["impactMedium1", "vehicle_impact_medium1.wav"],
    ["impactMedium2", "vehicle_impact_medium2.wav"],
    ["impactMedium3", "vehicle_impact_medium3.wav"],
    ["impactMedium4", "vehicle_impact_medium4.wav"],
    ["impactHeavy1", "vehicle_impact_heavy1.wav"],
    ["impactHeavy2", "vehicle_impact_heavy2.wav"],
    ["impactHeavy3", "vehicle_impact_heavy3.wav"],
    ["impactHeavy4", "vehicle_impact_heavy4.wav"],
    ["rollover1", "vehicle_rollover1.wav"],
    ["rollover2", "vehicle_rollover2.wav"],
  ]),
  ...hl2Clips(
    "vehicles.crawler.hl2",
    "vehicles/apc",
    "vehicles",
    [
      ["idle", "apc_idle1.wav"],
      ["rev", "apc_firstgear_loop1.wav"],
      ["cruise", "apc_cruise_loop3.wav"],
      ["coast", "apc_slowdown_fast_loop5.wav"],
      ["diesel", "diesel_loop2.wav"],
    ],
    { loop: true },
  ),
  ...hl2Clips("vehicles.crawler.hl2", "vehicles/apc", "vehicles", [
    ["start", "apc_start_loop3.wav"],
    ["stop", "apc_shutdown.wav"],
    ["turret", "tank_turret_loop1.wav"],
    ["hatch", "atv_ammo_close.wav"],
  ]),
  ...hl2Clips(
    "vehicles.airboat.hl2",
    "vehicles/airboat",
    "vehicles",
    [
      ["motorIdle", "fan_motor_idle_loop1.wav"],
      ["motorFull", "fan_motor_fullthrottle_loop1.wav"],
      ["bladeIdle", "fan_blade_idle_loop1.wav"],
      ["bladeFull", "fan_blade_fullthrottle_loop1.wav"],
      ["waterIdle", "pontoon_stopped_water_loop1.wav"],
      ["waterFast", "pontoon_fast_water_loop1.wav"],
    ],
    { loop: true },
  ),
  ...hl2Clips("vehicles.airboat.hl2", "vehicles/airboat", "vehicles", [
    ["start", "fan_motor_start1.wav"],
    ["stop", "fan_motor_shut_off1.wav"],
    ["splash1", "pontoon_splash1.wav"],
    ["splash2", "pontoon_splash2.wav"],
    ["impact1", "pontoon_impact_hard1.wav"],
    ["impact2", "pontoon_impact_hard2.wav"],
    ["scrape", "pontoon_scrape_rough1.wav"],
  ]),
  ...hl2Clips(
    "vehicles.helicopter.hl2",
    "vehicles/helicopter",
    "vehicles",
    [
      ["rotor", "aheli_rotor_loop1.wav"],
      ["wash", "aheli_wash_loop3.wav"],
      ["cabin", "chopper_rotor2.wav"],
      ["wind", "fast_windloop1.wav"],
      ["alarm", "aheli_damaged_alarm1.wav"],
    ],
    { loop: true },
  ),
  ...hl2Clips("vehicles.helicopter.hl2", "vehicles/helicopter", "vehicles", [
    ["crashAlert", "aheli_crash_alert2.wav"],
    ["chargeUp", "aheli_charge_up.wav"],
    ["gun", "aheli_weapon_fire_loop3.wav"],
  ]),
];

/**
 * Puertas y portones. HL2 los arma como `move` + `stop`: el batiente suena
 * mientras viaja y el marco cierra la frase. `locked` es el intento fallido.
 */
const doorClips: ClipSpec[] = hl2Clips("doors.hl2", "doors", "world", [
  ["metalOpen", "door_metal_medium_open1.wav"],
  ["metalClose", "door_metal_medium_close1.wav"],
  ["metalThinOpen", "door_metal_thin_open1.wav"],
  ["metalThinClose", "door_metal_thin_close2.wav"],
  ["metalThinMove", "door_metal_thin_move1.wav"],
  ["metalLargeOpen", "door_metal_large_open1.wav"],
  ["metalLargeClose", "door_metal_large_close2.wav"],
  ["metalRustyMove", "door_metal_rusty_move1.wav"],
  ["heavyMove", "heavy_metal_move1.wav"],
  ["heavyStop", "heavy_metal_stop1.wav"],
  ["slideMove", "metal_move1.wav"],
  ["slideStop", "metal_stop1.wav"],
  ["woodMove", "wood_move1.wav"],
  ["woodStop", "wood_stop1.wav"],
  ["woodClose", "door_wood_close1.wav"],
  ["chainlinkMove", "door_chainlink_move1.wav"],
  ["chainlinkClose", "door_chainlink_close1.wav"],
  ["gateMove", "door_metal_gate_move1.wav"],
  ["gateStop", "gate_move1.wav"],
  ["garageMove", "garage_move1.wav"],
  ["garageStop", "garage_stop1.wav"],
  ["ventOpen1", "vent_open1.wav"],
  ["ventOpen2", "vent_open2.wav"],
  ["locked", "door_locked2.wav"],
  ["lockedDefault", "default_locked.wav"],
  ["pushbarOpen", "handle_pushbar_open1.wav"],
  ["pushbarLocked", "handle_pushbar_locked1.wav"],
  ["unlatch", "latchunlocked1.wav"],
  ["latch", "door_latch3.wav"],
  ["squeek", "door_squeek1.wav"],
]);

/**
 * El jugador tiene cuerpo: gruñe al recibir daño, tose bajo el agua y se
 * queja al caer. Nada de esto pasa por el traje — es Gordon, no la voz del HEV.
 */
const playerClips: ClipSpec[] = [
  ...hl2Clips("player.hl2", "player", "voice", [
    ["pain1", "pl_pain5.wav"],
    ["pain2", "pl_pain6.wav"],
    ["pain3", "pl_pain7.wav"],
    ["fallPain1", "pl_fallpain1.wav"],
    ["fallPain2", "pl_fallpain3.wav"],
    ["burnPain1", "pl_burnpain1.wav"],
    ["burnPain2", "pl_burnpain2.wav"],
    ["burnPain3", "pl_burnpain3.wav"],
    ["drown1", "pl_drown1.wav"],
    ["drown2", "pl_drown2.wav"],
    ["drown3", "pl_drown3.wav"],
    ["breathe", "breathe1.wav"],
  ]),
  { id: "player.hl2.heartbeat", source: "hl2/player/heartbeat1.wav", bus: "voice" },
  ...hl2Clips("player.hl2", "player", "world", [
    ["shell1", "pl_shell1.wav"],
    ["shell2", "pl_shell2.wav"],
    ["shell3", "pl_shell3.wav"],
    ["fleshBurn", "flesh_burn.wav"],
  ]),
];

/** Peligros del entorno: el fuego que quema, la corriente que fríe. */
const hazardClips: ClipSpec[] = [
  ...hl2Clips(
    "world.hl2",
    "ambient/world",
    "world",
    [
      ["fireSmall", "fire_small_loop1.wav"],
      ["fireMedium", "fire_med_loop1.wav"],
      ["electric", "electric_loop.wav"],
      ["forceField", "force_field_loop1.wav"],
      ["waterFlow", "water_flow_loop1.wav"],
      ["underwater", "underwater.wav"],
    ],
    { loop: true },
  ),
  ...hl2Clips("world.hl2", "ambient/world", "world", [
    ["ignite", "ignite.wav"],
    ["zap1", "zap1.wav"],
    ["zap2", "zap2.wav"],
    ["zap3", "zap3.wav"],
    ["spark1", "spark1.wav"],
    ["spark2", "spark2.wav"],
    ["splash1", "water_splash1.wav"],
    ["splash2", "water_splash2.wav"],
    ["splash3", "water_splash3.wav"],
    ["metalStress", "metal_stress1.wav"],
    ["woodCreak", "wood_creak1.wav"],
    ["rustyPipes", "rustypipes1.wav"],
  ]),
];

const enemyClips: ClipSpec[] = [
  { id: "enemies.headcrab.hl2.alert", source: "hl2/npcs/headcrab/alert1.wav", bus: "enemies" },
  { id: "enemies.headcrab.hl2.attack1", source: "hl2/npcs/headcrab/attack1.wav", bus: "enemies" },
  { id: "enemies.headcrab.hl2.attack2", source: "hl2/npcs/headcrab/attack2.wav", bus: "enemies" },
  { id: "enemies.headcrab.hl2.attack3", source: "hl2/npcs/headcrab/attack3.wav", bus: "enemies" },
  { id: "enemies.headcrab.hl2.bite", source: "hl2/npcs/headcrab/headbite.wav", bus: "enemies" },
  { id: "enemies.headcrab.hl2.pain1", source: "hl2/npcs/headcrab/pain1.wav", bus: "enemies" },
  { id: "enemies.headcrab.hl2.pain2", source: "hl2/npcs/headcrab/pain2.wav", bus: "enemies" },
  { id: "enemies.headcrab.hl2.pain3", source: "hl2/npcs/headcrab/pain3.wav", bus: "enemies" },
  { id: "enemies.headcrab.hl2.die1", source: "hl2/npcs/headcrab/die1.wav", bus: "enemies" },
  { id: "enemies.headcrab.hl2.die2", source: "hl2/npcs/headcrab/die2.wav", bus: "enemies" },
  { id: "enemies.manhack.hl2.alert", source: "hl2/npcs/manhack/mh_blade_snick1.wav", bus: "enemies" },
  { id: "enemies.manhack.hl2.attack", source: "hl2/npcs/manhack/grind_flesh1.wav", bus: "enemies" },
  { id: "enemies.manhack.hl2.attack2", source: "hl2/npcs/manhack/grind_flesh2.wav", bus: "enemies" },
  { id: "enemies.manhack.hl2.attack3", source: "hl2/npcs/manhack/grind_flesh3.wav", bus: "enemies" },
  { id: "enemies.manhack.hl2.engine", source: "hl2/npcs/manhack/mh_engine_loop1.wav", bus: "enemies", loop: true },
  { id: "enemies.manhack.hl2.damage1", source: "hl2/npcs/manhack/bat_away.wav", bus: "enemies" },
  { id: "enemies.manhack.hl2.die", source: "hl2/npcs/manhack/gib.wav", bus: "enemies" },
  { id: "enemies.turret.hl2.deploy", source: "hl2/npcs/turret_floor/deploy.wav", bus: "enemies" },
  { id: "enemies.turret.hl2.active", source: "hl2/npcs/turret_floor/active.wav", bus: "enemies" },
  { id: "enemies.turret.hl2.alert", source: "hl2/npcs/turret_floor/alert.wav", bus: "enemies" },
  { id: "enemies.turret.hl2.attack1", source: "hl2/npcs/turret_floor/shoot1.wav", bus: "weapons" },
  { id: "enemies.turret.hl2.attack2", source: "hl2/npcs/turret_floor/shoot2.wav", bus: "weapons" },
  { id: "enemies.turret.hl2.attack3", source: "hl2/npcs/turret_floor/shoot3.wav", bus: "weapons" },
  { id: "enemies.turret.hl2.die", source: "hl2/npcs/turret_floor/die.wav", bus: "enemies" },
  { id: "enemies.turret.hl2.retract", source: "hl2/npcs/turret_floor/retract.wav", bus: "enemies" },
  { id: "enemies.combine.hl2.alert1", source: "hl2/npcs/combine_soldier/vo/alert1.wav", bus: "enemies" },
  { id: "enemies.combine.hl2.alert2", source: "hl2/npcs/combine_soldier/vo/contact.wav", bus: "enemies" },
  { id: "enemies.combine.hl2.attack1", source: "hl2/npcs/combine_soldier/vo/engaging.wav", bus: "enemies" },
  { id: "enemies.combine.hl2.attack2", source: "hl2/npcs/combine_soldier/vo/coverme.wav", bus: "enemies" },
  { id: "enemies.combine.hl2.pain1", source: "hl2/npcs/combine_soldier/pain1.wav", bus: "enemies" },
  { id: "enemies.combine.hl2.pain2", source: "hl2/npcs/combine_soldier/pain2.wav", bus: "enemies" },
  { id: "enemies.combine.hl2.pain3", source: "hl2/npcs/combine_soldier/pain3.wav", bus: "enemies" },
  { id: "enemies.combine.hl2.die1", source: "hl2/npcs/combine_soldier/die1.wav", bus: "enemies" },
  { id: "enemies.combine.hl2.die2", source: "hl2/npcs/combine_soldier/die2.wav", bus: "enemies" },
  { id: "enemies.combine.hl2.die3", source: "hl2/npcs/combine_soldier/die3.wav", bus: "enemies" },
  ...hl2Clips("enemies.zombie.hl2", "npcs/zombie", "enemies", [
    ["die1", "zombie_die1.wav"],
    ["die2", "zombie_die2.wav"],
    ["die3", "zombie_die3.wav"],
    ["alert1", "zombie_alert1.wav"],
    ["alert2", "zombie_alert2.wav"],
    ["alert3", "zombie_alert3.wav"],
    ["attack1", "zo_attack1.wav"],
    ["attack2", "zo_attack2.wav"],
    ["clawStrike1", "claw_strike1.wav"],
    ["clawStrike2", "claw_strike2.wav"],
    ["clawStrike3", "claw_strike3.wav"],
    ["clawMiss1", "claw_miss1.wav"],
    ["clawMiss2", "claw_miss2.wav"],
    ["pain1", "zombie_pain1.wav"],
    ["pain2", "zombie_pain2.wav"],
    ["pain3", "zombie_pain3.wav"],
    ["pain4", "zombie_pain4.wav"],
    ["pain5", "zombie_pain5.wav"],
    ["pain6", "zombie_pain6.wav"],
    ["idle1", "zombie_voice_idle1.wav"],
    ["idle2", "zombie_voice_idle2.wav"],
    ["idle3", "zombie_voice_idle3.wav"],
    ["idle4", "zombie_voice_idle4.wav"],
    ["hit", "zombie_hit.wav"],
    ["poundDoor", "zombie_pound_door.wav"],
    ["step1", "foot1.wav"],
    ["step2", "foot2.wav"],
    ["step3", "foot3.wav"],
  ]),
  // El gemido es un lecho continuo, no un motor: si se infiere por `loop`
  // termina en `engineLoop` y pierde la reverb de una voz.
  ...hl2Clips(
    "enemies.zombie.hl2",
    "npcs/zombie",
    "enemies",
    [
      ["moanLoop1", "moan_loop1.wav"],
      ["moanLoop2", "moan_loop2.wav"],
    ],
    { loop: true, role: "vocalization" },
  ),
  ...hl2Clips("enemies.combine.hl2", "npcs/combine_soldier", "enemies", [
    ...numbered("gear", 6),
  ]),
  { id: "enemies.gunship.hl2.alert", source: "hl2/npcs/combine_gunship/see_enemy.wav", bus: "enemies" },
  { id: "enemies.gunship.hl2.pain", source: "hl2/npcs/combine_gunship/gunship_pain.wav", bus: "enemies" },
  { id: "enemies.gunship.hl2.die", source: "hl2/npcs/combine_gunship/gunship_explode2.wav", bus: "enemies", role: "explosion" },
  { id: "enemies.gunship.hl2.fire", source: "hl2/npcs/combine_gunship/gunship_weapon_fire_loop6.wav", bus: "enemies" },
  { id: "enemies.gunship.hl2.engine", source: "hl2/npcs/combine_gunship/gunship_engine_loop3.wav", bus: "enemies", loop: true },
  { id: "enemies.strider.hl2.alert1", source: "hl2/npcs/strider/striderx_alert2.wav", bus: "enemies" },
  { id: "enemies.strider.hl2.alert2", source: "hl2/npcs/strider/striderx_alert4.wav", bus: "enemies" },
  { id: "enemies.strider.hl2.pain", source: "hl2/npcs/strider/striderx_pain2.wav", bus: "enemies" },
  { id: "enemies.strider.hl2.die", source: "hl2/npcs/strider/striderx_die1.wav", bus: "enemies" },
  { id: "enemies.strider.hl2.minigun", source: "hl2/npcs/strider/strider_minigun.wav", bus: "weapons" },
  { id: "enemies.strider.hl2.cannon", source: "hl2/npcs/strider/fire.wav", bus: "weapons" },
  { id: "enemies.strider.hl2.cannonCharge", source: "hl2/npcs/strider/charging.wav", bus: "enemies" },
  // El strider pesa 20 toneladas: sus pasos son un golpe del mundo, no un paso.
  { id: "enemies.strider.hl2.step1", source: "hl2/npcs/strider/strider_step1.wav", bus: "enemies", role: "impact" },
  { id: "enemies.strider.hl2.step2", source: "hl2/npcs/strider/strider_step2.wav", bus: "enemies", role: "impact" },
  { id: "enemies.strider.hl2.step3", source: "hl2/npcs/strider/strider_step3.wav", bus: "enemies", role: "impact" },
  { id: "enemies.strider.hl2.step4", source: "hl2/npcs/strider/strider_step4.wav", bus: "enemies", role: "impact" },
  { id: "enemies.strider.hl2.step5", source: "hl2/npcs/strider/strider_step5.wav", bus: "enemies", role: "impact" },
  { id: "enemies.strider.hl2.step6", source: "hl2/npcs/strider/strider_step6.wav", bus: "enemies", role: "impact" },
];

/**
 * Voces de la resistencia. Son las mismas grabaciones que HL2 usa para los
 * ciudadanos: dolor, aviso y confirmación de escuadra. `rebelMale` y
 * `rebelFemale` comparten el guion; sólo cambia quién lo dice.
 */
const REBEL_LINES: readonly ClipEntry[] = [
  ...numberedPadded("pain", 9),
  ...numberedPadded("moan", 3),
  ["ow1", "ow01.wav"],
  ["ow2", "ow02.wav"],
  ["hurtArm", "myarm01.wav"],
  ["hurtLeg", "myleg01.wav"],
  ["hurtGut", "hitingut01.wav"],
  ["hurt1", "imhurt01.wav"],
  ["hurt2", "imhurt02.wav"],
  ["help", "help01.wav"],
  ["contact", "heretheycome01.wav"],
  ["incoming", "incoming02.wav"],
  ["headsUp1", "headsup01.wav"],
  ["headsUp2", "headsup02.wav"],
  ["watchOut", "watchout.wav"],
  ["behindYou", "behindyou01.wav"],
  ["combine1", "combine01.wav"],
  ["combine2", "combine02.wav"],
  ["zombies", "zombies01.wav"],
  ["headcrabs", "headcrabs01.wav"],
  ["takeCover", "takecover02.wav"],
  ["getDown", "getdown02.wav"],
  ["reloading", "gottareload01.wav"],
  ["coverReload", "coverwhilereload01.wav"],
  ["gotOne1", "gotone01.wav"],
  ["gotOne2", "gotone02.wav"],
  ["affirm1", "squad_affirm01.wav"],
  ["affirm2", "squad_affirm03.wav"],
  ["affirm3", "squad_affirm05.wav"],
  ["follow1", "squad_follow01.wav"],
  ["follow2", "squad_follow03.wav"],
  ["away1", "squad_away01.wav"],
  ["away2", "squad_away02.wav"],
  ["startle", "startle01.wav"],
  ["uhoh", "uhoh.wav"],
  ["ohno", "ohno.wav"],
];

const allyClips: ClipSpec[] = [
  ...hl2Clips("enemies.rebelMale.hl2", "vo/rebel_male", "enemies", REBEL_LINES),
  ...hl2Clips("enemies.rebelFemale.hl2", "vo/rebel_female", "enemies", REBEL_LINES),
  ...hl2Clips("enemies.alyx.hl2", "vo/alyx", "enemies", [
    ["pain1", "hurt04.wav"],
    ["pain2", "hurt05.wav"],
    ["pain3", "hurt06.wav"],
    ["pain4", "hurt08.wav"],
    ["grunt1", "uggh01.wav"],
    ["grunt2", "uggh02.wav"],
    ["gasp1", "gasp02.wav"],
    ["gasp2", "gasp03.wav"],
    ["coverMe1", "coverme01.wav"],
    ["coverMe2", "coverme02.wav"],
    ["coverMe3", "coverme03.wav"],
    ["lookOut1", "lookout01.wav"],
    ["lookOut2", "lookout03.wav"],
    ["watchOut1", "watchout01.wav"],
    ["watchOut2", "watchout02.wav"],
    ["getBack1", "getback01.wav"],
    ["getBack2", "getback02.wav"],
    ["no", "no01.wav"],
    ["ohGod", "ohgod01.wav"],
    ["startle", "ohno_startle01.wav"],
    ["brutal", "brutal02.wav"],
    ["youReload", "youreload01.wav"],
  ]),
];

const footstepClips: ClipSpec[] = [
  ...hl2Footsteps("chainlink", 4),
  ...hl2Footsteps("concrete", 4),
  ...hl2Footsteps("dirt", 4),
  ...hl2Footsteps("duct", 4),
  ...hl2Footsteps("grass", 4),
  ...hl2Footsteps("gravel", 4),
  ...hl2Footsteps("ladder", 4),
  ...hl2Footsteps("metal", 4),
  ...hl2Footsteps("metalgrate", 4),
  ...hl2Footsteps("mud", 4),
  ...hl2Footsteps("sand", 4),
  ...hl2Footsteps("slosh", 4),
  ...hl2Footsteps("tile", 4),
  ...hl2Footsteps("wade", 8),
  ...hl2Footsteps("wood", 4),
  ...hl2Footsteps("woodpanel", 4),
];

const backgroundClips: ClipSpec[] = [
  // Lecho genérico de exteriores: lo referencian casi todos los niveles.
  { id: "background.wind", source: "hl2/ambient/wind/wind1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.wind.wasteland", source: "hl2/ambient/wind/wasteland_wind.wav", bus: "ambience", loop: true },
  { id: "background.hl2.wind.med1", source: "hl2/ambient/wind/wind_med1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.wind.med2", source: "hl2/ambient/wind/wind_med2.wav", bus: "ambience", loop: true },
  { id: "background.hl2.wind.rooftop", source: "hl2/ambient/wind/wind_rooftop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.wind.tunnel", source: "hl2/ambient/wind/wind_tunnel1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.labs.equipmentBeep", source: "hl2/ambient/levels/labs/equipment_beep_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.labs.machineMoving", source: "hl2/ambient/levels/labs/machine_moving_loop3.wav", bus: "ambience", loop: true },
  { id: "background.hl2.labs.machineRing", source: "hl2/ambient/levels/labs/machine_ring_resonance_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.labs.teleportActive", source: "hl2/ambient/levels/labs/teleport_active_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.canals.tunnelWind", source: "hl2/ambient/levels/canals/tunnel_wind_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.canals.waterRivulet", source: "hl2/ambient/levels/canals/water_rivulet_loop2.wav", bus: "ambience", loop: true },
  { id: "background.hl2.canals.waterLeak", source: "hl2/ambient/levels/canals/waterleak_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.canals.generator", source: "hl2/ambient/levels/canals/generator_ambience_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.canals.manhackMachine", source: "hl2/ambient/levels/canals/manhack_machine_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.streetwar.battle1", source: "hl2/ambient/levels/streetwar/city_battle1.wav", bus: "ambience" },
  { id: "background.hl2.streetwar.battle5", source: "hl2/ambient/levels/streetwar/city_battle5.wav", bus: "ambience" },
  { id: "background.hl2.streetwar.riot", source: "hl2/ambient/levels/streetwar/city_riot1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.streetwar.gunshipDistant", source: "hl2/ambient/levels/streetwar/gunship_distant1.wav", bus: "ambience" },
  { id: "background.hl2.streetwar.striderDistantWalk", source: "hl2/ambient/levels/streetwar/strider_distant_walk1.wav", bus: "ambience" },
  { id: "background.hl2.atmosphere.cityRumble", source: "hl2/ambient/atmosphere/city_rumble_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.atmosphere.plaza", source: "hl2/ambient/atmosphere/plaza_amb.wav", bus: "ambience", loop: true },
  { id: "background.hl2.atmosphere.undergroundHall", source: "hl2/ambient/atmosphere/underground_hall_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.atmosphere.undercity", source: "hl2/ambient/atmosphere/undercity_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.atmosphere.trainstation", source: "hl2/ambient/atmosphere/trainstation_ambient_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.machines.combineTerminal", source: "hl2/ambient/machines/combine_terminal_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.machines.labLoop", source: "hl2/ambient/machines/lab_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.machines.wallAmbient", source: "hl2/ambient/machines/wall_ambient_loop1.wav", bus: "ambience", loop: true },
  { id: "background.hl2.machines.trainRumble", source: "hl2/ambient/machines/train_rumble.wav", bus: "ambience", loop: true },
];

const uiClips: ClipSpec[] = [
  { id: "ui.hl2.buttonRollover", source: "hl2/ui/buttonrollover.wav", bus: "ui" },
  { id: "ui.hl2.buttonClick", source: "hl2/ui/buttonclick.wav", bus: "ui" },
  { id: "ui.hl2.buttonClickRelease", source: "hl2/ui/buttonclickrelease.wav", bus: "ui" },
  // Selector de armas: los mismos cuatro sonidos del HUD de HL2.
  ...hl2Clips("ui.hl2", "common", "ui", [
    ["weaponSelect", "wpn_select.wav"],
    ["weaponMove", "wpn_moveselect.wav"],
    ["weaponDeny", "wpn_denyselect.wav"],
    ["weaponHudOff", "wpn_hudoff.wav"],
  ]),
  ...hl2Clips("ui.hl2", "items", "ui", [
    ["pickupAmmo", "ammo_pickup.wav"],
    ["pickupArmor", "battery_pickup.wav"],
    ["pickupHealth", "smallmedkit1.wav"],
    ["medshot", "medshot4.wav"],
    ["medshotDeny", "medshotno1.wav"],
    ["flashlight", "flashlight1.wav"],
    ["crateOpen", "ammocrate_open.wav"],
    ["crateClose", "ammocrate_close.wav"],
  ]),
];

/**
 * Banda sonora original de Half-Life 2 y Half-Life. Los niveles eligen su track
 * por id en `LevelDefinition.audio.music`; los `stinger` son remates cortos
 * para momentos puntuales, no lechos.
 */
const musicClips: ClipSpec[] = [
  ...hl2Clips(
    "music.hl2",
    "music",
    "music",
    [
      ["intro", "hl2_intro.mp3"],
      ["ambient", "hl2_ambient_1.wav"],
      ["trainstation1", "hl2_song26_trainstation1.mp3"],
      ["trainstation2", "hl2_song27_trainstation2.mp3"],
      ["suit", "hl2_song23_suitsong3.mp3"],
      ["teleporter", "hl2_song25_teleporter.mp3"],
      ["ravenholm", "ravenholm_1.mp3"],
      ["radio", "radio1.mp3"],
      ["song0", "hl2_song0.mp3"],
      ["song1", "hl2_song1.mp3"],
      ["song2", "hl2_song2.mp3"],
      ["song3", "hl2_song3.mp3"],
      ["song4", "hl2_song4.mp3"],
      ["song6", "hl2_song6.mp3"],
      ["song7", "hl2_song7.mp3"],
      ["song8", "hl2_song8.mp3"],
      ["song10", "hl2_song10.mp3"],
      ["song11", "hl2_song11.mp3"],
      ["song12", "hl2_song12_long.mp3"],
      ["song13", "hl2_song13.mp3"],
      ["song14", "hl2_song14.mp3"],
      ["song15", "hl2_song15.mp3"],
      ["song16", "hl2_song16.mp3"],
      ["song17", "hl2_song17.mp3"],
      ["song19", "hl2_song19.mp3"],
      ["song20a", "hl2_song20_submix0.mp3"],
      ["song20b", "hl2_song20_submix4.mp3"],
      ["song26", "hl2_song26.mp3"],
      ["song28", "hl2_song28.mp3"],
      ["song29", "hl2_song29.mp3"],
      ["song30", "hl2_song30.mp3"],
      ["song31", "hl2_song31.mp3"],
      ["song32", "hl2_song32.mp3"],
      ["song33", "hl2_song33.mp3"],
    ],
    { loop: true },
  ),
  ...hl2Clips(
    "music.hl1",
    "music",
    "music",
    [
      ["song3", "hl1_song3.mp3"],
      ["song5", "hl1_song5.mp3"],
      ["song6", "hl1_song6.mp3"],
      ["song9", "hl1_song9.mp3"],
      ["song10", "hl1_song10.mp3"],
      ["song11", "hl1_song11.mp3"],
      ["song14", "hl1_song14.mp3"],
      ["song15", "hl1_song15.mp3"],
      ["song17", "hl1_song17.mp3"],
      ["song19", "hl1_song19.mp3"],
      ["song20", "hl1_song20.mp3"],
      ["song21", "hl1_song21.mp3"],
      ["song24", "hl1_song24.mp3"],
      ["song25", "hl1_song25_remix3.mp3"],
      ["song26", "hl1_song26.mp3"],
    ],
    { loop: true },
  ),
  ...hl2Clips("music.stinger", "music/stingers", "music", [
    ["hl1a", "hl1_stinger_song7.mp3"],
    ["hl1b", "hl1_stinger_song8.mp3"],
    ["hl1c", "hl1_stinger_song16.mp3"],
    ["hl1d", "hl1_stinger_song27.mp3"],
    ["hl1e", "hl1_stinger_song28.mp3"],
    ["suspense1", "industrial_suspense1.wav"],
    ["suspense2", "industrial_suspense2.wav"],
  ]),
];

const hevClips: ClipSpec[] = [
  { id: "hev.items.suitCharge", source: "hl2/items/suitcharge1.wav", bus: "ui", loop: true },
  { id: "hev.items.suitChargeNo", source: "hl2/items/suitchargeno1.wav", bus: "ui" },
  { id: "hev.items.suitChargeOk", source: "hl2/items/suitchargeok1.wav", bus: "ui" },
  { id: "hev.items.medCharge", source: "hl2/items/medcharge4.wav", bus: "ui", loop: true },
  { id: "hev.player.denyDevice", source: "hl2/player/suit_denydevice.wav", bus: "ui" },
  { id: "hev.player.sprint", source: "hl2/player/suit_sprint.wav", bus: "ui" },
  { id: "hev.fvox.flatline", source: "hl2/hl1/fvox/flatline.wav", bus: "voice" },
  { id: "hev.fvox.criticalFail", source: "hl2/hl1/fvox/hev_critical_fail.wav", bus: "voice" },
  { id: "hev.fvox.generalFail", source: "hl2/hl1/fvox/hev_general_fail.wav", bus: "voice" },
  { id: "hev.fvox.shutdown", source: "hl2/hl1/fvox/hev_shutdown.wav", bus: "voice" },
  { id: "hev.fvox.healthCritical", source: "hl2/hl1/fvox/health_critical.wav", bus: "voice" },
  { id: "hev.fvox.nearDeath", source: "hl2/hl1/fvox/near_death.wav", bus: "voice" },
  { id: "hev.fvox.damage", source: "hl2/hl1/fvox/hev_damage.wav", bus: "voice" },
  { id: "hev.fvox.bloodLoss", source: "hl2/hl1/fvox/blood_loss.wav", bus: "voice" },
  { id: "hev.fvox.minorFracture", source: "hl2/hl1/fvox/minor_fracture.wav", bus: "voice" },
  { id: "hev.fvox.majorFracture", source: "hl2/hl1/fvox/major_fracture.wav", bus: "voice" },
  { id: "hev.fvox.minorLacerations", source: "hl2/hl1/fvox/minor_lacerations.wav", bus: "voice" },
  { id: "hev.fvox.majorLacerations", source: "hl2/hl1/fvox/major_lacerations.wav", bus: "voice" },
  { id: "hev.fvox.armorGone", source: "hl2/hl1/fvox/armor_gone.wav", bus: "voice" },
  { id: "hev.fvox.powerBelow", source: "hl2/hl1/fvox/power_below.wav", bus: "voice" },
  { id: "hev.fvox.powerRestored", source: "hl2/hl1/fvox/power_restored.wav", bus: "voice" },
  { id: "hev.fvox.heatDamage", source: "hl2/hl1/fvox/heat_damage.wav", bus: "voice" },
  { id: "hev.fvox.shockDamage", source: "hl2/hl1/fvox/shock_damage.wav", bus: "voice" },
  { id: "hev.fvox.biohazard", source: "hl2/hl1/fvox/biohazard_detected.wav", bus: "voice" },
  { id: "hev.fvox.chemical", source: "hl2/hl1/fvox/chemical_detected.wav", bus: "voice" },
  { id: "hev.fvox.radiation", source: "hl2/hl1/fvox/radiation_detected.wav", bus: "voice" },
  { id: "hev.fvox.warning", source: "hl2/hl1/fvox/warning.wav", bus: "voice" },
  { id: "hev.fvox.medicalRepaired", source: "hl2/hl1/fvox/medical_repaired.wav", bus: "voice" },
  { id: "hev.fvox.morphine", source: "hl2/hl1/fvox/morphine_shot.wav", bus: "voice" },
];

export const AudioClipCatalog: Readonly<Record<string, AudioClipDefinition>> =
  Object.fromEntries(
    [
      ...legacyClips,
      ...weaponClips,
      ...vehicleClips,
      ...physicsClips,
      ...doorClips,
      ...playerClips,
      ...hazardClips,
      ...enemyClips,
      ...allyClips,
      ...footstepClips,
      ...backgroundClips,
      ...uiClips,
      ...musicClips,
      ...hevClips,
    ].map((spec) => [spec.id, clip(spec)]),
  );
