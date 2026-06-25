import {
  AdditiveBlending,
  Color,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PointLight,
  type Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from "three";
import type { Disposable } from "@shared/types/lifecycle";
import { buildSoftSprite, ParticleField } from "./ParticleField";

const ADDITIVE_CAPACITY = 3200;
const SMOKE_CAPACITY = 1600;
// Las luces de destello viven SIEMPRE en la escena (intensidad 0 en reposo). Si
// se prendieran/apagaran con `visible`, cada explosión cambiaría
// `NUM_POINT_LIGHTS` y Three recompilaría todos los materiales iluminados → hitch
// de un frame (peor en cadenas de barriles, que suben el conteo simultáneo). Es
// el mismo patrón que usa el `MuzzleFlash`. Por eso el pool es chico (costo fijo).
const FLASH_LIGHT_POOL = 4;
const SHOCKWAVE_POOL = 5;
const MAX_EMITTER_SPAWNS_PER_FRAME = 12;
const GRAVITY = -20.5;

export interface VfxLightConfig {
  color: Color;
  intensity: number;
  range: number;
  /** Amplitud del parpadeo 0..1 (fuego/eléctrico alto, gas bajo). */
  flicker: number;
}

/**
 * Emisor continuo: llena una caja con partículas a una tasa constante.
 * Reusable para cualquier ambiente persistente (fuego, gas tóxico, arcos).
 * El semantismo (qué color/velocidad) lo decide el llamador — el motor es agnóstico.
 */
export interface VfxEmitterConfig {
  position: Vector3;
  halfExtents: Vector3;
  ratePerSecond: number;
  color: Color;
  /** Color al final de la vida (rampa). Default = `color`. Fuego: caliente → rojo. */
  endColor?: Color;
  /** Variación de color 0..1 (oscurece/aclara aleatorio por partícula). */
  colorJitter: number;
  size: number;
  endSize: number;
  lifetime: number;
  lifetimeJitter: number;
  /** Velocidad vertical media (m/s). Positivo = sube. */
  rise: number;
  /** Velocidad horizontal aleatoria (m/s). */
  spread: number;
  /** Velocidad vertical aleatoria (m/s) sumada a `rise` (chispas omnidireccionales). */
  spreadY: number;
  /** Aceleración vertical (m/s²): flotación (+) o gravedad (-). */
  buoyancy: number;
  /** Vaivén horizontal (m) que crece con la edad: curl de llamas / remolino de gas. */
  turbulence?: number;
  blend: "additive" | "alpha";
  /** Dónde nacen: piso de la caja (gas/llama) o todo el volumen (chispas). */
  spawnRegion: "floor" | "full";
  light?: VfxLightConfig;
}

export interface VfxEmitterHandle {
  setActive(active: boolean): void;
  dispose(): void;
}

export interface ExplosionOptions {
  /** Radio aproximado de la explosión en metros (escala todo el efecto). */
  scale?: number;
  color?: Color;
}

interface FlashLight {
  light: PointLight;
  remaining: number;
  duration: number;
  peak: number;
}

interface Shockwave {
  mesh: Mesh;
  material: MeshBasicMaterial;
  remaining: number;
  duration: number;
  fromScale: number;
  toScale: number;
}

interface RuntimeEmitter {
  config: VfxEmitterConfig;
  field: ParticleField;
  accumulator: number;
  active: boolean;
  light: PointLight | null;
  flickerPhase: number;
  disposed: boolean;
}

const tmpDir = new Vector3();
const tmpDrawSize = new Vector2();

/**
 * Servicio de efectos visuales del motor: dueño de los pools de partículas
 * (aditivo + humo), de luces de destello transitorias y de ondas expansivas.
 * Expone una primitiva genérica `explosion()` y emisores continuos
 * `createEmitter()`. Agnóstico de contenido — granadas/barriles/hazards
 * componen sus efectos desde la capa de juego.
 */
export class VfxSystem implements Disposable {
  private readonly additive: ParticleField;
  private readonly smoke: ParticleField;
  private readonly sprite = buildSoftSprite();

  private readonly flashLights: FlashLight[] = [];
  private readonly shockwaves: Shockwave[] = [];
  private readonly emitters: RuntimeEmitter[] = [];

  constructor(
    private readonly scene: Scene,
    private readonly renderer: WebGLRenderer,
  ) {
    this.additive = new ParticleField(scene, {
      capacity: ADDITIVE_CAPACITY,
      blend: "additive",
      drag: 2.4,
      texture: this.sprite,
    });
    this.smoke = new ParticleField(scene, {
      capacity: SMOKE_CAPACITY,
      blend: "alpha",
      drag: 1.6,
      texture: this.sprite,
    });

    for (let i = 0; i < FLASH_LIGHT_POOL; i += 1) {
      // visible=true permanente; el conteo de luces queda fijo (ver nota arriba).
      const light = new PointLight(0xffd29a, 0, 12, 2);
      scene.add(light);
      this.flashLights.push({ light, remaining: 0, duration: 0, peak: 0 });
    }

    const shellGeometry = new SphereGeometry(1, 18, 12);
    for (let i = 0; i < SHOCKWAVE_POOL; i += 1) {
      const material = new MeshBasicMaterial({
        color: 0xffcaa0,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const mesh = new Mesh(shellGeometry, material);
      mesh.visible = false;
      mesh.renderOrder = 49;
      scene.add(mesh);
      this.shockwaves.push({ mesh, material, remaining: 0, duration: 0, fromScale: 0, toScale: 0 });
    }
  }

  update(delta: number): void {
    const viewportHeight = this.renderer.getDrawingBufferSize(tmpDrawSize).y || 1080;
    this.additive.advance(delta, viewportHeight);
    this.smoke.advance(delta, viewportHeight);
    this.updateFlashLights(delta);
    this.updateShockwaves(delta);
    this.updateEmitters(delta);
  }

  /**
   * Explosión genérica en un punto: destello de luz, onda expansiva, bola de
   * fuego, chispas balísticas y humo ascendente. El `scale` (≈ radio) escala
   * número de partículas, velocidades y tamaños.
   */
  explosion(point: Vector3, options: ExplosionOptions = {}): void {
    const scale = Math.max(0.6, options.scale ?? 4);
    const tint = options.color;

    this.spawnFlashLight(point, scale);
    this.spawnShockwave(point, scale);
    this.spawnFireball(point, scale, tint);
    this.spawnSparks(point, scale, tint);
    this.spawnSmoke(point, scale);
  }

  createEmitter(config: VfxEmitterConfig): VfxEmitterHandle {
    const field = config.blend === "additive" ? this.additive : this.smoke;
    let light: PointLight | null = null;
    if (config.light) {
      light = new PointLight(
        config.light.color.getHex(),
        config.light.intensity,
        config.light.range,
        2,
      );
      light.position.copy(config.position);
      this.scene.add(light);
    }
    const emitter: RuntimeEmitter = {
      config,
      field,
      accumulator: 0,
      active: true,
      light,
      flickerPhase: Math.random() * Math.PI * 2,
      disposed: false,
    };
    this.emitters.push(emitter);

    return {
      // No togglear `visible`: el conteo de luces debe quedar fijo (ver nota de
      // FLASH_LIGHT_POOL). Inactivo = intensidad 0, lo maneja `tickEmitterLight`.
      setActive: (active: boolean) => {
        emitter.active = active;
      },
      dispose: () => this.disposeEmitter(emitter),
    };
  }

  /**
   * Objetos persistentes que el VFX mantiene en la escena (pools de partículas,
   * luces de destello, ondas). `SceneManager.clearLevel` debe preservarlos al
   * desmontar un nivel, igual que las luces — si no, el sistema queda huérfano.
   */
  getPersistentObjects(): Object3D[] {
    return [
      this.additive.object,
      this.smoke.object,
      ...this.flashLights.map((f) => f.light),
      ...this.shockwaves.map((w) => w.mesh),
    ];
  }

  /** Limpia todo el VFX vivo (transición/recarga de nivel). */
  clear(): void {
    this.additive.clear();
    this.smoke.clear();
    for (const flash of this.flashLights) {
      flash.remaining = 0;
      flash.light.intensity = 0;
    }
    for (const wave of this.shockwaves) {
      wave.remaining = 0;
      wave.material.opacity = 0;
      wave.mesh.visible = false;
    }
    for (const emitter of [...this.emitters]) {
      this.disposeEmitter(emitter);
    }
  }

  dispose(): void {
    this.clear();
    this.additive.dispose();
    this.smoke.dispose();
    for (const flash of this.flashLights) flash.light.removeFromParent();
    for (const wave of this.shockwaves) {
      wave.mesh.removeFromParent();
      wave.material.dispose();
    }
    this.shockwaves[0]?.mesh.geometry.dispose();
    this.sprite.dispose();
  }

  // ---------------------------------------------------------------------------

  private spawnFlashLight(point: Vector3, scale: number): void {
    const flash = this.flashLights.find((f) => f.remaining <= 0) ?? this.flashLights[0];
    flash.light.position.copy(point);
    flash.light.distance = 5 + scale * 3.5;
    flash.peak = 9 + scale * 5;
    flash.duration = 0.16;
    flash.remaining = flash.duration;
    flash.light.intensity = flash.peak;
  }

  private spawnShockwave(point: Vector3, scale: number): void {
    const wave = this.shockwaves.find((w) => w.remaining <= 0) ?? this.shockwaves[0];
    wave.mesh.position.copy(point);
    wave.fromScale = scale * 0.25;
    wave.toScale = scale * 1.25;
    wave.duration = 0.2;
    wave.remaining = wave.duration;
    wave.mesh.scale.setScalar(wave.fromScale);
    wave.material.opacity = 0.8;
    wave.mesh.visible = true;
  }

  private spawnFireball(point: Vector3, scale: number, tint: Color | undefined): void {
    const count = Math.round(22 + scale * 6);
    const hot = new Color(0xffe8b0);
    const warm = new Color(0xff7a1e);
    const ember = new Color(0x551400);
    for (let i = 0; i < count; i += 1) {
      randomUnitVector(tmpDir);
      const speed = scale * (1.6 + Math.random() * 2.4);
      const color = tint
        ? tint.clone()
        : hot.clone().lerp(warm, Math.random() * 0.85);
      // La bola de fuego se enfría a brasa roja oscura mientras se disipa.
      const endColor = (tint ? tint.clone() : color.clone()).lerp(ember, 0.78);
      this.additive.spawn({
        position: point.clone().addScaledVector(tmpDir, scale * 0.15),
        velocity: new Vector3(
          tmpDir.x * speed,
          Math.abs(tmpDir.y) * speed * 0.5 + scale * 1.2,
          tmpDir.z * speed,
        ),
        accel: new Vector3(0, scale * 1.2, 0),
        color,
        endColor,
        size: scale * (0.35 + Math.random() * 0.25),
        endSize: scale * (0.9 + Math.random() * 0.5),
        lifetime: 0.32 + Math.random() * 0.35,
        turbulence: scale * 0.35,
      });
    }
  }

  private spawnSparks(point: Vector3, scale: number, tint: Color | undefined): void {
    const count = Math.round(18 + scale * 5);
    const spark = new Color(0xffd27a);
    for (let i = 0; i < count; i += 1) {
      randomUnitVector(tmpDir);
      const speed = scale * (3 + Math.random() * 5);
      this.additive.spawn({
        position: point.clone(),
        velocity: new Vector3(tmpDir.x * speed, tmpDir.y * speed + scale, tmpDir.z * speed),
        accel: new Vector3(0, GRAVITY, 0),
        color: tint ? tint.clone() : spark.clone(),
        size: 0.07 + Math.random() * 0.05,
        endSize: 0.015,
        lifetime: 0.4 + Math.random() * 0.7,
      });
    }
  }

  private spawnSmoke(point: Vector3, scale: number): void {
    const count = Math.round(14 + scale * 3);
    const dark = new Color(0x1c1812);
    const light = new Color(0x4a4138);
    for (let i = 0; i < count; i += 1) {
      randomUnitVector(tmpDir);
      const speed = scale * (0.5 + Math.random() * 0.9);
      this.smoke.spawn({
        position: point.clone().addScaledVector(tmpDir, scale * 0.3),
        velocity: new Vector3(tmpDir.x * speed, Math.abs(tmpDir.y) * speed + scale * 0.8, tmpDir.z * speed),
        accel: new Vector3(0, 1.4, 0),
        color: dark.clone().lerp(light, Math.random()),
        size: scale * (0.5 + Math.random() * 0.4),
        endSize: scale * (1.4 + Math.random() * 0.8),
        lifetime: 1.1 + Math.random() * 1.1,
      });
    }
  }

  private updateFlashLights(delta: number): void {
    for (const flash of this.flashLights) {
      if (flash.remaining <= 0) continue;
      flash.remaining -= delta;
      if (flash.remaining <= 0) {
        flash.light.intensity = 0;
        continue;
      }
      const t = flash.remaining / flash.duration;
      flash.light.intensity = flash.peak * t * t;
    }
  }

  private updateShockwaves(delta: number): void {
    for (const wave of this.shockwaves) {
      if (wave.remaining <= 0) continue;
      wave.remaining -= delta;
      if (wave.remaining <= 0) {
        wave.material.opacity = 0;
        wave.mesh.visible = false;
        continue;
      }
      const t = 1 - wave.remaining / wave.duration;
      wave.mesh.scale.setScalar(wave.fromScale + (wave.toScale - wave.fromScale) * easeOut(t));
      wave.material.opacity = 0.8 * (1 - t) * (1 - t);
    }
  }

  private updateEmitters(delta: number): void {
    for (const emitter of this.emitters) {
      if (emitter.disposed) continue;
      this.tickEmitterLight(emitter, delta);
      if (!emitter.active) continue;

      emitter.accumulator += emitter.config.ratePerSecond * delta;
      let count = Math.floor(emitter.accumulator);
      if (count <= 0) continue;
      emitter.accumulator -= count;
      count = Math.min(count, MAX_EMITTER_SPAWNS_PER_FRAME);
      for (let i = 0; i < count; i += 1) {
        this.spawnFromEmitter(emitter);
      }
    }
  }

  private tickEmitterLight(emitter: RuntimeEmitter, delta: number): void {
    const light = emitter.light;
    const cfg = emitter.config.light;
    if (!light || !cfg) return;
    if (!emitter.active) {
      light.intensity = 0;
      return;
    }
    emitter.flickerPhase += delta * 18;
    const flicker = 1 - cfg.flicker * (0.5 + 0.5 * Math.sin(emitter.flickerPhase) * Math.random());
    light.intensity = cfg.intensity * Math.max(0.2, flicker);
  }

  private spawnFromEmitter(emitter: RuntimeEmitter): void {
    const cfg = emitter.config;
    const h = cfg.halfExtents;
    const ox = (Math.random() * 2 - 1) * h.x;
    const oz = (Math.random() * 2 - 1) * h.z;
    const oy =
      cfg.spawnRegion === "floor"
        ? -h.y + Math.random() * Math.min(h.y * 2, h.y * 0.6 + 0.3)
        : (Math.random() * 2 - 1) * h.y;
    const position = new Vector3(cfg.position.x + ox, cfg.position.y + oy, cfg.position.z + oz);

    const color = cfg.color.clone();
    const endColor = cfg.endColor?.clone();
    if (cfg.colorJitter > 0) {
      const j = 1 - Math.random() * cfg.colorJitter;
      color.multiplyScalar(j);
      endColor?.multiplyScalar(j);
    }
    const lifetime = cfg.lifetime * (1 - Math.random() * cfg.lifetimeJitter);

    emitter.field.spawn({
      position,
      velocity: new Vector3(
        (Math.random() * 2 - 1) * cfg.spread,
        cfg.rise * (0.7 + Math.random() * 0.6) + (Math.random() * 2 - 1) * cfg.spreadY,
        (Math.random() * 2 - 1) * cfg.spread,
      ),
      accel: new Vector3(0, cfg.buoyancy, 0),
      color,
      endColor,
      size: cfg.size,
      endSize: cfg.endSize,
      lifetime,
      turbulence: cfg.turbulence,
    });
  }

  private disposeEmitter(emitter: RuntimeEmitter): void {
    if (emitter.disposed) return;
    emitter.disposed = true;
    emitter.active = false;
    if (emitter.light) {
      emitter.light.removeFromParent();
      emitter.light = null;
    }
    const index = this.emitters.indexOf(emitter);
    if (index >= 0) this.emitters.splice(index, 1);
  }
}

function randomUnitVector(out: Vector3): Vector3 {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  out.set(r * Math.cos(a), z, r * Math.sin(a));
  return out;
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
