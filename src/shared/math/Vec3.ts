/**
 * Vector 3D estructural sin dependencia de motores de render.
 *
 * Sirve como tipo común entre `engine/` y `game/`. El render (Three.js)
 * implementa esta forma a través de su clase `Vector3`, por lo que un
 * `Vector3` puede pasarse donde se espera un `Vec3` sin conversión.
 *
 * Usar este tipo en `EngineEvents`/`GameEvents` desacopla el bus de
 * eventos de cualquier librería concreta de render.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Constructor utilitario para `Vec3` literales. */
export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

/** `Vec3` con todos los componentes en cero. */
export const VEC3_ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });
