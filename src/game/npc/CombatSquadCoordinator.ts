import { Vector3 } from "three";

/**
 * Rol táctico asignado por el coordinador del squad.
 *
 * - `solo`        — NPC sin aliados cerca, actúa por su cuenta.
 * - `suppressor`  — fija fuego sobre el threat desde una posición; no avanza.
 * - `flanker`     — busca un ángulo lateral; pathea al costado del threat.
 * - `coverer`    — toma cobertura, dispara desde ahí. Default "seguro".
 * - `charger`     — avanza si el threat está oculto/débil y hay apoyo.
 */
export type SquadRole =
  | "solo"
  | "suppressor"
  | "flanker"
  | "coverer"
  | "charger";

interface SquadMember {
  id: string;
  position: Vector3;
  health01: number;
  hasLineOfSight: boolean;
  inCover: boolean;
  isFlankerCandidate: boolean;
}

interface RoleAssignment {
  role: SquadRole;
  /** Para flankers: dirección lateral preferida desde el threat (1=derecha, -1=izquierda). */
  flankSide: 1 | -1;
}

/**
 * Coordinador grupal para combines (y otros NPCs hostiles del mismo bando).
 *
 * Cada frame:
 *  1. Los Combine llaman `report(member)` con su estado actual.
 *  2. Llaman `tickAssignments(threatPosition)` UNA VEZ al final del NPC pass
 *     (o el coordinator lo hace automáticamente cada N ms).
 *  3. Consultan `getRole(id)` durante su tick táctico.
 *
 * Heurística de asignación (sin coordinación perfecta, intencional —
 * suficiente para que se sienta natural):
 *  - Si hay 1 miembro → solo
 *  - Si hay 2+ miembros:
 *      - El primero con LOS Y en cover → `suppressor`
 *      - El segundo sin LOS o sin cover → `flanker`, lado opuesto al spotter
 *      - Si hay un 3ro y el threat está sin verse hace >3s → `charger`
 *      - Resto → `coverer`
 *  - Si nadie tiene LOS → todos `flanker` o `charger` según health
 *
 * El estado se recomputa cada 0.5s para evitar flicker entre frames.
 */
export class CombatSquadCoordinator {
  private readonly reports = new Map<string, SquadMember>();
  private readonly assignments = new Map<string, RoleAssignment>();
  private lastTickAt = -Infinity;
  private readonly tickInterval = 0.5;

  report(member: SquadMember): void {
    this.reports.set(member.id, member);
  }

  unregister(id: string): void {
    this.reports.delete(id);
    this.assignments.delete(id);
  }

  getRole(id: string): SquadRole {
    return this.assignments.get(id)?.role ?? "solo";
  }

  getFlankSide(id: string): 1 | -1 {
    return this.assignments.get(id)?.flankSide ?? 1;
  }

  /**
   * Recomputa asignaciones si pasó el tick interval. `elapsed` para throttle,
   * `threatPosition` para resolver el side angle del flanker. Si no hay
   * threat conocido, todos quedan `solo`.
   */
  tickAssignments(elapsed: number, threatPosition: Vector3 | null): void {
    if (elapsed - this.lastTickAt < this.tickInterval) return;
    this.lastTickAt = elapsed;

    const members = [...this.reports.values()];
    if (members.length === 0) {
      this.assignments.clear();
      return;
    }

    if (members.length === 1 || !threatPosition) {
      const m = members[0];
      this.assignments.set(m.id, { role: "solo", flankSide: 1 });
      for (let i = 1; i < members.length; i += 1) {
        this.assignments.set(members[i].id, { role: "solo", flankSide: 1 });
      }
      return;
    }

    const sorted = members
      .map((m) => ({ ...m, distToThreat: m.position.distanceTo(threatPosition) }))
      .sort((a, b) => a.distToThreat - b.distToThreat);

    const spotter = sorted[0];

    let suppressorId: string | null = null;
    for (const m of sorted) {
      if (m.hasLineOfSight && m.inCover) {
        suppressorId = m.id;
        break;
      }
    }
    if (!suppressorId) {
      for (const m of sorted) {
        if (m.hasLineOfSight) {
          suppressorId = m.id;
          break;
        }
      }
    }
    if (suppressorId) {
      this.assignments.set(suppressorId, { role: "suppressor", flankSide: 1 });
    }

    let flankerAssigned = false;
    let chargerAssigned = false;
    for (const m of sorted) {
      if (m.id === suppressorId) continue;
      if (!flankerAssigned && m.isFlankerCandidate && m.health01 > 0.4) {
        const side = this.pickFlankSide(m, spotter, threatPosition);
        this.assignments.set(m.id, { role: "flanker", flankSide: side });
        flankerAssigned = true;
        continue;
      }
      if (!chargerAssigned && m.health01 > 0.6 && Math.random() < 0.4) {
        this.assignments.set(m.id, { role: "charger", flankSide: 1 });
        chargerAssigned = true;
        continue;
      }
      this.assignments.set(m.id, { role: "coverer", flankSide: 1 });
    }
  }

  /**
   * Elige el lado del flank en base a dónde NO está el spotter. Si el spotter
   * cubre desde la derecha, el flanker va por la izquierda.
   */
  private pickFlankSide(
    member: SquadMember,
    spotter: SquadMember,
    threatPosition: Vector3,
  ): 1 | -1 {
    const toThreat = threatPosition.clone().sub(spotter.position).setY(0);
    toThreat.normalize();
    const right = new Vector3(-toThreat.z, 0, toThreat.x);
    const memberOffset = member.position.clone().sub(spotter.position).setY(0);
    const dotRight = memberOffset.dot(right);
    return dotRight >= 0 ? 1 : -1;
  }
}
