import { AmmoDefinitions, type AmmoId } from "@game/config/ammo.config";
import { WeaponDefinitions } from "@game/config/weapons.config";
import type {
  AmmoLoadoutEntry,
  WeaponLoadoutEntry,
} from "@game/gameplay/weapons/core/WeaponController";
import type { VehicleSystemSnapshot } from "@game/gameplay/vehicles/VehicleSystem";
import {
  VEHICLE_OBJECTIVE_FAILURE_REASONS,
  VEHICLE_OBJECTIVE_KINDS,
  VEHICLE_OBJECTIVE_SOURCES,
} from "@game/gameplay/vehicles/ai/VehicleTacticalTypes";
import type { CheckpointSnapshot } from "@game/levels/CheckpointSystem";
import type { EntityIOSnapshot } from "@game/script/EntityIOSystem";
import type { VectorTuple } from "@shared/math/VectorTuple";
import {
  assertJsonValue,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "./JsonValue";

const VEHICLE_SAVE_FACTIONS = [
  "player",
  "resistance",
  "combine",
  "zombies",
  "blob",
  "neutral",
] as const;

type RuntimeVehicleExtractionState = NonNullable<
  VehicleSystemSnapshot["extractions"]
>[number];

export interface VehicleExtractionSaveState
  extends RuntimeVehicleExtractionState {
  readonly deliveredActorIds?: readonly string[];
  readonly dropoffAttempts?: number;
}

export interface VehicleExtractionRequestSaveState {
  readonly faction: RuntimeVehicleExtractionState["faction"];
  readonly position: RuntimeVehicleExtractionState["pickup"];
  readonly actorIds: readonly string[];
  readonly requestedAgoSeconds?: number;
}

export type VehicleSystemSaveState = Omit<
  VehicleSystemSnapshot,
  "extractions" | "extractionRequests"
> & {
  readonly extractions?: readonly VehicleExtractionSaveState[];
  readonly extractionRequests?: readonly VehicleExtractionRequestSaveState[];
};

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
): VehicleSystemSaveState {
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
  if (value.npcDriveModes !== undefined) {
    requireArray(value.npcDriveModes, "vehicles.npcDriveModes").forEach(
      (entry, index) => {
        const mode = requireObject(
          entry,
          `vehicles.npcDriveModes[${index}]`,
        );
        requireString(
          mode.vehicleId,
          `vehicles.npcDriveModes[${index}].vehicleId`,
        );
        const driveMode = requireString(
          mode.mode,
          `vehicles.npcDriveModes[${index}].mode`,
        );
        if (
          driveMode !== "hold" &&
          driveMode !== "automatic" &&
          driveMode !== "patrol" &&
          driveMode !== "destination"
        ) {
          throw new Error(
            `vehicles.npcDriveModes[${index}].mode no es compatible.`,
          );
        }
        if (mode.destination !== undefined) {
          requireTuple(
            mode.destination,
            `vehicles.npcDriveModes[${index}].destination`,
          );
        }
        if (mode.patrolPoints !== undefined) {
          requireArray(
            mode.patrolPoints,
            `vehicles.npcDriveModes[${index}].patrolPoints`,
          ).forEach((point, pointIndex) => {
            requireTuple(
              point,
              `vehicles.npcDriveModes[${index}].patrolPoints[${pointIndex}]`,
            );
          });
        }
      },
    );
  }
  if (value.npcExitRequests !== undefined) {
    requireArray(value.npcExitRequests, "vehicles.npcExitRequests").forEach(
      (entry, index) => {
        const request = requireObject(
          entry,
          `vehicles.npcExitRequests[${index}]`,
        );
        requireString(
          request.actorId,
          `vehicles.npcExitRequests[${index}].actorId`,
        );
        requireBoolean(
          request.emergency,
          `vehicles.npcExitRequests[${index}].emergency`,
        );
      },
    );
  }
  if (value.objectives !== undefined) {
    requireArray(value.objectives, "vehicles.objectives").forEach(
      readVehicleObjectiveGroup,
    );
  }
  if (value.extractions !== undefined) {
    requireArray(value.extractions, "vehicles.extractions").forEach(
      readVehicleExtraction,
    );
  }
  if (value.extractionRequests !== undefined) {
    requireArray(
      value.extractionRequests,
      "vehicles.extractionRequests",
    ).forEach(readVehicleExtractionRequest);
  }
  if (value.landingOrders !== undefined) {
    requireArray(value.landingOrders, "vehicles.landingOrders").forEach(
      readVehicleLandingOrder,
    );
  }
  return value as unknown as VehicleSystemSaveState;
}

