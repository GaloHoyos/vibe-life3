import { DirectionalLight, Scene, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { LightingSystem } from '@engine/render/environment/LightingSystem';

const getSun = (lighting: LightingSystem): DirectionalLight => {
  const sun = lighting.getLights().find(
    (light): light is DirectionalLight => light instanceof DirectionalLight,
  );
  if (!sun) throw new Error('LightingSystem no expuso una luz direccional');
  return sun;
};

describe('LightingSystem shadow focus', () => {
  it('recentra sol y target alrededor de una cámara lejana sin cambiar la dirección', () => {
    const lighting = new LightingSystem();
    lighting.attach(new Scene());
    lighting.configureSun({ direction: [0.4, 1, 0.3] });
    const sun = getSun(lighting);
    const originalDirection = sun.position.clone().sub(sun.target.position).normalize();

    lighting.focusAt(new Vector3(-72, 1.7, 138));

    expect(sun.target.position.toArray()).toEqual([-72, 0, 136]);
    expect(sun.position.clone().sub(sun.target.position).normalize().distanceTo(originalDirection)).toBeLessThan(1e-10);
    expect(sun.position.distanceTo(sun.target.position)).toBeCloseTo(30, 10);
  });

  it('ignora movimiento vertical y desplazamientos pequeños para evitar jitter', () => {
    const lighting = new LightingSystem();
    lighting.attach(new Scene());
    const sun = getSun(lighting);
    lighting.focusAt(new Vector3(80, 2, -40));
    const position = sun.position.clone();
    const target = sun.target.position.clone();

    lighting.focusAt(new Vector3(87.99, 50, -32.01));

    expect(sun.position.equals(position)).toBe(true);
    expect(sun.target.position.equals(target)).toBe(true);
  });

  it('usa histéresis al cruzar una celda y no rebota en su borde', () => {
    const lighting = new LightingSystem();
    lighting.attach(new Scene());
    const sun = getSun(lighting);

    lighting.focusAt(new Vector3(8.1, 0, 0));
    expect(sun.target.position.x).toBe(8);

    lighting.focusAt(new Vector3(7.9, 0, 0));
    expect(sun.target.position.x).toBe(8);

    lighting.focusAt(new Vector3(-0.1, 0, 0));
    expect(sun.target.position.x).toBe(0);
  });

  it('conserva el foco al reconfigurar color, intensidad y dirección', () => {
    const lighting = new LightingSystem();
    lighting.attach(new Scene());
    lighting.focusAt(new Vector3(64, 0, 96));
    const sun = getSun(lighting);

    lighting.configureSun({ direction: [-1, 2, 0.5], color: 0xabcdef, intensity: 4 });

    expect(sun.target.position.toArray()).toEqual([64, 0, 96]);
    expect(
      sun.position
        .clone()
        .sub(sun.target.position)
        .normalize()
        .distanceTo(new Vector3(-1, 2, 0.5).normalize()),
    ).toBeLessThan(1e-10);
    expect(sun.color.getHex()).toBe(0xabcdef);
    expect(sun.intensity).toBe(4);
  });
});
