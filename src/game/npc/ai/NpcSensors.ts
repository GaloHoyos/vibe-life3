import { Vector3 } from "three";
import type { ActorSnapshot } from "@game/npc/core/INpc";
import { isHostileTo } from "@engine/ai/Faction";
import type { Faction } from "@engine/ai/Faction";

export interface NpcSensorInput {
  selfId: string;
  selfFaction: Faction;
  selfPosition: Vector3;
  player: ActorSnapshot;
  npcs: ActorSnapshot[];
}

export interface NpcSensorThreat {
  actor: ActorSnapshot | null;
  distance: number;
}

export class NpcSensors {
  pickNearestHostile(input: NpcSensorInput): NpcSensorThreat {
    let best: ActorSnapshot | null = null;
    let bestDistance = Infinity;
    const consider = (actor: ActorSnapshot): void => {
      if (!actor.isAlive || actor.id === input.selfId) return;
      if (!isHostileTo(input.selfFaction, actor.faction)) return;
      const distance = input.selfPosition.distanceTo(actor.position);
      if (distance < bestDistance) {
        best = actor;
        bestDistance = distance;
      }
    };
    consider(input.player);
    for (const npc of input.npcs) {
      consider(npc);
    }
    return { actor: best, distance: bestDistance };
  }

  alliesNear(input: NpcSensorInput, radius: number): ActorSnapshot[] {
    const radiusSq = radius * radius;
    return input.npcs.filter(
      (npc) =>
        npc.id !== input.selfId &&
        npc.isAlive &&
        !isHostileTo(input.selfFaction, npc.faction) &&
        npc.position.distanceToSquared(input.selfPosition) <= radiusSq,
    );
  }
}
