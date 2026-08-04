import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import {
  createCreatureVehicleAnimator,
  type CreatureVehicleState,
} from "@game/gameplay/vehicles/CreatureVehicleAnimator";

const IDLE: CreatureVehicleState = {
  speed: 0,
  localVelocity: new Vector3(),
  steering: 0,
  yawRate: 0,
  engine01: 0,
  hull01: 1,
  burning: false,
  occupied: false,
  riderYaw: 0,
  riderPitch: 0,
  gazeYaw: 0,
  gazePitch: 0,
  attention: 0,
  dead: false,
};

/** Estado con la marcha puesta: la velocidad local es la que mueve todo. */
function moving(forward: number, extra: Partial<CreatureVehicleState> = {}) {
  return {
    ...IDLE,
    speed: Math.abs(forward),
    localVelocity: new Vector3(0, 0, forward),
    ...extra,
  };
}

describe("CreatureVehicleAnimator", () => {
  it("bate los remos en ola metacrónica, con la popa adelantada a la proa", () => {
    const { root, body } = swimmerRig();
    const animator = createCreatureVehicleAnimator(root, body);

    run(animator, moving(20, { engine01: 1, occupied: true }));

    const front = root.getObjectByName("swimmer_oar_left_0")!;
    const rear = root.getObjectByName("swimmer_oar_left_2")!;
    expect(front.rotation.x).not.toBeCloseTo(0);
    // Mismo ciclo con retardo por par: en fase serían idénticos y el bicho
    // remaría como un mecanismo de biela.
    expect(front.rotation.x).not.toBeCloseTo(rear.rotation.x, 2);

    animator.dispose();
  });

  it("arrastra la punta de la antena detrás de su base", () => {
    const { root, body } = swimmerRig();
    const animator = createCreatureVehicleAnimator(root, body);

    // Frenazo: la inercia manda las antenas al frente y la punta llega tarde.
    run(animator, moving(24, { engine01: 1, occupied: true }), 90);
    run(animator, moving(0, { occupied: true }), 6);

    const base = root.getObjectByName("swimmer_antenna_left")!;
    const tip = root.getObjectByName("swimmer_antenna_left_tip")!;
    expect(Math.abs(tip.rotation.x)).toBeLessThan(Math.abs(base.rotation.x));

    animator.dispose();
  });

  it("acota la postura para no marear al jinete, que cuelga de este nodo", () => {
    const { root, body } = swimmerRig();
    const animator = createCreatureVehicleAnimator(root, body);

    run(
      animator,
      moving(30, { yawRate: 3, engine01: 1, occupied: true }),
      240,
    );

    expect(Math.abs(root.rotation.z)).toBeLessThanOrEqual(0.16 + 1e-6);
    expect(Math.abs(root.rotation.x)).toBeLessThanOrEqual(0.12 + 1e-6);

    animator.dispose();
  });

  it("apaga el ojo Combine a medida que se muere", () => {
    const { root, body } = swimmerRig();
    const animator = createCreatureVehicleAnimator(root, body);
    const eye = root.getObjectByName("combineSwimmer_eye") as Mesh;
    const material = eye.material as MeshStandardMaterial;

    run(animator, IDLE, 30);
    const healthy = material.emissiveIntensity;
    run(animator, { ...IDLE, hull01: 0.05 }, 30);

    expect(healthy).toBeGreaterThan(0);
    expect(material.emissiveIntensity).toBeLessThan(healthy);

    animator.dispose();
  });

  it("sacude el cuerpo al montarlo y vuelve a la calma", () => {
    const { root, body } = swimmerRig();
    const animator = createCreatureVehicleAnimator(root, body);

    run(animator, IDLE, 30);
    animator.startle(1);
    run(animator, IDLE, 4);
    const shaken = Math.abs(root.position.y);
    run(animator, IDLE, 200);

    expect(shaken).toBeGreaterThan(0.02);
    expect(Math.abs(root.position.y)).toBeLessThan(shaken);

    animator.dispose();
  });

  it("gira la cabeza hacia donde mira el jinete, con el convenio de la torreta", () => {
    const { root, body } = swimmerRig();
    const animator = createCreatureVehicleAnimator(root, body);
    const head = root.getObjectByName("swimmer_head")!;

    run(animator, { ...IDLE, occupied: true, riderYaw: 0.7, riderPitch: 0.3 }, 120);

    // Yaw directo y pitch invertido: mirar a la izquierda del vehículo tiene
    // que llevar el hocico al mismo lado que la cámara, no al contrario.
    expect(head.rotation.y).toBeGreaterThan(0.5);
    expect(head.rotation.x).toBeLessThan(-0.2);

    animator.dispose();
  });

  it("no deja que el cuello se desarme aunque la mirada se vaya al hombro", () => {
    const { root, body } = swimmerRig();
    const animator = createCreatureVehicleAnimator(root, body);
    const head = root.getObjectByName("swimmer_head")!;

    run(animator, { ...IDLE, occupied: true, riderYaw: 3, riderPitch: 1.5 }, 200);

    expect(Math.abs(head.rotation.y)).toBeLessThanOrEqual(0.96);
    expect(Math.abs(head.rotation.x)).toBeLessThanOrEqual(0.46);

    animator.dispose();
  });

  it("mira al que se le acerca y ladea la cabeza, pero sólo si está suelto", () => {
    const curious = swimmerRig();
    const ridden = swimmerRig();
    const looking = createCreatureVehicleAnimator(curious.root, curious.body);
    const busy = createCreatureVehicleAnimator(ridden.root, ridden.body);
    // Alguien parado a la izquierda del bicho, bien cerca.
    const nearby = { gazeYaw: 0.8, gazePitch: -0.2, attention: 1 };

    run(looking, { ...IDLE, ...nearby }, 180);
    // El mismo peatón con jinete arriba: la cabeza es del jinete, que mira al
    // frente. Un bicho montado que se distrae deja de leerse como vehículo.
    run(busy, { ...IDLE, ...nearby, occupied: true }, 180);

    const head = curious.root.getObjectByName("swimmer_head")!;
    expect(head.rotation.y).toBeGreaterThan(0.4);
    expect(Math.abs(head.rotation.z)).toBeGreaterThan(0.02);
    expect(
      Math.abs(ridden.root.getObjectByName("swimmer_head")!.rotation.y),
    ).toBeLessThan(0.05);

    looking.dispose();
    busy.dispose();
  });

  it("levanta las antenas hacia quien lo mira en vez de dejarlas peinadas", () => {
    const alone = swimmerRig();
    const watched = swimmerRig();
    const idle = createCreatureVehicleAnimator(alone.root, alone.body);
    const noticing = createCreatureVehicleAnimator(watched.root, watched.body);

    run(idle, IDLE, 240);
    run(noticing, { ...IDLE, gazeYaw: 0.6, attention: 1 }, 240);

    expect(
      watched.root.getObjectByName("swimmer_antenna_left")!.rotation.x,
    ).toBeGreaterThan(
      alone.root.getObjectByName("swimmer_antenna_left")!.rotation.x,
    );

    idle.dispose();
    noticing.dispose();
  });

  it("no abre la junta de la antena más de lo que el nudillo puede tapar", () => {
    const { root, body } = swimmerRig();
    const animator = createCreatureVehicleAnimator(root, body);
    const tip = root.getObjectByName("swimmer_antenna_left_tip")!;
    // Mismo quiebre de reposo que el GLB: la antena ya viene doblada de fábrica.
    const restX = tip.rotation.x;
    let worst = 0;
    const watch = (state: CreatureVehicleState, frames: number) => {
      for (let index = 0; index < frames; index += 1) {
        animator.update(1 / 60, state);
        worst = Math.max(worst, Math.abs(tip.rotation.x - restX));
      }
    };

    // Los tres casos que abrían el codo: mirar a alguien de costado, frenar de
    // golpe y recibir un empujón. Antes la punta sumaba encima una fracción de
    // la rotación de la base y la antena se veía partida en dos.
    watch({ ...IDLE, gazeYaw: 0.9, gazePitch: -0.2, attention: 1 }, 240);
    watch(moving(26, { engine01: 1, occupied: true }), 180);
    watch(moving(0, { occupied: true }), 120);
    animator.startle(1.5);
    watch({ ...IDLE, localVelocity: new Vector3(9, 3, 0), speed: 9 }, 120);
    watch({ ...IDLE, dead: true }, 240);

    expect(worst).toBeLessThanOrEqual(0.25 + 1e-6);

    animator.dispose();
  });

  it("acusa un empujón en el cuerpo sin torcerle el horizonte al jinete", () => {
    const { root, body } = swimmerRig();
    const animator = createCreatureVehicleAnimator(root, body);

    run(animator, IDLE, 120);
    const restedPosture = Math.abs(root.rotation.z);
    // Empujón lateral puro: el casco sale despedido sin que el motor lo pida y
    // sin que nadie haya avisado de un impacto. La única señal es la velocidad.
    run(animator, { ...IDLE, localVelocity: new Vector3(6, 0, 0), speed: 6 }, 3);

    expect(Math.abs(body.rotation.z) + Math.abs(body.position.x)).toBeGreaterThan(
      0.01,
    );
    // El asiento y la cámara cuelgan de `root`: el empujón no puede llegar ahí.
    expect(Math.abs(root.rotation.z)).toBeLessThanOrEqual(restedPosture + 0.02);

    animator.dispose();
  });

  it("nunca está del todo quieto: flota aunque nadie lo toque", () => {
    const { root, body } = swimmerRig();
    const animator = createCreatureVehicleAnimator(root, body);

    run(animator, IDLE, 60);
    const first = body.position.clone();
    run(animator, IDLE, 90);

    expect(body.position.distanceTo(first)).toBeGreaterThan(0.002);

    animator.dispose();
  });

  it("cuelga los apéndices hacia el abajo del mundo cuando muere de costado", () => {
    const { root, body } = swimmerRig();
    const animator = createCreatureVehicleAnimator(root, body);
    // Cadáver volcado 90°: el abajo real ya no es el abajo local, y ahí es donde
    // una pose de muerte autorada se delata.
    root.parent!.rotation.z = Math.PI / 2;
    root.parent!.updateMatrixWorld(true);

    const oar = root.getObjectByName("swimmer_oar_left_0")!;
    run(animator, { ...IDLE, dead: true }, 240);

    // Se mide la dirección en el MUNDO y no un eje de rotación: qué bisagra
    // hace el trabajo depende de cómo cayó, y lo que tiene que cumplirse es
    // que la pata termine apuntando al piso.
    const hang = new Vector3(0, -1, 0).applyQuaternion(
      oar.getWorldQuaternion(new Quaternion()),
    );
    expect(hang.y).toBeLessThan(-0.5);
    // La mandíbula queda abierta: la señal más barata de que está muerto.
    expect(root.getObjectByName("swimmer_jaw")!.rotation.x).toBeGreaterThan(0.3);

    animator.dispose();
  });

  it("apaga el ojo del cadáver y relaja la postura", () => {
    const { root, body } = swimmerRig();
    const animator = createCreatureVehicleAnimator(root, body);
    const material = (root.getObjectByName("combineSwimmer_eye") as Mesh)
      .material as MeshStandardMaterial;

    run(animator, { ...IDLE, dead: true }, 240);

    expect(material.emissiveIntensity).toBe(0);
    expect(Math.abs(root.rotation.x)).toBeLessThan(0.02);
    expect(Math.abs(root.position.y)).toBeLessThan(0.02);

    animator.dispose();
  });

  it("sólo deforma la piel, no los apéndices articulados", () => {
    const { root, body } = swimmerRig();
    const skin = root.getObjectByName("combineSwimmer_body") as Mesh;
    const oar = root.getObjectByName("swimmer_oar_left_0")!.children[0] as Mesh;
    const animator = createCreatureVehicleAnimator(root, body);

    // La ola vive en el material: el remo no puede haber quedado parcheado, o
    // se mediría contra un pivote que no es el suyo.
    expect(skin.customDepthMaterial).toBeDefined();
    expect(oar.customDepthMaterial).toBeUndefined();

    animator.dispose();
  });
});

