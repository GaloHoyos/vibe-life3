import type { Vector3 } from "three";

/**
 * Lo que el motor necesita saber del mundo para decidir acústica, expresado
 * como contrato estructural (mismo patrón que `RaycastSource`): `engine` no
 * puede importar `game`, y las habitaciones y vanos viven en
 * `game/levels/buildings`.
 *
 * Es una mejora **encima** de la sonda por rayos, no un requisito: los niveles
 * sin edificios registran un proveedor nulo y todo sigue funcionando.
 */

export interface AcousticSpace {
  readonly id: string;
  /** Volumen del recinto en m³. `Infinity` = exterior. */
  readonly volume: number;
}

export interface AcousticPortal {
  readonly position: Vector3;
  readonly width: number;
  readonly height: number;
  /** 0 = cerrado, 1 = vano libre. Lo saca del estado de la puerta. */
  readonly open: number;
}

export interface AcousticSpaceProvider {
  spaceAt(position: Vector3): AcousticSpace | null;
  /** Vano que comunica ambos puntos, si están en recintos distintos. */
  portalBetween(listener: Vector3, source: Vector3): AcousticPortal | null;
}

export const SpaceCoupling = {
  /** Mismo recinto: la fuente alimenta de lleno la reverb del oyente. */
  same: 1,
  /** A través de un vano abierto: llega parte del campo reverberante. */
  throughOpenPortal: 0.35,
  /** Con la puerta cerrada apenas se filtra. */
  throughClosedPortal: 0.08,
  /** Recintos sin conexión conocida. */
  disconnected: 0.05,
} as const;

/**
 * Cuánto de la fuente entra a la reverb del oyente. Se calcula por posición y
 * no por distancia: el campo reverberante de una sala es casi uniforme dentro
 * de ella, y lo que lo corta es la separación entre recintos.
 */
export function spaceCoupling(
  provider: AcousticSpaceProvider | null,
  listener: Vector3,
  source: Vector3,
): number {
  if (!provider) {
    return SpaceCoupling.same;
  }

  const listenerSpace = provider.spaceAt(listener);
  const sourceSpace = provider.spaceAt(source);
  if (listenerSpace?.id === sourceSpace?.id) {
    return SpaceCoupling.same;
  }

  const portal = provider.portalBetween(listener, source);
  if (!portal) {
    return SpaceCoupling.disconnected;
  }
  return lerp(
    SpaceCoupling.throughClosedPortal,
    SpaceCoupling.throughOpenPortal,
    clamp01(portal.open),
  );
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
