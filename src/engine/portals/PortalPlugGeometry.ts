import { BufferAttribute, BufferGeometry } from "three";

/**
 * Superficie de portal como "tapón" extruido en vez de disco plano: tapa
 * frontal en z=0, tubo lateral y tapa trasera en z=-1 (se escala en Z a la
 * profundidad deseada, hundida en la pared). Técnica de Portal/Lague: cuando
 * la cámara cruza el plano, el near plane rebana la tapa frontal y la pared,
 * pero el interior del tapón (double-sided, muestreo screen-space) sigue
 * cubriendo la vista con la imagen del otro lado — sin "blink" ni ver el
 * interior de la pared.
 *
 * UVs: las tapas mapean el círculo unitario a [0,1]² como `CircleGeometry`;
 * el tubo hereda el UV del borde (r≈1), así el shader le aplica el rim glow.
 */
export function createPortalPlugGeometry(segments = 48): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushVertex = (x: number, y: number, z: number): number => {
    positions.push(x, y, z);
    uvs.push(x * 0.5 + 0.5, y * 0.5 + 0.5);
    return positions.length / 3 - 1;
  };

  const frontCenter = pushVertex(0, 0, 0);
  const backCenter = pushVertex(0, 0, -1);
  const frontRing: number[] = [];
  const backRing: number[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    frontRing.push(pushVertex(x, y, 0));
    backRing.push(pushVertex(x, y, -1));
  }

  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    indices.push(frontCenter, frontRing[i], frontRing[next]);
    indices.push(backCenter, backRing[next], backRing[i]);
    indices.push(frontRing[i], backRing[i], backRing[next]);
    indices.push(frontRing[i], backRing[next], frontRing[next]);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  return geometry;
}
