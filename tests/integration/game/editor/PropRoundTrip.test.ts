import { describe, expect, it } from "vitest";
import { blankDocument, type EditorEntity } from "@game/editor/EditorDocument";
import { toLevelDefinition } from "@game/editor/codegen/toLevelDefinition";
import { fromLevelDefinition } from "@game/editor/codegen/fromLevelDefinition";
import { getRotation, getPosition } from "@game/editor/EditorEntityOps";
import type { PropDefinition } from "@game/levels/LevelDefinition";

/**
 * Un nivel que pasa por el editor tiene que volver igual. Los smart objects de
 * arquitectura se aplanan a cajas a propósito, pero un prop del catálogo es un
 * dato: si se pierde en el viaje, editar un nivel lo destruye en silencio.
 */
function documentWithProps(props: readonly PropDefinition[]) {
  const doc = blankDocument();
  for (const def of props) {
    doc.entities.push({
      eid: `prop-${def.id}`,
      kind: "propEntity",
      def: { ...def },
    } as EditorEntity);
  }
  return doc;
}

const PROPS: PropDefinition[] = [
  { id: "crate-a", archetypeId: "woodenCrate", position: [3, 0, -2] },
  {
    id: "barrel-a",
    archetypeId: "metalBarrel",
    position: [-4, 1.5, 6],
    rotation: [0, 0.75, 0],
    scale: 1.4,
    variant: 1,
    health: 200,
    physicsMode: "anchored",
  },
  {
    id: "bottle-a",
    archetypeId: "glassBottle",
    position: [0, 2, 0],
    breakOverride: { kind: "explode", damage: 40, radius: 3, impulse: 8 },
  },
];

describe("round-trip de props por el editor", () => {
  it("toLevelDefinition los emite como props del nivel, no como cajas sueltas", () => {
    const level = toLevelDefinition(documentWithProps(PROPS));

    expect(level.props).toHaveLength(PROPS.length);
    expect(level.props?.map((prop) => prop.id)).toEqual(["crate-a", "barrel-a", "bottle-a"]);
    // Lo que NO debe pasar: que terminen aplanados como geometría anónima.
    expect(level.dynamicBoxes).toHaveLength(0);
  });

  it("fromLevelDefinition(toLevelDefinition(doc)) conserva cada campo", () => {
    const level = toLevelDefinition(documentWithProps(PROPS));
    const restored = fromLevelDefinition(level);

    const props = restored.entities.filter(
      (entity): entity is Extract<EditorEntity, { kind: "propEntity" }> =>
        entity.kind === "propEntity",
    );
    expect(props).toHaveLength(PROPS.length);
    for (const original of PROPS) {
      const found = props.find((entity) => entity.def.id === original.id);
      expect(found, original.id).toBeDefined();
      expect(found!.def).toEqual(original);
    }
  });

  it("sobrevive dos vueltas seguidas sin degradarse", () => {
    const once = fromLevelDefinition(toLevelDefinition(documentWithProps(PROPS)));
    const twice = fromLevelDefinition(toLevelDefinition(once));

    const ids = (doc: typeof once): string[] =>
      doc.entities.filter((e) => e.kind === "propEntity").map((e) => e.eid.split("-")[0]!);
    expect(ids(twice)).toHaveLength(PROPS.length);
    const first = once.entities.find((e) => e.kind === "propEntity");
    const second = twice.entities.find((e) => e.kind === "propEntity");
    expect(second?.kind === "propEntity" && second.def).toEqual(
      first?.kind === "propEntity" ? first.def : null,
    );
  });

  it("un prop anclado con navBlocking emite su caja de navegacion", () => {
    const doc = documentWithProps([
      {
        id: "block",
        archetypeId: "concreteBlock",
        position: [0, 0, 0],
        physicsMode: "anchored",
        scale: 3,
      },
    ]);

    const level = toLevelDefinition(doc);

    expect(level.navBlockers).toHaveLength(1);
    expect(level.navBlockers?.[0]?.id).toBe("block-nav");
    // La caja invisible no aparece como geometría del nivel.
    expect(level.staticBoxes.some((box) => box.id === "block-nav")).toBe(false);
  });

  it("las operaciones genericas del editor mueven y rotan un prop", () => {
    const entity = documentWithProps([PROPS[1]!]).entities.find(
      (candidate) => candidate.kind === "propEntity",
    )!;

    expect(getPosition(entity)).toEqual([-4, 1.5, 6]);
    expect(getRotation(entity)).toEqual([0, 0.75, 0]);
  });
});
