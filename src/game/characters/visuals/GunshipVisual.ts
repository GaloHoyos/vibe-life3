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

const upperHullTexture = createCamoTexture(128, 0x77683c, 0x494229, 0xb2a66e, 0x5e4730);
const paleShellTexture = createOrganicTexture(96, 0xd2d8cb, 0x8e9b91, 0xf0f1df, 0x6f8a7d);
const darkTexture = createOrganicTexture(64, 0x202622, 0x0c1111, 0x4a5046, 0x163b3e);
const glowTexture = createGlowTexture(64);
const hullBump = createBumpTexture(96, 0.6);

const SPHERE_16 = new SphereGeometry(1, 16, 10);
const SPHERE_24 = new SphereGeometry(1, 24, 14);
const THIN_CABLE = new CylinderGeometry(0.014, 0.018, 1, 6);

/**
 * Gunship procedural inspirado en Combine. Mantiene +Z como nariz para que el
 * movimiento, el apuntado y el muzzle sigan usando el frente esperado.
 */
export function createGunshipVisual(): Object3D {
  const root = new Group();
  root.name = "gunship";

  const hull = new MeshStandardMaterial({
    color: 0x7f7347,
    map: upperHullTexture,
    bumpMap: hullBump,
    bumpScale: 0.045,
    roughness: 0.88,
    metalness: 0.08,
  });
  const camoPatch = new MeshStandardMaterial({
    color: 0x9d965e,
    map: upperHullTexture,
    bumpMap: hullBump,
    bumpScale: 0.025,
    roughness: 0.92,
    metalness: 0.04,
  });
  const pale = new MeshStandardMaterial({
    color: 0xd0d7cb,
    map: paleShellTexture,
    bumpMap: hullBump,
    bumpScale: 0.035,
    roughness: 0.78,
    metalness: 0.1,
  });
  const dark = new MeshStandardMaterial({
    color: 0x15191a,
    map: darkTexture,
    roughness: 0.46,
    metalness: 0.72,
  });
  const metal = new MeshStandardMaterial({
    color: 0x6f7774,
    map: darkTexture,
    roughness: 0.34,
    metalness: 0.86,
  });
  const membrane = new MeshStandardMaterial({
    color: 0x5b4b2f,
    map: upperHullTexture,
    roughness: 0.96,
    metalness: 0.02,
  });
  const cyanGlow = new MeshStandardMaterial({
    color: 0x1cdbe0,
    emissive: 0x08f5f0,
    emissiveIntensity: 1.6,
    map: glowTexture,
    roughness: 0.22,
    metalness: 0.22,
    transparent: true,
    opacity: 0.9,
  });
  const purpleEye = new MeshStandardMaterial({
    color: 0x210026,
    emissive: 0x9637ff,
    emissiveIntensity: 1.7,
    roughness: 0.3,
    metalness: 0.18,
  });
  const muzzleGlow = new MeshStandardMaterial({
    color: 0x120700,
    emissive: 0xffa33a,
    emissiveIntensity: 0,
    roughness: 0.36,
    metalness: 0.74,
  });
  const stencil = new MeshStandardMaterial({
    color: 0x8f3f2a,
    roughness: 0.9,
    metalness: 0.03,
  });
  const rotorBlur = new MeshStandardMaterial({
    color: 0xc8fff7,
    emissive: 0x59e9e6,
    emissiveIntensity: 0.35,
    roughness: 0.18,
    metalness: 0.22,
    transparent: true,
    opacity: 0.32,
  });

  const spine = addMesh(root, "gunship-spine", new CylinderGeometry(0.46, 0.68, 2.42, 24), hull);
  spine.rotation.x = Math.PI / 2;
  spine.position.set(0, 0.04, 0.12);
  spine.scale.set(0.92, 1, 1);

  const frontCowl = addMesh(root, "gunship-front-cowl", SPHERE_24, hull);
  frontCowl.scale.set(0.5, 0.44, 0.72);
  frontCowl.position.set(0, 0.02, 1.46);

  const noseCap = addMesh(root, "gunship-nose-cap", SPHERE_16, pale);
  noseCap.scale.set(0.34, 0.28, 0.38);
  noseCap.position.set(0, -0.03, 1.96);

  const aftCowl = addMesh(root, "gunship-aft-cowl", SPHERE_24, pale);
  aftCowl.scale.set(0.74, 0.52, 0.5);
  aftCowl.position.set(0, 0.0, -1.08);

  const dorsalShell = addMesh(root, "gunship-dorsal-shell", SPHERE_24, hull);
  dorsalShell.scale.set(0.64, 0.26, 1.18);
  dorsalShell.position.set(0, 0.48, 0.22);
  dorsalShell.rotation.x = -0.08;

  const bellyShell = addMesh(root, "gunship-belly-shell", SPHERE_16, pale);
  bellyShell.scale.set(0.52, 0.24, 1.05);
  bellyShell.position.set(0, -0.4, -0.08);

  addSegmentBands(root, pale, dark);
  addCamoPatches(root, camoPatch, stencil);
  addBellyAssembly(root, pale, dark, cyanGlow, purpleEye);
  addSidePods(root, pale, dark, purpleEye, membrane);
  addRearDuct(root, pale, hull, metal, rotorBlur);
  addWeaponAssembly(root, dark, metal, muzzleGlow);
  addFinsAndAntennae(root, pale, metal, dark);

  return root;
}

