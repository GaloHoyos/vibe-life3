import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
} from "three";

/**
 * Visual procedural del manhack (no hay GLB; `src/models/` es intocable). Un
 * drone metalico: cuerpo esferico, ojo emisivo al frente (+z), aro exterior y
 * una cuchilla giratoria. El hijo `manhack-blade` lo gira el `CreatureAnimator`.
 * Materiales inline (como los efectos): look propio, sin sumar `MaterialKey`s.
 */
export function createManhackVisual(): Object3D {
  const root = new Group();
  root.name = "manhack";

  const bodyMat = new MeshStandardMaterial({ color: 0x303338, roughness: 0.45, metalness: 0.85 });
  const trimMat = new MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.7 });
  const eyeMat = new MeshStandardMaterial({
    color: 0x220000,
    emissive: 0xff2a12,
    emissiveIntensity: 2.2,
    roughness: 0.3,
  });
  const bladeMat = new MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.95 });

  const body = new Mesh(new SphereGeometry(0.16, 16, 12), bodyMat);
  body.scale.set(1, 0.8, 1);
  root.add(body);

  const cage = new Mesh(new TorusGeometry(0.2, 0.018, 8, 20), trimMat);
  cage.rotation.x = Math.PI / 2;
  root.add(cage);

  const eye = new Mesh(new SphereGeometry(0.06, 12, 10), eyeMat);
  eye.position.set(0, 0, 0.14);
  root.add(eye);

  const blade = new Group();
  blade.name = "manhack-blade";
  const bladeRim = new Mesh(new TorusGeometry(0.16, 0.01, 6, 18), bladeMat);
  bladeRim.rotation.x = Math.PI / 2;
  blade.add(bladeRim);
  for (let i = 0; i < 2; i += 1) {
    const vane = new Mesh(new BoxGeometry(0.3, 0.006, 0.04), bladeMat);
    vane.rotation.y = (i * Math.PI) / 2;
    blade.add(vane);
  }
  blade.position.y = -0.02;
  root.add(blade);

  for (const side of [-1, 1]) {
    const fin = new Mesh(new BoxGeometry(0.05, 0.02, 0.12), trimMat);
    fin.position.set(side * 0.2, 0, -0.02);
    root.add(fin);
  }

  root.traverse((object) => {
    if (object instanceof Mesh) object.castShadow = true;
  });
  return root;
}
