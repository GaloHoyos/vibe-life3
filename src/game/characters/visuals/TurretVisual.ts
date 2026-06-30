import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
} from "three";

const TAU = Math.PI * 2;

/**
 * Visual procedural de la torreta de piso (no hay GLB; `src/models/` es intocable).
 * Trípode metálico con cabeza/cañón giratorio. Nodos nombrados que el
 * `TurretAnimator` mueve: `turret-barrel` (cabeza+cañón, gira en yaw+pitch),
 * `turret-eye` (ojo sensor emisivo verde→rojo) y `turret-muzzle` (destello de
 * boca). El cuerpo está centrado en el origen del collider (caja ~0.6×1.2×0.6):
 * patas hacia abajo (−Y), cañón apuntando +Z (dirección de montaje). Materiales
 * inline, como `ManhackVisual`. Para migrar a GLB en el futuro: exponer los
 * mismos nombres de nodo.
 */
export function createTurretVisual(): Object3D {
  const root = new Group();
  root.name = "turret";

  const bodyMat = new MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.5, metalness: 0.85 });
  const trimMat = new MeshStandardMaterial({ color: 0x15171a, roughness: 0.65, metalness: 0.7 });
  const eyeMat = new MeshStandardMaterial({
    color: 0x041007,
    emissive: 0x18ff5a,
    emissiveIntensity: 0.4,
    roughness: 0.3,
  });
  const muzzleMat = new MeshStandardMaterial({
    color: 0x140a00,
    emissive: 0xffb24a,
    emissiveIntensity: 0,
    roughness: 0.4,
  });

  // Trípode: 3 patas splayadas hacia afuera desde la base.
  for (let i = 0; i < 3; i += 1) {
    const pivot = new Group();
    pivot.rotation.y = (i / 3) * TAU;
    const leg = new Mesh(new BoxGeometry(0.07, 0.82, 0.07), trimMat);
    leg.position.set(0, -0.3, 0.18);
    // Negativo: el pie (−Y) abre hacia afuera y el tope converge al eje (trípode
    // estable). Positivo invertía la pata (patas "para arriba").
    leg.rotation.x = -0.34;
    pivot.add(leg);
    root.add(pivot);
  }

  // Columna central.
  const column = new Mesh(new CylinderGeometry(0.12, 0.16, 0.8, 12), bodyMat);
  column.position.y = -0.1;
  root.add(column);

  // Cabeza + cañón giratorio.
  const barrel = new Group();
  barrel.name = "turret-barrel";
  barrel.position.y = 0.42;

  const head = new Mesh(new BoxGeometry(0.34, 0.3, 0.4), bodyMat);
  barrel.add(head);

  for (const side of [-1, 1]) {
    const gun = new Mesh(new CylinderGeometry(0.045, 0.045, 0.5, 10), trimMat);
    gun.rotation.x = Math.PI / 2; // apunta +Z
    gun.position.set(side * 0.08, -0.02, 0.32);
    barrel.add(gun);

    const muzzle = new Mesh(new SphereGeometry(0.05, 8, 6), muzzleMat);
    muzzle.name = "turret-muzzle";
    muzzle.position.set(side * 0.08, -0.02, 0.56);
    barrel.add(muzzle);
  }

  const eye = new Mesh(new SphereGeometry(0.07, 12, 10), eyeMat);
  eye.name = "turret-eye";
  eye.position.set(0, 0.06, 0.21);
  barrel.add(eye);

  root.add(barrel);

  root.traverse((object) => {
    if (object instanceof Mesh) object.castShadow = true;
  });
  return root;
}
