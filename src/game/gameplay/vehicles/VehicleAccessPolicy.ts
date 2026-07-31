import type { Faction } from "@engine/ai/Faction";
import {
  isAtTheControls,
  type VehicleCrewRole,
} from "@game/config/vehicles.config";
import {
  resolveVehicleAccessPolicy,
  type VehicleAccessPolicy,
  type VehicleDefinition,
} from "@game/levels/LevelDefinition";
import type { NpcVehicleCapability } from "@game/npc/core/INpc";

export type VehicleAccessActor =
  | { readonly kind: "player" }
  | {
      readonly kind: "npc";
      readonly faction: Faction;
      readonly vehicleCapability?: NpcVehicleCapability | null;
    };

export type VehicleAccessDenialReason =
  | "no-vehicle-capability"
  | "incompatible-faction"
  | "controls-reserved-for-player"
  | "cannot-drive";

export interface VehicleRoleAccessDecision {
  readonly allowed: boolean;
  readonly policy: VehicleAccessPolicy;
  readonly reason: VehicleAccessDenialReason | null;
}

type VehicleAccessDefinition = Pick<
  VehicleDefinition,
  "accessPolicy" | "faction"
>;

/**
 * Resolves both vehicle ownership and seat responsibility. A gunner, commander
 * or passenger counts as a companion; only driver and pilot control the vehicle.
 */
export function evaluateVehicleRoleAccess(
  actor: VehicleAccessActor,
  vehicle: VehicleAccessDefinition,
  role: VehicleCrewRole,
): VehicleRoleAccessDecision {
  const policy = resolveVehicleAccessPolicy(vehicle);
  if (actor.kind === "player") return allow(policy);

  const capability = actor.vehicleCapability;
  if (!capability) return deny(policy, "no-vehicle-capability");

  const atControls = isAtTheControls(role);
  if (actor.faction === "resistance") {
    if (policy === "combine") return deny(policy, "incompatible-faction");
    if (policy === "player" && atControls) {
      return deny(policy, "controls-reserved-for-player");
    }
    if (atControls && !capability.canDrive) {
      return deny(policy, "cannot-drive");
    }
    return allow(policy);
  }

  if (actor.faction === "combine") {
    if (policy !== "combine") return deny(policy, "incompatible-faction");
    if (atControls && !capability.canDrive) {
      return deny(policy, "cannot-drive");
    }
    return allow(policy);
  }

  return deny(policy, "incompatible-faction");
}

export function canUseVehicleRole(
  actor: VehicleAccessActor,
  vehicle: VehicleAccessDefinition,
  role: VehicleCrewRole,
): boolean {
  return evaluateVehicleRoleAccess(actor, vehicle, role).allowed;
}

export function isManualPlayerExitAllowed(
  vehicle: Pick<VehicleDefinition, "presetId" | "allowPlayerExit">,
): boolean {
  return vehicle.presetId !== "helicopter" || vehicle.allowPlayerExit === true;
}

function allow(policy: VehicleAccessPolicy): VehicleRoleAccessDecision {
  return { allowed: true, policy, reason: null };
}

function deny(
  policy: VehicleAccessPolicy,
  reason: VehicleAccessDenialReason,
): VehicleRoleAccessDecision {
  return { allowed: false, policy, reason };
}
