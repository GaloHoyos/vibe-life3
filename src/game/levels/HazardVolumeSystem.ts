import { Box3, Color, Vector3 } from "three";
import type {
  VfxEmitterConfig,
  VfxEmitterHandle,
} from "@engine/render/effects/VfxSystem";
import type { GameEventBus } from "@game/GameEvents";
import type { VectorTuple } from "@shared/math/VectorTuple";
import { tupleToVector3 } from "@shared/math/VectorTuple";

export type HazardKind = "toxic" | "fire" | "electric" | "void";

export interface HazardVolumeDefinition {
  id: string;
  position: VectorTuple;
  size: VectorTuple;
  kind: HazardKind;
  /** Daño por segundo mientras el jugador está dentro. */
  damagePerSecond: number;
  /** Mata al instante (p. ej. caer fuera del mundo). Ignora `damagePerSecond`. */
  instantKill?: boolean;
  /**
   * Muestra el efecto visual ambiente (humo tóxico / llamas / arcos). Default
   * `true`. `void` nunca dibuja nada. Permite kill-volumes invisibles.
   */
  showEffect?: boolean;
}

interface RuntimeHazard {
  definition: HazardVolumeDefinition;
  bounds: Box3;
  handles: VfxEmitterHandle[];
}

/** Solo lo que el sistema necesita del `VfxSystem` (testeable con un stub). */
export interface HazardVfx {
  createEmitter(config: VfxEmitterConfig): VfxEmitterHandle;
}

/** Intervalo entre ticks de daño (sensación HL clásica + indicador legible). */
const HAZARD_TICK = 0.4;
/** Daño efectivamente letal para `instantKill` (supera cualquier vida + armadura). */
const LETHAL = 1000;

/**
 * Volúmenes que dañan al jugador mientras está adentro. Espeja `CheckpointSystem`
 * (volumen invisible que mira la posición del player cada frame) pero evalúa de
 * forma **continua** en vez de one-shot: acumula y aplica el daño en ticks
 * periódicos. No conoce al `Player`: emite `player.hazard` y `Game` lo aplica.
 *
 * Cada volumen con `showEffect` arma uno o más emisores del `VfxSystem` que
 * llenan su caja con el ambiente del tipo (humo tóxico, llamas, arcos eléctricos).
 */
export class HazardVolumeSystem {
  private readonly hazards: RuntimeHazard[] = [];
  private sinceLastTick = HAZARD_TICK;

  constructor(
    private readonly eventBus: GameEventBus,
    private readonly vfx: HazardVfx,
  ) {}

  addVolume(definition: HazardVolumeDefinition): void {
    const center = tupleToVector3(definition.position);
    const halfSize = tupleToVector3(definition.size).multiplyScalar(0.5);
    const handles =
      definition.showEffect === false
        ? []
        : hazardEmitterConfigs(definition.kind, center, halfSize).map((config) =>
            this.vfx.createEmitter(config),
          );
    this.hazards.push({
      definition,
      bounds: new Box3(center.clone().sub(halfSize), center.clone().add(halfSize)),
      handles,
    });
  }

  clear(): void {
    for (const hazard of this.hazards) {
      hazard.handles.forEach((handle) => handle.dispose());
    }
    this.hazards.length = 0;
    this.sinceLastTick = HAZARD_TICK;
  }

  update(playerPosition: Vector3, delta: number): void {
    let damagePerSecond = 0;
    let kind: HazardKind | null = null;

    for (const hazard of this.hazards) {
      if (!hazard.bounds.containsPoint(playerPosition)) {
        continue;
      }
      if (hazard.definition.instantKill) {
        this.eventBus.emit("player.hazard", {
          amount: LETHAL,
          kind: hazard.definition.kind,
          instant: true,
        });
        return;
      }
      damagePerSecond += hazard.definition.damagePerSecond;
      kind = hazard.definition.kind;
    }

    if (damagePerSecond <= 0 || kind === null) {
      // Fuera de todo hazard: re-armar el tick para que la próxima entrada pegue ya.
      this.sinceLastTick = HAZARD_TICK;
      return;
    }

    this.sinceLastTick += delta;
    if (this.sinceLastTick >= HAZARD_TICK) {
      this.sinceLastTick = 0;
      const amount = Math.max(1, Math.round(damagePerSecond * HAZARD_TICK));
      this.eventBus.emit("player.hazard", { amount, kind, instant: false });
    }
  }
}

/** Tasa = densidad/m² × área del piso del volumen, acotada para volúmenes grandes. */
function areaRate(half: Vector3, density: number, max: number): number {
  const area = Math.max(0.5, half.x * 2 * (half.z * 2));
  return Math.min(max, density * area);
}

