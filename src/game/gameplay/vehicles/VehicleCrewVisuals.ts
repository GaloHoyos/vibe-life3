import { Quaternion, Vector3 } from "three";
import type { INpc } from "@game/npc/core/INpc";
import { isAtTheControls, type VehicleCrewRole } from "@game/config/vehicles.config";
import type { VehicleEntity } from "./VehicleEntity";

/** Segundos que tarda un NPC en meterse al asiento. */
const BOARD_SECONDS = 0.55;
/** Segundos de la bajada; termina devolviendo el motor físico al NPC. */
const LEAVE_SECONDS = 0.45;
/** Altura del arco de subida/bajada: simula pasar la pierna sobre el borde. */
const STEP_ARC_HEIGHT = 0.22;
/**
 * Más lejos que esto, la subida se resuelve de golpe. El blend representa
 * trepar desde al lado del vehículo; arrastrar un cuerpo veinte metros en medio
 * segundo se ve peor que aparecer sentado (y `Attach` del IO es, como en Source,
 * un teleport a bordo: si se quiere caminata, la pide la IA antes de subir).
 */
const MAX_BOARD_DISTANCE = 3;

type CrewPhase = "boarding" | "seated" | "leaving";

interface CrewVisual {
  readonly npc: INpc;
  vehicle: VehicleEntity;
  seatId: string;
  handsOnControls: boolean;
  phase: CrewPhase;
  progress: number;
  /** Pose de partida de la transición, en world space. */
  readonly fromPosition: Vector3;
  readonly fromRotation: Quaternion;
  /** Destino de la bajada; sin usar mientras sube o va sentado. */
  readonly exitPosition: Vector3;
  readonly exitVelocity: Vector3;
  onLeaveComplete: (() => void) | null;
}

const tmpSeatPosition = new Vector3();
const tmpSeatRotation = new Quaternion();
const tmpPosition = new Vector3();
const tmpRotation = new Quaternion();
const tmpUpright = new Quaternion();
const tmpForward = new Vector3();
const tmpLook = new Vector3();
const tmpInverse = new Quaternion();
const WORLD_UP = new Vector3(0, 1, 0);
/** Cuánto acompaña la cabeza del conductor al volante. */
const DRIVER_LOOK_STEER = 0.7;

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

/** Rotación de pie con el yaw de `source`: al bajar el cuerpo se endereza. */
function uprightFrom(source: Quaternion, out: Quaternion): Quaternion {
  tmpForward.set(0, 0, 1).applyQuaternion(source);
  return out.setFromAxisAngle(
    WORLD_UP,
    Math.atan2(tmpForward.x, tmpForward.z),
  );
}

/**
 * Pose visual de la tripulación NPC de los vehículos.
 *
 * El `Npc` sentado tiene el motor y los colliders suspendidos, así que nadie
 * más escribe su transform: este sistema lo hace cada frame desde el anchor del
 * asiento, y mezcla las transiciones de subida y bajada contra la pose de pie.
 * La bajada es dueña del momento en que el NPC recupera su física — recién al
 * cerrar el blend se llama `setVehicleMounted(false, exit)`.
 */
export class VehicleCrewVisuals {
  private readonly crew = new Map<string, CrewVisual>();
  private readonly attention = new Map<string, Vector3>();
  private readonly steering = new Map<string, number>();

  /**
   * Punto que mira la tripulación de un vehículo: el blanco de la torreta. Sin
   * esto los ocupantes van sentados de frente como maniquíes aunque el cañón
   * esté siguiendo a alguien.
   */
  setAttention(vehicleId: string, point: Vector3 | null): void {
    if (!point) {
      this.attention.delete(vehicleId);
      return;
    }
    const stored = this.attention.get(vehicleId);
    if (stored) stored.copy(point);
    else this.attention.set(vehicleId, point.clone());
  }

  /** Dirección normalizada del volante, para que el conductor mire la curva. */
  setSteering(vehicleId: string, steering: number): void {
    this.steering.set(vehicleId, steering);
  }

  /**
   * `snap` sienta al NPC sin transición: lo usa la tripulación autorada del
   * nivel, que ya arranca a bordo y no debería verse entrando en el fade-in.
   */
  board(
    npc: INpc,
    vehicle: VehicleEntity,
    seatId: string,
    role: VehicleCrewRole,
    snap: boolean,
  ): void {
    const existing = this.crew.get(npc.id);
    const entry: CrewVisual = existing ?? {
      npc,
      vehicle,
      seatId,
      handsOnControls: isAtTheControls(role),
      phase: "seated",
      progress: 1,
      fromPosition: new Vector3(),
      fromRotation: new Quaternion(),
      exitPosition: new Vector3(),
      exitVelocity: new Vector3(),
      onLeaveComplete: null,
    };
    entry.vehicle = vehicle;
    entry.seatId = seatId;
    entry.handsOnControls = isAtTheControls(role);
    entry.fromPosition.copy(npc.mesh.position);
    entry.fromRotation.copy(npc.mesh.quaternion);
    const instant =
      snap ||
      !vehicle.getSeatWorldPose(seatId, tmpSeatPosition, tmpSeatRotation) ||
      tmpSeatPosition.distanceTo(entry.fromPosition) > MAX_BOARD_DISTANCE;
    entry.phase = instant ? "seated" : "boarding";
    entry.progress = instant ? 1 : 0;
    entry.onLeaveComplete = null;
    this.crew.set(npc.id, entry);
    this.applyPose(entry);
  }

