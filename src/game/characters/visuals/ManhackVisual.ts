import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  RepeatWrapping,
  RGBAFormat,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  type BufferGeometry,
} from "three";

const armorTexture = createScratchedMetalTexture(96, 0x59616a, 0x252a30, 0xb0b4ad, 0x7b5636);
const darkTexture = createScratchedMetalTexture(64, 0x242a2f, 0x0d1012, 0x5a6265, 0x26303a);
const bladeTexture = createScratchedMetalTexture(96, 0xaeb4b8, 0x5b646b, 0xf4f1df, 0x7a5638);
const cyanTexture = createGlowTexture(64, 0x0bf2ee, 0x70fff5);
const metalBump = createBumpTexture(96, 0.58);

const SPHERE_16 = new SphereGeometry(1, 16, 10);
const SPHERE_24 = new SphereGeometry(1, 24, 14);

/**
 * Visual procedural del manhack. Compacto por diseno: el preset ya aplica
 * visualScale 1.2, asi que esta geometria mantiene la silueta dentro del collider.
 */
export function createManhackVisual(): Object3D {
  const root = new Group();
  root.name = "manhack";
  root.scale.set(0.78, 0.48, 0.78);

  const armor = new MeshStandardMaterial({
    color: 0x59616a,
    map: armorTexture,
    bumpMap: metalBump,
    bumpScale: 0.012,
    roughness: 0.44,
    metalness: 0.84,
  });
  const dark = new MeshStandardMaterial({
    color: 0x20262b,
    map: darkTexture,
    roughness: 0.36,
    metalness: 0.88,
  });
  const wornEdge = new MeshStandardMaterial({
    color: 0x9d8355,
    map: bladeTexture,
    roughness: 0.38,
    metalness: 0.82,
  });
  const bladeMat = new MeshStandardMaterial({
    color: 0xc1c7cb,
    map: bladeTexture,
    bumpMap: metalBump,
    bumpScale: 0.008,
    roughness: 0.24,
    metalness: 0.96,
  });
  const eyeMat = new MeshStandardMaterial({
    color: 0x250000,
    emissive: 0xff2a12,
    emissiveIntensity: 2.5,
    roughness: 0.18,
    metalness: 0.28,
  });
  const lensGlass = new MeshStandardMaterial({
    color: 0xff7356,
    emissive: 0xff1800,
    emissiveIntensity: 1.8,
    roughness: 0.1,
    metalness: 0.05,
    transparent: true,
    opacity: 0.82,
  });
  const cyanCore = new MeshStandardMaterial({
    color: 0x0ddbd7,
    emissive: 0x00f5f0,
    emissiveIntensity: 1.35,
    map: cyanTexture,
    roughness: 0.2,
    metalness: 0.12,
  });
  const bladeBlur = new MeshStandardMaterial({
    color: 0xa8fffb,
    emissive: 0x22e9e4,
    emissiveIntensity: 0.55,
    roughness: 0.16,
    metalness: 0.12,
    transparent: true,
    opacity: 0.28,
  });

  const core = addMesh(root, "manhack-core", SPHERE_24, dark);
  core.scale.set(0.13, 0.18, 0.12);
  core.position.y = 0.01;

  const upperShell = addMesh(root, "manhack-upper-shell", new BoxGeometry(0.29, 0.1, 0.17), armor);
  upperShell.position.set(0, 0.12, 0.005);
  upperShell.rotation.x = -0.08;

  const upperBrow = addMesh(root, "manhack-front-brow", new BoxGeometry(0.32, 0.035, 0.08), wornEdge);
  upperBrow.position.set(0, 0.074, 0.12);
  upperBrow.rotation.x = -0.14;

  const rearBlock = addMesh(root, "manhack-rear-block", new BoxGeometry(0.25, 0.13, 0.095), armor);
  rearBlock.position.set(0, 0.045, -0.12);
  rearBlock.rotation.x = 0.08;

  const lowerJaw = addMesh(root, "manhack-lower-jaw", new BoxGeometry(0.24, 0.08, 0.14), armor);
  lowerJaw.position.set(0, -0.13, 0.055);
  lowerJaw.rotation.x = 0.1;

  const lowerLip = addMesh(root, "manhack-lower-lip", new BoxGeometry(0.26, 0.026, 0.1), wornEdge);
  lowerLip.position.set(0, -0.09, 0.13);
  lowerLip.rotation.x = 0.12;

  const cyanChest = addMesh(root, "manhack-cyan-core", SPHERE_16, cyanCore);
  cyanChest.scale.set(0.09, 0.13, 0.045);
  cyanChest.position.set(0, -0.015, 0.09);

  const eyeSocket = addMesh(root, "manhack-eye-socket", new CylinderGeometry(0.052, 0.06, 0.052, 16), dark);
  eyeSocket.rotation.x = Math.PI / 2;
  eyeSocket.position.set(0, -0.065, 0.17);
  const eye = addMesh(root, "manhack-eye", SPHERE_16, eyeMat);
  eye.scale.set(0.047, 0.047, 0.026);
  eye.position.set(0, -0.065, 0.202);
  const lens = addMesh(root, "manhack-eye-lens", SPHERE_16, lensGlass);
  lens.scale.set(0.03, 0.03, 0.014);
  lens.position.set(0, -0.065, 0.222);

  addBladeAssembly(root, bladeMat, bladeBlur, wornEdge);
  addSideDetails(root, armor, dark, wornEdge, cyanCore, eyeMat);
  addHooks(root, armor, dark, wornEdge);

  return root;
}

