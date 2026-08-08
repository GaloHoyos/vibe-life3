import type RAPIER from "@dimforge/rapier3d-compat";
import { Vector3 } from "three";
import type { ControllablePositionalSound } from "@engine/audio/core/PositionalSoundManager";
import type { PositionalSoundManager } from "@engine/audio/core/PositionalSoundManager";
import type { SoundManager } from "@engine/audio/core/SoundManager";
import type { PhysicsWorld } from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import type { Disposable } from "@shared/types/lifecycle";
import type { SurfaceType } from "@shared/types/Surface";
import {
  PropMaterialAudio,
  PropScrapeConfig,
  PropStrainConfig,
  RoughScrapeSurfaces,
  SurfaceImpactMaterial,
} from "@game/config/audio.config";
import { pickSound } from "./SoundPool";

interface ScrapeVoice {
  readonly sound: ControllablePositionalSound;
  readonly soundId: string;
  /** Segundos que la condición viene sin cumplirse. */
  idleFor: number;
  /** Cuándo toca volver a mirar contra qué superficie roza. */
  nextProbeAt: number;
  rough: boolean;
}

interface Candidate {
  readonly body: RAPIER.RigidBody;
  readonly surface: SurfaceType;
  readonly speed: number;
  readonly score: number;
}

const tmpPosition = new Vector3();
const tmpDown = new Vector3(0, -1, 0);

/**
 * Arrastre y tensión de los props.
 *
 * Un cajón empujado por el piso no "choca": roza. Eso no lo puede describir la
 * heurística de frenada que alimenta los impactos, hace falta la energía
 * tangencial del contacto — y esa sí se puede consultar, porque
 * `world.contactPairsWith` es una consulta de narrow-phase y no la cola de
 * eventos de un solo lector que ya consume el sistema de vehículos.
 *
 * El costo se acota por presupuesto: se filtra barato por velocidad, se ordena
 * por cuánto puede oírse, y recién a los mejores candidatos se les pregunta el
 * impulso real.
 */
