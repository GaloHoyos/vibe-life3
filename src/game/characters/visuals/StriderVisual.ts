import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  RepeatWrapping,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
} from "three";

const shellTexture = createOrganicTexture(96, 0x8c7753, 0x514331, 0xb4996f, 0x7c2f1e);
const shellBump = createBumpTexture(96, 0.58);
const paleTexture = createOrganicTexture(80, 0xb7ae92, 0x655f4d, 0xd1c4a4, 0x9d3f2c);
const darkTexture = createOrganicTexture(64, 0x2f3028, 0x111310, 0x5c5948, 0x1a1d1e);

const SPHERE_16 = new SphereGeometry(1, 16, 10);
const SPHERE_24 = new SphereGeometry(1, 24, 14);
const CABLE_GEOMETRY = new CylinderGeometry(0.018, 0.018, 1, 6);
const JOINT_GEOMETRY = new SphereGeometry(0.16, 12, 8);

export function createStriderVisual(): Group {
  const root = new Group();
  root.name = "strider";

  const shell = new MeshStandardMaterial({
    color: 0x9a855e,
    map: shellTexture,
    bumpMap: shellBump,
    bumpScale: 0.08,
    roughness: 0.86,
    metalness: 0.08,
  });
  const pale = new MeshStandardMaterial({
    color: 0xb8ad8d,
    map: paleTexture,
    bumpMap: shellBump,
    bumpScale: 0.05,
    roughness: 0.82,
    metalness: 0.05,
  });
  const dark = new MeshStandardMaterial({
    color: 0x242820,
    map: darkTexture,
    roughness: 0.58,
    metalness: 0.48,
  });
  const black = new MeshStandardMaterial({
    color: 0x090b0c,
    roughness: 0.42,
    metalness: 0.72,
  });
  const joint = new MeshStandardMaterial({
    color: 0x494734,
    map: darkTexture,
    roughness: 0.68,
    metalness: 0.28,
  });
  const wound = new MeshStandardMaterial({
    color: 0x8d4c35,
    map: paleTexture,
    roughness: 0.9,
    metalness: 0.02,
  });
  const visor = new MeshStandardMaterial({
    color: 0x141713,
    roughness: 0.32,
    metalness: 0.65,
  });
  const eye = new MeshStandardMaterial({
    color: 0x3fb8ff,
    emissive: 0x32a6ff,
    emissiveIntensity: 1.8,
    roughness: 0.2,
    metalness: 0.25,
  });
  const minigunGlow = new MeshStandardMaterial({
    color: 0x141719,
    emissive: 0xff8a2a,
    emissiveIntensity: 0,
    roughness: 0.3,
    metalness: 0.78,
  });
  const cannonGlow = new MeshStandardMaterial({
    color: 0x13202b,
    emissive: 0x53c8ff,
    emissiveIntensity: 0,
    roughness: 0.28,
    metalness: 0.78,
  });

  const body = addMesh(root, "strider-body", SPHERE_24, shell);
  body.scale.set(1.45, 0.62, 2.05);
  body.position.set(0, 0.22, 0.42);
  body.rotation.x = -0.05;

  const underbelly = addMesh(root, "strider-underbelly", SPHERE_16, dark);
  underbelly.scale.set(0.88, 0.48, 1.25);
  underbelly.position.set(0, -0.17, 0.98);

  const backPlate = addMesh(root, "strider-back-plate", SPHERE_24, shell);
  backPlate.scale.set(1.56, 0.32, 1.55);
  backPlate.position.set(0, 0.66, -0.36);
  backPlate.rotation.x = 0.16;

  const rearLip = addMesh(root, "strider-shell-rear-lip", SPHERE_16, shell);
  rearLip.scale.set(1.2, 0.2, 0.54);
  rearLip.position.set(0, 0.42, -1.7);
  rearLip.rotation.x = 0.22;

  const frontBrow = addMesh(root, "strider-shell-front-brow", SPHERE_16, shell);
  frontBrow.scale.set(1.18, 0.24, 0.72);
  frontBrow.position.set(0, 0.52, 1.72);
  frontBrow.rotation.x = -0.12;

  const head = addMesh(root, "strider-head", SPHERE_16, shell);
  head.scale.set(0.82, 0.42, 0.86);
  head.position.set(0, 0.2, 2.28);
  head.rotation.x = -0.08;

  const visorLeft = addMesh(root, "strider-visor-left", SPHERE_16, visor);
  visorLeft.scale.set(0.34, 0.13, 0.26);
  visorLeft.position.set(-0.26, 0.28, 2.82);
  visorLeft.rotation.y = -0.16;

  const visorRight = addMesh(root, "strider-visor-right", SPHERE_16, visor);
  visorRight.scale.set(0.34, 0.13, 0.26);
  visorRight.position.set(0.26, 0.28, 2.82);
  visorRight.rotation.y = 0.16;

  const eyeMesh = addMesh(root, "strider-eye", SPHERE_16, eye);
  eyeMesh.scale.set(0.14, 0.08, 0.08);
  eyeMesh.position.set(0, 0.18, 2.96);

  addSidePod(root, "left", pale, wound);
  addSidePod(root, "right", pale, wound);
  addRidges(root, shell);

  const minigun = addMesh(root, "strider-minigun", new CylinderGeometry(0.065, 0.085, 1.55, 12), black);
  minigun.rotation.x = Math.PI / 2;
  minigun.position.set(0.27, -0.52, 2.76);
  const minigunSleeve = addMesh(root, "strider-minigun-sleeve", new CylinderGeometry(0.12, 0.15, 0.42, 12), dark);
  minigunSleeve.rotation.x = Math.PI / 2;
  minigunSleeve.position.set(0.27, -0.52, 2.18);
  const minigunMuzzle = addMesh(root, "strider-minigun-muzzle", new SphereGeometry(0.105, 12, 8), minigunGlow);
  minigunMuzzle.position.set(0.27, -0.52, 3.56);

  const cannon = addMesh(root, "strider-cannon", new CylinderGeometry(0.14, 0.24, 1.75, 16), black);
  cannon.rotation.x = Math.PI / 2;
  cannon.position.set(0, -0.8, 2.36);
  const cannonRoot = addMesh(root, "strider-cannon-root", new SphereGeometry(0.28, 16, 10), dark);
  cannonRoot.scale.set(1, 0.65, 0.85);
  cannonRoot.position.set(0, -0.8, 1.72);
  const cannonMuzzle = addMesh(root, "strider-cannon-muzzle", new SphereGeometry(0.2, 16, 10), cannonGlow);
  cannonMuzzle.position.set(0, -0.8, 3.28);

  addLeg(root, "left", joint, black);
  addLeg(root, "right", joint, black);
  addLeg(root, "rear", joint, black);

  addAntenna(root, "left", -0.5, 0.48, dark);
  addAntenna(root, "right", 0.5, -0.48, dark);
  addTendril(root, "left", -0.22, dark);
  addTendril(root, "right", 0.22, dark);

  return root;
}

