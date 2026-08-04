import {
  Material,
  Mesh,
  MeshDepthMaterial,
  RGBADepthPacking,
  type IUniform,
  type WebGLProgramParametersWithUniforms,
} from "three";
import type { Disposable } from "@shared/types/lifecycle";

/**
 * Ondulación de piel por vértice: deforma una malla en espacio de objeto con
 * una ola viajera más una hinchazón respiratoria.
 *
 * Existe porque una criatura no se articula del todo con nodos. Un ala partida
 * en segmentos que rotan muestra la junta en cada quiebre, y el disco de una
 * manta es justo la superficie que no tolera juntas: la ondulación tiene que
 * recorrer una piel continua. Deformar en el vertex shader no cuesta draws ni
 * rompe el batching, y deja la geometría intacta para colisión y LOD.
 *
 * La ola viaja desde el eje hacia la punta (`spanWave`) y desde el borde de
 * ataque hacia el de fuga (`chordWave`); las dos juntas son lo que separa un
 * batido de ala de un pistón subiendo y bajando.
 */
export interface OrganicWaveSettings {
  /** Amplitud del batido en la punta, en metros. */
  flap: number;
  /** Número de onda transversal (eje X), en rad/m. */
  spanWave: number;
  /** Número de onda longitudinal (eje Z), en rad/m. */
  chordWave: number;
  /** Semiancho donde el batido arranca, en metros. */
  spanRoot: number;
  /** Semiancho donde el batido llega al máximo, en metros. */
  spanTip: number;
  /** Hinchazón respiratoria del torso, como fracción de su media altura. */
  breath: number;
  /** Centro del cuerpo en espacio de objeto: de ahí se hincha la respiración. */
  pivotY: number;
}

export interface OrganicWave extends Disposable {
  /** Avanza la fase de la ola, en radianes. */
  setPhase(phase: number): void;
  apply(settings: Readonly<OrganicWaveSettings>): void;
}

const DECLARATIONS = /* glsl */ `
uniform float uOrganicPhase;
uniform float uOrganicFlap;
uniform vec2 uOrganicWave;
uniform vec2 uOrganicSpan;
uniform float uOrganicBreath;
uniform float uOrganicPivotY;

float organicReach(float span) {
  float t = clamp(
    (span - uOrganicSpan.x) / max(1e-4, uOrganicSpan.y - uOrganicSpan.x),
    0.0,
    1.0
  );
  return t * t * (3.0 - 2.0 * t);
}

vec3 organicOffset(vec3 p) {
  float span = abs(p.x);
  float reach = organicReach(span);
  float theta = uOrganicPhase - span * uOrganicWave.x + p.z * uOrganicWave.y;
  float lift = uOrganicFlap * reach * sin(theta);
  // El torso respira y el ala no: si la hinchazón llegara a las puntas, el
  // bicho se infla como un globo en vez de tomar aire.
  float torso = 1.0 - reach;
  vec3 swell = uOrganicBreath * torso *
    vec3(p.x * 0.35, p.y - uOrganicPivotY, 0.0);
  return vec3(0.0, lift, 0.0) + swell;
}

/** Pendiente del batido en (x, z); alcanza para inclinar la normal. */
vec2 organicSlope(vec3 p) {
  float span = abs(p.x);
  float width = max(1e-4, uOrganicSpan.y - uOrganicSpan.x);
  float t = clamp((span - uOrganicSpan.x) / width, 0.0, 1.0);
  float reach = t * t * (3.0 - 2.0 * t);
  float dReach = 6.0 * t * (1.0 - t) / width * sign(p.x);
  float theta = uOrganicPhase - span * uOrganicWave.x + p.z * uOrganicWave.y;
  float s = sin(theta);
  float c = cos(theta);
  return uOrganicFlap * vec2(
    dReach * s - reach * c * uOrganicWave.x * sign(p.x),
    reach * c * uOrganicWave.y
  );
}
`;