/**
 * Mapea un tipo de peligro a sus emisores de VFX. El motor es agnóstico: el
 * "sabor" (color/velocidad/luz de fuego vs gas vs eléctrico) se decide acá, en
 * la capa de juego. `void` no dibuja nada.
 */
function hazardEmitterConfigs(
  kind: HazardKind,
  position: Vector3,
  half: Vector3,
): VfxEmitterConfig[] {
  const lightRange = Math.max(half.x, half.z, 1) * 2.5;
  switch (kind) {
    case "toxic":
      return [
        {
          position,
          halfExtents: half,
          ratePerSecond: areaRate(half, 1.4, 70),
          color: new Color(0x86c93a),
          endColor: new Color(0x46741e),
          colorJitter: 0.35,
          size: 0.7,
          endSize: 2.1,
          lifetime: 2.6,
          lifetimeJitter: 0.4,
          rise: 0.35,
          spread: 0.25,
          spreadY: 0,
          buoyancy: 0.25,
          turbulence: 0.3,
          blend: "alpha",
          spawnRegion: "floor",
          light: { color: new Color(0x6cbf32), intensity: 4, range: lightRange, flicker: 0.18 },
        },
      ];
    // Tres capas para que lea como fuego real en vez de orbes subiendo:
    // (1) base densa, chica y caliente (amarillo→naranja), poco recorrido;
    // (2) lengüetas más altas y rojas que se curvan por turbulencia;
    // (3) brasas chispeantes que suben alto. La rampa de color (caliente→rojo)
    // + el ascenso hacen que la columna muestre amarillo abajo y rojo arriba;
    // la turbulencia mata la trayectoria parabólica limpia (el look "orbe").
    // Tres capas para que lea como fuego real en vez de orbes subiendo:
    // (1) cuerpo denso y brillante en la base (amarillo→naranja, queda luminoso);
    // (2) lengüetas más altas que se curvan por turbulencia, naranja→rojo brillante
    //     (en aditivo un rojo muy oscuro casi no suma, así que las puntas quedan
    //     visibles en vez de apagarse); (3) brasas chispeantes que suben alto.
    // La rampa de color + el ascenso dan amarillo abajo y rojo arriba; la
    // turbulencia mata la parábola limpia (el look "orbe").
    case "fire":
      return [
        {
          position,
          halfExtents: half,
          ratePerSecond: areaRate(half, 30, 440),
          color: new Color(0xffe3b4),
          endColor: new Color(0xff7a1e),
          colorJitter: 0.12,
          size: 0.5,
          endSize: 0.16,
          lifetime: 0.4,
          lifetimeJitter: 0.3,
          rise: 1.0,
          spread: 0.22,
          spreadY: 0.2,
          buoyancy: 1.2,
          turbulence: 0.45,
          blend: "additive",
          spawnRegion: "floor",
          light: { color: new Color(0xff7b2a), intensity: 15, range: lightRange, flicker: 0.55 },
        },
        {
          position,
          halfExtents: half,
          ratePerSecond: areaRate(half, 13, 220),
          color: new Color(0xff8a24),
          endColor: new Color(0xc62800),
          colorJitter: 0.22,
          size: 0.4,
          endSize: 0.1,
          lifetime: 0.72,
          lifetimeJitter: 0.4,
          rise: 2.3,
          spread: 0.3,
          spreadY: 0.4,
          buoyancy: 1.6,
          turbulence: 1.2,
          blend: "additive",
          spawnRegion: "floor",
        },
        {
          position,
          halfExtents: half,
          ratePerSecond: areaRate(half, 1, 30),
          color: new Color(0xffd07a),
          endColor: new Color(0xff4a00),
          colorJitter: 0.2,
          size: 0.05,
          endSize: 0.015,
          lifetime: 1.7,
          lifetimeJitter: 0.5,
          rise: 2.5,
          spread: 0.5,
          spreadY: 0.6,
          buoyancy: 0.5,
          turbulence: 0.85,
          blend: "additive",
          spawnRegion: "floor",
        },
      ];
    case "electric":
      return [
        {
          position,
          halfExtents: half,
          ratePerSecond: areaRate(half, 3, 90),
          color: new Color(0x9fd0ff),
          colorJitter: 0.2,
          size: 0.09,
          endSize: 0.02,
          lifetime: 0.26,
          lifetimeJitter: 0.5,
          rise: 0,
          spread: 3,
          spreadY: 3,
          buoyancy: 0,
          blend: "additive",
          spawnRegion: "full",
          light: { color: new Color(0x6ea8ff), intensity: 10, range: lightRange, flicker: 0.85 },
        },
      ];
    case "void":
      return [];
  }
}
