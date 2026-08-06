import { Vector3 } from "three";
import type { RaycastSource } from "@engine/physics/Raycast";
import type { SurfaceType } from "@shared/types/Surface";

/**
 * Estima la acústica del espacio donde está el oyente tirando rayos contra la
 * geometría real, al estilo del DSP automático de Source.
 *
 * Es la fuente primaria de reverb y no un extra: de los mapas del juego solo
 * cinco declaran edificios y dos de esos tienen la lista de habitaciones
 * vacía. Cualquier sistema que dependa de volúmenes autorados dejaría sin
 * reverb a casi todo el contenido, y a todos los mapas del Workshop.
 *
 * Los rayos son un patrón **fijo**: seis ejes (que dan las tres dimensiones de
 * la caja, y los niveles están hechos de cajas) más ocho diagonales para medir
 * apertura y materiales. Un patrón aleatorio haría titilar el estimador.
 */

export interface AcousticEstimate {
  /** Volumen aproximado del espacio, en m³. `Infinity` no existe acá: ver `openness`. */
  readonly volume: number;
  /** Absorción media de las superficies alcanzadas, 0..1. */
  readonly absorption: number;
  /** Fracción de rayos que se van sin tocar nada: 1 = a cielo abierto. */
  readonly openness: number;
  /** Distancia media al primer obstáculo, en metros. */
  readonly meanDistance: number;
  /**
   * Mayor de las tres dimensiones del recinto, en metros. El eco de golpeteo
   * (flutter) rebota entre las dos superficies más lejanas, así que su período
   * lo marca esto y no el promedio: un túnel angosto y largo repica, un cuarto
   * del mismo volumen no.
   */
  readonly longestExtent: number;
}

const axisDirections: readonly Vector3[] = [
  new Vector3(1, 0, 0),
  new Vector3(-1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, -1, 0),
  new Vector3(0, 0, 1),
  new Vector3(0, 0, -1),
];

const diagonalDirections: readonly Vector3[] = [
  new Vector3(1, 1, 1),
  new Vector3(1, 1, -1),
  new Vector3(1, -1, 1),
  new Vector3(1, -1, -1),
  new Vector3(-1, 1, 1),
  new Vector3(-1, 1, -1),
  new Vector3(-1, -1, 1),
  new Vector3(-1, -1, -1),
].map((direction) => direction.normalize());

export const ProbeTuning = {
  /** Más lejos que esto ya es "exterior" para lo que decide la reverb. */
  maxDistance: 40,
  /** Absorción cuando el rayo se va sin tocar nada: el cielo no devuelve. */
  openAbsorption: 1,
  defaultAbsorption: 0.25,
  /** Segundos para que el estimador alcance un cambio de espacio. */
  smoothingSeconds: 1.5,
  /** Ritmo del sondeo. Un espacio no cambia rápido; sondearlo por frame es tirar rayos. */
  intervalSeconds: 0.2,
} as const;

const origin = new Vector3();
const scratch = new Vector3();

export class AcousticProbe {
  private smoothed: AcousticEstimate | null = null;
  private elapsed = Number.POSITIVE_INFINITY;

  constructor(
    private readonly absorptionBySurface: Readonly<
      Partial<Record<SurfaceType, number>>
    >,
  ) {}

  /**
   * Avanza el reloj y sondea si toca. Devuelve la estimación suavizada, o
   * `null` mientras no haya ninguna todavía.
   */
  update(
    delta: number,
    raycast: RaycastSource | null,
    listener: Vector3,
  ): AcousticEstimate | null {
    this.elapsed += delta;
    if (!raycast || this.elapsed < ProbeTuning.intervalSeconds) {
      return this.smoothed;
    }
    // El paso del suavizado es el tiempo entre sondeos, no el del frame.
    const step = Math.min(this.elapsed, ProbeTuning.smoothingSeconds);
    this.elapsed = 0;

    const raw = this.sample(raycast, listener);
    this.smoothed = this.smoothed ? blend(this.smoothed, raw, step) : raw;
    return this.smoothed;
  }

  reset(): void {
    this.smoothed = null;
    this.elapsed = Number.POSITIVE_INFINITY;
  }

  /** Un sondeo completo, sin suavizar. Expuesto para tests y debug. */
  sample(raycast: RaycastSource, listener: Vector3): AcousticEstimate {
    origin.copy(listener);

    const axisDistances: number[] = [];
    let absorptionSum = 0;
    let distanceSum = 0;
    let openRays = 0;
    let rays = 0;

    const cast = (direction: Vector3): number => {
      rays += 1;
      const hit = raycast.cast(
        origin,
        scratch.copy(direction),
        ProbeTuning.maxDistance,
        undefined,
        undefined,
        (metadata) => metadata?.kind === "static" || metadata?.kind === "door",
      );
      if (!hit) {
        openRays += 1;
        absorptionSum += ProbeTuning.openAbsorption;
        distanceSum += ProbeTuning.maxDistance;
        return ProbeTuning.maxDistance;
      }
      absorptionSum += this.absorptionOf(hit.metadata?.surface);
      distanceSum += hit.toi;
      return hit.toi;
    };

    for (const direction of axisDirections) {
      axisDistances.push(cast(direction));
    }
    for (const direction of diagonalDirections) {
      cast(direction);
    }

    // Los niveles son cajas: sumar los pares opuestos da las tres dimensiones
    // del recinto directamente, sin aproximar por esfera.
    const width = (axisDistances[0] ?? 0) + (axisDistances[1] ?? 0);
    const height = (axisDistances[2] ?? 0) + (axisDistances[3] ?? 0);
    const depth = (axisDistances[4] ?? 0) + (axisDistances[5] ?? 0);

    return {
      volume: Math.max(1, width * height * depth),
      absorption: absorptionSum / rays,
      openness: openRays / rays,
      meanDistance: distanceSum / rays,
      longestExtent: Math.max(width, height, depth),
    };
  }

  private absorptionOf(surface: SurfaceType | undefined): number {
    if (!surface) {
      return ProbeTuning.defaultAbsorption;
    }
    return this.absorptionBySurface[surface] ?? ProbeTuning.defaultAbsorption;
  }
}

/**
 * Suavizado exponencial. El volumen se interpola en logaritmo porque va de
 * decenas a cientos de miles de m³ al salir de un cuarto: en lineal el salto
 * sería instantáneo hacia arriba y eterno hacia abajo.
 */
function blend(
  previous: AcousticEstimate,
  next: AcousticEstimate,
  delta: number,
): AcousticEstimate {
  const t = 1 - Math.exp(-delta / ProbeTuning.smoothingSeconds);
  return {
    volume: Math.exp(
      lerp(Math.log(previous.volume), Math.log(next.volume), t),
    ),
    absorption: lerp(previous.absorption, next.absorption, t),
    openness: lerp(previous.openness, next.openness, t),
    meanDistance: lerp(previous.meanDistance, next.meanDistance, t),
    longestExtent: lerp(previous.longestExtent, next.longestExtent, t),
  };
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