function run(
  animator: { update: (delta: number, state: CreatureVehicleState) => void },
  state: CreatureVehicleState,
  frames = 30,
): void {
  for (let index = 0; index < frames; index += 1) {
    animator.update(1 / 60, state);
  }
}

/**
 * Mismo vocabulario de nodos que emite `tools/vehicle-assets/models.ts`, colgado
 * de un padre para poder volcar el cadáver y comprobar que los miembros caen
 * hacia el abajo del mundo.
 *
 * `body` cuelga de `root` igual que el LOD real: las mallas van ahí y las anclas
 * de asiento y cámara se quedan arriba, que es lo que le permite al cuerpo
 * bambolearse sin llevarse la cámara puesta.
 */
function swimmerRig(): { root: Object3D; body: Object3D } {
  const holder = new Group();
  const root = new Group();
  root.name = "combineSwimmer_vehicle";
  holder.add(root);
  const body = node("runtime_visual_lods");
  root.add(body);
  body.add(skinMesh("combineSwimmer_body"));
  body.add(node("swimmer_gills"));

  const head = node("swimmer_head");
  head.add(emissiveMesh("combineSwimmer_eye"));
  head.add(node("swimmer_jaw"));
  body.add(head);

  for (const side of ["left", "right"]) {
    const base = node(`swimmer_antenna_${side}`);
    base.rotation.set(-0.5, side === "left" ? -0.3 : 0.3, 0);
    const tip = node(`swimmer_antenna_${side}_tip`);
    // Mismo quiebre de fábrica que el GLB: la junta ya arranca doblada.
    tip.rotation.x = -0.24;
    base.add(tip);
    head.add(base);
    for (let index = 0; index < 3; index += 1) {
      const oar = node(`swimmer_oar_${side}_${index}`);
      oar.add(skinMesh(`oar_mesh_${side}_${index}`));
      body.add(oar);
    }
  }

  const tail = node("swimmer_tail_0");
  tail.add(node("swimmer_tail_1"));
  body.add(tail);

  // El cadáver comparte el prefijo de la piel y no debe ondular.
  const wreckage = node("wreckage");
  wreckage.add(skinMesh("combineSwimmer_body_wreck"));
  root.add(wreckage);
  return { root, body };
}

function node(name: string): Object3D {
  const object = new Group();
  object.name = name;
  return object;
}

function skinMesh(name: string): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ color: 0x556055 }),
  );
  mesh.name = name;
  return mesh;
}

function emissiveMesh(name: string): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(0.2, 0.1, 0.1),
    new MeshStandardMaterial({ emissive: new Color(0x1fc8ff), emissiveIntensity: 1 }),
  );
  mesh.name = name;
  return mesh;
}