function addSidePod(root: Group, side: "left" | "right", material: MeshStandardMaterial, stain: MeshStandardMaterial): void {
  const sign = side === "left" ? -1 : 1;
  const pod = addMesh(root, `strider-side-pod-${side}`, SPHERE_16, material);
  pod.scale.set(0.3, 0.24, 0.9);
  pod.position.set(sign * 0.92, -0.03, 1.18);
  pod.rotation.z = sign * 0.28;
  pod.rotation.y = sign * 0.12;

  const patch = addMesh(root, `strider-side-pod-${side}-stain`, SPHERE_16, stain);
  patch.scale.set(0.14, 0.05, 0.36);
  patch.position.set(sign * 0.98, -0.02, 1.46);
  patch.rotation.z = sign * 0.28;
}

function addRidges(root: Group, material: MeshStandardMaterial): void {
  for (let i = 0; i < 7; i += 1) {
    const z = -1.35 + i * 0.45;
    const ridge = addMesh(root, `strider-shell-ridge-${i}`, new BoxGeometry(0.06, 0.04, 0.34), material);
    ridge.scale.set(1 + Math.sin(i * 1.7) * 0.15, 1, 1);
    ridge.position.set(-0.36 + (i % 3) * 0.36, 0.96 - Math.abs(z) * 0.08, z);
    ridge.rotation.x = 0.35;
    ridge.rotation.z = (i - 3) * 0.04;
  }
}

function addLeg(root: Group, side: "left" | "right" | "rear", material: MeshStandardMaterial, black: MeshStandardMaterial): void {
  root.add(createLegSegment(`strider-leg-${side}-upper`, 0.12, 0.09, material, black));
  root.add(createLegSegment(`strider-leg-${side}-lower`, 0.1, 0.065, material, black));

  const foot = new Group();
  foot.name = `strider-leg-${side}-foot`;
  const spike = addMesh(foot, `${foot.name}-spike`, new ConeGeometry(0.09, 0.9, 10), black);
  spike.position.y = -0.28;
  spike.rotation.x = Math.PI;
  const pad = addMesh(foot, `${foot.name}-pad`, new SphereGeometry(0.18, 12, 8), material);
  pad.scale.set(1.25, 0.5, 1);
  pad.position.y = 0.14;
  for (let i = 0; i < 3; i += 1) {
    const angle = i * (Math.PI * 2 / 3) + (side === "rear" ? Math.PI : 0);
    const claw = addMesh(foot, `${foot.name}-claw-${i}`, new CylinderGeometry(0.015, 0.025, 0.52, 6), black);
    claw.position.set(Math.sin(angle) * 0.22, -0.05, Math.cos(angle) * 0.22);
    claw.rotation.z = Math.sin(angle) * 0.95;
    claw.rotation.x = Math.cos(angle) * 0.95;
  }
  root.add(foot);

  const hip = new Group();
  hip.name = `strider-leg-${side}-hip`;
  const socket = addMesh(hip, `${hip.name}-socket`, JOINT_GEOMETRY, material);
  socket.scale.set(1.25, 0.9, 1.1);
  const armor = addMesh(hip, `${hip.name}-armor`, SPHERE_16, material);
  armor.scale.set(0.34, 0.14, 0.22);
  armor.position.y = 0.14;
  root.add(hip);
}

