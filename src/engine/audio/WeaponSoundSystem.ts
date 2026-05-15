import type { GameEventBus } from "../GameEvents";
import type { SoundManager } from "./SoundManager";

export class WeaponSoundSystem {
  constructor(
    eventBus: GameEventBus,
    private readonly sounds: SoundManager,
  ) {
    eventBus.on("weapon.fired", (event) => {
      const soundId = this.getShotSound(event.weaponName);
      if (soundId && this.sounds.hasSound(soundId)) {
        this.sounds.play(soundId, { bus: "weapons" });
      }
    });

    eventBus.on("weapon.reloaded", (event) => {
      const soundId = this.getReloadSound(event.weaponName);
      if (soundId && this.sounds.hasSound(soundId)) {
        this.sounds.play(soundId, { bus: "weapons" });
      }
    });

    eventBus.on("weapon.empty", (event) => {
      const soundId = this.getEmptySound(event.weaponName);
      if (soundId && this.sounds.hasSound(soundId)) {
        this.sounds.play(soundId, { bus: "weapons" });
      }
    });

    eventBus.on("weapon.hit", (event) => {
      if (event.weaponName === "Crowbar" && event.surfaceKind === "npc") {
        if (this.sounds.hasSound("weapons.crowbar.hitFlesh")) {
          this.sounds.play("weapons.crowbar.hitFlesh", { bus: "weapons" });
        }
      }
    });
  }

  private getShotSound(weaponName: string): string | null {
    switch (weaponName) {
      case "9mm Pistol":
        return "weapons.pistol.shot";
      case "SMG":
        return "weapons.smg.shot";
      case "AR3":
        return "weapons.ar3.shot";
      case "Crowbar":
        return "weapons.crowbar.swing";
      default:
        return null;
    }
  }

  private getReloadSound(weaponName: string): string | null {
    switch (weaponName) {
      case "9mm Pistol":
        return "weapons.pistol.reload";
      case "SMG":
        return "weapons.smg.reload";
      case "AR3":
        return "weapons.ar3.reload";
      default:
        return null;
    }
  }

  private getEmptySound(weaponName: string): string | null {
    switch (weaponName) {
      case "9mm Pistol":
        return "weapons.pistol.empty";
      case "SMG":
        return "weapons.smg.empty";
      case "AR3":
        return "weapons.ar3.empty";
      default:
        return null;
    }
  }
}
