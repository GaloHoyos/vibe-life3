import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from "three";

export function createStriderVisual(): Group {
  const root = new Group();
  root.name = "strider";

  const shell = new MeshStandardMaterial({
    color: 0x7f7a66,
    roughness: 0.72,
    metalness: 0.25,
  });
  const pale = new MeshStandardMaterial({
    color: 0xaeb8aa,
    roughness: 0.82,
    metalness: 0.12,
  });
  const dark = new MeshStandardMaterial({
    color: 0x1d2020,
    roughness: 0.55,
    metalness: 0.62,
  });
  const joint = new MeshStandardMaterial({
    color: 0x30372f,
    roughness: 0.58,
    metalness: 0.45,
  });
  const eye = new MeshStandardMaterial({
    color: 0x5ac2ff,
    emissive: 0x32a6ff,
    emissiveIntensity: 1.8,
    roughness: 0.2,
    metalness: 0.25,
  });
  const muzzle = new MeshStandardMaterial({
    color: 0x1a2430,
    emissive: 0x000000,
    emissiveIntensity: 0,
    roughness: 0.35,
    metalness: 0.7,
  });

  const body = new Mesh(new SphereGeometry(1, 24, 14), shell);
  body.name = "strider-body";
  body.scale.set(1.45, 0.78, 2.25);
  body.position.set(0, 0.05, 0.45);
  root.add(body);

  const backPlate = new Mesh(new SphereGeometry(1, 20, 10), pale);
  backPlate.name = "strider-back-plate";
  backPlate.scale.set(1.15, 0.42, 1.65);
  backPlate.position.set(0, 0.4, -0.05);
  root.add(backPlate);

  const head = new Mesh(new SphereGeometry(1, 22, 12), shell);
  head.name = "strider-head";
  head.scale.set(0.9, 0.52, 0.92);
  head.position.set(0, 0.2, 2.25);
  root.add(head);

  const eyeMesh = new Mesh(new SphereGeometry(0.16, 16, 10), eye);
  eyeMesh.name = "strider-eye";
  eyeMesh.position.set(0, 0.25, 2.96);
  root.add(eyeMesh);

  const minigun = new Mesh(new CylinderGeometry(0.07, 0.07, 1.5, 12), dark);
  minigun.name = "strider-minigun";
  minigun.rotation.x = Math.PI / 2;
  minigun.position.set(0.26, -0.42, 2.75);
  root.add(minigun);

  const minigunMuzzle = new Mesh(new SphereGeometry(0.11, 12, 8), muzzle.clone());
  minigunMuzzle.name = "strider-minigun-muzzle";
  minigunMuzzle.position.set(0.26, -0.42, 3.52);
  root.add(minigunMuzzle);

  const cannon = new Mesh(new CylinderGeometry(0.16, 0.22, 1.65, 16), dark);
  cannon.name = "strider-cannon";
  cannon.rotation.x = Math.PI / 2;
  cannon.position.set(0, -0.72, 2.35);
  root.add(cannon);

  const cannonMuzzle = new Mesh(new SphereGeometry(0.22, 16, 10), muzzle.clone());
  cannonMuzzle.name = "strider-cannon-muzzle";
  cannonMuzzle.position.set(0, -0.72, 3.22);
  root.add(cannonMuzzle);

  addLeg(root, "left", joint);
  addLeg(root, "right", joint);
  addLeg(root, "rear", joint);

  const antennaLeft = new Mesh(new CylinderGeometry(0.025, 0.025, 1.4, 8), dark);
  antennaLeft.name = "strider-antenna-left";
  antennaLeft.position.set(-0.45, 0.82, 1.7);
  antennaLeft.rotation.z = 0.45;
  root.add(antennaLeft);

  const antennaRight = antennaLeft.clone();
  antennaRight.name = "strider-antenna-right";
  antennaRight.position.x = 0.45;
  antennaRight.rotation.z = -0.45;
  root.add(antennaRight);

  return root;
}

function addLeg(root: Group, side: "left" | "right" | "rear", material: MeshStandardMaterial): void {
  const upper = new Mesh(new CylinderGeometry(0.16, 0.2, 1, 10), material);
  upper.name = `strider-leg-${side}-upper`;
  root.add(upper);

  const lower = new Mesh(new CylinderGeometry(0.12, 0.15, 1, 10), material);
  lower.name = `strider-leg-${side}-lower`;
  root.add(lower);

  const foot = new Mesh(new ConeGeometry(0.32, 0.85, 12), material);
  foot.name = `strider-leg-${side}-foot`;
  foot.rotation.x = Math.PI / 2;
  root.add(foot);

  const hip = new Mesh(new BoxGeometry(0.45, 0.35, 0.45), material);
  hip.name = `strider-leg-${side}-hip`;
  root.add(hip);
}
