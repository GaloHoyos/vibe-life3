import type { ModelAssetId } from '@engine/assets/AssetManifest';

/**
 * Pickups consumibles del jugador (vida y traje HEV). Data-driven igual que
 * las armas: agregar un consumible = sumar una entrada a `ItemDefinitions` y,
 * si trae modelo nuevo, registrarlo en `AssetManifest`.
 */
export type ItemId = 'medkit' | 'hevBattery';

/** Qué vital recarga el pickup al tocarlo. */
export type ItemEffectKind = 'health' | 'armor';

export interface ItemDefinition {
  id: ItemId;
  displayName: string;
  modelId: ModelAssetId;
  kind: ItemEffectKind;
  /** Puntos que repone al recogerlo (clampeados al máximo del vital). */
  amount: number;
  /** Escala visual del modelo en el mundo (el collider físico se auto-ajusta al bbox escalado). */
  pickupScale: number;
  /** Radio planar (m) al que el jugador lo absorbe. */
  pickupRadius: number;
}

export const ItemDefinitions: Record<ItemId, ItemDefinition> = {
  medkit: {
    id: 'medkit',
    displayName: 'Botiquín',
    modelId: 'medkit',
    kind: 'health',
    amount: 25,
    pickupScale: 0.3,
    pickupRadius: 1.4,
  },
  hevBattery: {
    id: 'hevBattery',
    displayName: 'Batería HEV',
    modelId: 'hevBattery',
    kind: 'armor',
    amount: 25,
    pickupScale: 0.15,
    pickupRadius: 1.4,
  },
};

export function getItem(id: ItemId): ItemDefinition {
  return ItemDefinitions[id];
}

/**
 * Cargadores de pared estilo HL2: se mantiene USE para drenar una reserva
 * finita hacia el vital (vida o traje), parando al llenarse o agotarse.
 * Data-driven igual que los pickups — un tipo nuevo es una entrada acá.
 */
export type ChargerKind = 'health' | 'armor';

export interface ChargerTypeDefinition {
  kind: ChargerKind;
  /** Nombre en minúscula para el prompt de interacción (en español). */
  displayName: string;
  modelId: ModelAssetId;
  /** Reserva total que dispensa antes de agotarse. */
  capacity: number;
  /** Puntos por segundo mientras se mantiene USE. */
  rate: number;
  /** Escala visual del modelo (el collider estático se auto-ajusta al bbox). */
  scale: number;
  /** Alcance (m) de interacción. */
  maxDistance: number;
}

export const ChargerTypes: Record<ChargerKind, ChargerTypeDefinition> = {
  health: {
    kind: 'health',
    displayName: 'cargador de salud',
    modelId: 'healthCharger',
    capacity: 50,
    rate: 30,
    scale: 0.5,
    maxDistance: 2.4,
  },
  armor: {
    kind: 'armor',
    displayName: 'cargador HEV',
    modelId: 'hevCharger',
    capacity: 75,
    rate: 30,
    scale: 0.5,
    maxDistance: 2.4,
  },
};

export function getChargerType(kind: ChargerKind): ChargerTypeDefinition {
  return ChargerTypes[kind];
}
