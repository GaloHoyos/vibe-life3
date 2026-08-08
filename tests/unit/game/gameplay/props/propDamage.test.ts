import { describe, expect, it } from "vitest";
import { PropArchetypes } from "@game/config/props.config";
import {
  clampPropScale,
  impactDamageToProp,
  isPropDestructible,
  propBoundsForScale,
  propMassForScale,
  propMaxHealth,
  resolvePropDamage,
} from "@game/gameplay/props/propDamage";

const crate = PropArchetypes.woodenCrate;
const barrel = PropArchetypes.metalBarrel;
const cone = PropArchetypes.trafficCone;

describe("resolvePropDamage", () => {
  it("aplica el multiplicador del tipo de golpe", () => {
    const melee = crate.damage.multipliers?.melee ?? 1;

    expect(resolvePropDamage(crate, 10, "melee")).toBeCloseTo(10 * melee, 6);
    expect(resolvePropDamage(crate, 10, "bullet")).toBeCloseTo(
      10 * (crate.damage.multipliers?.bullet ?? 1),
      6,
    );
  });

  it("un tipo sin multiplicador pasa sin escalar", () => {
    expect(resolvePropDamage(crate, 10, "energy")).toBe(10);
    expect(resolvePropDamage(crate, 10)).toBe(10);
  });

  it("la barreta le hace más al cajón que al barril", () => {
    expect(resolvePropDamage(crate, 10, "melee")).toBeGreaterThan(
      resolvePropDamage(barrel, 10, "melee"),
    );
  });

  it("un prop indestructible no puede morir pero sí acusa el golpe", () => {
    expect(isPropDestructible(cone)).toBe(false);
    expect(propMaxHealth(cone)).toBe(Infinity);
    // La fuerza del golpe se calcula igual: la inmunidad vive en
    // `PropInstance`, que es el único que sabe si al prop le queda vida. Poner
    // el cero acá dejaba a un balde de metal inmune también a abollarse, porque
    // sin daño efectivo nunca se emitía `prop.damaged`.
    expect(resolvePropDamage(cone, 999, "explosive")).toBeGreaterThan(0);
    // Y lo que sí tiene que seguir en cero: el daño que se hace a sí mismo al
    // chocar. Un cono no se destruye solo por rodar contra una pared.
    expect(impactDamageToProp(cone, 50)).toBe(0);
  });

  it("ignora montos no positivos o no finitos", () => {
    expect(resolvePropDamage(crate, 0)).toBe(0);
    expect(resolvePropDamage(crate, -5)).toBe(0);
    expect(resolvePropDamage(crate, Number.NaN)).toBe(0);
  });
});

describe("impactDamageToProp", () => {
  it("por debajo del umbral el golpe no lastima", () => {
    const threshold = crate.damage.impactDamageSpeed;

    expect(impactDamageToProp(crate, threshold)).toBe(0);
    expect(impactDamageToProp(crate, threshold - 1)).toBe(0);
  });

  it("sobre el umbral escala con el exceso de velocidad", () => {
    const threshold = crate.damage.impactDamageSpeed;

    expect(impactDamageToProp(crate, threshold + 4)).toBeCloseTo(
      4 * crate.damage.impactDamageScale,
      6,
    );
  });

  it("una botella se rompe al primer choque real y un cono nunca", () => {
    const bottle = PropArchetypes.glassBottle;

    expect(impactDamageToProp(bottle, 6)).toBeGreaterThan(propMaxHealth(bottle));
    expect(impactDamageToProp(cone, 100)).toBe(0);
  });
});

describe("escala", () => {
  it("la masa crece al cubo", () => {
    expect(propMassForScale(crate, 2)).toBeCloseTo(crate.physics.mass * 8, 6);
    expect(propMassForScale(crate, 1)).toBeCloseTo(crate.physics.mass, 6);
  });

  it("los bounds crecen lineales", () => {
    const [x, y, z] = propBoundsForScale(crate, 2);

    expect(x).toBeCloseTo(crate.bounds[0] * 2, 6);
    expect(y).toBeCloseTo(crate.bounds[1] * 2, 6);
    expect(z).toBeCloseTo(crate.bounds[2] * 2, 6);
  });

  it("una escala ausente o inválida vale 1, y los extremos se acotan", () => {
    expect(clampPropScale(undefined)).toBe(1);
    expect(clampPropScale(Number.NaN)).toBe(1);
    // Escala 0 anularía la masa y dejaría un collider degenerado.
    expect(clampPropScale(0)).toBeGreaterThan(0);
    expect(clampPropScale(1000)).toBeLessThan(1000);
  });
});
