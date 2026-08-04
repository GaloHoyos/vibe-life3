import {
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import {
  applyOrganicWave,
  type OrganicWave,
} from "@engine/render/material/OrganicWave";
import { SecondOrderSpring } from "@shared/math/SecondOrderSpring";
import type { Disposable } from "@shared/types/lifecycle";

/**
 * Lectura del estado del vehículo desde el punto de vista del bicho. No es la
 * telemetría del motor: son las cuatro cosas de las que depende cómo se mueve
 * un animal —cuánto se está esforzando, hacia dónde lo tiran las inercias y
 * cuán entero está—.
 */
export interface CreatureVehicleState {
  readonly speed: number;
  readonly forwardSpeed: number;
  readonly steering: number;
  /** Guiñada en rad/s: de acá sale la fuerza centrífuga que lo tumba. */
  readonly yawRate: number;
  readonly engine01: number;
  readonly hull01: number;
  readonly burning: boolean;
  /** Con jinete encima el bicho está despierto; sin nadie, dormita. */
  readonly occupied: boolean;
  /** Mirada del que maneja, en ejes del vehículo: la cabeza la sigue. */
  readonly riderYaw: number;
  readonly riderPitch: number;
  /** Muerto: el ciclo de nado se apaga y todo cuelga de la gravedad. */
  readonly dead: boolean;
}

export interface CreatureVehicleAnimator extends Disposable {
  update(delta: number, state: Readonly<CreatureVehicleState>): void;
  /** Sacudón: al montarlo, al recibir un impacto, al despertarlo. */
  startle(intensity: number): void;
}

const TAU = Math.PI * 2;
/** Cabeceo y alabeo máximos de la postura, en radianes (~7° y ~9°). */
const MAX_PITCH = 0.12;
const MAX_ROLL = 0.16;
/** Recorrido del cuello. Más allá, la cabeza se despega del cuerpo. */
const MAX_HEAD_YAW = 0.95;
const MAX_HEAD_PITCH = 0.45;
/**
 * Cuánto puede alejarse un apéndice muerto de su pose de reposo. Sin tope, un
 * cadáver boca abajo pide ángulos de casi π y los miembros atraviesan el cuerpo
 * para llegar; con tope cuelgan hacia donde pueden, que es lo que hace la carne.
 */
const LIMP_REACH = 1.15;

const TMP_DOWN = new Vector3();
const TMP_ROTATION = new Quaternion();

/**
 * Geometría del nadador que el animador necesita saber, en espacio de objeto.
 * Sale del GLB (`tools/vehicle-assets/models.ts`), así que si allá cambia el
 * contorno del disco, acá hay que mover el `spanTip` o la ola se corta antes
 * de llegar a la punta del ala.
 */
const SWIMMER = {
  /** Centro del cuerpo: de ahí se hincha la respiración. */
  pivotY: 0.55,
  /** Semiancho donde el batido arranca y donde llega al máximo. */
  spanRoot: 0.24,
  spanTip: 1.05,
  /** Remos por lado, de proa a popa. */
  oarsPerSide: 3,
  tailSegments: 2,
} as const;

interface RiggedNode {
  readonly node: Object3D;
  readonly restX: number;
  readonly restY: number;
  readonly restZ: number;
}

interface OarNode extends RiggedNode {
  /** −1 babor, +1 estribor. */
  readonly side: number;
  /** 0 el par de proa. Define el retardo dentro de la ola metacrónica. */
  readonly index: number;
}

interface AntennaChain {
  readonly base: readonly RiggedNode[];
  readonly tip: readonly RiggedNode[];
  readonly side: number;
  readonly sweep: SecondOrderSpring;
  readonly sway: SecondOrderSpring;
  readonly tipSweep: SecondOrderSpring;
  readonly tipSway: SecondOrderSpring;
}

/**
 * Anima el nadador Combine como criatura y no como casco.
 *
 * El reparto es deliberado: la piel del disco ondula por vértice —una manta no
 * tiene juntas donde partirla en segmentos— y todo lo que sí puede quebrarse
 * (remos, antenas, cola, mandíbula) vive en nodos propios del GLB. Encima de
 * las dos capas va una tercera, la postura global, que encabrita al bicho
 * cuando acelera y lo tumba en las curvas.
 *
 * `root` es el nodo del modelo importado, hijo de la raíz física. Moverlo mueve
 * también el asiento y la cámara, que es justo lo que se busca: el jinete tiene
 * que sentir el bicho debajo, no mirarlo moverse desde un soporte quieto.
 */
export function createCreatureVehicleAnimator(
  root: Object3D,
): CreatureVehicleAnimator {
  const wave = applyOrganicWave(collectSkinMeshes(root));
  const oars = collectOars(root);
  const tails = collectTail(root);
  const jaws = collect(root, "swimmer_jaw");
  const gills = collect(root, "swimmer_gills");
  const heads = collect(root, "swimmer_head");
  const antennae = collectAntennae(root);
  const glowMaterials = collectGlowMaterials(root);
  const baseGillScale = gills.map((entry) => entry.node.scale.x);

  const pitch = new SecondOrderSpring(0, 9, 0.85);
  const roll = new SecondOrderSpring(0, 7, 0.8);
  const heave = new SecondOrderSpring(0, 11, 0.62);
  const headYaw = new SecondOrderSpring(0, 10, 0.72);
  const headPitch = new SecondOrderSpring(0, 10, 0.75);

  let strokePhase = 0;
  let breathPhase = 0;
  let previousForwardSpeed = 0;
  let startleAmount = 0;
  let strain = 0;
  let deathElapsed = -1;
  let disposed = false;

  return {
    startle(intensity): void {
      startleAmount = Math.min(1.6, startleAmount + Math.max(0, intensity));
      heave.kick(intensity * 1.4);
      pitch.kick(intensity * 0.9);
      antennae.forEach((antenna) => {
        antenna.sweep.kick(intensity * 2.2);
        antenna.tipSweep.kick(intensity * 3.4);
      });
    },
    update(delta, state): void {
      if (disposed || delta <= 0) return;
      if (state.dead) {
        if (deathElapsed < 0) {
          // Espasmo: el único momento en que el bicho se mueve más muerto que
          // vivo. Sin él, la transición a cadáver es un corte seco.
          deathElapsed = 0;
          startleAmount = 1.5;
          heave.kick(2.4);
          pitch.kick(1.6);
          antennae.forEach((antenna) => {
            antenna.sweep.kick(5);
            antenna.tipSweep.kick(7);
          });
        }
        deathElapsed += delta;
        updateCorpse(delta, {
          root,
          wave,
          oars,
          tails,
          jaws,
          gills,
          heads,
          antennae,
          glowMaterials,
          baseGillScale,
          pitch,
          roll,
          heave,
          headYaw,
          headPitch,
          deathElapsed,
        });
        startleAmount = Math.max(0, startleAmount - delta * 1.4);
        return;
      }
      deathElapsed = -1;
      const hull01 = MathUtils.clamp(state.hull01, 0, 1);
      // Un bicho reventado se mueve menos y peor: todo lo que sigue se escala
      // por acá, así el daño se lee en el movimiento antes que en la textura.
      const vigor = MathUtils.lerp(0.32, 1, hull01);
      const speed01 = MathUtils.clamp(state.speed / 26, 0, 1);
      const effort = MathUtils.clamp(
        state.engine01 * 0.55 + speed01 * 0.65,
        state.occupied ? 0.06 : 0,
        1,
      );

      const acceleration = MathUtils.clamp(
        (state.forwardSpeed - previousForwardSpeed) / delta,
        -22,
        22,
      );
      previousForwardSpeed = state.forwardSpeed;
      // Centrífuga: es lo que tumba al bicho y lo que tira de las antenas hacia
      // afuera de la curva. Sale de la guiñada por la velocidad, no de una
      // lectura del acelerómetro que el motor no publica.
      const lateral = MathUtils.clamp(state.forwardSpeed * state.yawRate, -16, 16);

      startleAmount = Math.max(0, startleAmount - delta * 2.1);
      strain = MathUtils.lerp(
        strain,
        MathUtils.clamp(Math.max(0, acceleration) / 11 + effort * 0.35, 0, 1),
        1 - Math.exp(-delta * 6),
      );

      strokePhase =
        (strokePhase + delta * TAU * MathUtils.lerp(0.48, 2.85, effort) * vigor) %
        TAU;
      // La respiración se acelera con el esfuerzo, como un jadeo. Es el único
      // ciclo que sigue corriendo con el bicho parado y apagado.
      breathPhase =
        (breathPhase +
          delta * TAU * MathUtils.lerp(0.26, 1.2, effort) * MathUtils.lerp(0.6, 1, hull01)) %
        TAU;
      const breath = Math.sin(breathPhase) * 0.5 + 0.5;

      wave.setPhase(strokePhase);
      wave.apply({
        flap: (MathUtils.lerp(0.03, 0.155, effort) + startleAmount * 0.05) * vigor,
        spanWave: 2.05,
        chordWave: 1.45,
        spanRoot: SWIMMER.spanRoot,
        spanTip: SWIMMER.spanTip,
        breath: breath * MathUtils.lerp(0.05, 0.13, effort),
        pivotY: SWIMMER.pivotY,
      });

      updateOars(oars, strokePhase, effort, vigor);
      updateTail(tails, strokePhase, effort, vigor, state.steering);
      updateAntennae(antennae, delta, {
        speed01,
        acceleration,
        lateral,
        breathPhase,
        vigor,
      });

      jaws.forEach((entry) => {
        // Se abre al forzar y de golpe al sacudirse: es el gesto que más lee
        // como reacción, porque no está atado al ciclo de nado.
        entry.node.rotation.x =
          entry.restX + (strain * 0.3 + startleAmount * 0.45) * vigor;
      });

      gills.forEach((entry, index) => {
        const flare = 1 + breath * MathUtils.lerp(0.1, 0.34, effort) * vigor;
        entry.node.scale.set(
          (baseGillScale[index] ?? 1) * flare,
          1 + breath * 0.08,
          1,
        );
      });

      // Cabeza. Mismo convenio que la torreta —yaw directo, pitch invertido—
      // porque el rig de cámara entrega la mirada en ejes del vehículo. Sin
      // jinete mira adonde va, que es lo que hace un animal suelto.
      const lookYaw = state.occupied
        ? MathUtils.clamp(state.riderYaw, -MAX_HEAD_YAW, MAX_HEAD_YAW)
        : MathUtils.clamp(-state.steering * 0.5, -MAX_HEAD_YAW, MAX_HEAD_YAW);
      const lookPitch = state.occupied
        ? MathUtils.clamp(state.riderPitch, -MAX_HEAD_PITCH, MAX_HEAD_PITCH)
        : Math.sin(breathPhase * 0.5) * 0.06;
      const yawNow = headYaw.step(lookYaw * vigor, delta);
      const pitchNow = headPitch.step(lookPitch * vigor, delta);
      heads.forEach((entry) => {
        entry.node.rotation.set(
          entry.restX - pitchNow,
          entry.restY + yawNow,
          entry.restZ + yawNow * 0.18,
        );
      });

      // Postura global. `+Z` es proa, así que un `rotation.x` positivo hunde el
      // morro: encabritarse al acelerar es el signo contrario.
      //
      // Los topes no son estéticos. El asiento y la cámara cuelgan de este
      // nodo, así que cada grado acá es un grado de horizonte torcido para el
      // jinete: sin recortar, una curva cerrada tumbaba la vista 15°.
      const pitchTarget = MathUtils.clamp(
        -acceleration * 0.011 - startleAmount * 0.06 + Math.sin(breathPhase) * 0.008,
        -MAX_PITCH,
        MAX_PITCH,
      );
      const rollTarget = MathUtils.clamp(
        -lateral * 0.013 - (1 - hull01) * 0.1 + Math.sin(breathPhase * 0.7) * 0.012,
        -MAX_ROLL,
        MAX_ROLL,
      );
      const heaveTarget =
        Math.sin(breathPhase) * 0.022 * MathUtils.lerp(1, 0.35, effort) +
        (state.burning ? Math.sin(strokePhase * 3.1) * 0.02 : 0);
      root.rotation.x = pitch.step(pitchTarget, delta);
      root.rotation.z = roll.step(rollTarget, delta);
      root.position.y = heave.step(heaveTarget, delta);

      const pulse = 0.62 + Math.sin(breathPhase * 2) * 0.16 + startleAmount * 0.5;
      const flicker = state.burning ? 0.5 + Math.random() * 0.5 : 1;
      glowMaterials.forEach((material) => {
        material.emissiveIntensity = pulse * MathUtils.lerp(0.15, 1, hull01) * flicker;
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      wave.dispose();
    },
  };
}

interface CorpseRig {
  readonly root: Object3D;
  readonly wave: OrganicWave;
  readonly oars: readonly OarNode[];
  readonly tails: readonly RiggedNode[];
  readonly jaws: readonly RiggedNode[];
  readonly gills: readonly RiggedNode[];
  readonly heads: readonly RiggedNode[];
  readonly antennae: readonly AntennaChain[];
  readonly glowMaterials: readonly MeshStandardMaterial[];
  readonly baseGillScale: readonly number[];
  readonly pitch: SecondOrderSpring;
  readonly roll: SecondOrderSpring;
  readonly heave: SecondOrderSpring;
  readonly headYaw: SecondOrderSpring;
  readonly headPitch: SecondOrderSpring;
  readonly deathElapsed: number;
}

/**
 * Ragdoll del cadáver. El casco lo tumba la física —es un rígido con gravedad
 * desde que muere— y lo que hace acá el animador es dejar caer los apéndices
 * hacia el abajo REAL del mundo, no hacia un abajo de reposo.
 *
 * Ésa es toda la diferencia entre un cadáver y un modelo congelado: la criatura
 * puede quedar de costado o boca abajo, y los remos, las antenas y la cola
 * tienen que seguir colgando hacia el piso igual. Por eso se transforma la
 * gravedad al espacio local en vez de guardar poses de muerte autoradas.
 */
function updateCorpse(delta: number, rig: CorpseRig): void {
  rig.root.getWorldQuaternion(TMP_ROTATION);
  const down = TMP_DOWN.set(0, -1, 0).applyQuaternion(TMP_ROTATION.invert());
  // Se afloja de a poco: recién muerto todavía tiene tono muscular.
  const slack = MathUtils.clamp(rig.deathElapsed / 1.1, 0, 1);

  rig.wave.setPhase(0);
  rig.wave.apply({
    flap: 0,
    spanWave: 0,
    chordWave: 0,
    spanRoot: SWIMMER.spanRoot,
    spanTip: SWIMMER.spanTip,
    // Negativo: el cuerpo se desinfla en vez de respirar.
    breath: -0.06 * slack,
    pivotY: SWIMMER.pivotY,
  });

  // Cada familia de apéndices apunta a un eje local distinto, así que el ángulo
  // de máxima alineación con la gravedad sale de un plano distinto.
  //
  // Cada miembro necesita DOS bisagras. Con una sola, un cadáver volcado de
  // costado deja la gravedad justo en el eje del que la bisagra no puede
  // sacarla y las patas se quedan apuntando al cielo, tiesas.
  const antennaDrop = Math.atan2(-down.y, down.z);
  const antennaSwing = Math.atan2(down.x, down.z);
  const tailDrop = Math.atan2(down.y, -down.z);
  const tailSwing = Math.atan2(-down.x, -down.z);
  const oarDrop = Math.atan2(-down.z, -down.y);
  const oarSwing = Math.atan2(down.x, -down.y);

  rig.oars.forEach((oar) => {
    oar.node.rotation.x = limpAngle(oar.restX, oarDrop, slack, delta, oar.node.rotation.x);
    oar.node.rotation.z = limpAngle(oar.restZ, oarSwing, slack, delta, oar.node.rotation.z);
    oar.node.rotation.y = decay(oar.node.rotation.y, oar.restY, delta);
  });
  rig.tails.forEach((segment) => {
    segment.node.rotation.x = limpAngle(
      segment.restX,
      tailDrop,
      slack,
      delta,
      segment.node.rotation.x,
    );
    segment.node.rotation.y = limpAngle(
      segment.restY,
      tailSwing,
      slack,
      delta,
      segment.node.rotation.y,
    );
  });
  rig.antennae.forEach((antenna) => {
    const target = MathUtils.clamp(
      antennaDrop - antenna.base[0]!.restX,
      -LIMP_REACH,
      LIMP_REACH,
    ) * slack;
    const swing = MathUtils.clamp(
      antennaSwing - antenna.base[0]!.restY,
      -LIMP_REACH,
      LIMP_REACH,
    ) * slack;
    const sweep = antenna.sweep.step(target, delta);
    const tipSweep = antenna.tipSweep.step(target * 1.3, delta);
    const sway = antenna.sway.step(swing, delta);
    antenna.base.forEach((node) => {
      node.node.rotation.x = node.restX + sweep;
      node.node.rotation.y = node.restY + sway;
    });
    antenna.tip.forEach((node) => {
      node.node.rotation.x = node.restX + tipSweep;
      node.node.rotation.y = node.restY + sway * 0.7;
    });
  });
  rig.jaws.forEach((entry) => {
    // La mandíbula queda abierta: es la señal más barata de que está muerto.
    entry.node.rotation.x = MathUtils.lerp(
      entry.node.rotation.x,
      entry.restX + 0.42,
      1 - Math.exp(-delta * 3),
    );
  });
  rig.gills.forEach((entry, index) => {
    entry.node.scale.set(
      MathUtils.lerp(entry.node.scale.x, (rig.baseGillScale[index] ?? 1) * 0.9, 1 - Math.exp(-delta * 2)),
      1,
      1,
    );
  });
  rig.heads.forEach((entry) => {
    entry.node.rotation.x = limpAngle(
      entry.restX,
      antennaDrop * 0.55,
      slack,
      delta,
      entry.node.rotation.x,
    );
    entry.node.rotation.y = decay(entry.node.rotation.y, entry.restY, delta);
    entry.node.rotation.z = decay(entry.node.rotation.z, entry.restZ, delta);
  });
  rig.headYaw.step(0, delta);
  rig.headPitch.step(0, delta);

  // La postura se relaja: el casco ya está gobernado por la física y sumarle
  // cabeceo autorado encima lo haría cabecear dos veces.
  rig.root.rotation.x = rig.pitch.step(0, delta);
  rig.root.rotation.z = rig.roll.step(0, delta);
  rig.root.position.y = rig.heave.step(0, delta);

  // El ojo Combine se apaga en dos segundos: es lo último que queda encendido.
  const glow = Math.max(0, 1 - rig.deathElapsed / 2) ** 2;
  rig.glowMaterials.forEach((material) => {
    material.emissiveIntensity = glow * (0.3 + Math.random() * 0.5);
  });
}

/** Ángulo hacia el que cuelga un miembro suelto, acotado a su alcance. */
function limpAngle(
  rest: number,
  drop: number,
  slack: number,
  delta: number,
  current: number,
): number {
  const target =
    rest + MathUtils.clamp(drop - rest, -LIMP_REACH, LIMP_REACH) * slack;
  return MathUtils.lerp(current, target, 1 - Math.exp(-delta * 4.5));
}

function decay(current: number, rest: number, delta: number): number {
  return MathUtils.lerp(current, rest, 1 - Math.exp(-delta * 3));
}

/**
 * Ola metacrónica: los remos de popa arrancan la brazada y el movimiento sube
 * hacia proa. En fase los tres pares se leen como un mecanismo; con el retardo
 * se leen como un bicho remando.
 */
function updateOars(
  oars: readonly OarNode[],
  phase: number,
  effort: number,
  vigor: number,
): void {
  const sweep = MathUtils.lerp(0.18, 0.62, effort) * vigor;
  oars.forEach((oar) => {
    const angle =
      phase + (SWIMMER.oarsPerSide - 1 - oar.index) * 0.78;
    const stroke = Math.sin(angle);
    const recovery = Math.cos(angle);
    oar.node.rotation.x = oar.restX + stroke * sweep;
    // Vuelta de la paleta sobre su propio eje: en el recobro se pone de canto.
    // Sin esto el remo barre el aire de plano en los dos sentidos y la brazada
    // deja de tener dirección.
    oar.node.rotation.y = oar.restY + recovery * 0.44 * oar.side * vigor;
    oar.node.rotation.z = oar.restZ + recovery * 0.1 * oar.side;
  });
}

function updateTail(
  tails: readonly RiggedNode[],
  phase: number,
  effort: number,
  vigor: number,
  steering: number,
): void {
  const amplitude = MathUtils.lerp(0.11, 0.33, effort) * vigor;
  tails.forEach((segment, index) => {
    const lag = index * 0.92;
    const swing = Math.sin(phase * 0.64 - lag);
    segment.node.rotation.y =
      segment.restY + swing * amplitude - steering * 0.2;
    segment.node.rotation.x =
      segment.restX + Math.sin(phase * 0.64 - lag + 1.15) * amplitude * 0.32;
  });
}

interface AntennaDrive {
  readonly speed01: number;
  readonly acceleration: number;
  readonly lateral: number;
  readonly breathPhase: number;
  readonly vigor: number;
}

/**
 * Antenas. Todo el punto es que NO sigan una curva: van por resorte, tiradas
 * por el aire y por las inercias del propio bicho, así que al frenar se van
 * para adelante y al doblar quedan atrás. La punta usa un resorte más blando
 * que la base para que el latigazo llegue con retardo.
 */
function updateAntennae(
  antennae: readonly AntennaChain[],
  delta: number,
  drive: AntennaDrive,
): void {
  antennae.forEach((antenna) => {
    const idle = Math.sin(drive.breathPhase * 0.8 + antenna.side) * 0.07;
    // El aire las peina hacia atrás sobre el lomo; frenar las manda al frente.
    const sweepTarget =
      -drive.speed01 * 0.85 - drive.acceleration * 0.014 + idle * drive.vigor;
    const swayTarget =
      drive.lateral * 0.022 * antenna.side +
      Math.cos(drive.breathPhase * 0.6 + antenna.side * 1.7) * 0.05;
    const sweep = antenna.sweep.step(sweepTarget, delta);
    const sway = antenna.sway.step(swayTarget, delta);
    const tipSweep = antenna.tipSweep.step(sweep * 0.72, delta);
    const tipSway = antenna.tipSway.step(sway * 0.68, delta);
    antenna.base.forEach((node) => {
      node.node.rotation.x = node.restX + sweep;
      node.node.rotation.y = node.restY + sway;
    });
    antenna.tip.forEach((node) => {
      node.node.rotation.x = node.restX + tipSweep;
      node.node.rotation.y = node.restY + tipSway;
    });
  });
}

/** Un nodo por nivel de detalle: el GLB repite los nombres con `_lodN`. */
function collect(root: Object3D, baseName: string): RiggedNode[] {
  return [baseName, `${baseName}_lod1`, `${baseName}_lod2`].flatMap((name) => {
    const node = root.getObjectByName(name);
    if (!node) return [];
    return [{
      node,
      restX: node.rotation.x,
      restY: node.rotation.y,
      restZ: node.rotation.z,
    }];
  });
}

function collectOars(root: Object3D): OarNode[] {
  const oars: OarNode[] = [];
  for (const [prefix, side] of [
    ["swimmer_oar_left", -1],
    ["swimmer_oar_right", 1],
  ] as const) {
    for (let index = 0; index < SWIMMER.oarsPerSide; index += 1) {
      collect(root, `${prefix}_${index}`).forEach((entry) => {
        oars.push({ ...entry, side, index });
      });
    }
  }
  return oars;
}

function collectTail(root: Object3D): RiggedNode[] {
  const tails: RiggedNode[] = [];
  for (let index = 0; index < SWIMMER.tailSegments; index += 1) {
    tails.push(...collect(root, `swimmer_tail_${index}`));
  }
  return tails;
}

function collectAntennae(root: Object3D): AntennaChain[] {
  return ([["swimmer_antenna_left", -1], ["swimmer_antenna_right", 1]] as const)
    .flatMap(([name, side]) => {
      const base = collect(root, name);
      if (base.length === 0) return [];
      return [{
        base,
        tip: collect(root, `${name}_tip`),
        side,
        sweep: new SecondOrderSpring(0, 13, 0.55),
        sway: new SecondOrderSpring(0, 11, 0.6),
        // La punta va más blanda y menos amortiguada: es de donde sale el
        // rebote que hace que la antena parezca tener peso propio.
        tipSweep: new SecondOrderSpring(0, 8, 0.34),
        tipSway: new SecondOrderSpring(0, 7, 0.38),
      }];
    });
}

/**
 * La piel: las únicas mallas autoradas en espacio de vehículo, y por eso las
 * únicas que la ola puede deformar con sentido. El cadáver queda afuera —una
 * carcasa muerta no respira— y los apéndices también, porque se articulan por
 * nodo.
 */
function collectSkinMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  const wreckage = root.getObjectByName("wreckage");
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    if (!node.name.startsWith("combineSwimmer_body")) return;
    if (wreckage && isDescendantOf(node, wreckage)) return;
    meshes.push(node);
  });
  return meshes;
}

function isDescendantOf(node: Object3D, ancestor: Object3D): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

/**
 * Todo lo que emite luz propia: el ojo y los emisores del injerto. Se los
 * reconoce por venir emisivos del GLB, que es el mismo criterio con el que
 * `VehicleVisual` los deja afuera del tiznado por daño.
 *
 * Van juntos a propósito. Latiendo con la respiración, el injerto se lee como
 * parte del bicho y no como una pieza montada; y al morir tienen que apagarse
 * todos, porque un cadáver con los anillos antigravedad encendidos sigue
 * pareciendo una máquina prendida.
 */
function collectGlowMaterials(root: Object3D): MeshStandardMaterial[] {
  const materials = new Set<MeshStandardMaterial>();
  const wreckage = root.getObjectByName("wreckage");
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    if (wreckage && isDescendantOf(node, wreckage)) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    list.forEach((material) => {
      if (!(material instanceof MeshStandardMaterial)) return;
      const { r, g, b } = material.emissive;
      if (r === 0 && g === 0 && b === 0) return;
      materials.add(material);
    });
  });
  return [...materials];
}
