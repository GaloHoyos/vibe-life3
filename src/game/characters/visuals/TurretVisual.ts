import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  RepeatWrapping,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from "three";

const armorTexture = createWornMetalTexture(96, 0xb7bbb2, 0x626c6d, 0xe2dfd0, 0x8a6040);
const darkTexture = createWornMetalTexture(64, 0x20272c, 0x07090a, 0x5a6368, 0x242c31);
const oliveTexture = createWornMetalTexture(80, 0x777a64, 0x34382f, 0xa7a58e, 0x674430);
const barrelTexture = createWornMetalTexture(80, 0x252b30, 0x07090a, 0x6a7277, 0x1a1f22);
const bumpTexture = createBumpTexture(96, 0.55);

const Y_AXIS = new Vector3(0, 1, 0);

/**
 * Visual procedural de la torreta de piso. Mantiene los nodos que usa el
 * TurretAnimator: `turret-barrel`, `turret-eye` y `turret-muzzle`.
 */
export function createTurretVisual(): Object3D {
  const root = new Group();
  root.name = "turret";

  const armor = new MeshStandardMaterial({
    color: 0xb8bab1,
    map: armorTexture,
    bumpMap: bumpTexture,
    bumpScale: 0.014,
    roughness: 0.62,
    metalness: 0.42,
  });
  const dark = new MeshStandardMaterial({
    color: 0x1a2024,
    map: darkTexture,
    roughness: 0.4,
    metalness: 0.86,
  });
  const olive = new MeshStandardMaterial({
    color: 0x767a62,
    map: oliveTexture,
    bumpMap: bumpTexture,
    bumpScale: 0.01,
    roughness: 0.66,
    metalness: 0.58,
  });
  const wornEdge = new MeshStandardMaterial({
    color: 0xb39a66,
    map: armorTexture,
    roughness: 0.5,
    metalness: 0.74,
  });
  const barrelMat = new MeshStandardMaterial({
    color: 0x252b30,
    map: barrelTexture,
    roughness: 0.34,
    metalness: 0.92,
  });
  const eyeMat = new MeshStandardMaterial({
    color: 0x2b0000,
    emissive: 0xff2a12,
    emissiveIntensity: 0.55,
    roughness: 0.2,
    metalness: 0.25,
  });
  const muzzleMat = new MeshStandardMaterial({
    color: 0x140a00,
    emissive: 0xffb24a,
    emissiveIntensity: 0,
    roughness: 0.28,
    metalness: 0.75,
  });
  const stencil = new MeshStandardMaterial({
    color: 0xd58a22,
    roughness: 0.82,
    metalness: 0.04,
  });

  addTripod(root, dark, armor, wornEdge);
  addBody(root, armor, dark, olive, wornEdge, stencil);
  addBarrel(root, armor, dark, olive, barrelMat, eyeMat, muzzleMat);
  addCables(root, dark);

  return root;
}

function addTripod(
  root: Group,
  dark: MeshStandardMaterial,
  armor: MeshStandardMaterial,
  wornEdge: MeshStandardMaterial,
): void {
  const hub = new Vector3(0, -0.34, 0);
  const knees = [
    new Vector3(0, -0.49, 0.13),
    new Vector3(-0.14, -0.5, -0.095),
    new Vector3(0.14, -0.5, -0.095),
  ];
  const feet = [
    new Vector3(0, -0.625, 0.34),
    new Vector3(-0.27, -0.63, -0.24),
    new Vector3(0.27, -0.63, -0.24),
  ];

  const collar = addMesh(root, "turret-tripod-collar", new CylinderGeometry(0.085, 0.105, 0.075, 14), dark);
  collar.position.copy(hub);

  for (let i = 0; i < 3; i += 1) {
    const knee = knees[i];
    const foot = feet[i];
    addCylinderBetween(root, `turret-leg-${i}-upper`, hub, knee, 0.019, armor);
    addCylinderBetween(root, `turret-leg-${i}-lower`, knee, foot, 0.014, dark);

    const kneeJoint = addMesh(root, `turret-leg-${i}-knee`, new SphereGeometry(0.034, 12, 8), wornEdge);
    kneeJoint.position.copy(knee);
    const footPad = addMesh(root, `turret-leg-${i}-foot`, new BoxGeometry(0.038, 0.022, 0.13), dark);
    footPad.position.copy(foot);
    footPad.rotation.x = i === 0 ? -0.22 : 0.18;
    footPad.rotation.y = i === 0 ? 0 : i === 1 ? -0.72 : 0.72;
  }

  const rearShield = addMesh(root, "turret-rear-leg-shield", new BoxGeometry(0.055, 0.31, 0.03), dark);
  rearShield.position.set(0.2, -0.5, -0.18);
  rearShield.rotation.z = -0.34;
  rearShield.rotation.y = 0.62;
}

