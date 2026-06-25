import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  type Color,
  LinearFilter,
  NormalBlending,
  Points,
  type Scene,
  ShaderMaterial,
  type Texture,
  type Vector3,
} from "three";

export type ParticleBlend = "additive" | "alpha";

export interface ParticleSpawn {
  position: Vector3;
  velocity: Vector3;
  /** Aceleración constante (m/s²): gravedad para chispas, flotación para humo. */
  accel: Vector3;
  color: Color;
  /** Color al final de la vida (rampa lerp por vida). Default = `color`. */
  endColor?: Color;
  /** Diámetro inicial / final en metros (interpolado por vida). */
  size: number;
  endSize: number;
  /** Vida en segundos. */
  lifetime: number;
  /**
   * Amplitud del vaivén horizontal (m), que crece con la edad. Da el curl de las
   * lengüetas de fuego / remolinos de gas. Default 0 = trayectoria limpia.
   */
  turbulence?: number;
}

export interface ParticleFieldOptions {
  capacity: number;
  blend: ParticleBlend;
  /** Amortiguación exponencial de la velocidad (1/s). 0 = sin drag. */
  drag: number;
  texture: Texture;
}

const FLOATS_POS = 3;
const FLOATS_VEL = 3;
const FLOATS_ACC = 3;
const FLOATS_COL = 3;

// `logdepthbuf_*`: el `WebGLRenderer` corre con `logarithmicDepthBuffer`, así que
// los materiales propios DEBEN escribir el `gl_FragDepth` logarítmico — si no,
// su profundidad no matchea la del resto de la escena y las partículas fallan el
// depth test contra toda la geometría (se dibujan "detrás de todo", contra el cielo).
const VERTEX_SHADER = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

uniform float uTime;
uniform float uViewportHeight;
uniform float uDrag;

attribute vec3 aVelocity;
attribute vec3 aAccel;
attribute vec3 aColor;
attribute vec3 aEndColor;
attribute float aSpawnTime;
attribute float aLifetime;
attribute vec2 aSize;
attribute float aSeed;
attribute float aTurbulence;

varying vec3 vColor;
varying float vLife;

