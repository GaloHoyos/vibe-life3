import { Vector3 } from 'three';
import { BlobConfig } from '@game/config/blob.config';
import type { BlobOrganismRuntime } from '@engine/blob/BlobOrganismRuntime';

/**
 * Estado compartido entre `BlobContactCombat` (lo escribe) y `BlobAnimator`
 * (lo lee) — mismo patrón que `TurretAimState`. El combat publica el threat y
 * los kills consumidos; el animator dimensiona el enjambre a partir de eso.
 */
export class BlobSwarmState {
  readonly threatPosition = new Vector3();
  hasThreat = false;
  consumedKills = 0;

  constructor(private readonly runtime?: BlobOrganismRuntime) {}

  setThreat(position: Vector3 | null): void {
    if (position) {
      this.threatPosition.copy(position);
      this.hasThreat = true;
    } else {
      this.hasThreat = false;
    }
  }

  noteKill(): void {
    this.consumedKills = Math.min(BlobConfig.growth.maxKills, this.consumedKills + 1);
    this.runtime?.grow(BlobConfig.growth.elementsPerKill);
  }

  get damageMultiplier(): number {
    return 1 + BlobConfig.growth.damageMultPerKill * this.consumedKills;
  }

  get bonusElements(): number {
    return BlobConfig.growth.elementsPerKill * this.consumedKills;
  }

  get bonusRadius(): number {
    return BlobConfig.growth.radiusPerKill * this.consumedKills;
  }

  get contactRange(): number {
    return (
      BlobConfig.contact.baseRange +
      BlobConfig.contact.rangePerGrowth * this.consumedKills
    );
  }
}
