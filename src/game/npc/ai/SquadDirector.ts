import { Vector3 } from "three";
import type { Faction } from "@engine/ai/Faction";
import { SquadSlotBoard } from "./SquadSlotBoard";

export type SquadRole =
  | "leader"
  | "suppressor"
  | "flanker"
  | "cover"
  | "assault"
  | "grenadier"
  | "searcher";

export interface SquadReport {
  id: string;
  faction: Faction;
  position: Vector3;
  health01: number;
  hasLineOfSight: boolean;
  inCover: boolean;
  wantsGrenade: boolean;
  canFlank: boolean;
  threatPosition: Vector3 | null;
}

export interface SquadOrder {
  role: SquadRole;
  flankSide: 1 | -1;
  assignedAt: number;
}

export class SquadDirector {
  /** Slots limitados por faccion (attack/grenade/overwatch), estilo HL2. */
  readonly slots = new SquadSlotBoard();
  private readonly reports = new Map<string, SquadReport>();
  private readonly orders = new Map<string, SquadOrder>();
  private lastTickAt = -Infinity;
  private readonly tickInterval = 0.45;
  private readonly roleHoldDuration = 1.6;

  report(report: SquadReport): void {
    this.reports.set(report.id, {
      ...report,
      position: report.position.clone(),
      threatPosition: report.threatPosition?.clone() ?? null,
    });
  }

  unregister(id: string): void {
    this.reports.delete(id);
    this.orders.delete(id);
    this.slots.unregister(id);
  }

  getRole(id: string): SquadRole {
    return this.orders.get(id)?.role ?? "leader";
  }

  getFlankSide(id: string): 1 | -1 {
    return this.orders.get(id)?.flankSide ?? 1;
  }

  getOrder(id: string): SquadOrder {
    return this.orders.get(id) ?? { role: "leader", flankSide: 1, assignedAt: -Infinity };
  }

  tickAssignments(elapsed: number, threatPosition: Vector3 | null): void {
    // El reloj de lockouts corre todos los frames, aun con el throttle abajo.
    this.slots.tick(elapsed);
    if (elapsed - this.lastTickAt < this.tickInterval) return;
    this.lastTickAt = elapsed;

    const reports = [...this.reports.values()];
    if (reports.length === 0) {
      this.orders.clear();
      return;
    }

    const threat = threatPosition ?? this.estimateThreatPosition(reports);
    if (!threat) {
      for (const report of reports) {
        this.setOrder(report.id, "searcher", 1, elapsed);
      }
      return;
    }

    const byFaction = new Map<Faction, SquadReport[]>();
    for (const report of reports) {
      const bucket = byFaction.get(report.faction) ?? [];
      bucket.push(report);
      byFaction.set(report.faction, bucket);
    }

    for (const members of byFaction.values()) {
      this.assignFactionSquad(members, threat, elapsed);
    }
  }

  private assignFactionSquad(
    members: SquadReport[],
    threat: Vector3,
    elapsed: number,
  ): void {
    const sorted = members
      .map((member) => ({
        ...member,
        distToThreat: member.position.distanceTo(threat),
      }))
      .sort((a, b) => a.distToThreat - b.distToThreat);

    if (sorted.length === 1) {
      this.setOrder(sorted[0].id, "leader", 1, elapsed);
      return;
    }

    const leader = sorted.find((member) => member.hasLineOfSight) ?? sorted[0];
    this.setOrder(leader.id, leader.inCover ? "suppressor" : "leader", 1, elapsed);

    let suppressorAssigned = leader.inCover;
    let flankerAssigned = false;
    let grenadierAssigned = false;
    for (const member of sorted) {
      if (member.id === leader.id) continue;
      if (!suppressorAssigned && member.hasLineOfSight) {
        this.setOrder(member.id, "suppressor", 1, elapsed);
        suppressorAssigned = true;
        continue;
      }
      if (!grenadierAssigned && member.wantsGrenade && member.health01 > 0.35) {
        this.setOrder(member.id, "grenadier", this.pickFlankSide(member, leader, threat), elapsed);
        grenadierAssigned = true;
        continue;
      }
      if (!flankerAssigned && member.canFlank && member.health01 > 0.4) {
        this.setOrder(member.id, "flanker", this.pickFlankSide(member, leader, threat), elapsed);
        flankerAssigned = true;
        continue;
      }
      if (member.health01 > 0.65 && !member.inCover) {
        this.setOrder(member.id, "assault", 1, elapsed);
      } else {
        this.setOrder(member.id, "cover", 1, elapsed);
      }
    }
  }

  private estimateThreatPosition(reports: SquadReport[]): Vector3 | null {
    const sum = new Vector3();
    let count = 0;
    for (const report of reports) {
      if (!report.threatPosition) continue;
      sum.add(report.threatPosition);
      count += 1;
    }
    return count > 0 ? sum.divideScalar(count) : null;
  }

  private pickFlankSide(
    member: SquadReport,
    spotter: SquadReport,
    threat: Vector3,
  ): 1 | -1 {
    const toThreat = threat.clone().sub(spotter.position).setY(0);
    if (toThreat.lengthSq() < 0.01) return 1;
    toThreat.normalize();
    const right = new Vector3(-toThreat.z, 0, toThreat.x);
    const memberOffset = member.position.clone().sub(spotter.position).setY(0);
    return memberOffset.dot(right) >= 0 ? 1 : -1;
  }

  private setOrder(
    id: string,
    role: SquadRole,
    flankSide: 1 | -1,
    elapsed: number,
  ): void {
    const previous = this.orders.get(id);
    if (
      previous &&
      previous.role !== role &&
      elapsed - previous.assignedAt < this.roleHoldDuration
    ) {
      return;
    }
    this.orders.set(id, {
      role,
      flankSide,
      assignedAt: previous?.role === role ? previous.assignedAt : elapsed,
    });
  }
}
