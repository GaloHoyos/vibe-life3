import type { PhysicsMetadata } from './PhysicsWorld';

type MetadataKind = PhysicsMetadata['kind'];

/**
 * El cuerpo es geometría sólida del mundo: piso, pared, puerta, prop o
 * cualquier otro cuerpo dinámico no-actor. Lo consultan los checks de "toqué
 * suelo", de línea de visión bloqueada y de impacto contra el entorno.
 *
 * Existe para que agregar un `kind` nuevo cueste una línea acá en vez de una
 * cadena de `||` en cada consumidor, que es como se desincronizaron antes.
 */
export function isSolidWorldKind(kind: MetadataKind | undefined): boolean {
  return kind === 'static' || kind === 'door' || kind === 'dynamic' || kind === 'prop';
}

/**
 * El cuerpo es un actor vivo o su cadáver: recibe daño por impacto de props y
 * cuenta como carne para el audio.
 */
export function isActorKind(kind: MetadataKind | undefined): boolean {
  return kind === 'npc' || kind === 'player' || kind === 'ragdoll';
}
