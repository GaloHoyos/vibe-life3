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
  forwardSpeed: 0,
  steering: 0,
  yawRate: 0,
  engine01: 0,
  hull01: 1,
  burning: false,
  occupied: false,
  riderYaw: 0,
  riderPitch: 0,
  dead: false,
};

describe("CreatureVehicleAnimator", () => {
  it("bate los remos en ola metacrónica, con la popa adelantada a la proa", () => {
    const root = swimmerRig();
    const animator = createCreatureVehicleAnimator(root);

    run(animator, { ...IDLE, speed: 20, forwardSpeed: 20, engine01: 1, occupied: true });

    const front = root.getObjectByName("swimmer_oar_left_0")!;
    const rear = root.getObjectByName("swimmer_oar_left_2")!;
    expect(front.rotation.x).not.toBeCloseTo(0);
    // Mismo ciclo con retardo por par: en fase serían idénticos y el bicho
    // remaría como un mecanismo de biela.
    expect(front.rotation.x).not.toBeCloseTo(rear.rotation.x, 2);

    animator.dispose();
  });

  it("arrastra la punta de la antena detrás de su base", () => {
    const root = swimmerRig();
    const animator = createCreatureVehicleAnimator(root);

    // Frenazo: la inercia manda las antenas al frente y la punta llega tarde.
    run(animator, { ...IDLE, speed: 24, forwardSpeed: 24, engine01: 1, occupied: true }, 90);
    run(animator, { ...IDLE, speed: 0, forwardSpeed: 0, occupied: true }, 6);

    const base = root.getObjectByName("swimmer_antenna_left")!;
    const tip = root.getObjectByName("swimmer_antenna_left_tip")!;
    expect(Math.abs(tip.rotation.x)).toBeLessThan(Math.abs(base.rotation.x));

    animator.dispose();
  });

  it("acota la postura para no marear al jinete, que cuelga de este nodo", () => {
    const root = swimmerRig();
    const animator = createCreatureVehicleAnimator(root);

    run(
      animator,
      { ...IDLE, speed: 30, forwardSpeed: 30, yawRate: 3, engine01: 1, occupied: true },
      240,
    );

    expect(Math.abs(root.rotation.z)).toBeLessThanOrEqual(0.16 + 1e-6);
    expect(Math.abs(root.rotation.x)).toBeLessThanOrEqual(0.12 + 1e-6);

    animator.dispose();
  });

  it("apaga el ojo Combine a medida que se muere", () => {
    const root = swimmerRig();
    const animator = createCreatureVehicleAnimator(root);
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
    const root = swimmerRig();
    const animator = createCreatureVehicleAnimator(root);

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
    const root = swimmerRig();
    const animator = createCreatureVehicleAnimator(root);
    const head = root.getObjectByName("swimmer_head")!;

    run(animator, { ...IDLE, occupied: true, riderYaw: 0.7, riderPitch: 0.3 }, 120);

    // Yaw directo y pitch invertido: mirar a la izquierda del vehículo tiene
    // que llevar el hocico al mismo lado que la cámara, no al contrario.
    expect(head.rotation.y).toBeGreaterThan(0.5);
    expect(head.rotation.x).toBeLessThan(-0.2);

    animator.dispose();
  });

  it("no deja que el cuello se desarme aunque la mirada se vaya al hombro", () => {
    const root = swimmerRig();
    const animator = createCreatureVehicleAnimator(root);
    const head = root.getObjectByName("swimmer_head")!;

    run(animator, { ...IDLE, occupied: true, riderYaw: 3, riderPitch: 1.5 }, 200);

    expect(Math.abs(head.rotation.y)).toBeLessThanOrEqual(0.96);
    expect(Math.abs(head.rotation.x)).toBeLessThanOrEqual(0.46);

    animator.dispose();
  });

  it("cuelga los apéndices hacia el abajo del mundo cuando muere de costado", () => {
    const root = swimmerRig();
    const animator = createCreatureVehicleAnimator(root);
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
    const root = swimmerRig();
    const animator = createCreatureVehicleAnimator(root);
    const material = (root.getObjectByName("combineSwimmer_eye") as Mesh)
      .material as MeshStandardMaterial;

    run(animator, { ...IDLE, dead: true }, 240);

    expect(material.emissiveIntensity).toBe(0);
    expect(Math.abs(root.rotation.x)).toBeLessThan(0.02);
    expect(Math.abs(root.position.y)).toBeLessThan(0.02);

    animator.dispose();
  });

  it("sólo deforma la piel, no los apéndices articulados", () => {
    const root = swimmerRig();
    const skin = root.getObjectByName("combineSwimmer_body") as Mesh;
    const oar = root.getObjectByName("swimmer_oar_left_0")!.children[0] as Mesh;
    const animator = createCreatureVehicleAnimator(root);

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
 */
function swimmerRig(): Object3D {
  const holder = new Group();
  const root = new Group();
  root.name = "combineSwimmer_vehicle";
  holder.add(root);
  root.add(skinMesh("combineSwimmer_body"));
  root.add(node("swimmer_gills"));

  const head = node("swimmer_head");
  head.add(emissiveMesh("combineSwimmer_eye"));
  head.add(node("swimmer_jaw"));
  root.add(head);

  for (const side of ["left", "right"]) {
    const base = node(`swimmer_antenna_${side}`);
    base.rotation.set(-0.5, side === "left" ? -0.3 : 0.3, 0);
    base.add(node(`swimmer_antenna_${side}_tip`));
    head.add(base);
    for (let index = 0; index < 3; index += 1) {
      const oar = node(`swimmer_oar_${side}_${index}`);
      oar.add(skinMesh(`oar_mesh_${side}_${index}`));
      root.add(oar);
    }
  }

  const tail = node("swimmer_tail_0");
  tail.add(node("swimmer_tail_1"));
  root.add(tail);

  // El cadáver comparte el prefijo de la piel y no debe ondular.
  const wreckage = node("wreckage");
  wreckage.add(skinMesh("combineSwimmer_body_wreck"));
  root.add(wreckage);
  return root;
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