function readVehicleLandingOrder(value: JsonValue, index: number): void {
  const path = `vehicles.landingOrders[${index}]`;
  const landing = requireObject(value, path);
  requireString(landing.vehicleId, `${path}.vehicleId`);
  requireString(landing.objectiveId, `${path}.objectiveId`);
  requireNonNegativeNumber(
    landing.objectiveRevision,
    `${path}.objectiveRevision`,
  );
  const options = requireObject(landing.options, `${path}.options`);
  if (options.searchRadius !== undefined) {
    requireNonNegativeNumber(options.searchRadius, `${path}.options.searchRadius`);
  }
  if (options.preferAuthored !== undefined) {
    requireBoolean(options.preferAuthored, `${path}.options.preferAuthored`);
  }
  if (options.holdAfterLanding !== undefined) {
    requireBoolean(
      options.holdAfterLanding,
      `${path}.options.holdAfterLanding`,
    );
  }
  if (options.orderId !== undefined) {
    requireString(options.orderId, `${path}.options.orderId`);
  }
}

function readVehicleObjectiveGroup(value: JsonValue, index: number): void {
  const path = `vehicles.objectives[${index}]`;
  const group = requireObject(value, path);
  requireString(group.vehicleId, `${path}.vehicleId`);
  requireArray(group.objectives, `${path}.objectives`).forEach(
    (entry, objectiveIndex) => {
      readVehicleObjective(
        entry,
        `${path}.objectives[${objectiveIndex}]`,
      );
    },
  );
}

function readVehicleObjective(value: JsonValue, path: string): void {
  const objective = requireObject(value, path);
  requireString(objective.id, `${path}.id`);
  requireNonNegativeNumber(objective.revision, `${path}.revision`);
  requireOneOf(
    objective.source,
    `${path}.source`,
    VEHICLE_OBJECTIVE_SOURCES,
  );
  requireOneOf(
    objective.kind,
    `${path}.kind`,
    VEHICLE_OBJECTIVE_KINDS,
  );
  readVehicleObjectiveTarget(objective.target, `${path}.target`);
  requireOneOf(objective.status, `${path}.status`, [
    "queued",
    "active",
    "completed",
    "failed",
    "cancelled",
  ]);
  requireNonNegativeNumber(
    objective.issuedAtSeconds,
    `${path}.issuedAtSeconds`,
  );
  requireNonNegativeNumber(
    objective.updatedAtSeconds,
    `${path}.updatedAtSeconds`,
  );
  if (objective.failure !== undefined) {
    const failure = requireObject(objective.failure, `${path}.failure`);
    requireOneOf(
      failure.reason,
      `${path}.failure.reason`,
      VEHICLE_OBJECTIVE_FAILURE_REASONS,
    );
    requireNonNegativeNumber(
      failure.atSeconds,
      `${path}.failure.atSeconds`,
    );
    requireBoolean(failure.recoverable, `${path}.failure.recoverable`);
    if (failure.detail !== undefined) {
      requireText(failure.detail, `${path}.failure.detail`);
    }
  }
}