function addBladeAssembly(
  root: Group,
  bladeMat: MeshStandardMaterial,
  bladeBlur: MeshStandardMaterial,
  wornEdge: MeshStandardMaterial,
): void {
  const blade = new Group();
  blade.name = "manhack-blade";
  blade.position.y = -0.01;

  const blurRing = addMesh(blade, "manhack-blade-blur-ring", new TorusGeometry(0.19, 0.004, 8, 48), bladeBlur);
  blurRing.rotation.x = Math.PI / 2;
  const steelRing = addMesh(blade, "manhack-blade-ring", new TorusGeometry(0.172, 0.004, 6, 36), bladeMat);
  steelRing.rotation.x = Math.PI / 2;

  for (let i = 0; i < 2; i += 1) {
    const angle = i * Math.PI;
    const vane = addMesh(blade, `manhack-blade-vane-${i}`, new BoxGeometry(0.39, 0.004, 0.018), bladeMat);
    vane.rotation.y = angle + 0.035;

    const cutterA = addMesh(blade, `manhack-blade-cutter-a-${i}`, new BoxGeometry(0.075, 0.006, 0.018), wornEdge);
    cutterA.position.set(Math.cos(angle) * 0.18, 0, -Math.sin(angle) * 0.18);
    cutterA.rotation.y = angle + 0.12;
    const cutterB = addMesh(blade, `manhack-blade-cutter-b-${i}`, new BoxGeometry(0.075, 0.006, 0.018), wornEdge);
    cutterB.position.set(-Math.cos(angle) * 0.18, 0, Math.sin(angle) * 0.18);
    cutterB.rotation.y = angle - 0.12;
  }

  const hub = addMesh(blade, "manhack-blade-hub", new CylinderGeometry(0.034, 0.04, 0.024, 16), bladeMat);
  hub.rotation.x = Math.PI / 2;
  root.add(blade);
}

function addSideDetails(
  root: Group,
  armor: MeshStandardMaterial,
  dark: MeshStandardMaterial,
  wornEdge: MeshStandardMaterial,
  cyanCore: MeshStandardMaterial,
  eyeMat: MeshStandardMaterial,
): void {
  for (const side of [-1, 1] as const) {
    const plate = addMesh(root, `manhack-side-plate-${side}`, new BoxGeometry(0.035, 0.145, 0.115), armor);
    plate.position.set(side * 0.15, 0.005, -0.015);
    plate.rotation.z = side * 0.12;

    const sideLens = addMesh(root, `manhack-side-red-lens-${side}`, SPHERE_16, eyeMat);
    sideLens.scale.set(0.024, 0.024, 0.014);
    sideLens.position.set(side * 0.168, -0.04, 0.11);

    const cyanSlit = addMesh(root, `manhack-side-cyan-slit-${side}`, new BoxGeometry(0.009, 0.064, 0.02), cyanCore);
    cyanSlit.position.set(side * 0.162, 0.08, 0.082);
    cyanSlit.rotation.z = side * 0.08;

    const rail = addMesh(root, `manhack-side-rail-${side}`, new CylinderGeometry(0.006, 0.007, 0.16, 6), wornEdge);
    rail.position.set(side * 0.157, -0.018, 0.02);
    rail.rotation.z = side * 0.42;

    const skid = addMesh(root, `manhack-side-skid-${side}`, new BoxGeometry(0.026, 0.018, 0.16), dark);
    skid.position.set(side * 0.14, -0.205, -0.005);
    skid.rotation.z = -side * 0.13;
  }
}

