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
const BLOOD_CAPACITY = 2200;
// Las luces de destello viven SIEMPRE en la escena (intensidad 0 en reposo). Si
// se prendieran/apagaran con `visible`, cada explosión cambiaría
// `NUM_POINT_LIGHTS` y Three recompilaría todos los materiales iluminados → hitch
// de un frame (peor en cadenas de barriles, que suben el conteo simultáneo). Es
// el mismo patrón que usa el `MuzzleFlash`. Por eso el pool es chico (costo fijo).
const FLASH_LIGHT_POOL = 4;
/**
 * Las luces de los emisores continuos (fuego de un vehículo, fugas de gas)
 * salen de un pool por el mismo motivo que las de destello, y es peor acá:
 * crear la luz al prender el emisor y sacarla al apagarlo cambiaba
 * `NUM_POINT_LIGHTS` DOS veces por incendio, así que cada vehículo que explotaba
 * recompilaba todos los materiales iluminados de la escena — segundos de freeze,
 * y encima acumulando programas nuevos por cada conteo distinto de luces.
 * Cuando el pool se agota el emisor corre sin luz: se pierde el halo, no el frame.
 */
const EMITTER_LIGHT_POOL = 6;
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

export interface BloodImpactOptions {
  scale?: number;
  color?: Color;
  variant?: "direct" | "radial";
}

export interface DebrisBurstOptions {
  /** Radio aproximado del objeto que cedió, en metros. */
  scale?: number;
  /** Color del polvo. Lo elige el material del prop que se rompió. */
  color?: Color;
  /** Chispas además del polvo (metal contra metal, vidrio). */
  sparks?: boolean;
}

export interface RocketTrailOptions {
  scale?: number;
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

interface EmitterLight {
  light: PointLight;
  taken: boolean;
}

interface RuntimeEmitter {
  config: VfxEmitterConfig;
  field: ParticleField;
  accumulator: number;
  active: boolean;
  light: EmitterLight | null;
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
  private readonly blood: ParticleField;
  private readonly sprite = buildSoftSprite();

  private readonly flashLights: FlashLight[] = [];
  private readonly emitterLights: EmitterLight[] = [];
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
    this.blood = new ParticleField(scene, {
      capacity: BLOOD_CAPACITY,
      blend: "alpha",
      drag: 1.1,
      texture: this.sprite,
    });

    for (let i = 0; i < FLASH_LIGHT_POOL; i += 1) {
      // visible=true permanente; el conteo de luces queda fijo (ver nota arriba).
      const light = new PointLight(0xffd29a, 0, 12, 2);
      scene.add(light);
      this.flashLights.push({ light, remaining: 0, duration: 0, peak: 0 });
    }