function readVehicleObjectiveTarget(
  value: JsonValue | undefined,
  path: string,
): void {
  const target = requireObject(value, path);
  const type = requireString(target.type, `${path}.type`);
  switch (type) {
    case "none":
      return;
    case "position":
      requireTuple(target.position, `${path}.position`);
      if (target.heading !== undefined) {
        requireNumber(target.heading, `${path}.heading`);
      }
      return;
    case "entity":
      requireString(target.entityId, `${path}.entityId`);
      if (target.lastKnownPosition !== undefined) {
        requireTuple(
          target.lastKnownPosition,
          `${path}.lastKnownPosition`,
        );
      }
      return;
    case "route":
      requireArray(target.points, `${path}.points`).forEach(
        (point, pointIndex) => {
          requireTuple(point, `${path}.points[${pointIndex}]`);
        },
      );
      requireBoolean(target.loop, `${path}.loop`);
      return;
    case "area":
      requireTuple(target.center, `${path}.center`);
      requireNonNegativeNumber(target.radius, `${path}.radius`);
      return;
    default:
      throw new Error(`${path}.type no es compatible.`);
  }
}

function readVehicleExtraction(value: JsonValue, index: number): void {
  const path = `vehicles.extractions[${index}]`;
  const extraction = requireObject(value, path);
  requireOneOf(
    extraction.faction,
    `${path}.faction`,
    VEHICLE_SAVE_FACTIONS,
  );
  requireString(extraction.vehicleId, `${path}.vehicleId`);
  readStringArray(
    extraction.requestedActorIds,
    `${path}.requestedActorIds`,
  );
  readStringArray(extraction.cargoActorIds, `${path}.cargoActorIds`);
  readStringArray(extraction.failedActorIds, `${path}.failedActorIds`);
  if (extraction.deliveredActorIds !== undefined) {
    readStringArray(
      extraction.deliveredActorIds,
      `${path}.deliveredActorIds`,
    );
  }
  requireTuple(extraction.pickup, `${path}.pickup`);
  requireTuple(extraction.dropoff, `${path}.dropoff`);
  requireTuple(extraction.home, `${path}.home`);
  requireOneOf(extraction.phase, `${path}.phase`, [
    "pickup",
    "boarding",
    "outbound",
    "dropoff",
    "complete",
  ]);
  requireNullableNonNegativeNumber(
    extraction.boardingDeadline,
    `${path}.boardingDeadline`,
  );
  requireNullableString(extraction.objectiveId, `${path}.objectiveId`);
  requireNullableNonNegativeNumber(
    extraction.objectiveRevision,
    `${path}.objectiveRevision`,
  );
  if (extraction.dropoffAttempts !== undefined) {
    requireNonNegativeInteger(
      extraction.dropoffAttempts,
      `${path}.dropoffAttempts`,
    );
  }
}

function readVehicleExtractionRequest(value: JsonValue, index: number): void {
  const path = `vehicles.extractionRequests[${index}]`;
  const request = requireObject(value, path);
  requireOneOf(
    request.faction,
    `${path}.faction`,
    VEHICLE_SAVE_FACTIONS,
  );
  requireTuple(request.position, `${path}.position`);
  readStringArray(request.actorIds, `${path}.actorIds`);
  if (request.requestedAgoSeconds !== undefined) {
    requireNonNegativeNumber(
      request.requestedAgoSeconds,
      `${path}.requestedAgoSeconds`,
    );
  }
}

function readStringArray(value: JsonValue | undefined, path: string): void {
  requireArray(value, path).forEach((entry, index) => {
    requireString(entry, `${path}[${index}]`);
  });
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

function requireText(
  value: JsonValue | undefined,
  path: string,
): string {
  if (typeof value !== "string") {
    throw new Error(`${path} debe ser texto.`);
  }
  return value;
}

function requireOneOf(
  value: JsonValue | undefined,
  path: string,
  allowed: readonly string[],
): string {
  const entry = requireString(value, path);
  if (!allowed.includes(entry)) {
    throw new Error(`${path} no es compatible.`);
  }
  return entry;
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

function requireNonNegativeInteger(
  value: JsonValue | undefined,
  path: string,
): number {
  const number = requireNonNegativeNumber(value, path);
  if (!Number.isInteger(number)) {
    throw new Error(`${path} debe ser un entero.`);
  }
  return number;
}

function requireNullableNonNegativeNumber(
  value: JsonValue | undefined,
  path: string,
): number | null {
  if (value === null) return null;
  return requireNonNegativeNumber(value, path);
}

export function tuple(value: VectorTuple): [number, number, number] {
  return [value[0], value[1], value[2]];
}
