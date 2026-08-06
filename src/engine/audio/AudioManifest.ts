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

const legacyClips: ClipSpec[] = [
  { id: "background.wind", source: "background/wind.mp3", bus: "ambience", loop: true },
  { id: "footsteps.concrete1", source: "footsteps/concrete/concrete1.mp3", bus: "footsteps" },
  { id: "footsteps.snow1", source: "footsteps/snow/snow1.mp3", bus: "footsteps" },
  { id: "footsteps.snow2", source: "footsteps/snow/snow2.mp3", bus: "footsteps" },
  { id: "footsteps.snow3", source: "footsteps/snow/snow3.mp3", bus: "footsteps" },
  { id: "footsteps.snow4", source: "footsteps/snow/snow4.mp3", bus: "footsteps" },
  { id: "weapons.pistol.shot", source: "weapons/pistol/shot.mp3", bus: "weapons" },
  { id: "weapons.pistol.reload", source: "weapons/pistol/reload.mp3", bus: "weapons" },
  { id: "weapons.pistol.empty", source: "weapons/pistol/empty.mp3", bus: "weapons" },
  { id: "weapons.smg.shot", source: "weapons/smg/shot.mp3", bus: "weapons" },
  { id: "weapons.smg.reload", source: "weapons/smg/reload.mp3", bus: "weapons" },
  { id: "weapons.smg.empty", source: "weapons/smg/empty.mp3", bus: "weapons" },
  { id: "weapons.smg.secondary", source: "weapons/smg/secondary.mp3", bus: "weapons" },
  { id: "weapons.ar3.shot", source: "weapons/ar3/shot.mp3", bus: "weapons" },
  { id: "weapons.ar3.reload", source: "weapons/ar3/reload.mp3", bus: "weapons" },
  { id: "weapons.ar3.empty", source: "weapons/ar3/empty.mp3", bus: "weapons" },
  { id: "weapons.crowbar.swing", source: "weapons/crowbar/swing.mp3", bus: "weapons" },
  { id: "weapons.crowbar.hitFlesh", source: "weapons/crowbar/hitFlesh.mp3", bus: "weapons" },
  { id: "weapons.pickup", source: "weapons/pickup.mp3", bus: "world" },
  { id: "weapons.shotgun.shot", source: "weapons/shotgun/shot.mp3", bus: "weapons" },
  { id: "weapons.shotgun.reload", source: "weapons/shotgun/reload.mp3", bus: "weapons" },
  { id: "weapons.shotgun.cock", source: "weapons/shotgun/cock.mp3", bus: "weapons" },
  { id: "weapons.shotgun.empty", source: "weapons/shotgun/empty.mp3", bus: "weapons" },
  { id: "weapons.grenade.throw", source: "weapons/grenade/throw.mp3", bus: "weapons" },
  { id: "weapons.grenade.beep", source: "weapons/grenade/beep.mp3", bus: "weapons", role: "hevBeep" },
  { id: "weapons.grenade.explosion", source: "weapons/grenade/explosion.mp3", bus: "weapons" },
  { id: "enemies.zombie.alert", source: "npcs/zombie/alert.mp3", bus: "enemies" },
  { id: "enemies.zombie.attack", source: "npcs/zombie/attack.mp3", bus: "enemies" },
  { id: "enemies.zombie.damaged", source: "npcs/zombie/damaged.mp3", bus: "enemies" },
];

const weaponClips: ClipSpec[] = [
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
  { id: "enemies.zombie.hl2.die1", source: "hl2/npcs/zombie/zombie_die1.wav", bus: "enemies" },
  { id: "enemies.zombie.hl2.die2", source: "hl2/npcs/zombie/zombie_die2.wav", bus: "enemies" },
  { id: "enemies.zombie.hl2.die3", source: "hl2/npcs/zombie/zombie_die3.wav", bus: "enemies" },
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
      ...enemyClips,
      ...footstepClips,
      ...backgroundClips,
      ...uiClips,
      ...hevClips,
    ].map((spec) => [spec.id, clip(spec)]),
  );
