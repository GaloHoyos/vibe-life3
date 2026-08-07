import { Quaternion, Vector3 } from "three";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { VfxSystem } from "@engine/render/effects/VfxSystem";
import type { Disposable } from "@shared/types/lifecycle";
import {
  PropBreakAudioConfig,
  PropMaterialAudio,
  SurfaceImpactMaterial,
} from "@game/config/audio.config";
import type { GameEventBus } from "@game/GameEvents";
import { pickSound } from "@game/audio/SoundPool";
import type { GrenadeSystem } from "@game/gameplay/weapons/grenade/GrenadeSystem";
import type { PropInstance } from "./PropInstance";
import type { PropSystem } from "./PropSystem";
import type { PropContactMonitor } from "./PropContactMonitor";
import type { DebrisPool } from "./DebrisPool";
import { impactDamageToProp, propBoundsForScale } from "./propDamage";
import { propBreakSparks, propDustColor } from "./propMaterials";

interface DelayedSound {
  readonly soundId: string;
  readonly position: Vector3;
  readonly at: number;
}

const tmpPosition = new Vector3();
const tmpRotation = new Quaternion();
const tmpVelocity = new Vector3();

/**
 * Resuelve la muerte de un prop: el estallido, los pedazos y lo que la rotura
 * desencadena (una explosión, una estructura que se suelta).
 *
 * Las roturas se difieren a este `update`: un prop que agota su vida marca
 * `pendingBreak` y recién acá se resuelve. Romper in-line, mientras una
 * explosión todavía está recorriendo sus damageables, sería re-entrante — y es
 * exactamente lo que hace que una cadena de barriles se vea escalonada en vez
 * de estallar entera en un frame.
 */
export class PropBreakSystem implements Disposable {
  private readonly delayedSounds: DelayedSound[] = [];
  private breakCounter = 0;

  constructor(
    private readonly props: PropSystem,
    private readonly contacts: PropContactMonitor,
    private readonly debris: DebrisPool,
    private readonly grenades: GrenadeSystem,
    private readonly sounds: SoundManager,
    private readonly positional: PositionalSoundManager,
    private readonly vfx: VfxSystem,
    private readonly eventBus: GameEventBus,
  ) {}

  update(delta: number, elapsed: number, playerPosition: Vector3): void {
    this.applyContactDamage();
    this.resolvePendingBreaks(elapsed);
    this.flushDelayedSounds(elapsed);
    this.debris.update(delta, playerPosition);
  }

  /** Un prop que se estrella fuerte se daña a sí mismo. */
  private applyContactDamage(): void {
    for (const contact of this.contacts.contacts()) {
      const prop = this.props.get(contact.metadata.id);
      if (!prop?.isAlive() || !prop.destructible) continue;

      const damage = impactDamageToProp(prop.archetype, contact.speed);
      if (damage <= 0) continue;
      prop.applyDamage(
        damage,
        undefined,
        undefined,
        prop.lastAttackerId,
        contact.position,
        "physics",
      );
    }
  }

  private resolvePendingBreaks(elapsed: number): void {
    // Snapshot: sólo se rompe lo marcado al comenzar el frame. Lo que esta
    // tanda encadene queda pendiente para el siguiente.
    const breaking = this.props.all().filter((prop) => prop.pendingBreak);
    for (const prop of breaking) this.breakProp(prop, elapsed);
  }

