import { describe, expect, it } from "vitest";
import { crate, crateStack } from "@game/levels/builders/PropBuilder";
import { createMap } from "@game/levels/builders/MapCreator";
import { PropArchetypes } from "@game/config/props.config";

const CRATE = PropArchetypes.woodenCrate;

function emptyMap() {
  return createMap({
    id: "crate-test",
    title: "Cajones",
    background: 0x101014,
    playerStart: [0, 0, 0],
    audio: { ambiences: [], footstepSounds: [] },
  });
}

describe("cajones migrados al catalogo de props", () => {
  it("un cajon es un prop del catalogo y no una caja estatica", () => {
    const artifact = crate({ id: "c1", at: [3, 0, -2] });

    expect(artifact.staticBoxes).toHaveLength(0);
    expect(artifact.dynamicBoxes).toHaveLength(0);
    expect(artifact.props).toHaveLength(1);
    expect(artifact.props[0]!.archetypeId).toBe("woodenCrate");
    // La posicion de un prop es su APOYO, igual que la que autora el mapa.
    expect(artifact.props[0]!.position).toEqual([3, 0, -2]);
  });

  it("un cajon dinamico se puede empujar y uno de decorado no", () => {
    expect(crate({ id: "c1", at: [0, 0, 0], dynamic: true }).props[0]!.physicsMode).toBe("dynamic");
    expect(crate({ id: "c2", at: [0, 0, 0] }).props[0]!.physicsMode).toBe("anchored");
  });

  it("un cajon anclado emite su bloqueador de navegacion", () => {
    // Es EL punto de la migracion. Un cajon anclado sale del horneado del
    // navmesh —que solo lee geometria estatica— y sin esta caja invisible los
    // NPCs lo atraviesan caminando. Con el umbral en 1 m el cajon de 0.887 no
    // calificaba y el bug era mudo.
    const level = emptyMap().prop(crate({ id: "c1", at: [5, 0, 5] })).build();

    expect(level.navBlockers ?? []).toHaveLength(1);
    const blocker = level.navBlockers![0]!;
    expect(blocker.id).toBe("c1-nav");
    // Centrado sobre el apoyo, no sobre el.
    expect(blocker.position[1]).toBeCloseTo(CRATE.bounds[1] / 2, 5);
  });

  it("un cajon dinamico no bloquea el navmesh horneado", () => {
    // Se mueve: taparlo en el bake dejaria un agujero permanente donde ya no
    // hay nada. Lo cubre `syncDynamicObstacles` en runtime.
    const level = emptyMap().prop(crate({ id: "c1", at: [5, 0, 5], dynamic: true })).build();

    expect(level.navBlockers ?? []).toHaveLength(0);
  });

  it("el tamano explicito se traduce a escala del arquetipo", () => {
    const scaled = crate({ id: "c1", at: [0, 0, 0], size: 1.8 }).props[0]!;

    expect(scaled.scale).toBeCloseTo(1.8 / CRATE.bounds[0], 5);
    // Sin `size` no se escala nada: el cajon mide lo que dice su arquetipo.
    expect(crate({ id: "c2", at: [0, 0, 0] }).props[0]!.scale).toBeUndefined();
  });

  it("las capas de una pila se apoyan sin encimarse ni flotar", () => {
    const stack = crateStack({ id: "s", at: [0, 0], rows: 1, cols: 1, layers: 3 });

    const heights = stack.props.map((prop) => prop.position[1]).sort((a, b) => a - b);
    expect(heights).toHaveLength(3);
    // La altura real del cajon (0.86), no el lado (0.887): usar el lado dejaria
    // cada capa flotando 2.7 cm sobre la de abajo.
    expect(heights[1]! - heights[0]!).toBeCloseTo(CRATE.bounds[1], 5);
    expect(heights[2]! - heights[1]!).toBeCloseTo(CRATE.bounds[1], 5);
  });

  it("la pila piramidal pierde una fila y una columna por capa", () => {
    const stack = crateStack({ id: "s", at: [0, 0], rows: 3, cols: 3, layers: 3 });

    expect(stack.props).toHaveLength(9 + 4 + 1);
  });

  it("todos los cajones de una pila bloquean navegacion", () => {
    const level = emptyMap()
      .prop(crateStack({ id: "s", at: [0, 0], rows: 2, cols: 2, layers: 2 }))
      .build();

    expect(level.props).toHaveLength(5);
    expect(level.navBlockers).toHaveLength(5);
  });

  it("la rotacion del prop se hornea en la posicion y en la orientacion", () => {
    const turned = crateStack({
      id: "s",
      at: [10, 0],
      rows: 1,
      cols: 2,
      rotation: [0, Math.PI / 2, 0],
    });

    // Girar 90 grados una fila que corria sobre X la deja corriendo sobre Z.
    const spreadX = Math.max(...turned.props.map((p) => p.position[0])) -
      Math.min(...turned.props.map((p) => p.position[0]));
    const spreadZ = Math.max(...turned.props.map((p) => p.position[2])) -
      Math.min(...turned.props.map((p) => p.position[2]));
    expect(spreadX).toBeCloseTo(0, 5);
    expect(spreadZ).toBeGreaterThan(0.5);
    for (const prop of turned.props) {
      expect(prop.rotation![1]).toBeCloseTo(Math.PI / 2, 5);
    }
  });

  it("una pila con seed es determinista", () => {
    const spec = { id: "s", at: [0, 0] as [number, number], rows: 2, cols: 2, seed: 7 };
    expect(crateStack(spec).props).toEqual(crateStack(spec).props);
  });

  it("una pila de dos capas o mas se une para derrumbarse", () => {
    const stack = crateStack({ id: "s", at: [0, 0], rows: 2, cols: 2, layers: 2 });

    expect(stack.structures).toHaveLength(1);
    const structure = stack.structures[0]!;
    // Se viene abajo entera: romper un cajon suelta TODAS las uniones.
    expect(structure.cascade).toBe(true);
    expect(structure.joints).toHaveLength(stack.props.length);

    // La capa de abajo se atornilla al piso; el resto cuelga de la de abajo.
    const toWorld = structure.joints.filter((joint) => joint.b === "world");
    expect(toWorld).toHaveLength(4);
    for (const joint of structure.joints) {
      if (joint.b === "world") continue;
      expect(stack.props.some((prop) => prop.id === joint.b)).toBe(true);
    }
  });

  it("una sola capa no se une: atar cajones que ya estan en el piso no ata nada", () => {
    expect(crateStack({ id: "s", at: [0, 0], layers: 1 }).structures).toHaveLength(0);
  });

  it("el ancla al mundo acompana la rotacion de la pila", () => {
    // Es una posicion GLOBAL, no un offset local: calcularla antes de rotar la
    // dejaria atornillada donde estaba la pila sin girar.
    const turned = crateStack({
      id: "s",
      at: [10, 4],
      rows: 1,
      cols: 2,
      layers: 2,
      rotation: [0, Math.PI / 2, 0],
    });

    for (const joint of turned.structures[0]!.joints) {
      if (joint.b !== "world") continue;
      const anchored = turned.props.find((prop) => prop.id === joint.a)!;
      expect(joint.anchorB[0]).toBeCloseTo(anchored.position[0], 5);
      expect(joint.anchorB[2]).toBeCloseTo(anchored.position[2], 5);
    }
  });

  it("el mapa registra la estructura de la pila", () => {
    const level = emptyMap()
      .prop(crateStack({ id: "s", at: [0, 0], rows: 2, cols: 2, layers: 2 }))
      .build();

    expect(level.propStructures).toHaveLength(1);
  });

  it("los ids siguen siendo unicos dentro de un mapa", () => {
    // `build()` valida ids duplicados; que no tire es la prueba.
    const level = emptyMap()
      .prop(
        crateStack({ id: "a", at: [0, 0], rows: 2, cols: 2, layers: 2 }),
        crateStack({ id: "b", at: [20, 0], rows: 2, cols: 2, layers: 2 }),
        crate({ id: "c", at: [40, 0, 0] }),
      )
      .build();

    const ids = (level.props ?? []).map((prop) => prop.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