const NORMAL_INJECTION = /* glsl */ `
{
  vec2 organicTilt = organicSlope(position);
  objectNormal = normalize(
    objectNormal - vec3(organicTilt.x, 0.0, organicTilt.y) * objectNormal.y
  );
}
`;

const POSITION_INJECTION = /* glsl */ `
transformed += organicOffset(position);
`;

/**
 * Aplica la ondulación a las mallas indicadas.
 *
 * Recibe mallas y no un subárbol porque la deformación se calcula sobre la
 * posición LOCAL del vértice: una malla cuya geometría esté centrada en su
 * propio nodo —un remo, una antena— cae entera por debajo de `spanRoot` y no
 * ondularía, pero sí se la llevaría la hinchazón respiratoria, que la mediría
 * contra un pivote que no es el suyo. Sólo la piel está autorada en espacio de
 * vehículo, así que sólo la piel entra acá.
 *
 * Parchea también el material de profundidad, porque el mapa de sombras usa su
 * propio shader: sin eso el bicho batiría las alas y su sombra en el piso
 * seguiría quieta, que es la clase de detalle que delata que nada de esto es
 * real.
 */
export function applyOrganicWave(meshes: Iterable<Mesh>): OrganicWave {
  const uniforms = {
    uOrganicPhase: { value: 0 },
    uOrganicFlap: { value: 0 },
    uOrganicWave: { value: [0, 0] as [number, number] },
    uOrganicSpan: { value: [0.2, 1] as [number, number] },
    uOrganicBreath: { value: 0 },
    uOrganicPivotY: { value: 0 },
  } satisfies Record<string, IUniform>;

  const patchVertexShader = (
    parameters: WebGLProgramParametersWithUniforms,
    withNormals: boolean,
  ): void => {
    Object.assign(parameters.uniforms, uniforms);
    parameters.vertexShader = parameters.vertexShader
      .replace("#include <common>", `#include <common>\n${DECLARATIONS}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n${POSITION_INJECTION}`,
      );
    if (!withNormals) return;
    // La normal se toca antes de `defaultnormal_vertex`, que es donde three la
    // pasa a espacio de vista: después ya es tarde.
    parameters.vertexShader = parameters.vertexShader.replace(
      "#include <beginnormal_vertex>",
      `#include <beginnormal_vertex>\n${NORMAL_INJECTION}`,
    );
  };

  const surfaceCompile = function organicWaveSurface(
    parameters: WebGLProgramParametersWithUniforms,
  ): void {
    patchVertexShader(parameters, true);
  };
  const depthCompile = function organicWaveDepth(
    parameters: WebGLProgramParametersWithUniforms,
  ): void {
    patchVertexShader(parameters, false);
  };

  const patched: Material[] = [];
  const depthMaterials: MeshDepthMaterial[] = [];
  for (const mesh of meshes) {
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    materials.forEach((material) => {
      material.onBeforeCompile = surfaceCompile;
      material.needsUpdate = true;
      patched.push(material);
    });
    const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
    depth.onBeforeCompile = depthCompile;
    mesh.customDepthMaterial = depth;
    depthMaterials.push(depth);
  }

  let disposed = false;
  return {
    setPhase(phase): void {
      uniforms.uOrganicPhase.value = phase;
    },
    apply(settings): void {
      uniforms.uOrganicFlap.value = settings.flap;
      uniforms.uOrganicWave.value[0] = settings.spanWave;
      uniforms.uOrganicWave.value[1] = settings.chordWave;
      uniforms.uOrganicSpan.value[0] = settings.spanRoot;
      uniforms.uOrganicSpan.value[1] = settings.spanTip;
      uniforms.uOrganicBreath.value = settings.breath;
      uniforms.uOrganicPivotY.value = settings.pivotY;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      patched.forEach((material) => {
        material.onBeforeCompile = (): void => undefined;
        material.needsUpdate = true;
      });
      depthMaterials.forEach((material) => material.dispose());
    },
  };
}
