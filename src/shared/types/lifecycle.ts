import type { Vector3 } from 'three';

/**
 * Categoria de daño. Permite gates por tipo en el receptor (ej: jefes estilo
 * HL2 que solo reciben `"explosive"`). `explosive` lo emite el path compartido
 * de explosiones (`GrenadeSystem.detonate`: RPG, granadas, barriles). Los demas
 * son informativos; omitir el argumento equivale a `"bullet"`.
 */
export type DamageType = 'bullet' | 'explosive' | 'melee' | 'energy' | 'physics';

export interface Damageable {
  /** `attackerId` permite al receptor reaccionar contra quien lo daño (aggro). */
  applyDamage(
    amount: number,
    hitDirection?: Vector3,
    hitPartName?: string,
    attackerId?: string,
    hitPoint?: Vector3,
    damageType?: DamageType,
  ): void;
  isAlive(): boolean;
}

export interface Disposable {
  dispose(): void;
}

export interface Updatable {
  update(delta: number): void;
}