function addBody(
  root: Group,
  armor: MeshStandardMaterial,
  dark: MeshStandardMaterial,
  olive: MeshStandardMaterial,
  wornEdge: MeshStandardMaterial,
  stencil: MeshStandardMaterial,
): void {
  const column = addMesh(root, "turret-center-column", new CylinderGeometry(0.045, 0.058, 0.62, 14), dark);
  column.position.y = -0.1;

  const torso = addMesh(root, "turret-tall-body", new BoxGeometry(0.22, 0.6, 0.145), armor);
  torso.position.set(0, 0.045, -0.005);
  torso.rotation.x = -0.02;

  const frontPanel = addMesh(root, "turret-front-panel", new BoxGeometry(0.15, 0.46, 0.018), armor);
  frontPanel.position.set(0, 0.07, 0.078);

  const recessedPanel = addMesh(root, "turret-recessed-front-panel", new BoxGeometry(0.116, 0.34, 0.012), olive);
  recessedPanel.position.set(0, 0.055, 0.09);

  const lowerBox = addMesh(root, "turret-lower-battery", new BoxGeometry(0.25, 0.135, 0.17), armor);
  lowerBox.position.set(0, -0.265, 0.002);

  const lowerRust = addMesh(root, "turret-lower-rust-strip", new BoxGeometry(0.255, 0.024, 0.176), wornEdge);
  lowerRust.position.set(0, -0.185, 0.004);

  const sideLeft = addMesh(root, "turret-side-plate-left", new BoxGeometry(0.035, 0.44, 0.13), dark);
  sideLeft.position.set(-0.128, 0.035, -0.01);
  sideLeft.rotation.z = -0.05;
  const sideRight = addMesh(root, "turret-side-plate-right", new BoxGeometry(0.035, 0.44, 0.13), dark);
  sideRight.position.set(0.128, 0.035, -0.01);
  sideRight.rotation.z = 0.05;

  const combineRing = addMesh(root, "turret-combine-mark-ring", new TorusGeometry(0.043, 0.005, 6, 28), stencil);
  combineRing.position.set(-0.042, 0.11, 0.1);
  const combineStem = addMesh(root, "turret-combine-mark-stem", new BoxGeometry(0.01, 0.058, 0.006), stencil);
  combineStem.position.set(-0.042, 0.11, 0.106);
  combineStem.rotation.z = -0.58;

  const tinyTextA = addMesh(root, "turret-panel-label-a", new BoxGeometry(0.072, 0.005, 0.005), wornEdge);
  tinyTextA.position.set(0.024, -0.05, 0.104);
  const tinyTextB = addMesh(root, "turret-panel-label-b", new BoxGeometry(0.052, 0.004, 0.005), wornEdge);
  tinyTextB.position.set(0.014, -0.069, 0.104);
}

