export interface HUDValue {
  current: number;
  max: number;
}

export interface HUDWeaponState {
  name: string;
  ammo: number;
  reserve: number;
}

export interface HUDState {
  health: HUDValue;
  armor: HUDValue;
  armorEnabled: boolean;
  weapon: HUDWeaponState;
  interactionLabel?: string;
  objective: string;
}

export function createDefaultHUDState(): HUDState {
  return {
    health: { current: 100, max: 100 },
    armor: { current: 0, max: 100 },
    armorEnabled: false,
    weapon: { name: 'UNARMED', ammo: 0, reserve: 0 },
    objective: 'Explorar la instalacion',
  };
}