function createLegSegment(
  name: string,
  radiusTop: number,
  radiusBottom: number,
  material: MeshStandardMaterial,
  dark: MeshStandardMaterial,
): Group {
  const group = new Group();
  group.name = name;
  const core = addMesh(group, `${name}-core`, new CylinderGeometry(radiusTop, radiusBottom, 1, 12), material);
  core.scale.set(0.78, 1, 0.78);
  const cableA = addMesh(group, `${name}-cable-a`, CABLE_GEOMETRY, dark);
  cableA.position.x = radiusTop + 0.045;
  const cableB = addMesh(group, `${name}-cable-b`, CABLE_GEOMETRY, dark);
  cableB.position.x = -(radiusTop + 0.045);
  const topJoint = addMesh(group, `${name}-joint-top`, JOINT_GEOMETRY, material);
  topJoint.scale.set(0.8, 0.8, 0.8);
  topJoint.position.y = 0.5;
  const bottomJoint = addMesh(group, `${name}-joint-bottom`, JOINT_GEOMETRY, material);
  bottomJoint.scale.set(0.72, 0.72, 0.72);
  bottomJoint.position.y = -0.5;
  return group;
}

function addAntenna(root: Group, side: "left" | "right", x: number, roll: number, material: MeshStandardMaterial): void {
  const antenna = addMesh(root, `strider-antenna-${side}`, new CylinderGeometry(0.018, 0.028, 1.5, 8), material);
  antenna.position.set(x, 0.86, 1.58);
  antenna.rotation.z = roll;
  antenna.rotation.x = -0.35;
}

function addTendril(root: Group, side: "left" | "right", x: number, material: MeshStandardMaterial): void {
  const tendril = addMesh(root, `strider-tendril-${side}`, new CylinderGeometry(0.012, 0.02, 0.8, 6), material);
  tendril.position.set(x, -0.58, 1.78);
  tendril.rotation.x = 0.45;
  tendril.rotation.z = side === "left" ? -0.35 : 0.35;
}

function addMesh(
  parent: Group,
  name: string,
  geometry: BoxGeometry | ConeGeometry | CylinderGeometry | SphereGeometry,
  material: MeshStandardMaterial,
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createOrganicTexture(
  size: number,
  baseHex: number,
  lowHex: number,
  highHex: number,
  stainHex: number,
): DataTexture {
  const base = new Color(baseHex);
  const low = new Color(lowHex);
  const high = new Color(highHex);
  const stain = new Color(stainHex);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const grain = hashNoise(x * 2.1, y * 0.7);
      const vein = Math.sin(x * 0.18 + Math.sin(y * 0.09) * 2.4) * 0.5 + 0.5;
      const scratches = hashNoise(Math.floor(x / 3), Math.floor(y / 11)) > 0.78 ? 0.22 : 0;
      const stainMask = hashNoise(x * 0.14 + 31.7, y * 0.14 - 9.2) > 0.84 ? 1 : 0;
      const color = base
        .clone()
        .lerp(low, Math.max(0, 0.35 - grain * 0.35) + scratches)
        .lerp(high, Math.max(0, vein - 0.62) * 0.42)
        .lerp(stain, stainMask * (0.18 + grain * 0.16));
      data[i + 0] = Math.round(color.r * 255);
      data[i + 1] = Math.round(color.g * 255);
      data[i + 2] = Math.round(color.b * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2.5, 2.5);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createBumpTexture(size: number, contrast: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const ridges = Math.sin(x * 0.28 + Math.sin(y * 0.11) * 1.8) * 0.5 + 0.5;
      const fine = hashNoise(x * 1.7, y * 1.7);
      const value = Math.round((0.32 + ridges * 0.42 + fine * 0.26 * contrast) * 255);
      data[i + 0] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(3, 3);
  texture.needsUpdate = true;
  return texture;
}

function hashNoise(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
