import type RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { PhysicsMetadata, PhysicsWorld } from "@engine/physics/PhysicsWorld";

export interface PropContact {
  readonly body: RAPIER.RigidBody;
  readonly metadata: PhysicsMetadata;
  /** Velocidad con la que venía justo antes de frenar, en m/s. */
  readonly speed: number;
  readonly position: Vector3;
}

export const PropContactTuning = {
  /** Por debajo de esto el prop se está acomodando, no chocando. */
  minSpeed: 2.2,
  /** Fracción de la velocidad que hay que perder en un frame para ser choque. */
  stopRatio: 0.45,
  /** Silencio por cuerpo tras un golpe: evita el zumbido del que rueda. */
  cooldown: 0.16,
} as const;

/**
 * Detecta choques de props por frenada y publica la lista del frame. Un cuerpo
 * que venía rápido y perdió de golpe la mayor parte de su velocidad acaba de
 * pegar contra algo.
 *
 * Existe como pieza aparte porque el mismo choque lo necesitan el audio y la
 * rotura: sin esto cada consumidor barría todos los cuerpos dinámicos por su
 * cuenta con su propia copia de los umbrales, que es como se desincronizan.
 *
 * Es una heurística, no contactos reales: la cola `CONTACT_FORCE_EVENTS` de
 * Rapier es de un solo lector y ya la consume el sistema de vehículos.
 */
export class PropContactMonitor {
  /** Velocidad del frame anterior por cuerpo, para medir la frenada. */
  private readonly lastSpeed = new Map<number, number>();
  private readonly cooldowns = new Map<number, number>();
  private readonly frameContacts: PropContact[] = [];

  constructor(private readonly physics: PhysicsWorld) {}

  update(elapsed: number): void {
    this.frameContacts.length = 0;
    const candidates = [
      ...this.physics.getBodiesByKind("prop"),
      ...this.physics.getBodiesByKind("dynamic"),
    ];

    for (const body of candidates) {
      if (!body.isValid()) continue;
      const handle = body.handle;
      if (!body.isDynamic() || !body.isEnabled()) {
        this.lastSpeed.delete(handle);
        continue;
      }
      // Un prop sostenido frena contra el jugador todo el tiempo.
      if (this.physics.isHeldBody(handle)) {
        this.lastSpeed.set(handle, 0);
        continue;
      }

      const velocity = body.linvel();
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      const previous = this.lastSpeed.get(handle) ?? speed;
      this.lastSpeed.set(handle, speed);

      if (previous < PropContactTuning.minSpeed) continue;
      if (previous - speed < previous * PropContactTuning.stopRatio) continue;

      const until = this.cooldowns.get(handle);
      if (until !== undefined && elapsed < until) continue;

      const metadata = this.physics.getBodyMetadata(body);
      if (!metadata) continue;
      // `propImpactExcluded` significa dos cosas distintas según quién lo pone.
      // En un cuerpo `dynamic` es el opt-out de un dueño que resuelve sus
      // propios choques (chasis de vehículo, granada viva, placa de blob). En un
      // prop del catálogo significa otra cosa —que no lastima NPCs al volar— y
      // ahí NO debe silenciar su propio choque: una botella no mata a nadie
      // pero se hace pedazos igual.
      if (metadata.kind !== "prop" && metadata.propImpactExcluded) continue;
      // El debris tiene su propia política de ruido: ocho astillas sonando a la
      // vez taparían el estallido que las produjo.
      if (metadata.propKind === "debris") continue;

      this.cooldowns.set(handle, elapsed + PropContactTuning.cooldown);
      const translation = body.translation();
      this.frameContacts.push({
        body,
        metadata,
        speed: previous,
        position: new Vector3(translation.x, translation.y, translation.z),
      });
    }
  }

  /** Choques detectados en el frame actual. Válido hasta el próximo `update`. */
  contacts(): readonly PropContact[] {
    return this.frameContacts;
  }

  /** Transición de nivel: los handles del mundo viejo dejan de valer. */
  clear(): void {
    this.lastSpeed.clear();
    this.cooldowns.clear();
    this.frameContacts.length = 0;
  }
}