function addSegmentBands(root: Group, pale: MeshStandardMaterial, dark: MeshStandardMaterial): void {
  const bands = [
    { z: 0.9, radius: 0.48, tube: 0.026, sx: 0.92, sy: 0.78, material: pale },
    { z: 0.18, radius: 0.56, tube: 0.028, sx: 0.96, sy: 0.82, material: dark },
    { z: -0.58, radius: 0.62, tube: 0.03, sx: 1.0, sy: 0.84, material: pale },
  ];
  for (const [index, band] of bands.entries()) {
    const mesh = addMesh(root, `gunship-hull-band-${index}`, new TorusGeometry(band.radius, band.tube, 8, 36), band.material);
    mesh.position.z = band.z;
    mesh.scale.set(band.sx, band.sy, 1);
  }
}

function addCamoPatches(root: Group, material: MeshStandardMaterial, stencil: MeshStandardMaterial): void {
  const patches = [
    [-0.22, 0.5, 0.7, 0.42, 0.055, 0.36, -0.24],
    [0.24, 0.51, 0.24, 0.36, 0.052, 0.3, 0.18],
    [-0.18, 0.48, -0.32, 0.44, 0.05, 0.32, 0.28],
    [0.18, 0.43, -0.84, 0.34, 0.048, 0.24, -0.2],
    [-0.28, -0.28, 0.42, 0.32, 0.042, 0.22, 0.16],
  ] as const;

  for (const [index, patch] of patches.entries()) {
    const [x, y, z, sx, sy, sz, rz] = patch;
    const mesh = addMesh(root, `gunship-camo-patch-${index}`, SPHERE_16, material);
    mesh.scale.set(sx, sy, sz);
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz;
  }

  const markRing = addMesh(root, "gunship-faded-stencil-ring", new TorusGeometry(0.13, 0.006, 6, 28), stencil);
  markRing.position.set(-0.18, 0.555, 0.58);
  markRing.rotation.x = Math.PI / 2;
  markRing.rotation.z = -0.18;
  const markBar = addMesh(root, "gunship-faded-stencil-bar", new BoxGeometry(0.19, 0.011, 0.018), stencil);
  markBar.position.set(-0.18, 0.565, 0.58);
  markBar.rotation.z = -0.18;
}

function addBellyAssembly(
  root: Group,
  pale: MeshStandardMaterial,
  dark: MeshStandardMaterial,
  cyanGlow: MeshStandardMaterial,
  purpleEye: MeshStandardMaterial,
): void {
  const channel = addMesh(root, "gunship-belly-cyan-channel", new BoxGeometry(0.26, 0.06, 1.28), cyanGlow);
  channel.position.set(0, -0.56, 0.25);

  const ribA = addMesh(root, "gunship-belly-rib-front", new TorusGeometry(0.22, 0.014, 6, 24), pale);
  ribA.position.set(0, -0.54, 0.76);
  ribA.scale.set(1.25, 0.32, 1);
  ribA.rotation.x = Math.PI / 2;
  const ribB = addMesh(root, "gunship-belly-rib-rear", new TorusGeometry(0.23, 0.014, 6, 24), pale);
  ribB.position.set(0, -0.54, -0.36);
  ribB.scale.set(1.28, 0.32, 1);
  ribB.rotation.x = Math.PI / 2;

  const bellyEye = addMesh(root, "gunship-eye", SPHERE_16, purpleEye);
  bellyEye.position.set(0, -0.62, 0.02);
  bellyEye.scale.set(0.34, 0.16, 0.46);

  for (const side of [-1, 1] as const) {
    const cable = addMesh(root, `gunship-belly-cable-${side}`, THIN_CABLE, dark);
    cable.position.set(side * 0.2, -0.52, 0.26);
    cable.rotation.x = Math.PI / 2;
    cable.rotation.z = side * 0.16;
  }
}

