import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  TorusGeometry,
} from "three";

/**
 * Visual procedural v1 del gunship Combine. Mantiene la orientacion +Z como
 * frente para coincidir con los motores/animadores del resto de NPCs.
 */
export function createGunshipVisual(): Object3D {
  const root = new Group();
  root.name = "gunship";

  const hullMat = new MeshStandardMaterial({ color: 0x6d6442, roughness: 0.82, metalness: 0.18 });
  const camoMat = new MeshStandardMaterial({ color: 0x8a8459, roughness: 0.9, metalness: 0.05 });
  const paleMat = new MeshStandardMaterial({ color: 0xb9c2b8, roughness: 0.72, metalness: 0.12 });
  const darkMat = new MeshStandardMaterial({ color: 0x151718, roughness: 0.48, metalness: 0.8 });
  const metalMat = new MeshStandardMaterial({ color: 0x7e8586, roughness: 0.38, metalness: 0.86 });
  const eyeMat = new MeshStandardMaterial({
    color: 0x160018,
    emissive: 0x9f31ff,
    emissiveIntensity: 1.7,
    roughness: 0.35,
  });
  const muzzleMat = new MeshStandardMaterial({
    color: 0x140800,
    emissive: 0xffa33a,
    emissiveIntensity: 0,
    roughness: 0.4,
  });

  const body = new Mesh(new CylinderGeometry(0.48, 0.62, 2.35, 18), hullMat);
  body.rotation.x = Math.PI / 2;
  body.position.z = 0.12;
  body.scale.set(1.05, 1, 0.9);
  root.add(body);

  const nose = new Mesh(new SphereGeometry(0.5, 18, 12), hullMat);
  nose.position.z = 1.34;
  nose.scale.set(0.78, 0.82, 1.16);
  root.add(nose);

  const tail = new Mesh(new SphereGeometry(0.58, 18, 12), paleMat);
  tail.position.z = -1.12;
  tail.scale.set(0.82, 0.74, 0.62);
  root.add(tail);

  const duct = new Mesh(new TorusGeometry(0.88, 0.085, 12, 36), paleMat);
  duct.position.z = -1.54;
  duct.scale.set(0.9, 1.05, 1);
  root.add(duct);

  const rotor = new Group();
  rotor.name = "gunship-rotor";
  rotor.position.z = -1.55;
  for (let i = 0; i < 4; i += 1) {
    const blade = new Mesh(new BoxGeometry(1.32, 0.045, 0.08), metalMat);
    blade.rotation.z = (i * Math.PI) / 4;
    rotor.add(blade);
  }
  root.add(rotor);

  for (const side of [-1, 1]) {
    const pod = new Mesh(new CylinderGeometry(0.16, 0.16, 0.58, 12), darkMat);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(side * 0.38, 0.34, -0.46);
    root.add(pod);

    const wing = new Mesh(new BoxGeometry(0.62, 0.08, 0.28), hullMat);
    wing.position.set(side * 0.62, -0.06, -0.18);
    wing.rotation.z = side * 0.22;
    root.add(wing);

    const stabilizer = new Mesh(new ConeGeometry(0.11, 0.62, 4), metalMat);
    stabilizer.position.set(side * 0.78, 0.02, -1.85);
    stabilizer.rotation.z = -side * Math.PI * 0.5;
    stabilizer.rotation.y = Math.PI / 4;
    root.add(stabilizer);
  }

  const bellyEye = new Mesh(new SphereGeometry(0.22, 16, 10), eyeMat);
  bellyEye.name = "gunship-eye";
  bellyEye.position.set(0, -0.43, 0.18);
  bellyEye.scale.set(1.0, 0.48, 1.25);
  root.add(bellyEye);

  const cannon = new Mesh(new CylinderGeometry(0.045, 0.06, 1.05, 10), darkMat);
  cannon.rotation.x = Math.PI / 2;
  cannon.position.set(0, -0.18, 1.86);
  root.add(cannon);

  const muzzle = new Mesh(new SphereGeometry(0.075, 10, 8), muzzleMat);
  muzzle.name = "gunship-muzzle";
  muzzle.position.set(0, -0.18, 2.42);
  root.add(muzzle);

  const antenna = new Mesh(new BoxGeometry(0.035, 0.72, 0.035), metalMat);
  antenna.position.set(0.18, 0.78, -1.28);
  antenna.rotation.x = 0.35;
  root.add(antenna);

  const patches = [
    [-0.24, 0.47, 0.72, 0.36, 0.035, 0.32],
    [0.25, 0.49, 0.14, 0.42, 0.035, 0.26],
    [-0.18, 0.46, -0.42, 0.32, 0.035, 0.26],
    [0.18, -0.36, 0.58, 0.34, 0.032, 0.2],
  ] as const;
  for (const [x, y, z, sx, sy, sz] of patches) {
    const patch = new Mesh(new BoxGeometry(sx, sy, sz), camoMat);
    patch.position.set(x, y, z);
    patch.rotation.z = x * 0.8;
    root.add(patch);
  }

  root.traverse((object) => {
    if (object instanceof Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return root;
}