function addHooks(
  root: Group,
  armor: MeshStandardMaterial,
  dark: MeshStandardMaterial,
  wornEdge: MeshStandardMaterial,
): void {
  const topHook = new Group();
  topHook.name = "manhack-top-hook";
  topHook.position.set(0, 0.19, -0.045);
  const topStem = addMesh(topHook, "manhack-top-hook-stem", new BoxGeometry(0.032, 0.13, 0.034), armor);
  topStem.rotation.z = -0.28;
  topStem.position.set(-0.018, 0.042, 0);
  const topTip = addMesh(topHook, "manhack-top-hook-tip", new BoxGeometry(0.032, 0.09, 0.028), wornEdge);
  topTip.rotation.z = -0.82;
  topTip.position.set(0.04, 0.105, 0.012);
  const topSpike = addMesh(topHook, "manhack-top-hook-spike", new ConeGeometry(0.018, 0.055, 5), dark);
  topSpike.position.set(0.074, 0.138, 0.012);
  topSpike.rotation.z = -0.78;
  root.add(topHook);

  const lowerHook = new Group();
  lowerHook.name = "manhack-lower-hook";
  lowerHook.position.set(0, -0.24, -0.02);
  const lowerStem = addMesh(lowerHook, "manhack-lower-hook-stem", new BoxGeometry(0.03, 0.16, 0.032), dark);
  lowerStem.rotation.z = 0.14;
  lowerStem.position.set(0.012, -0.045, 0);
  const lowerTip = addMesh(lowerHook, "manhack-lower-hook-tip", new BoxGeometry(0.03, 0.085, 0.028), wornEdge);
  lowerTip.rotation.z = 0.68;
  lowerTip.position.set(-0.026, -0.13, 0.014);
  const lowerSpike = addMesh(lowerHook, "manhack-lower-hook-spike", new ConeGeometry(0.016, 0.052, 5), armor);
  lowerSpike.position.set(-0.055, -0.164, 0.014);
  lowerSpike.rotation.z = 0.64;
  root.add(lowerHook);
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

function createScratchedMetalTexture(
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
      const grain = hashNoise(x * 1.9, y * 0.65);
      const scrape = hashNoise(Math.floor(x / 2), Math.floor(y / 12)) > 0.82 ? 1 : 0;
      const edgeWear = x < 4 || y < 4 || x > size - 5 || y > size - 5 ? 0.28 : 0;
      const rustSpot = hashNoise(x * 0.16 + 19.4, y * 0.13 - 7.1) > 0.93 ? 1 : 0;
      const color = base
        .clone()
        .lerp(low, Math.max(0, 0.26 - grain * 0.22))
        .lerp(high, edgeWear + scrape * (0.12 + grain * 0.1))
        .lerp(rust, rustSpot * 0.2);
      data[i + 0] = Math.round(color.r * 255);
      data[i + 1] = Math.round(color.g * 255);
      data[i + 2] = Math.round(color.b * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2.2, 2.2);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createGlowTexture(size: number, baseHex: number, highHex: number): DataTexture {
  const base = new Color(baseHex);
  const high = new Color(highHex);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const stripes = Math.sin(x * 0.45 + Math.sin(y * 0.2) * 1.6) * 0.5 + 0.5;
      const pulse = hashNoise(Math.floor(x / 5), Math.floor(y / 5));
      const color = base.clone().lerp(high, stripes * 0.55 + pulse * 0.18);
      data[i + 0] = Math.round(color.r * 255);
      data[i + 1] = Math.round(color.g * 255);
      data[i + 2] = Math.round(color.b * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(1.4, 2.6);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createBumpTexture(size: number, contrast: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const scratches = hashNoise(Math.floor(x / 2), Math.floor(y / 10)) > 0.8 ? 0.26 : 0;
      const grain = hashNoise(x * 2.2, y * 2.2);
      const value = Math.round((0.38 + grain * 0.28 * contrast + scratches) * 255);
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