function addSidePods(
  root: Group,
  pale: MeshStandardMaterial,
  dark: MeshStandardMaterial,
  purpleEye: MeshStandardMaterial,
  membrane: MeshStandardMaterial,
): void {
  for (const side of [-1, 1] as const) {
    const pod = addMesh(root, `gunship-side-sensor-${side}`, SPHERE_16, purpleEye);
    pod.scale.set(0.18, 0.3, 0.34);
    pod.position.set(side * 0.48, -0.22, -0.04);
    pod.rotation.z = side * 0.22;

    const socket = addMesh(root, `gunship-side-sensor-socket-${side}`, SPHERE_16, pale);
    socket.scale.set(0.25, 0.18, 0.42);
    socket.position.set(side * 0.55, -0.1, -0.02);
    socket.rotation.z = side * 0.2;

    const enginePod = addMesh(root, `gunship-side-engine-${side}`, new CylinderGeometry(0.14, 0.17, 0.42, 14), dark);
    enginePod.rotation.x = Math.PI / 2;
    enginePod.position.set(side * 0.36, 0.33, -0.58);

    const fin = addMesh(root, `gunship-soft-fin-${side}`, SPHERE_16, membrane);
    fin.scale.set(0.18, 0.06, 0.72);
    fin.position.set(side * 0.64, -0.33, -0.48);
    fin.rotation.z = side * 0.32;
    fin.rotation.y = side * 0.18;

    const strut = addMesh(root, `gunship-fin-strut-${side}`, THIN_CABLE, dark);
    strut.position.set(side * 0.45, -0.23, -0.45);
    strut.rotation.x = Math.PI / 2;
    strut.rotation.z = side * 0.58;
  }
}

function addRearDuct(
  root: Group,
  pale: MeshStandardMaterial,
  hull: MeshStandardMaterial,
  metal: MeshStandardMaterial,
  rotorBlur: MeshStandardMaterial,
): void {
  const outerDuct = addMesh(root, "gunship-rear-duct", new TorusGeometry(0.92, 0.105, 18, 64), pale);
  outerDuct.position.z = -1.55;
  outerDuct.scale.set(1.22, 0.72, 1);

  const topShell = addMesh(root, "gunship-rear-duct-top-shell", SPHERE_16, hull);
  topShell.scale.set(0.34, 0.16, 0.82);
  topShell.position.set(0, 0.63, -1.55);
  topShell.rotation.x = 0.08;

  const tailPod = addMesh(root, "gunship-tail-pod", SPHERE_16, pale);
  tailPod.scale.set(0.28, 0.22, 0.54);
  tailPod.position.set(0, 0.03, -1.72);

  const rotor = new Group();
  rotor.name = "gunship-rotor";
  rotor.position.z = -1.58;
  for (let i = 0; i < 6; i += 1) {
    const blade = addMesh(rotor, `gunship-rotor-blade-${i}`, new BoxGeometry(1.42, 0.038, 0.064), rotorBlur);
    blade.rotation.z = (i * Math.PI) / 6;
  }
  const hub = addMesh(rotor, "gunship-rotor-hub", new CylinderGeometry(0.12, 0.16, 0.18, 16), metal);
  hub.rotation.x = Math.PI / 2;
  root.add(rotor);

  for (const side of [-1, 1] as const) {
    const brace = addMesh(root, `gunship-duct-brace-${side}`, new BoxGeometry(0.08, 0.08, 0.86), metal);
    brace.position.set(side * 0.5, 0.02, -1.28);
    brace.rotation.y = side * 0.2;
  }
}

function addWeaponAssembly(
  root: Group,
  dark: MeshStandardMaterial,
  metal: MeshStandardMaterial,
  muzzleGlow: MeshStandardMaterial,
): void {
  const mount = addMesh(root, "gunship-cannon-mount", SPHERE_16, dark);
  mount.scale.set(0.18, 0.18, 0.26);
  mount.position.set(0, -0.2, 1.52);

  const railLeft = addMesh(root, "gunship-cannon-rail-left", new BoxGeometry(0.035, 0.035, 1.05), metal);
  railLeft.position.set(-0.07, -0.17, 2.05);
  const railRight = addMesh(root, "gunship-cannon-rail-right", new BoxGeometry(0.035, 0.035, 1.05), metal);
  railRight.position.set(0.07, -0.17, 2.05);

  const cannon = addMesh(root, "gunship-cannon", new CylinderGeometry(0.045, 0.06, 1.12, 12), dark);
  cannon.rotation.x = Math.PI / 2;
  cannon.position.set(0, -0.18, 2.03);

  const muzzle = addMesh(root, "gunship-muzzle", new SphereGeometry(0.078, 12, 8), muzzleGlow);
  muzzle.position.set(0, -0.18, 2.62);
}