export class PropScrapeSystem implements Disposable {
  private readonly voices = new Map<number, ScrapeVoice>();
  private readonly strainCooldowns = new Map<string, number>();

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly raycast: Raycast,
    private readonly sounds: SoundManager,
    private readonly positional: PositionalSoundManager,
  ) {}

  update(delta: number, elapsed: number, listener: Vector3): void {
    const candidates = this.collectCandidates(listener);
    const chosen = new Set<number>();

    for (const candidate of candidates.slice(0, PropScrapeConfig.maxVoices)) {
      const impulse = this.tangentialImpulse(candidate.body);
      // `NaN > 0` es false, así que esto también descarta el impulso corrupto.
      if (!(impulse > 0)) continue;
      chosen.add(candidate.body.handle);
      this.driveVoice(candidate, impulse, elapsed);
    }

    // Histéresis: una voz no se corta al primer frame que falla, o el arrastre
    // se entrecorta como una ametralladora cada vez que el prop rebota.
    for (const [handle, voice] of [...this.voices]) {
      if (chosen.has(handle)) continue;
      voice.idleFor += delta;
      voice.sound.setVolume(0);
      if (voice.idleFor >= PropScrapeConfig.releaseDelay) this.releaseVoice(handle);
    }
  }

  /** Crujido de un prop bajo carga. Lo dispara quien detecta la tensión. */
  strain(propId: string, surface: SurfaceType, position: Vector3, elapsed: number): void {
    const until = this.strainCooldowns.get(propId);
    if (until !== undefined && elapsed < until) return;
    const audio = PropMaterialAudio[SurfaceImpactMaterial[surface]];
    const soundId = pickSound(this.sounds, audio.strain);
    if (!soundId) return;
    this.strainCooldowns.set(propId, elapsed + PropStrainConfig.cooldown);
    this.positional.playAt(soundId, position.clone(), {
      bus: "world",
      refDistance: PropScrapeConfig.refDistance,
      maxDistance: PropScrapeConfig.maxDistance,
      playbackRate: 0.94 + Math.random() * 0.12,
    });
  }

  private collectCandidates(listener: Vector3): Candidate[] {
    const candidates: Candidate[] = [];
    for (const body of this.physics.getBodiesByKind("prop")) {
      if (!body.isValid() || !body.isDynamic() || body.isSleeping()) continue;
      if (this.physics.isHeldBody(body.handle)) continue;
      const velocity = body.linvel();
      const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
      if (speed < PropScrapeConfig.minSpeed || speed > PropScrapeConfig.maxSpeed) continue;
      if (Math.abs(velocity.y) > PropScrapeConfig.maxVerticalSpeed) continue;

      const metadata = this.physics.getBodyMetadata(body);
      if (!metadata?.surface) continue;
      const translation = body.translation();
      const distance = Math.max(
        1,
        tmpPosition.set(translation.x, translation.y, translation.z).distanceTo(listener),
      );
      candidates.push({ body, surface: metadata.surface, speed, score: speed / distance });
    }
    // Lo más rápido y más cerca primero: es lo que el jugador puede oír.
    return candidates.sort((a, b) => b.score - a.score);
  }

  /**
   * Energía tangencial del contacto, que es literalmente lo que produce el
   * sonido de raspado. Es una consulta de narrow-phase, así que sólo vale
   * después de `world.step()`.
   */
  private tangentialImpulse(body: RAPIER.RigidBody): number {
    if (body.numColliders() === 0) return 0;
    const collider = body.collider(0);
    let total = 0;
    this.physics.world.contactPairsWith(collider, (other) => {
      this.physics.world.contactPair(collider, other, (manifold) => {
        for (let index = 0; index < manifold.numContacts(); index += 1) {
          // El manifold puede traer contactos que el solver todavía no resolvió,
          // y su impulso llega sin inicializar. Se descarta el contacto, no el
          // manifold entero: los demás sí describen el roce.
          const magnitude = Math.hypot(
            manifold.contactTangentImpulseX(index),
            manifold.contactTangentImpulseY(index),
          );
          if (Number.isFinite(magnitude)) total += magnitude;
        }
      });
    });
    return total;
  }

  private driveVoice(candidate: Candidate, impulse: number, elapsed: number): void {
    const handle = candidate.body.handle;
    let voice = this.voices.get(handle);
    const rough = voice?.rough ?? this.probeSurface(candidate.body);

    if (voice && (voice.nextProbeAt <= elapsed || voice.rough !== rough)) {
      const probed = this.probeSurface(candidate.body);
      voice.nextProbeAt = elapsed + PropScrapeConfig.surfaceProbeInterval;
      // Cambiar de hormigón a chapa cambia el clip, así que se rearma la voz.
      if (probed !== voice.rough) {
        this.releaseVoice(handle);
        voice = undefined;
      }
    }

    if (!voice) {
      const created = this.startVoice(candidate, rough, elapsed);
      if (!created) return;
      voice = created;
    }

    voice.idleFor = 0;
    voice.sound.setVolume(Math.min(1, impulse / PropScrapeConfig.fullScrapeImpulse));
    voice.sound.setPlaybackRate(0.85 + candidate.speed * 0.05);
  }

  private startVoice(
    candidate: Candidate,
    rough: boolean,
    elapsed: number,
  ): ScrapeVoice | null {
    const audio = PropMaterialAudio[SurfaceImpactMaterial[candidate.surface]];
    const soundId = pickSound(this.sounds, rough ? audio.scrapeRough : audio.scrapeSmooth);
    if (!soundId) return null;
    const mesh = this.physics.getBoundMesh(candidate.body);
    if (!mesh) return null;

    const sound = this.positional.attachControllable(soundId, mesh, {
      bus: "world",
      loop: true,
      volume: 0,
      refDistance: PropScrapeConfig.refDistance,
      maxDistance: PropScrapeConfig.maxDistance,
      rolloffFactor: 1.2,
    });
    const voice: ScrapeVoice = {
      sound,
      soundId,
      idleFor: 0,
      nextProbeAt: elapsed + PropScrapeConfig.surfaceProbeInterval,
      rough,
    };
    this.voices.set(candidate.body.handle, voice);
    return voice;
  }

  /** Un rayo hacia abajo dice sobre qué está rozando. */
  private probeSurface(body: RAPIER.RigidBody): boolean {
    const translation = body.translation();
    tmpPosition.set(translation.x, translation.y, translation.z);
    const hit = this.raycast.cast(tmpPosition, tmpDown, 2, body);
    const surface = hit?.metadata?.surface;
    return surface ? RoughScrapeSurfaces.has(surface) : true;
  }

  private releaseVoice(handle: number): void {
    const voice = this.voices.get(handle);
    if (!voice) return;
    voice.sound.dispose();
    this.voices.delete(handle);
  }

  /** Transición de nivel: las voces apuntan a mallas del mundo viejo. */
  clear(): void {
    for (const handle of [...this.voices.keys()]) this.releaseVoice(handle);
    this.strainCooldowns.clear();
  }

  dispose(): void {
    this.clear();
  }
}
