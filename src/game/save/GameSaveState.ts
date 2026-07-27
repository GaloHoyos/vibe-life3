import { AmmoDefinitions, type AmmoId } from "@game/config/ammo.config";
import { WeaponDefinitions } from "@game/config/weapons.config";
import type {
  AmmoLoadoutEntry,
  WeaponLoadoutEntry,
} from "@game/gameplay/weapons/core/WeaponController";
import type { VehicleSystemSnapshot } from "@game/gameplay/vehicles/VehicleSystem";
import type { CheckpointSnapshot } from "@game/levels/CheckpointSystem";
import type { EntityIOSnapshot } from "@game/script/EntityIOSystem";
import type { VectorTuple } from "@shared/math/VectorTuple";
import {
  assertJsonValue,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./JsonValue";

export interface PlayerRuntimeSaveState extends CheckpointSnapshot {
  readonly pitch: number;
  readonly stamina: {
    readonly current: number;
    readonly depleted: boolean;
    readonly timeSinceDrain: number;
  };
}

export function toJsonValue(value: unknown): JsonValue {
  let parsed: unknown;
  try {
    parsed = JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    throw new Error("El estado contiene datos que no se pueden serializar.");
  }
  assertJsonValue(parsed);
  return parsed;
}

export function toJsonObject(value: unknown): JsonObject {
  const json = toJsonValue(value);
  if (!isJsonObject(json)) {
    throw new Error("El serializer debe producir un objeto JSON.");
  }
  return json;
}

export function readPlayerRuntimeSaveState(
  value: JsonObject,
): PlayerRuntimeSaveState {
  const checkpoint = readCheckpointSnapshot(value);
  const stamina = requireObject(value.stamina, "player.stamina");
  return {
    ...checkpoint,
    pitch: requireNumber(value.pitch, "player.pitch"),
    stamina: {
      current: requireNumber(stamina.current, "player.stamina.current"),
      depleted: requireBoolean(stamina.depleted, "player.stamina.depleted"),
      timeSinceDrain: requireNonNegativeNumber(
        stamina.timeSinceDrain,
        "player.stamina.timeSinceDrain",
      ),
    },
  };
}

export function readCheckpointSnapshot(
  value: JsonObject,
): CheckpointSnapshot {
  const activeWeapon = value.activeWeaponId;
  if (
    activeWeapon !== null &&
    (typeof activeWeapon !== "string" || !(activeWeapon in WeaponDefinitions))
  ) {
    throw new Error("El arma activa del guardado no es compatible.");
  }
  const ammoValue = value.ammo;
  const result: CheckpointSnapshot = {
    position: requireTuple(value.position, "player.position"),
    velocity: requireTuple(value.velocity, "player.velocity"),
    yaw: requireNumber(value.yaw, "player.yaw"),
    health: requireNonNegativeNumber(value.health, "player.health"),
    armor: requireNonNegativeNumber(value.armor, "player.armor"),
    weapons: requireArray(value.weapons, "player.weapons").map(
      readWeaponEntry,
    ),
    activeWeaponId:
      activeWeapon === null
        ? null
        : activeWeapon as keyof typeof WeaponDefinitions,
  };
  if (ammoValue !== undefined) {
    result.ammo = requireArray(ammoValue, "player.ammo").map(readAmmoEntry);
  }
  return result;
}

export function readVehicleSystemSnapshot(
  value: JsonObject,
): VehicleSystemSnapshot {
  const vehicles = requireArray(value.vehicles, "vehicles.vehicles");
  vehicles.forEach((entry, index) => {
    const object = requireObject(entry, `vehicles.vehicles[${index}]`);
    requireString(object.id, `vehicles.vehicles[${index}].id`);
    requireObject(object.motor, `vehicles.vehicles[${index}].motor`);
    requireObject(object.damage, `vehicles.vehicles[${index}].damage`);
    requireArray(object.occupants, `vehicles.vehicles[${index}].occupants`);
  });
  requireNullableString(
    value.mountedVehicleId,
    "vehicles.mountedVehicleId",
  );
  requireNullableString(value.mountedSeatId, "vehicles.mountedSeatId");
  if (value.ai !== undefined) {
    requireArray(value.ai, "vehicles.ai");
  }
  return value as unknown as VehicleSystemSnapshot;
}

export function readEntityIOSnapshot(value: JsonObject): EntityIOSnapshot {
  requireNonNegativeNumber(value.clock, "io.clock");
  requireNonNegativeNumber(value.pendingSerial, "io.pendingSerial");
  requireArray(value.connections, "io.connections");
  requireArray(value.handles, "io.handles");
  requireArray(value.pending, "io.pending");
  return value as unknown as EntityIOSnapshot;
}

function readWeaponEntry(
  value: JsonValue,
  index: number,
): WeaponLoadoutEntry {
  const entry = requireObject(value, `player.weapons[${index}]`);
  const id = requireString(entry.id, `player.weapons[${index}].id`);
  if (!(id in WeaponDefinitions)) {
    throw new Error(`El arma "${id}" no existe en esta versión.`);
  }
  return {
    id: id as keyof typeof WeaponDefinitions,
    magazine: requireNonNegativeNumber(
      entry.magazine,
      `player.weapons[${index}].magazine`,
    ),
    reserve: requireNonNegativeNumber(
      entry.reserve,
      `player.weapons[${index}].reserve`,
    ),
  };
}

function readAmmoEntry(
  value: JsonValue,
  index: number,
): AmmoLoadoutEntry {
  const entry = requireObject(value, `player.ammo[${index}]`);
  const id = requireString(entry.id, `player.ammo[${index}].id`);
  if (!(id in AmmoDefinitions)) {
    throw new Error(`La munición "${id}" no existe en esta versión.`);
  }
  return {
    id: id as AmmoId,
    amount: requireNonNegativeNumber(
      entry.amount,
      `player.ammo[${index}].amount`,
    ),
  };
}

function requireTuple(
  value: JsonValue | undefined,
  path: string,
): [number, number, number] {
  const entries = requireArray(value, path);
  if (entries.length !== 3) {
    throw new Error(`${path} debe tener tres componentes.`);
  }
  return [
    requireNumber(entries[0], `${path}[0]`),
    requireNumber(entries[1], `${path}[1]`),
    requireNumber(entries[2], `${path}[2]`),
  ];
}

function requireArray(
  value: JsonValue | undefined,
  path: string,
): JsonValue[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} debe ser un array.`);
  }
  return value;
}

function requireObject(
  value: JsonValue | undefined,
  path: string,
): JsonObject {
  if (!isJsonObject(value)) {
    throw new Error(`${path} debe ser un objeto.`);
  }
  return value;
}

function requireString(
  value: JsonValue | undefined,
  path: string,
): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} debe ser texto no vacío.`);
  }
  return value;
}

function requireNullableString(
  value: JsonValue | undefined,
  path: string,
): string | null {
  if (value === null) return null;
  return requireString(value, path);
}

function requireBoolean(
  value: JsonValue | undefined,
  path: string,
): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${path} debe ser booleano.`);
  }
  return value;
}

function requireNumber(
  value: JsonValue | undefined,
  path: string,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} debe ser un número finito.`);
  }
  return value;
}

function requireNonNegativeNumber(
  value: JsonValue | undefined,
  path: string,
): number {
  const number = requireNumber(value, path);
  if (number < 0) {
    throw new Error(`${path} no puede ser negativo.`);
  }
  return number;
}

export function tuple(value: VectorTuple): [number, number, number] {
  return [value[0], value[1], value[2]];
}