  /** Cambio de asiento a bordo: se reusa el blend de subida, sin pose de pie. */
  moveToSeat(actorId: string, seatId: string, role: VehicleCrewRole): void {
    const entry = this.crew.get(actorId);
    if (!entry || entry.phase === "leaving") return;
    entry.seatId = seatId;
    entry.handsOnControls = isAtTheControls(role);
    entry.phase = "boarding";
    entry.progress = 0;
    entry.fromPosition.copy(entry.npc.mesh.position);
    entry.fromRotation.copy(entry.npc.mesh.quaternion);
  }

  /**
   * Arranca la bajada desde la pose actual. Devuelve false si el actor no
   * estaba a bordo, para que quien llama haga el teleport directo.
   */
  leave(
    actorId: string,
    exitPosition: Vector3,
    onComplete?: () => void,
    exitVelocity?: Vector3,
  ): boolean {
    const entry = this.crew.get(actorId);
    if (!entry) return false;
    if (entry.phase === "leaving") {
      entry.onLeaveComplete ??= onComplete ?? null;
      return true;
    }
    entry.phase = "leaving";
    entry.progress = 0;
    entry.fromPosition.copy(entry.npc.mesh.position);
    entry.fromRotation.copy(entry.npc.mesh.quaternion);
    entry.exitPosition.copy(exitPosition);
    if (exitVelocity) {
      entry.exitVelocity.copy(exitVelocity);
    } else {
      entry.exitVelocity.set(0, 0, 0);
    }
    entry.onLeaveComplete = onComplete ?? null;
    return true;
  }

  /** Saca al actor sin animar (muerte, choque fatal, unload del nivel). */
  forget(actorId: string): void {
    this.crew.delete(actorId);
  }

  isAboard(actorId: string): boolean {
    return this.crew.has(actorId);
  }

  isLeaving(actorId: string): boolean {
    return this.crew.get(actorId)?.phase === "leaving";
  }

  /** Llamar después de sincronizar el visual del vehículo: lee sus anchors. */
  update(delta: number): void {
    for (const [actorId, entry] of [...this.crew]) {
      // El NPC pudo haber perdido el asiento por otra vía (restore de un save):
      // sin motor suspendido la pose de asiento ya no le corresponde.
      if (entry.npc.isVehicleMounted?.() === false) {
        this.crew.delete(actorId);
        continue;
      }
      // Muerto en plena transición: el ragdoll es dueño del visual desde ya, así
      // que se le devuelve el motor donde cayó en vez de arrastrarlo al destino.
      if (!entry.npc.isAlive()) {
        this.crew.delete(actorId);
        entry.onLeaveComplete?.();
        entry.npc.setVehicleMounted?.(false, entry.npc.position);
        continue;
      }
      if (entry.phase !== "seated") {
        const duration =
          entry.phase === "boarding" ? BOARD_SECONDS : LEAVE_SECONDS;
        entry.progress = Math.min(1, entry.progress + delta / duration);
      }
      if (entry.phase === "leaving" && entry.progress >= 1) {
        this.crew.delete(actorId);
        entry.onLeaveComplete?.();
        entry.npc.setVehicleMounted?.(
          false,
          entry.exitPosition,
          entry.exitVelocity,
        );
        continue;
      }
      this.applyPose(entry);
      if (entry.phase === "boarding" && entry.progress >= 1) {
        entry.phase = "seated";
      }
    }
  }

  clear(): void {
    this.crew.clear();
    this.attention.clear();
    this.steering.clear();
  }

  /**
   * Dirección de mirada en espacio LOCAL del asiento, que es lo que consume
   * `LookAtLayer` para el offset del cuello. El artillero mira al blanco; el
   * conductor acompaña el volante.
   */
  private lookDirection(
    entry: CrewVisual,
    seatPosition: Vector3,
    seatRotation: Quaternion,
  ): Vector3 | undefined {
    const attention = this.attention.get(entry.vehicle.id);
    if (attention) {
      tmpLook.copy(attention).sub(seatPosition);
      if (tmpLook.lengthSq() < 1e-4) return undefined;
      tmpInverse.copy(seatRotation).invert();
      return tmpLook.normalize().applyQuaternion(tmpInverse);
    }
    if (!entry.handsOnControls) return undefined;
    const steering = this.steering.get(entry.vehicle.id) ?? 0;
    if (Math.abs(steering) < 0.05) return undefined;
    // `steering` positivo dobla a la izquierda (+X en este proyecto).
    return tmpLook.set(steering * DRIVER_LOOK_STEER, 0, 1).normalize();
  }

  private applyPose(entry: CrewVisual): void {
    const { npc, vehicle, seatId } = entry;
    if (!vehicle.getSeatWorldPose(seatId, tmpSeatPosition, tmpSeatRotation)) {
      return;
    }
    if (entry.phase === "seated") {
      npc.setSeatPose?.({
        position: tmpSeatPosition,
        rotation: tmpSeatRotation,
        seated: 1,
        handsOnControls: entry.handsOnControls,
        lookDirection: this.lookDirection(entry, tmpSeatPosition, tmpSeatRotation),
      });
      return;
    }

    const boarding = entry.phase === "boarding";
    const blend = easeInOut(entry.progress);
    const target = boarding ? tmpSeatPosition : entry.exitPosition;
    const targetRotation = boarding
      ? tmpSeatRotation
      : uprightFrom(entry.fromRotation, tmpUpright);
    tmpPosition.copy(entry.fromPosition).lerp(target, blend);
    // Arco: el cuerpo pasa sobre el borde en vez de atravesar la chapa.
    tmpPosition.y += Math.sin(blend * Math.PI) * STEP_ARC_HEIGHT;
    tmpRotation.copy(entry.fromRotation).slerp(targetRotation, blend);
    npc.setSeatPose?.({
      position: tmpPosition,
      rotation: tmpRotation,
      seated: boarding ? blend : 1 - blend,
      handsOnControls: entry.handsOnControls,
    });
  }
}