    for (let i = 0; i < EMITTER_LIGHT_POOL; i += 1) {
      const light = new PointLight(0xffffff, 0, 8, 2);
      scene.add(light);
      this.emitterLights.push({ light, taken: false });
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
    this.blood.advance(delta, viewportHeight);
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

  /**
   * Polvareda de algo que se parte. A diferencia de `explosion()` NO enciende
   * una luz de destello: agregar o esconder una luz recompila todos los
   * materiales lit de la escena, y romper props es algo que pasa seguido.
   */
  debrisBurst(point: Vector3, options: DebrisBurstOptions = {}): void {
    const scale = Math.max(0.25, Math.min(options.scale ?? 0.6, 3));
    const count = Math.round(10 + scale * 8);
    const tint = options.color ?? new Color(0x6f6a60);
    for (let i = 0; i < count; i += 1) {
      randomUnitVector(tmpDir);
      const speed = scale * (1.2 + Math.random() * 2.4);
      this.smoke.spawn({
        position: point.clone().addScaledVector(tmpDir, scale * 0.35),
        velocity: new Vector3(
          tmpDir.x * speed,
          Math.abs(tmpDir.y) * speed * 0.7 + scale * 0.5,
          tmpDir.z * speed,
        ),
        accel: new Vector3(0, -1.2, 0),
        color: tint.clone(),
        size: scale * (0.16 + Math.random() * 0.18),
        endSize: scale * (0.5 + Math.random() * 0.5),
        lifetime: 0.5 + Math.random() * 0.7,
        turbulence: 0.5,
      });
    }
    if (options.sparks) this.spawnSparks(point, scale * 0.5, undefined);
  }

  bloodImpact(point: Vector3, direction: Vector3, options: BloodImpactOptions = {}): void {
    const scale = Math.max(0.55, Math.min(options.scale ?? 1, 2.4));
    const variant = options.variant ?? "direct";
    const dir = direction.lengthSq() > 0.001
      ? direction.clone().normalize()
      : new Vector3(0, 0.35, 1).normalize();
    const right = new Vector3();
    const up = new Vector3();
    buildBasis(dir, right, up);

    const color = options.color ?? new Color(0x6f0710);
    const dark = color.clone().multiplyScalar(0.38);
    const coreCount = variant === "radial" ? 8 : 5;
    const dropCount = variant === "radial" ? 18 : 10;
    const puffCount = variant === "radial" ? 7 : 4;

    for (let i = 0; i < coreCount; i += 1) {
      const origin = point
        .clone()
        .addScaledVector(dir, scale * 0.08)
        .addScaledVector(right, (Math.random() - 0.5) * scale * 0.16)
        .addScaledVector(up, (Math.random() - 0.5) * scale * 0.16);
      this.blood.spawn({
        position: origin,
        velocity: jitterDirection(dir, 0.45).multiplyScalar(scale * (1.2 + Math.random() * 2.2)),
        accel: new Vector3(0, GRAVITY * 0.35, 0),
        color: jitterColor(color, 0.35),
        endColor: dark.clone(),
        size: scale * (0.08 + Math.random() * 0.07),
        endSize: scale * (0.34 + Math.random() * 0.24),
        lifetime: 0.22 + Math.random() * 0.2,
        turbulence: scale * 0.08,
      });
    }

    for (let i = 0; i < puffCount; i += 1) {
      const origin = point
        .clone()
        .addScaledVector(dir, scale * (0.12 + Math.random() * 0.18))
        .addScaledVector(right, (Math.random() - 0.5) * scale * 0.28)
        .addScaledVector(up, (Math.random() - 0.5) * scale * 0.28);
      this.blood.spawn({
        position: origin,
        velocity: jitterDirection(dir, 0.75).multiplyScalar(scale * (0.6 + Math.random() * 1.3)),
        accel: new Vector3(0, GRAVITY * 0.15, 0),
        color: jitterColor(color, 0.45),
        endColor: dark.clone(),
        size: scale * (0.16 + Math.random() * 0.08),
        endSize: scale * (0.62 + Math.random() * 0.34),
        lifetime: 0.38 + Math.random() * 0.28,
        turbulence: scale * 0.14,
      });
    }

    for (let i = 0; i < dropCount; i += 1) {
      const origin = point
        .clone()
        .addScaledVector(right, (Math.random() - 0.5) * scale * 0.2)
        .addScaledVector(up, (Math.random() - 0.5) * scale * 0.2);
      const spray = variant === "radial" ? randomUnitVector(new Vector3()) : jitterDirection(dir, 1.0);
      spray.y += 0.18 + Math.random() * 0.35;
      spray.normalize();
      this.blood.spawn({
        position: origin,
        velocity: spray.multiplyScalar(scale * (2.2 + Math.random() * (variant === "radial" ? 4.5 : 3.0))),
        accel: new Vector3(0, GRAVITY * (0.75 + Math.random() * 0.35), 0),
        color: jitterColor(color, 0.28),
        endColor: dark.clone(),
        size: scale * (0.035 + Math.random() * 0.035),
        endSize: scale * (0.012 + Math.random() * 0.016),
        lifetime: 0.42 + Math.random() * 0.48,
      });
    }
  }

  rocketTrail(point: Vector3, direction: Vector3, options: RocketTrailOptions = {}): void {
    const scale = Math.max(0.65, Math.min(options.scale ?? 1, 1.8));
    const forward = direction.lengthSq() > 0.001
      ? direction.clone().normalize()
      : new Vector3(0, 0, -1);
    const exhaust = point.clone().addScaledVector(forward, -0.34 * scale);
    const smokeDark = new Color(0x2a2926);
    const smokeLight = new Color(0x7b766e);

    for (let i = 0; i < 2; i += 1) {
      randomUnitVector(tmpDir);
      const origin = exhaust
        .clone()
        .addScaledVector(tmpDir, scale * 0.08)
        .addScaledVector(forward, -Math.random() * scale * 0.14);
      this.smoke.spawn({
        position: origin,
        velocity: forward
          .clone()
          .multiplyScalar(-scale * (0.7 + Math.random() * 0.7))
          .add(new Vector3(
            tmpDir.x * scale * 0.35,
            Math.abs(tmpDir.y) * scale * 0.45 + 0.15,
            tmpDir.z * scale * 0.35,
          )),
        accel: new Vector3(0, 0.65, 0),
        color: smokeDark.clone().lerp(smokeLight, Math.random() * 0.65),
        endColor: smokeDark.clone().multiplyScalar(0.45),
        size: scale * (0.16 + Math.random() * 0.08),
        endSize: scale * (0.62 + Math.random() * 0.24),
        lifetime: 0.42 + Math.random() * 0.32,
        turbulence: scale * 0.12,
      });
    }

    if (Math.random() < 0.8) {
      this.additive.spawn({
        position: exhaust,
        velocity: forward.clone().multiplyScalar(-scale * 1.8),
        accel: new Vector3(0, 0.2, 0),
        color: new Color(0xffd7a0),
        endColor: new Color(0xff5a12),
        size: scale * 0.08,
        endSize: scale * 0.22,
        lifetime: 0.08 + Math.random() * 0.05,
      });
    }
  }

  createEmitter(config: VfxEmitterConfig): VfxEmitterHandle {
    const field = config.blend === "additive" ? this.additive : this.smoke;
    const light = config.light ? this.acquireEmitterLight(config) : null;
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
      this.blood.object,
      ...this.flashLights.map((f) => f.light),
      ...this.emitterLights.map((e) => e.light),
      ...this.shockwaves.map((w) => w.mesh),
    ];
  }

