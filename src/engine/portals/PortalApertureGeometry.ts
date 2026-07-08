export interface ApertureMesh {
  /** Local-space vertices (portal frame, z along the outward normal). */
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * "Arandela" física de un portal: un anillo plano y fino con un óvalo recortado
 * en el centro, coplanar con la superficie (z≈0, la cara de arriba mira al lado
 * frontal del portal). Es el AGUJERO REAL por el que los objetos se vuelcan: la
 * cara superior sostiene al objeto alrededor del hueco, y la pared interior es
 * el borde sobre el que pivotea al caer.
 *
 * Coordenadas locales del frame del portal: el hueco es el óvalo
 * `halfWidth × halfHeight`, el borde exterior un círculo de `radius`, y el
 * espesor `thickness` se hunde hacia -z (dentro de la superficie), así el
 * objeto sólo toca la cara de arriba (z=0) y el borde del hueco.
 */
export function createPortalApertureMesh(
  halfWidth: number,
  halfHeight: number,
  radius: number,
  thickness: number,
  segments = 32,
): ApertureMesh {
  const positions: number[] = [];
  const indices: number[] = [];

  const push = (x: number, y: number, z: number): number => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };

  const innerTop: number[] = [];
  const innerBot: number[] = [];
  const outerTop: number[] = [];
  const outerBot: number[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    innerTop.push(push(halfWidth * c, halfHeight * s, 0));
    innerBot.push(push(halfWidth * c, halfHeight * s, -thickness));
    outerTop.push(push(radius * c, radius * s, 0));
    outerBot.push(push(radius * c, radius * s, -thickness));
  }

  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    // Top annulus (faces +z, the surface objects rest on).
    indices.push(innerTop[i], outerTop[i], outerTop[j]);
    indices.push(innerTop[i], outerTop[j], innerTop[j]);
    // Bottom annulus (reverse winding).
    indices.push(innerBot[i], outerBot[j], outerBot[i]);
    indices.push(innerBot[i], innerBot[j], outerBot[j]);
    // Inner wall: the hole edge the object pivots over.
    indices.push(innerTop[i], innerBot[i], innerBot[j]);
    indices.push(innerTop[i], innerBot[j], innerTop[j]);
    // Outer wall (closes the ring; sits below the surface).
    indices.push(outerTop[i], outerBot[j], outerBot[i]);
    indices.push(outerTop[i], outerTop[j], outerBot[j]);
  }

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}
