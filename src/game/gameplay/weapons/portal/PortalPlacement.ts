import type RAPIER from "@dimforge/rapier3d-compat";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { PhysicsMetadata } from "@engine/physics/PhysicsWorld";
import type { Raycast } from "@engine/physics/Raycast";
import type { PortalFrame } from "@engine/portals/PortalFrame";
import { PortalConfig } from "@game/config/portal.config";

export interface PortalPlacementOptions {
  range: number;
  halfWidth: number;
  halfHeight: number;
  /** Player planar forward; orients the "up" of floor/ceiling portals. */
  planarForward: Vector3;
  /**
   * Shooter collider id to exclude. The placement ray starts at the eye,
   * INSIDE the shooter's capsule: without this the solid raycast returns the
   * capsule itself at toi 0 and every placement fails.
   */
  excludeId?: string;
  /** The paired portal (if any); the placement bumps to avoid overlapping it. */
  sibling?: PortalFrame;
}

export interface PortalPlacementResult {
  frame: PortalFrame;
  /**
   * Static colliders backing the portal footprint (surface hit + fit probes).
   * Traversal excludes them from the character controller while transiting.
   */
  backingColliders: RAPIER.Collider[];
}

/**
 * Revalida un frame persistido contra la colisión del mundo reconstruido.
 * Devuelve los colliders actuales, cuyos handles pueden cambiar entre cargas.
 */
export function resolvePortalBackingColliders(
  raycast: Raycast,
  frame: PortalFrame,
  excludeId?: string,
): RAPIER.Collider[] | null {
  const normal = new Vector3(0, 0, 1)
    .applyQuaternion(frame.quaternion)
    .normalize();
  return probeFootprint(raycast, frame, normal, excludeId);
}

const WORLD_UP = new Vector3(0, 1, 0);
const WORLD_X = new Vector3(1, 0, 0);

/** El disparo de portales sólo pega en geometría estática (atraviesa props). */
const STATIC_ONLY = (metadata: PhysicsMetadata | undefined): boolean =>
  metadata?.kind === "static";

/**
 * Resuelve un disparo de portal como en Portal: la traza pasa por props/
 * entidades y pega en la superficie estática; después el óvalo se "bumpea"
 * (desliza sobre la superficie) para caber junto a bordes y al portal par,
 * dentro de una distancia máxima. Devuelve null si no cabe en ningún lado.
 */
export function computePortalPlacement(
  raycast: Raycast,
  origin: Vector3,
  direction: Vector3,
  options: PortalPlacementOptions,
): PortalPlacementResult | null {
  const hit = raycast.cast(
    origin,
    direction,
    options.range,
    undefined,
    options.excludeId,
    STATIC_ONLY,
  );
  if (!hit || !hit.normal) {
    return null;
  }

  const normal = hit.normal.clone().normalize();
  const up = computePortalUp(normal, options.planarForward);
  const right = new Vector3().crossVectors(up, normal).normalize();
  const quaternion = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(right, up, normal),
  );

  // Máxima distancia de bump = √((W² + H²) / 2) (fórmula de Portal), con W/H el
  // ancho/alto completos del óvalo.
  const fullW = options.halfWidth * 2;
  const fullH = options.halfHeight * 2;
  const maxBump = Math.sqrt((fullW * fullW + fullH * fullH) / 2);

  const center = new Vector3();
  for (const [offsetX, offsetY] of bumpOffsets(maxBump)) {
    center
      .copy(hit.point)
      .addScaledVector(right, offsetX)
      .addScaledVector(up, offsetY);
    const frame: PortalFrame = {
      position: center.clone(),
      quaternion,
      halfWidth: options.halfWidth,
      halfHeight: options.halfHeight,
    };
    if (options.sibling && portalsOverlap(frame, options.sibling)) {
      continue;
    }
    const backing = probeFootprint(raycast, frame, normal, options.excludeId);
    if (backing) {
      return { frame, backingColliders: backing };
    }
  }
  return null;
}

/**
 * Offsets in-plane ordenados por distancia (el punto exacto primero, luego
 * anillos crecientes): el primer candidato válido es el más cercano a donde se
 * apuntó, así el bump respeta la intención del jugador.
 */