void main() {
  float age = uTime - aSpawnTime;
  float life = aLifetime > 0.0 ? age / aLifetime : 2.0;
  if (life < 0.0 || life >= 1.0) {
    // Partícula muerta: detrás del far plane → descartada por el clip.
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vLife = 2.0;
    return;
  }
  vLife = life;
  // Rampa de color por vida (fuego: amarillo caliente → rojo profundo).
  vColor = mix(aColor, aEndColor, life);

  // Desplazamiento por velocidad con drag exponencial + término de aceleración constante.
  vec3 disp;
  if (uDrag > 0.0001) {
    disp = aVelocity * (1.0 - exp(-uDrag * age)) / uDrag;
  } else {
    disp = aVelocity * age;
  }
  vec3 worldPos = position + disp + 0.5 * aAccel * age * age;

  // Turbulencia: vaivén horizontal que crece con la edad (lengüetas que se curvan
  // al subir). La fase por-semilla decorrelaciona partículas; uTime la anima (flicker).
  if (aTurbulence > 0.0) {
    float amp = aTurbulence * age;
    float ph = uTime * 6.5 + aSeed * 6.2831853;
    worldPos.x += sin(ph) * amp;
    worldPos.z += cos(ph * 1.27 + aSeed * 3.14159) * amp;
  }

  vec4 mv = modelViewMatrix * vec4(worldPos, 1.0);
  float size = mix(aSize.x, aSize.y, life);
  // projectionMatrix[1][1] = 1/tan(fov/2): convierte tamaño-mundo a píxeles.
  float px = size * uViewportHeight * 0.5 * projectionMatrix[1][1] / max(-mv.z, 0.001);
  gl_PointSize = clamp(px, 0.0, 360.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}
`;

const FRAGMENT_SHADER = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

uniform sampler2D uTexture;
uniform float uHotCore;

varying vec3 vColor;
varying float vLife;

void main() {
  if (vLife >= 1.0) discard;
  vec4 tex = texture2D(uTexture, gl_PointCoord);
  float fade = smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.55, 1.0, vLife));
  float alpha = tex.a * fade;
  if (alpha < 0.003) discard;
  #include <logdepthbuf_fragment>
  // Núcleo caliente al nacer (solo aditivo): sobrebrillo que decae rápido.
  vec3 col = vColor + vColor * uHotCore * (1.0 - smoothstep(0.0, 0.3, vLife)) * 0.9;
  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * Pool de partículas simuladas en GPU. Cada partícula integra su trayectoria
 * balística en el vertex shader a partir de atributos por-partícula (posición,
 * velocidad, aceleración, color, nacimiento, vida, tamaño). La CPU solo escribe
 * en el slot libre al spawnear y avanza un reloj uniforme — sin recálculo por
 * frame. `Points` con tamaño en metros (constante en pantalla por distancia).
 *
 * Reusable y agnóstico de contenido: explosiones, fuego, gas, chispas se arman
 * componiendo spawns con distintos parámetros.
 */
export class ParticleField {
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly points: Points;
  private readonly capacity: number;

  private readonly aPosition: Float32Array;
  private readonly aVelocity: Float32Array;
  private readonly aAccel: Float32Array;
  private readonly aColor: Float32Array;
  private readonly aEndColor: Float32Array;
  private readonly aSpawnTime: Float32Array;
  private readonly aLifetime: Float32Array;
  private readonly aSize: Float32Array;
  private readonly aSeed: Float32Array;
  private readonly aTurbulence: Float32Array;

  private head = 0;
  private time = 0;

  constructor(scene: Scene, options: ParticleFieldOptions) {
    this.capacity = options.capacity;
    const n = options.capacity;

    this.aPosition = new Float32Array(n * FLOATS_POS);
    this.aVelocity = new Float32Array(n * FLOATS_VEL);
    this.aAccel = new Float32Array(n * FLOATS_ACC);
    this.aColor = new Float32Array(n * FLOATS_COL);
    this.aEndColor = new Float32Array(n * FLOATS_COL);
    this.aSpawnTime = new Float32Array(n);
    this.aLifetime = new Float32Array(n);
    this.aSize = new Float32Array(n * 2);
    this.aSeed = new Float32Array(n);
    this.aTurbulence = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
      this.aSeed[i] = Math.random();
    }

    this.geometry.setAttribute("position", new BufferAttribute(this.aPosition, 3));
    this.geometry.setAttribute("aVelocity", new BufferAttribute(this.aVelocity, 3));
    this.geometry.setAttribute("aAccel", new BufferAttribute(this.aAccel, 3));
    this.geometry.setAttribute("aColor", new BufferAttribute(this.aColor, 3));
    this.geometry.setAttribute("aEndColor", new BufferAttribute(this.aEndColor, 3));
    this.geometry.setAttribute("aSpawnTime", new BufferAttribute(this.aSpawnTime, 1));
    this.geometry.setAttribute("aLifetime", new BufferAttribute(this.aLifetime, 1));
    this.geometry.setAttribute("aSize", new BufferAttribute(this.aSize, 2));
    this.geometry.setAttribute("aSeed", new BufferAttribute(this.aSeed, 1));
    this.geometry.setAttribute("aTurbulence", new BufferAttribute(this.aTurbulence, 1));

    this.material = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uViewportHeight: { value: 1080 },
        uDrag: { value: options.drag },
        uTexture: { value: options.texture },
        uHotCore: { value: options.blend === "additive" ? 1 : 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: options.blend === "additive" ? AdditiveBlending : NormalBlending,
    });

    this.points = new Points(this.geometry, this.material);
    this.points.frustumCulled = false; // las partículas se mueven en el shader; el culling por bounds no aplica.
    this.points.renderOrder = 50;
    scene.add(this.points);
  }

  /** El `Points` persistente; debe preservarse al limpiar la escena entre niveles. */
  get object(): Points {
    return this.points;
  }

  advance(delta: number, viewportHeight: number): void {
    this.time += delta;
    this.material.uniforms.uTime.value = this.time;
    this.material.uniforms.uViewportHeight.value = viewportHeight;
  }

  spawn(p: ParticleSpawn): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;

    this.aPosition[i * 3 + 0] = p.position.x;
    this.aPosition[i * 3 + 1] = p.position.y;
    this.aPosition[i * 3 + 2] = p.position.z;
    this.aVelocity[i * 3 + 0] = p.velocity.x;
    this.aVelocity[i * 3 + 1] = p.velocity.y;
    this.aVelocity[i * 3 + 2] = p.velocity.z;
    this.aAccel[i * 3 + 0] = p.accel.x;
    this.aAccel[i * 3 + 1] = p.accel.y;
    this.aAccel[i * 3 + 2] = p.accel.z;
    this.aColor[i * 3 + 0] = p.color.r;
    this.aColor[i * 3 + 1] = p.color.g;
    this.aColor[i * 3 + 2] = p.color.b;
    const end = p.endColor ?? p.color;
    this.aEndColor[i * 3 + 0] = end.r;
    this.aEndColor[i * 3 + 1] = end.g;
    this.aEndColor[i * 3 + 2] = end.b;
    this.aSpawnTime[i] = this.time;
    this.aLifetime[i] = p.lifetime;
    this.aSize[i * 2 + 0] = p.size;
    this.aSize[i * 2 + 1] = p.endSize;
    this.aTurbulence[i] = p.turbulence ?? 0;

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aVelocity.needsUpdate = true;
    this.geometry.attributes.aAccel.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aEndColor.needsUpdate = true;
    this.geometry.attributes.aSpawnTime.needsUpdate = true;
    this.geometry.attributes.aLifetime.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aTurbulence.needsUpdate = true;
  }

  /** Mata todas las partículas vivas (vida 0 → el shader las descarta). */
  clear(): void {
    this.aLifetime.fill(0);
    this.geometry.attributes.aLifetime.needsUpdate = true;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

/** Sprite radial suave (núcleo blanco → transparente), cacheable y compartible. */
export function buildSoftSprite(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0.0, "rgba(255, 255, 255, 1.0)");
    g.addColorStop(0.25, "rgba(255, 255, 255, 0.75)");
    g.addColorStop(0.55, "rgba(255, 255, 255, 0.28)");
    g.addColorStop(1.0, "rgba(255, 255, 255, 0.0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
