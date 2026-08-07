import type RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import type { GameEventBus } from "@game/GameEvents";
import { PropImpactConfig } from "@game/config/gameplay.config";

interface LaunchAttribution {
  sourceId: string;
  weaponName: string;
  expiresAt: number;
}

/**
 * Daño por impacto físico de props contra NPCs, global. Cada frame, todo
 * cuerpo `kind: 'prop'` o `kind: 'dynamic'` sobre el umbral de velocidad
 * castea un rayo corto en su dirección de vuelo; si pega a un NPC (cápsula o
 * hitbox de parte) le aplica daño escalado por velocidad y masa.
 *
 * La atribución es opcional: los props lanzados por el jugador (punt/throw de
 * la gravity gun, empuje del carry) conservan `sourceId: "player"` unos
 * segundos vía `registerLaunch`; el resto daña como entorno (sin atacante).
 * El handle del cuerpo persiste a través de los teleports de portal, así que
 * un prop que sale disparado por un portal sigue siendo letal y atribuido.
 */
export class PropImpactSystem {
  private readonly attributions = new Map<number, LaunchAttribution>();
  private readonly hitCooldowns = new Map<number, number>();
  private readonly tmpDirection = new Vector3();
  private readonly tmpOrigin = new Vector3();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly raycast: Raycast,
    private readonly eventBus: GameEventBus,
  ) {}

  registerLaunch(
    body: RAPIER.RigidBody,
    sourceId: string,
    weaponName: string,
    now: number,
  ): void {
    this.attributions.set(body.handle, {
      sourceId,
      weaponName,
      expiresAt: now + PropImpactConfig.attributionDuration,
    });
  }

  update(delta: number, elapsed: number): void {
    for (const [handle, attribution] of this.attributions) {
      if (elapsed > attribution.expiresAt) {
        this.attributions.delete(handle);
      }
    }
    for (const [handle, until] of this.hitCooldowns) {
      if (elapsed > until) {
        this.hitCooldowns.delete(handle);
      }
    }

    // El índice devuelve una copia, así que es seguro que un impacto derive en
    // crear o quitar cuerpos; hacerlo dentro de `world.bodies.forEach`
    // corrompería el iterador WASM de Rapier.
    const candidates = [
      ...this.physics.getBodiesByKind("prop"),
      ...this.physics.getBodiesByKind("dynamic"),
    ];
    for (const body of candidates) {
      if (!body.isValid() || !body.isDynamic() || !body.isEnabled()) continue;
      // Un prop sostenido persigue al target a velocidad de shadow hold; no
      // debe moler a un NPC solo por apretarlo contra él.
      if (this.physics.isHeldBody(body.handle)) continue;
      if (this.hitCooldowns.has(body.handle)) continue;

      const metadata = this.physics.getBodyMetadata(body);
      if (!metadata || metadata.propImpactExcluded) continue;

      const v = body.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed < PropImpactConfig.minDangerousSpeed) continue;

      this.tmpDirection.set(v.x / speed, v.y / speed, v.z / speed);
      const pos = body.translation();
      this.tmpOrigin.set(pos.x, pos.y, pos.z);
      // Sin excludeBody el rayo nace dentro del propio collider (toi 0).
      const castDistance = Math.max(0.6, speed * delta * 2);
      const hit = this.raycast.cast(
        this.tmpOrigin,
        this.tmpDirection,
        castDistance,
        body,
      );
      if (!hit) continue;
      if (hit.metadata?.kind !== "npc" && hit.metadata?.kind !== "ragdoll") {
        continue;
      }
      // Fragmentos desprendidos de un actor pueden nacer rozando su cuerpo.
      // impactOwnerId evita que se conviertan en proyectiles contra su propio
      // dueño sin hacerlos pasar por otra hitbox de ese actor en LOS/raycasts.
      if (
        metadata.impactOwnerId !== undefined &&
        metadata.impactOwnerId === (hit.metadata.ownerId ?? hit.metadata.id)
      ) {
        continue;
      }

      const damageOverride = metadata.impactDamageOverride;
      const damage = damageOverride ?? this.computePhysicsDamage(
        speed,
        body.mass(),
        hit.metadata.bodyPart?.damageMultiplier ?? 1,
      );
      const attribution = this.attributions.get(body.handle);
      hit.metadata.damageable?.applyDamage(
        damage,
        this.tmpDirection.clone(),
        hit.metadata.bodyPart?.name,
        attribution?.sourceId,
        hit.point,
        // Un cajón que te aplasta no es una bala: sin esto el daño por impacto
        // entraba como 'bullet' y los multiplicadores por tipo mentían.
        "physics",
      );
      this.hitCooldowns.set(body.handle, elapsed + PropImpactConfig.hitCooldown);

      this.eventBus.emit("prop.impact", {
        targetId: hit.metadata.id,
        point: hit.point,
        normal: hit.normal,
        damage,
        sourceId: attribution?.sourceId,
      });
      // Compat con hitmarker/audio: solo los impactos del jugador cuentan
      // como "weapon.hit".
      if (attribution?.sourceId === "player") {
        this.eventBus.emit("weapon.hit", {
          weaponName: attribution.weaponName,
          targetId: hit.metadata.id,
          surfaceKind: hit.metadata.kind,
          point: hit.point,
          normal: hit.normal,
          damage,
          sourceId: "player",
          sourceKind: "player",
          sourceFaction: "player",
        });
      }
    }
  }

  private computePhysicsDamage(
    speed: number,
    mass: number,
    bodyPartMultiplier: number,
  ): number {
    const raw =
      speed * (1 + mass * PropImpactConfig.massWeight) * PropImpactConfig.speedFactor;
    return Math.min(
      PropImpactConfig.damageMax,
      Math.max(PropImpactConfig.damageMin, raw),
    ) * bodyPartMultiplier;
  }

  /** Transición de nivel: los handles del mundo viejo dejan de valer. */
  clear(): void {
    this.attributions.clear();
    this.hitCooldowns.clear();
  }
}