  private breakProp(prop: PropInstance, elapsed: number): void {
    const body = prop.getBody();
    const archetype = prop.archetype;
    // Todo el estado se lee ANTES de soltar el cuerpo: después no existe.
    prop.position(tmpPosition);
    if (body) {
      const rotation = body.rotation();
      tmpRotation.set(rotation.x, rotation.y, rotation.z, rotation.w);
      const velocity = body.linvel();
      tmpVelocity.set(velocity.x, velocity.y, velocity.z);
    } else {
      tmpRotation.identity();
      tmpVelocity.set(0, 0, 0);
    }
    const position = tmpPosition.clone();
    const bounds = propBoundsForScale(archetype, prop.scale);
    const mass = body?.mass() ?? archetype.physics.mass;
    const attacker = prop.lastAttackerId;
    // Los fragmentos se leen ANTES de remover el prop: el lease muere con él.
    const chunks = this.props.chunksOf(prop.id);

    prop.pendingBreak = false;
    this.props.remove(prop);

    const debrisCount = archetype.gibs
      ? this.debris.spawn({
          count: randomChunkCount(archetype.gibs.minChunks, archetype.gibs.maxChunks),
          origin: position,
          rotation: tmpRotation.clone(),
          bounds,
          mass,
          surface: archetype.surface,
          inheritedVelocity: tmpVelocity.clone(),
          ...(prop.breakPoint ? { impactPoint: prop.breakPoint } : {}),
          burstSpeed: archetype.gibs.burstSpeed,
          seed: (this.breakCounter += 1),
          chunks,
          scale: prop.scale,
          coreSurvives: archetype.gibs.coreSurvives,
        })
      : 0;

    this.playBreakAudio(prop, position, elapsed);
    this.vfx.debrisBurst(position, {
      scale: Math.max(bounds[0], bounds[1], bounds[2]) * 0.6,
      color: propDustColor(archetype.surface),
      sparks: propBreakSparks(archetype.surface),
    });

    this.dispatchReaction(prop, position, attacker);

    this.eventBus.emit("prop.broken", {
      propId: prop.id,
      archetypeId: archetype.id,
      position: position.clone(),
      surface: archetype.surface,
      debrisCount,
      ...(attacker === undefined ? {} : { sourceId: attacker }),
    });
  }

  private dispatchReaction(
    prop: PropInstance,
    position: Vector3,
    attacker: string | undefined,
  ): void {
    const reaction = prop.breakReaction;
    switch (reaction.kind) {
      case "none":
      case "shatter":
        return;
      case "explode":
        // Después de soltar los pedazos: la onda los manda a volar con ella.
        this.grenades.detonate(position.clone(), {
          damage: reaction.damage,
          radius: reaction.radius,
          impulse: reaction.impulse,
          ownerKind: attacker === "player" ? "player" : "npc",
          ...(attacker === undefined ? {} : { sourceId: attacker }),
          weaponName: prop.archetype.id,
        });
        return;
      case "collapse":
        // Las juntas las suelta `PropStructureSystem`, que escucha `prop.broken`.
        return;
    }
  }

  private playBreakAudio(prop: PropInstance, position: Vector3, elapsed: number): void {
    const material = SurfaceImpactMaterial[prop.archetype.surface];
    const audio = PropMaterialAudio[material];

    const breakSound = pickSound(this.sounds, audio.break);
    if (breakSound) {
      this.positional.playAt(breakSound, position.clone(), {
        bus: "world",
        refDistance: PropBreakAudioConfig.refDistance,
        maxDistance: PropBreakAudioConfig.maxDistance,
        rolloffFactor: 1.1,
        playbackRate: 0.92 + Math.random() * 0.16,
      });
    }

    const debrisSound = pickSound(this.sounds, audio.debris);
    if (debrisSound) {
      this.delayedSounds.push({
        soundId: debrisSound,
        position: position.clone(),
        at: elapsed + PropBreakAudioConfig.debrisDelay,
      });
    }
  }

  private flushDelayedSounds(elapsed: number): void {
    for (let index = this.delayedSounds.length - 1; index >= 0; index -= 1) {
      const entry = this.delayedSounds[index]!;
      if (elapsed < entry.at) continue;
      this.delayedSounds.splice(index, 1);
      this.positional.playAt(entry.soundId, entry.position, {
        bus: "world",
        volume: 0.7,
        refDistance: PropBreakAudioConfig.refDistance,
        maxDistance: PropBreakAudioConfig.maxDistance,
        rolloffFactor: 1.2,
        playbackRate: 0.9 + Math.random() * 0.2,
      });
    }
  }

  /** Transición de nivel. Llamar ANTES de `PhysicsWorld.reset()`. */
  clear(): void {
    this.delayedSounds.length = 0;
    this.debris.clear();
  }

  dispose(): void {
    this.clear();
    this.debris.dispose();
  }
}

function randomChunkCount(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