  /** Limpia todo el VFX vivo (transición/recarga de nivel). */
  clear(): void {
    this.additive.clear();
    this.smoke.clear();
    this.blood.clear();
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
    for (const slot of this.emitterLights) this.releaseEmitterLight(slot);
  }

  dispose(): void {
    this.clear();
    this.additive.dispose();
    this.smoke.dispose();
    this.blood.dispose();
    for (const flash of this.flashLights) flash.light.removeFromParent();
    for (const slot of this.emitterLights) slot.light.removeFromParent();
    for (const wave of this.shockwaves) {
      wave.mesh.removeFromParent();
      wave.material.dispose();
    }
    this.shockwaves[0]?.mesh.geometry.dispose();
    this.sprite.dispose();
  }

  // ---------------------------------------------------------------------------

  /** Toma una luz del pool y la configura. Null si no quedan libres. */
  private acquireEmitterLight(config: VfxEmitterConfig): EmitterLight | null {
    const cfg = config.light;
    if (!cfg) return null;
    const slot = this.emitterLights.find((candidate) => !candidate.taken);
    if (!slot) return null;
    slot.taken = true;
    // Color, distancia e intensidad son uniforms: cambiarlos no recompila nada.
    slot.light.color.set(cfg.color.getHex());
    slot.light.distance = cfg.range;
    slot.light.intensity = 0;
    slot.light.position.copy(config.position);
    return slot;
  }

  private releaseEmitterLight(slot: EmitterLight): void {
    slot.light.intensity = 0;
    slot.taken = false;
  }

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
    const slot = emitter.light;
    const cfg = emitter.config.light;
    if (!slot || !cfg) return;
    if (!emitter.active) {
      slot.light.intensity = 0;
      return;
    }
    // La posición del emisor la mueve el dueño (el vehículo que arde se desplaza).
    slot.light.position.copy(emitter.config.position);
    emitter.flickerPhase += delta * 18;
    const flicker = 1 - cfg.flicker * (0.5 + 0.5 * Math.sin(emitter.flickerPhase) * Math.random());
    slot.light.intensity = cfg.intensity * Math.max(0.2, flicker);
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
      // La luz vuelve al pool, NO se saca de la escena: el conteo queda fijo.
      this.releaseEmitterLight(emitter.light);
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

function buildBasis(direction: Vector3, right: Vector3, up: Vector3): void {
  const reference = Math.abs(direction.y) > 0.92
    ? new Vector3(1, 0, 0)
    : new Vector3(0, 1, 0);
  right.crossVectors(direction, reference);
  if (right.lengthSq() < 1e-5) right.set(1, 0, 0);
  right.normalize();
  up.crossVectors(right, direction).normalize();
}

function jitterDirection(base: Vector3, amount: number): Vector3 {
  return base
    .clone()
    .addScaledVector(randomUnitVector(new Vector3()), Math.random() * amount)
    .normalize();
}

function jitterColor(base: Color, amount: number): Color {
  return base.clone().multiplyScalar(1 - Math.random() * amount);
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