function addFinsAndAntennae(
  root: Group,
  pale: MeshStandardMaterial,
  metal: MeshStandardMaterial,
  dark: MeshStandardMaterial,
): void {
  for (const side of [-1, 1] as const) {
    const rearFin = addMesh(root, `gunship-tail-fin-${side}`, new ConeGeometry(0.08, 0.72, 4), pale);
    rearFin.position.set(side * 0.82, 0.04, -1.88);
    rearFin.rotation.z = -side * Math.PI * 0.5;
    rearFin.rotation.y = side * 0.28;

    const whisker = addMesh(root, `gunship-rear-whisker-${side}`, THIN_CABLE, metal);
    whisker.position.set(side * 0.82, 0.28, -1.92);
    whisker.rotation.z = side * 0.62;
    whisker.rotation.x = 0.3;

    const lowerTendril = addMesh(root, `gunship-lower-tendril-${side}`, THIN_CABLE, dark);
    lowerTendril.position.set(side * 0.42, -0.62, -0.74);
    lowerTendril.rotation.x = 0.62;
    lowerTendril.rotation.z = side * 0.4;
  }

  const antenna = addMesh(root, "gunship-dorsal-antenna", new BoxGeometry(0.034, 0.78, 0.034), metal);
  antenna.position.set(0.2, 0.84, -0.92);
  antenna.rotation.x = 0.34;
  antenna.rotation.z = -0.16;
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

function createCamoTexture(
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
      const bands = Math.sin(x * 0.13 + Math.sin(y * 0.06) * 3.2) * 0.5 + 0.5;
      const block = hashNoise(Math.floor(x / 11) * 2.7, Math.floor(y / 9) * 3.1);
      const scratches = hashNoise(x * 0.35, y * 1.4) > 0.88 ? 0.26 : 0;
      const blotch = block > 0.56 || bands > 0.72 ? 1 : 0;
      const rust = hashNoise(x * 0.11 - 5.4, y * 0.12 + 17.2) > 0.9 ? 1 : 0;
      const color = base
        .clone()
        .lerp(high, blotch * (0.18 + bands * 0.28))
        .lerp(low, Math.max(0, 0.4 - block * 0.35) + scratches)
        .lerp(stain, rust * 0.26);
      data[i + 0] = Math.round(color.r * 255);
      data[i + 1] = Math.round(color.g * 255);
      data[i + 2] = Math.round(color.b * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2.2, 1.6);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
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
      const grain = hashNoise(x * 1.7, y * 0.8);
      const vein = Math.sin(x * 0.1 + Math.sin(y * 0.08) * 2.7) * 0.5 + 0.5;
      const spot = hashNoise(x * 0.13 + 29.2, y * 0.13 - 11.4) > 0.86 ? 1 : 0;
      const color = base
        .clone()
        .lerp(low, Math.max(0, 0.36 - grain * 0.28))
        .lerp(high, Math.max(0, vein - 0.54) * 0.36)
        .lerp(stain, spot * (0.16 + grain * 0.12));
      data[i + 0] = Math.round(color.r * 255);
      data[i + 1] = Math.round(color.g * 255);
      data[i + 2] = Math.round(color.b * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2.4, 2.4);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createGlowTexture(size: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const stripe = Math.sin(x * 0.52 + Math.sin(y * 0.16) * 1.8) * 0.5 + 0.5;
      const pulse = hashNoise(Math.floor(x / 4), Math.floor(y / 4));
      data[i + 0] = Math.round((0.04 + stripe * 0.08) * 255);
      data[i + 1] = Math.round((0.62 + stripe * 0.32 + pulse * 0.08) * 255);
      data[i + 2] = Math.round((0.68 + stripe * 0.28 + pulse * 0.08) * 255);
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(1.2, 3.2);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createBumpTexture(size: number, contrast: number): DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const ribs = Math.sin(x * 0.24 + Math.sin(y * 0.12) * 1.5) * 0.5 + 0.5;
      const grain = hashNoise(x * 1.9, y * 1.9);
      const value = Math.round((0.34 + ribs * 0.36 + grain * 0.3 * contrast) * 255);
      data[i + 0] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2.8, 2.8);
  texture.needsUpdate = true;
  return texture;
}

function hashNoise(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