function addBarrel(
  root: Group,
  armor: MeshStandardMaterial,
  dark: MeshStandardMaterial,
  olive: MeshStandardMaterial,
  barrelMat: MeshStandardMaterial,
  eyeMat: MeshStandardMaterial,
  muzzleMat: MeshStandardMaterial,
): void {
  const barrel = new Group();
  barrel.name = "turret-barrel";
  barrel.position.y = 0.43;

  const head = addMesh(barrel, "turret-head", new BoxGeometry(0.29, 0.145, 0.205), armor);
  head.position.set(0, -0.005, 0.01);

  const upperCap = addMesh(barrel, "turret-head-upper-cap", new BoxGeometry(0.27, 0.04, 0.225), armor);
  upperCap.position.set(0, 0.08, 0.02);
  upperCap.rotation.x = -0.04;

  const darkTopInset = addMesh(barrel, "turret-head-dark-top-inset", new BoxGeometry(0.2, 0.012, 0.15), dark);
  darkTopInset.position.set(0, 0.106, 0.006);

  const rearBlock = addMesh(barrel, "turret-head-rear-pack", new BoxGeometry(0.25, 0.105, 0.095), olive);
  rearBlock.position.set(0, -0.012, -0.128);

  const frontFace = addMesh(barrel, "turret-head-front-face", new BoxGeometry(0.22, 0.1, 0.028), dark);
  frontFace.position.set(0, -0.012, 0.128);

  const mainGun = addMesh(barrel, "turret-main-gun", new CylinderGeometry(0.022, 0.026, 0.46, 14), barrelMat);
  mainGun.rotation.x = Math.PI / 2;
  mainGun.position.set(0, 0.035, 0.34);

  const barrelSleeve = addMesh(barrel, "turret-main-gun-sleeve", new CylinderGeometry(0.035, 0.042, 0.12, 14), dark);
  barrelSleeve.rotation.x = Math.PI / 2;
  barrelSleeve.position.set(0, 0.035, 0.18);

  const lowerGun = addMesh(barrel, "turret-lower-gun", new CylinderGeometry(0.012, 0.016, 0.28, 10), barrelMat);
  lowerGun.rotation.x = Math.PI / 2;
  lowerGun.position.set(-0.075, -0.05, 0.255);

  const muzzle = addMesh(barrel, "turret-muzzle", new CylinderGeometry(0.024, 0.024, 0.025, 12), muzzleMat);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.035, 0.58);

  const sideMuzzle = addMesh(barrel, "turret-secondary-muzzle", new CylinderGeometry(0.015, 0.015, 0.02, 10), muzzleMat);
  sideMuzzle.rotation.x = Math.PI / 2;
  sideMuzzle.position.set(-0.075, -0.05, 0.405);

  const eyeSocket = addMesh(barrel, "turret-eye-socket", new CylinderGeometry(0.034, 0.04, 0.035, 16), dark);
  eyeSocket.rotation.x = Math.PI / 2;
  eyeSocket.position.set(0.09, -0.028, 0.145);

  const eye = addMesh(barrel, "turret-eye", new SphereGeometry(0.03, 14, 10), eyeMat);
  eye.position.set(0.09, -0.028, 0.166);

  const hingeLeft = addMesh(barrel, "turret-head-hinge-left", new CylinderGeometry(0.028, 0.028, 0.03, 12), dark);
  hingeLeft.rotation.z = Math.PI / 2;
  hingeLeft.position.set(-0.165, -0.005, -0.025);
  const hingeRight = addMesh(barrel, "turret-head-hinge-right", new CylinderGeometry(0.028, 0.028, 0.03, 12), dark);
  hingeRight.rotation.z = Math.PI / 2;
  hingeRight.position.set(0.165, -0.005, -0.025);

  root.add(barrel);
}

function addCables(root: Group, dark: MeshStandardMaterial): void {
  addCylinderBetween(root, "turret-rear-cable-left", new Vector3(-0.12, 0.42, -0.12), new Vector3(-0.18, 0.18, -0.1), 0.006, dark);
  addCylinderBetween(root, "turret-rear-cable-right", new Vector3(0.13, 0.42, -0.12), new Vector3(0.18, 0.16, -0.08), 0.006, dark);
  addCylinderBetween(root, "turret-side-wire", new Vector3(0.2, 0.47, -0.05), new Vector3(0.22, 0.27, 0.07), 0.005, dark);
}

function addCylinderBetween(
  parent: Object3D,
  name: string,
  start: Vector3,
  end: Vector3,
  radius: number,
  material: MeshStandardMaterial,
): Mesh {
  const delta = end.clone().sub(start);
  const mesh = addMesh(parent, name, new CylinderGeometry(radius, radius, delta.length(), 8), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(Y_AXIS, delta.normalize()));
  return mesh;
}

function addMesh(
  parent: Object3D,
  name: string,
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function createWornMetalTexture(
  size: number,
  baseHex: number,
  lowHex: number,
  highHex: number,
  rustHex: number,
): DataTexture {
  const base = new Color(baseHex);
  const low = new Color(lowHex);
  const high = new Color(highHex);
  const rust = new Color(rustHex);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const grain = hashNoise(x * 1.8, y * 0.72);
      const verticalWear = hashNoise(Math.floor(x / 3), Math.floor(y / 16)) > 0.8 ? 1 : 0;
      const edge = x < 5 || y < 5 || x > size - 6 || y > size - 6 ? 0.26 : 0;
      const rustMask = hashNoise(x * 0.13 - 8.1, y * 0.15 + 21.4) > 0.91 ? 1 : 0;
      const color = base
        .clone()
        .lerp(low, Math.max(0, 0.32 - grain * 0.28))
        .lerp(high, edge + verticalWear * (0.14 + grain * 0.1))
        .lerp(rust, rustMask * 0.22);
      data[i + 0] = Math.round(color.r * 255);
      data[i + 1] = Math.round(color.g * 255);
      data[i + 2] = Math.round(color.b * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2.1, 2.4);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createBumpTexture(size: number, contrast: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const scratches = hashNoise(Math.floor(x / 2), Math.floor(y / 13)) > 0.78 ? 0.28 : 0;
      const grain = hashNoise(x * 2.0, y * 2.0);
      const value = Math.round((0.36 + grain * 0.3 * contrast + scratches) * 255);
      data[i + 0] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2.5, 2.5);
  texture.needsUpdate = true;
  return texture;
}

function hashNoise(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