function* bumpOffsets(maxBump: number): Generator<[number, number]> {
  yield [0, 0];
  const step = PortalConfig.placement.bumpStep;
  const samples = PortalConfig.placement.bumpAngularSamples;
  for (let radius = step; radius <= maxBump + 1e-6; radius += step) {
    for (let s = 0; s < samples; s++) {
      const angle = (s / samples) * Math.PI * 2;
      yield [Math.cos(angle) * radius, Math.sin(angle) * radius];
    }
  }
}

function computePortalUp(normal: Vector3, planarForward: Vector3): Vector3 {
  if (Math.abs(normal.y) < PortalConfig.placement.wallNormalYMax) {
    return WORLD_UP.clone().addScaledVector(normal, -normal.y).normalize();
  }
  const up = planarForward
    .clone()
    .addScaledVector(normal, -planarForward.dot(normal));
  if (up.lengthSq() < 1e-6) {
    up.copy(WORLD_X).addScaledVector(normal, -normal.x);
  }
  return up.normalize();
}

/**
 * Valida que el centro y las 8 esquinas del óvalo caigan en geometría estática
 * coplanar (probes cortos hacia la superficie). Devuelve los colliders de
 * respaldo, o null si algún punto falla (borde/hueco/superficie no válida).
 */
function probeFootprint(
  raycast: Raycast,
  frame: PortalFrame,
  normal: Vector3,
  excludeId?: string,
): RAPIER.Collider[] | null {
  const cfg = PortalConfig.placement;
  const colliders: RAPIER.Collider[] = [];
  const probeDirection = normal.clone().negate();
  const local = new Vector3();
  const probeOrigin = new Vector3();

  const points: Array<[number, number]> = [[0, 0]];
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    points.push([
      frame.halfWidth * Math.cos(angle),
      frame.halfHeight * Math.sin(angle),
    ]);
  }

  for (const [localX, localY] of points) {
    local.set(localX, localY, 0);
    probeOrigin
      .copy(local)
      .applyQuaternion(frame.quaternion)
      .add(frame.position)
      .addScaledVector(normal, cfg.probeLift);

    const probe = raycast.cast(
      probeOrigin,
      probeDirection,
      cfg.probeMaxDistance,
      undefined,
      excludeId,
      STATIC_ONLY,
    );
    if (
      !probe ||
      probe.toi < cfg.probeToiMin ||
      probe.toi > cfg.probeToiMax ||
      !probe.normal ||
      probe.normal.dot(normal) < cfg.normalAlignMin
    ) {
      return null;
    }
    if (!colliders.some((c) => c.handle === probe.collider.handle)) {
      colliders.push(probe.collider);
    }
  }
  return colliders;
}

/**
 * True cuando dos portales coplanares (misma orientación) quedan demasiado
 * cerca. Regla de Source (CProp_Portal::IsPortalOverlappingOtherPortals): las
 * proyecciones del offset sobre right/up se comparan contra el ancho/alto
 * COMPLETOS más un padding chico (1 unidad en Source); el par debe quedar
 * libre en al menos un eje. Es más estricta que un test de elipse: Portal
 * nunca deja dos óvalos en contacto diagonal apretado.
 */
export function portalsOverlap(a: PortalFrame, b: PortalFrame): boolean {
  const normalA = new Vector3(0, 0, 1).applyQuaternion(a.quaternion);
  const normalB = new Vector3(0, 0, 1).applyQuaternion(b.quaternion);
  if (normalA.dot(normalB) < 0.9) {
    return false;
  }
  const offset = new Vector3().subVectors(b.position, a.position);
  if (Math.abs(offset.dot(normalA)) > 0.1) {
    return false;
  }
  const local = offset.applyQuaternion(a.quaternion.clone().invert());
  const pad = PortalConfig.placement.siblingSeparationPad;
  return (
    Math.abs(local.x) < a.halfWidth + b.halfWidth + pad &&
    Math.abs(local.y) < a.halfHeight + b.halfHeight + pad
  );
}
